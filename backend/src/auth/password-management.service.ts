import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { AuditAction, AuditTargetType } from '../audit-logs/audit-log.enums';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { AccountStatus } from '../common/enums/account-status.enum';
import { UsersService } from '../users/users.service';
import { AdminResetPasswordDto } from './dto/admin-reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { PasswordChangeIdentity } from './password-change.guard';
import { PasswordService } from './password.service';

@Injectable()
export class PasswordManagementService {
  constructor(
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    @InjectConnection() private readonly connection: Connection,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async setTemporaryPassword(userId: string, input: AdminResetPasswordDto, adminId: string): Promise<void> {
    const passwordHash = await this.passwords.hash(input.temporaryPassword);
    await this.connection.transaction(async (session) => {
      if (!await this.users.setTemporaryPassword(userId, passwordHash, session)) {
        throw new NotFoundException('User or moderator not found');
      }
      await this.auditLogs.log({
        adminId,
        action: AuditAction.PASSWORD_RESET,
        targetType: AuditTargetType.USER,
        targetId: userId,
      }, session);
    });
    // Only a committed reset increments the epoch. Never put credentials in audit details.
  }

  async changePassword(identity: PasswordChangeIdentity, input: ChangePasswordDto): Promise<void> {
    const user = await this.users.findForPasswordChange(identity.userId);
    if (
      !user || user.status !== AccountStatus.ACTIVE ||
      user.credentialVersion !== identity.credentialVersion ||
      user.mustChangePassword !== identity.mustChangePassword
    ) throw new UnauthorizedException('Invalid or expired session');

    if (!await this.passwords.verify(input.currentPassword, user.passwordHash)) {
      throw new UnauthorizedException('Invalid current password');
    }
    if (input.newPassword === input.currentPassword) {
      throw new BadRequestException({
        message: 'New password must be different from the current password',
        errors: { newPassword: ['New password must be different from the current password'] },
      });
    }
    const passwordHash = await this.passwords.hash(input.newPassword);
    const replaced = await this.users.replacePassword(
      identity.userId, user.passwordHash, identity.credentialVersion,
      passwordHash, identity.mustChangePassword,
    );
    if (!replaced) throw new UnauthorizedException('Invalid or expired session');
  }
}
