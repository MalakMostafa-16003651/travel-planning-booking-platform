import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { AccountStatus } from '../common/enums/account-status.enum';
import { UsersService } from '../users/users.service';
import { AdminResetPasswordDto } from './dto/admin-reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { PasswordChangeIdentity } from './password-change.guard';
import { PasswordService } from './password.service';

@Injectable()
export class PasswordManagementService {
  constructor(private readonly users: UsersService, private readonly passwords: PasswordService) {}

  async setTemporaryPassword(userId: string, input: AdminResetPasswordDto): Promise<void> {
    const passwordHash = await this.passwords.hash(input.temporaryPassword);
    if (!await this.users.setTemporaryPassword(userId, passwordHash)) {
      throw new NotFoundException('User or moderator not found');
    }
    // The single User write increments the epoch. Old normal/restricted sessions
    // are invalid even if their TTL records have not yet been physically removed.
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
