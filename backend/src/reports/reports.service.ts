import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter, Types } from 'mongoose';
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
   * GEN-10: resolves an OPEN report. The report is claimed atomically first, so two admins
   * cannot resolve it twice; if the content action then fails, the claim is undone.
   */
  async resolve(adminId: string, reportId: string, action: ReportAction): Promise<ReportDto> {
    const _id = new Types.ObjectId(reportId);
    const existing = await this.reports.findById(_id).lean().exec();
    if (!existing) throw new NotFoundException('Report not found');
    if (action !== ReportAction.DISMISS) this.content.assertSupported(existing.targetType);

    const status = action === ReportAction.DISMISS ? ReportStatus.DISMISSED
      : action === ReportAction.HIDE ? ReportStatus.CONTENT_HIDDEN : ReportStatus.CONTENT_DELETED;
    const claimed = await this.reports.findOneAndUpdate(
      { _id, status: ReportStatus.OPEN },
      { $set: { status, resolvedBy: new Types.ObjectId(adminId), resolvedAt: new Date() } },
      { returnDocument: 'after' },
    ).lean().exec();
    if (!claimed) throw new ConflictException(`Report is already ${existing.status}`);

    if (action === ReportAction.DISMISS) {
      await this.auditLogs.log({
        adminId, action: AuditAction.REPORT_DISMISSED, targetType: AuditTargetType.REPORT, targetId: reportId,
        details: `${claimed.targetType} ${claimed.targetId.toString()}: ${claimed.reason}`,
      });
      return toDto(claimed);
    }

    const targetId = claimed.targetId.toString();
    try {
      if (action === ReportAction.HIDE) await this.content.setHidden(claimed.targetType, targetId, true);
      else await this.content.delete(claimed.targetType, targetId);
    } catch (error: unknown) {
      if (isNotFound(error)) {
        // The content was already removed (by its author, or with its post): close every report about it.
        await this.closeOpenReports(claimed.targetType, targetId, ReportStatus.CONTENT_DELETED, adminId);
        const closed = await this.reports.findByIdAndUpdate(_id, { $set: { status: ReportStatus.CONTENT_DELETED } }, { returnDocument: 'after' }).lean().exec();
        return toDto(closed!);
      }
      await this.reports.updateOne({ _id }, { $set: { status: ReportStatus.OPEN, resolvedBy: null, resolvedAt: null } }).exec();
      throw error;
    }

    await this.closeOpenReports(claimed.targetType, targetId, status, adminId);
    await this.auditLogs.log({
      adminId,
      action: action === ReportAction.HIDE ? AuditAction.CONTENT_HIDDEN : AuditAction.CONTENT_DELETED,
      targetType: claimed.targetType as unknown as AuditTargetType,
      targetId,
      details: `Report ${reportId}: ${claimed.reason}`,
    });
    return toDto(claimed);
  }

  /** GEN-10: an admin hides, unhides or deletes content directly, without a report. */
  async moderate(adminId: string, type: ContentType, id: string, operation: 'hide' | 'unhide' | 'delete'): Promise<ContentModerationResultDto> {
    const targetType = toTargetType(type);
    if (operation === 'delete') await this.content.delete(targetType, id);
    else await this.content.setHidden(targetType, id, operation === 'hide');

    const closedReports = operation === 'unhide' ? 0
      : await this.closeOpenReports(targetType, id, operation === 'hide' ? ReportStatus.CONTENT_HIDDEN : ReportStatus.CONTENT_DELETED, adminId);
    await this.auditLogs.log({
      adminId,
      action: operation === 'hide' ? AuditAction.CONTENT_HIDDEN : operation === 'unhide' ? AuditAction.CONTENT_UNHIDDEN : AuditAction.CONTENT_DELETED,
      targetType: targetType as unknown as AuditTargetType,
      targetId: id,
    });
    return { type, id, state: operation === 'hide' ? 'HIDDEN' : operation === 'unhide' ? 'VISIBLE' : 'DELETED', closedReports };
  }

  private async closeOpenReports(targetType: ReportTargetType, targetId: string, status: ReportStatus, adminId: string): Promise<number> {
    const result = await this.reports.updateMany(
      { targetType, targetId: new Types.ObjectId(targetId), status: ReportStatus.OPEN },
      { $set: { status, resolvedBy: new Types.ObjectId(adminId), resolvedAt: new Date() } },
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
