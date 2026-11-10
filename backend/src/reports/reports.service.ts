import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, QueryFilter, Types } from 'mongoose';
import { AuditAction, AuditTargetType } from '../audit-logs/audit-log.enums';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { UsersService } from '../users/users.service';
import { ContentModerationService } from './content-moderation.service';
import { CreateReportDto } from './dto/create-report.dto';
import { ListReportsQueryDto } from './dto/list-reports-query.dto';
import { ContentModerationResultDto, ReportDto, ReportPageDto } from './dto/report-response.dto';
import { ContentType, ReportAction, ReportStatus, ReportTargetType, toTargetType } from './report.enums';
import { Report, ReportDocument } from './schemas/report.schema';

/** GEN-05: every list uses page size 10. */
export const REPORTS_PAGE_SIZE = 10;

function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
}

function isNotFound(error: unknown): boolean {
  return error instanceof NotFoundException;
}

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    @InjectModel(Report.name) private readonly reports: Model<ReportDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly content: ContentModerationService,
    private readonly auditLogs: AuditLogsService,
    private readonly users: UsersService,
  ) {}

  /** GEN-09: a registered user reports an item with a reason, at most once per item. */
  async create(userId: string, input: CreateReportDto): Promise<ReportDto> {
    if (!(await this.content.exists(input.targetType, input.targetId))) {
      throw new NotFoundException(`${input.targetType.charAt(0)}${input.targetType.slice(1).toLowerCase()} not found`);
    }
    try {
      const report = await this.reports.create({
        userId: new Types.ObjectId(userId),
        targetType: input.targetType,
        targetId: new Types.ObjectId(input.targetId),
        reason: input.reason,
      });
      return toDto(report.toObject());
    } catch (error: unknown) {
      if (isDuplicateKey(error)) throw new ConflictException('You have already reported this item');
      throw error;
    }
  }

  /** GEN-10: open reports by default, newest first, 10 per page, with the reporter's name. */
  async list(query: ListReportsQueryDto): Promise<ReportPageDto> {
    const page = query.page ?? 1;
    const filter: QueryFilter<Report> = { status: query.status ?? ReportStatus.OPEN };
    if (query.targetType) filter.targetType = query.targetType;
    const [rows, total] = await Promise.all([
      this.reports.find(filter).sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * REPORTS_PAGE_SIZE).limit(REPORTS_PAGE_SIZE).lean().exec(),
      this.reports.countDocuments(filter).exec(),
    ]);
    const names = await this.users.getDisplayNames(rows.map((row) => row.userId.toString()));
    return {
      items: rows.map((row) => ({ ...toDto(row), userName: names.get(row.userId.toString()) })),
      page,
      pageSize: REPORTS_PAGE_SIZE,
      total,
    };
  }

  /**
   * GEN-10: resolves an OPEN report.
   *
   * GEN-07 recovery: the report's state change and its audit entry always commit together in
   * one transaction. The content owners' hide/delete operations do not take a session, so they
   * run between the claim and that commit; if the audit commit fails, the claim is released and
   * a retry completes the missing report change and audit entry (hiding again is harmless; a
   * repeated delete finds the content gone and is recorded as such).
   */
  async resolve(adminId: string, reportId: string, action: ReportAction): Promise<ReportDto> {
    const _id = new Types.ObjectId(reportId);
    const existing = await this.reports.findById(_id).lean().exec();
    if (!existing) throw new NotFoundException('Report not found');
    if (existing.status !== ReportStatus.OPEN) throw new ConflictException(`Report is already ${existing.status}`);

    if (action === ReportAction.DISMISS) {
      return this.connection.transaction(async (session) => {
        const dismissed = await this.claim(_id, ReportStatus.DISMISSED, adminId, session);
        await this.auditLogs.log({
          adminId, action: AuditAction.REPORT_DISMISSED, targetType: AuditTargetType.REPORT, targetId: reportId,
          details: `${dismissed.targetType} ${dismissed.targetId.toString()}: ${dismissed.reason}`,
        }, session);
        return toDto(dismissed);
      });
    }

    // Claim first, outside the commit below, so two admins cannot both act on the content.
    const claimed = await this.claim(_id, ReportStatus.RESOLVING, adminId);
    const targetId = claimed.targetId.toString();
    let status = action === ReportAction.HIDE ? ReportStatus.CONTENT_HIDDEN : ReportStatus.CONTENT_DELETED;
    let auditAction = action === ReportAction.HIDE ? AuditAction.CONTENT_HIDDEN : AuditAction.CONTENT_DELETED;
    let details = `Report ${reportId}: ${claimed.reason}`;
    try {
      if (action === ReportAction.HIDE) await this.content.setHidden(claimed.targetType, targetId, true);
      else await this.content.delete(claimed.targetType, targetId);
    } catch (error: unknown) {
      if (!isNotFound(error)) {
        await this.release(_id);
        throw error;
      }
      // Already removed (by its author, with its post, or by an earlier attempt of this request).
      status = ReportStatus.CONTENT_DELETED;
      auditAction = AuditAction.CONTENT_DELETED;
      details = `Report ${reportId}: content was already removed. ${claimed.reason}`;
    }

    try {
      return await this.connection.transaction(async (session) => {
        const resolved = await this.reports.findOneAndUpdate(
          { _id, status: ReportStatus.RESOLVING },
          { $set: { status } },
          { returnDocument: 'after', session },
        ).lean().exec();
        if (!resolved) throw new ConflictException('Report changed while it was being resolved');
        await this.closeOpenReports(claimed.targetType, targetId, status, adminId, session);
        await this.auditLogs.log({
          adminId, action: auditAction, targetType: claimed.targetType as unknown as AuditTargetType, targetId, details,
        }, session);
        return toDto(resolved);
      });
    } catch (error: unknown) {
      await this.release(_id);
      throw error;
    }
  }

  /**
   * GEN-10: an admin hides, unhides or deletes content directly, without a report. Closing the
   * open reports and the audit entry commit together after the owner's operation; a retry after
   * an audit failure repeats the (idempotent) hide/unhide and records it.
   */
  async moderate(adminId: string, type: ContentType, id: string, operation: 'hide' | 'unhide' | 'delete'): Promise<ContentModerationResultDto> {
    const targetType = toTargetType(type);
    await this.content.assertDirectlyModeratable(targetType, id);
    if (operation === 'delete') await this.content.delete(targetType, id);
    else await this.content.setHidden(targetType, id, operation === 'hide');

    const closedReports = await this.connection.transaction(async (session) => {
      const closed = operation === 'unhide' ? 0
        : await this.closeOpenReports(targetType, id, operation === 'hide' ? ReportStatus.CONTENT_HIDDEN : ReportStatus.CONTENT_DELETED, adminId, session);
      await this.auditLogs.log({
        adminId,
        action: operation === 'hide' ? AuditAction.CONTENT_HIDDEN : operation === 'unhide' ? AuditAction.CONTENT_UNHIDDEN : AuditAction.CONTENT_DELETED,
        targetType: targetType as unknown as AuditTargetType,
        targetId: id,
      }, session);
      return closed;
    });
    return { type, id, state: operation === 'hide' ? 'HIDDEN' : operation === 'unhide' ? 'VISIBLE' : 'DELETED', closedReports };
  }

  /** Atomically moves an OPEN report on; a concurrent resolution makes this a 409. */
  private async claim(_id: Types.ObjectId, status: ReportStatus, adminId: string, session?: ClientSession): Promise<Report> {
    const claimed = await this.reports.findOneAndUpdate(
      { _id, status: ReportStatus.OPEN },
      { $set: { status, resolvedBy: new Types.ObjectId(adminId), resolvedAt: new Date() } },
      { returnDocument: 'after', session },
    ).lean().exec();
    if (!claimed) throw new ConflictException('Report is already being resolved or resolved');
    return claimed;
  }

  /** Returns an unfinished claim to OPEN so the admin can retry. */
  private async release(_id: Types.ObjectId): Promise<void> {
    try {
      await this.reports.updateOne({ _id, status: ReportStatus.RESOLVING }, { $set: { status: ReportStatus.OPEN, resolvedBy: null, resolvedAt: null } }).exec();
    } catch {
      this.logger.error(`Report ${_id.toString()} stays RESOLVING; it can be reopened by setting it back to OPEN`);
    }
  }

  private async closeOpenReports(targetType: ReportTargetType, targetId: string, status: ReportStatus, adminId: string, session: ClientSession): Promise<number> {
    const result = await this.reports.updateMany(
      { targetType, targetId: new Types.ObjectId(targetId), status: ReportStatus.OPEN },
      { $set: { status, resolvedBy: new Types.ObjectId(adminId), resolvedAt: new Date() } },
      { session },
    ).exec();
    return result.modifiedCount;
  }
}

function toDto(row: Report): ReportDto {
  return {
    reportId: row._id.toString(),
    userId: row.userId.toString(),
    targetType: row.targetType,
    targetId: row.targetId.toString(),
    reason: row.reason,
    status: row.status,
    resolvedBy: row.resolvedBy ? row.resolvedBy.toString() : null,
    resolvedAt: row.resolvedAt ?? null,
    createdAt: row.createdAt,
  };
}
