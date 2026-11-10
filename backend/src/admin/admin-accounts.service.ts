import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, QueryFilter, Types } from 'mongoose';
import { AuditAction, AuditTargetType } from '../audit-logs/audit-log.enums';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AccountStatus } from '../common/enums/account-status.enum';
import { UserRole } from '../common/enums/user-role.enum';
import { NotificationType } from '../notifications/notification-type.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { User, UserDocument } from '../users/schemas/user.schema';
import { AccountDto, AccountPageDto } from './dto/account-response.dto';
import { ListAccountsQueryDto } from './dto/list-accounts-query.dto';

/** GEN-05: every list uses page size 10. */
export const ACCOUNTS_PAGE_SIZE = 10;

/** Escapes user input so it is matched literally inside a regular expression. */
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

@Injectable()
export class AdminAccountsService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly auditLogs: AuditLogsService,
    private readonly notifications: NotificationsService,
  ) {}

  /** ACC-14: all accounts, newest first, 10 per page, searchable by name or email, filterable by role and status. */
  async list(query: ListAccountsQueryDto): Promise<AccountPageDto> {
    const page = query.page ?? 1;
    const filter: QueryFilter<User> = {};
    if (query.role) filter.role = query.role;
    if (query.status) filter.status = query.status;
    const search = query.search?.trim();
    if (search) {
      const pattern = new RegExp(escapeRegex(search), 'i');
      filter.$or = [{ name: pattern }, { email: pattern }];
    }
    const [rows, total] = await Promise.all([
      this.users.find(filter, { name: 1, email: 1, role: 1, status: 1, createdAt: 1 })
        .sort({ createdAt: -1, _id: -1 }).skip((page - 1) * ACCOUNTS_PAGE_SIZE).limit(ACCOUNTS_PAGE_SIZE).lean().exec(),
      this.users.countDocuments(filter).exec(),
    ]);
    return { items: rows.map(toDto), page, pageSize: ACCOUNTS_PAGE_SIZE, total };
  }

  /** ACC-15 (moderators) / ACC-16 (users): an ACTIVE account becomes SUSPENDED and can no longer log in. */
  suspend(adminId: string, accountId: string, reason?: string): Promise<AccountDto> {
    return this.changeStatus(adminId, accountId, AccountStatus.ACTIVE, AccountStatus.SUSPENDED, reason);
  }

  /** ACC-15 / ACC-16: a SUSPENDED account becomes ACTIVE again. DEACTIVATED (the user's own choice, ACC-12) is not reactivated here. */
  reactivate(adminId: string, accountId: string, reason?: string): Promise<AccountDto> {
    return this.changeStatus(adminId, accountId, AccountStatus.SUSPENDED, AccountStatus.ACTIVE, reason);
  }

  private async changeStatus(adminId: string, accountId: string, from: AccountStatus, to: AccountStatus, reason?: string): Promise<AccountDto> {
    const _id = new Types.ObjectId(accountId);
    return this.connection.transaction(async (session) => {
      // A concurrent winner forces a transaction retry before the expected-state check.
      const updated = await this.users.findOneAndUpdate(
        { _id, role: { $ne: UserRole.ADMIN }, status: from },
        { $set: { status: to } },
        { returnDocument: 'after', projection: { name: 1, email: 1, role: 1, status: 1, createdAt: 1 }, session },
      ).lean().exec();
      if (!updated) {
        const current = await this.users.findById(_id, { role: 1, status: 1 }).session(session).lean().exec();
        if (!current) throw new NotFoundException('Account not found');
        if (current.role === UserRole.ADMIN) throw new BadRequestException('Administrator accounts cannot be suspended or reactivated');
        throw new ConflictException(`Account is ${current.status}, not ${from}`);
      }
      const suspended = to === AccountStatus.SUSPENDED;
      await this.auditLogs.log({
        adminId,
        action: suspended ? AuditAction.ACCOUNT_SUSPENDED : AuditAction.ACCOUNT_REACTIVATED,
        targetType: AuditTargetType.USER,
        targetId: accountId,
        details: reason,
      }, session);
      // This persisted inbox entry joins the same database commit; no external delivery is involved.
      await this.notifications.notify({
        userId: accountId,
        type: suspended ? NotificationType.ACCOUNT_SUSPENDED : NotificationType.ACCOUNT_REACTIVATED,
        message: suspended
          ? 'Your account has been suspended by an administrator. Your existing bookings remain valid.'
          : 'Your account has been reactivated. You can log in again.',
      }, session);
      return toDto(updated);
    });
  }
}

function toDto(row: Pick<User, '_id' | 'name' | 'email' | 'role' | 'status' | 'createdAt'>): AccountDto {
  return {
    userId: row._id.toString(),
    name: row.name,
    email: row.email,
    role: row.role,
    status: row.status,
    createdAt: row.createdAt,
  };
}
