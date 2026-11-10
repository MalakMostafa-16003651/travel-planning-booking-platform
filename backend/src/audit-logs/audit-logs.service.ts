import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, isValidObjectId, Model, QueryFilter, Types } from 'mongoose';
import { UsersService } from '../users/users.service';
import { AuditAction, AuditTargetType } from './audit-log.enums';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto';
import { AuditLogDto, AuditLogPageDto } from './dto/audit-log-response.dto';
import { AuditLog, AuditLogDocument } from './schemas/audit-log.schema';

/** GEN-05: every list uses page size 10. */
export const AUDIT_LOGS_PAGE_SIZE = 10;

export interface AuditLogInput {
  adminId: string;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string;
  details?: string;
}

@Injectable()
export class AuditLogsService {
  constructor(
    @InjectModel(AuditLog.name) private readonly auditLogs: Model<AuditLogDocument>,
    private readonly users: UsersService,
  ) {}

  /**
   * GEN-07: records one admin action. Pass the caller's session to commit the action
   * and audit together. Legacy callers without a session retain their existing behavior.
   */
  async log(input: AuditLogInput, session?: ClientSession): Promise<void> {
    if (!isValidObjectId(input.adminId) || !isValidObjectId(input.targetId)) {
      throw new Error('Audit log entries need valid admin and target IDs');
    }
    await this.auditLogs.create([{
      adminId: new Types.ObjectId(input.adminId),
      action: input.action,
      targetType: input.targetType,
      targetId: new Types.ObjectId(input.targetId),
      details: input.details,
    }], { session });
  }

  /** GEN-07: newest first, page size 10, optional filters. */
  async list(query: ListAuditLogsQueryDto): Promise<AuditLogPageDto> {
    const page = query.page ?? 1;
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    // ISO validation also accepts week/ordinal/basic dates which JavaScript's
    // Date parser cannot read. Reject those before Mongoose casts the filter.
    const errors: Record<string, string[]> = {};
    if (from && !Number.isFinite(from.getTime())) errors.from = ['From must be a supported ISO 8601 date'];
    if (to && !Number.isFinite(to.getTime())) errors.to = ['To must be a supported ISO 8601 date'];
    if (Object.keys(errors).length > 0) {
      throw new BadRequestException({ message: 'Validation failed', errors });
    }
    if (from && to && from > to) {
      throw new BadRequestException({ message: 'Validation failed', errors: { from: ['From must not be after To'] } });
    }

    const filter: QueryFilter<AuditLog> = {};
    if (query.action) filter.action = query.action;
    if (query.targetType) filter.targetType = query.targetType;
    if (query.adminId) filter.adminId = new Types.ObjectId(query.adminId);
    if (from || to) filter.createdAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };

    const [rows, total] = await Promise.all([
      this.auditLogs.find(filter).sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * AUDIT_LOGS_PAGE_SIZE).limit(AUDIT_LOGS_PAGE_SIZE).lean().exec(),
      this.auditLogs.countDocuments(filter).exec(),
    ]);
    const names = await this.users.getDisplayNames(rows.map((row) => row.adminId.toString()));

    const items: AuditLogDto[] = rows.map((row) => ({
      auditLogId: row._id.toString(),
      adminId: row.adminId.toString(),
      adminName: names.get(row.adminId.toString()),
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId.toString(),
      details: row.details,
      createdAt: row.createdAt,
    }));
    return { items, page, pageSize: AUDIT_LOGS_PAGE_SIZE, total };
  }
}
