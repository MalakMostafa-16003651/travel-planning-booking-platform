import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
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
    const filter: QueryFilter<Report> = { status: query.status ?? { $in: [ReportStatus.OPEN, ReportStatus.RESOLVING] } };
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

  /** Claim, owner mutation, report closure and audit commit as one database action. */
  async resolve(adminId: string, reportId: string, action: ReportAction): Promise<ReportDto> {
    const _id = new Types.ObjectId(reportId);
    return this.connection.transaction(async (session) => {
      const existing = await this.reports.findById(_id).session(session).lean().exec();
      if (!existing) throw new NotFoundException('Report not found');
      if (![ReportStatus.OPEN, ReportStatus.RESOLVING].includes(existing.status)) {
        throw new ConflictException('Report is already resolved');
      }
      // RESOLVING may be left by the old nontransactional implementation. New claims
      // never commit in that intermediate state, and concurrent retries serialize here.
      const claimed = await this.claim(_id, ReportStatus.RESOLVING, adminId, session);
      if (action === ReportAction.DISMISS) {
        const dismissed = await this.reports.findByIdAndUpdate(_id, { $set: { status: ReportStatus.DISMISSED } },
          { session, returnDocument: 'after' }).lean().orFail().exec();
        await this.auditLogs.log({ adminId, action: AuditAction.REPORT_DISMISSED,
          targetType: AuditTargetType.REPORT, targetId: reportId,
          details: auditSummary(claimed.targetType + ' ' + claimed.targetId.toString() + ': ', claimed.reason) }, session);
        return toDto(dismissed);
      }
      const targetId = claimed.targetId.toString();
      let status = action === ReportAction.HIDE ? ReportStatus.CONTENT_HIDDEN : ReportStatus.CONTENT_DELETED;
      let auditAction = action === ReportAction.HIDE ? AuditAction.CONTENT_HIDDEN : AuditAction.CONTENT_DELETED;
      let prefix = 'Report ' + reportId + ': ';
      try {
        if (action === ReportAction.HIDE) await this.content.setHidden(claimed.targetType, targetId, true, session);
        else await this.content.delete(claimed.targetType, targetId, session);
      } catch (error) {
        if (!isNotFound(error)) throw error;
        status = ReportStatus.CONTENT_DELETED;
        auditAction = AuditAction.CONTENT_DELETED;
        prefix += 'content was already removed. ';
      }
      const resolved = await this.reports.findByIdAndUpdate(_id, { $set: { status } },
        { session, returnDocument: 'after' }).lean().orFail().exec();
      await this.closeOpenReports(claimed.targetType, targetId, status, adminId, session);
      await this.auditLogs.log({ adminId, action: auditAction,
        targetType: claimed.targetType as unknown as AuditTargetType, targetId,
        details: auditSummary(prefix, claimed.reason) }, session);
      return toDto(resolved);
    });
  }

  /** Direct moderation has the same atomic audit boundary as report-driven actions. */
  async moderate(adminId: string, type: ContentType, id: string, operation: 'hide' | 'unhide' | 'delete'): Promise<ContentModerationResultDto> {
    const targetType = toTargetType(type);
    return this.connection.transaction(async (session) => {
      await this.content.assertDirectlyModeratable(targetType, id, session);
      if (operation === 'delete') await this.content.delete(targetType, id, session);
      else await this.content.setHidden(targetType, id, operation === 'hide', session);
      const closedReports = operation === 'unhide' ? 0
        : await this.closeOpenReports(targetType, id, operation === 'hide' ? ReportStatus.CONTENT_HIDDEN : ReportStatus.CONTENT_DELETED, adminId, session);
      await this.auditLogs.log({ adminId,
        action: operation === 'hide' ? AuditAction.CONTENT_HIDDEN : operation === 'unhide' ? AuditAction.CONTENT_UNHIDDEN : AuditAction.CONTENT_DELETED,
        targetType: targetType as unknown as AuditTargetType, targetId: id }, session);
      return { type, id, state: operation === 'hide' ? 'HIDDEN' : operation === 'unhide' ? 'VISIBLE' : 'DELETED', closedReports };
    });
  }

  /** Atomically moves an OPEN report on; a concurrent resolution makes this a 409. */
  private async claim(_id: Types.ObjectId, status: ReportStatus, adminId: string, session?: ClientSession): Promise<Report> {
    const claimed = await this.reports.findOneAndUpdate(
      { _id, status: { $in: [ReportStatus.OPEN, ReportStatus.RESOLVING] } },
      { $set: { status, resolvedBy: new Types.ObjectId(adminId), resolvedAt: new Date() } },
      { returnDocument: 'after', session },
    ).lean().exec();
    if (!claimed) throw new ConflictException('Report is already being resolved or resolved');
    return claimed;
  }

  private async closeOpenReports(targetType: ReportTargetType, targetId: string, status: ReportStatus, adminId: string, session: ClientSession): Promise<number> {
    const result = await this.reports.updateMany(
      { targetType, targetId: new Types.ObjectId(targetId), status: { $in: [ReportStatus.OPEN, ReportStatus.RESOLVING] } },
      { $set: { status, resolvedBy: new Types.ObjectId(adminId), resolvedAt: new Date() } },
      { session },
    ).exec();
    return result.modifiedCount;
  }
}

/** Full reason is retained on the report; the audit stores a bounded linked summary. */
function auditSummary(prefix: string, reason: string): string {
  const summary = prefix + reason;
  return summary.length > 500 ? summary.slice(0, 499) + '…' : summary;
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
