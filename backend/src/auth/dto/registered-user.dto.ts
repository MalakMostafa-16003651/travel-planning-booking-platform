import { ApiProperty } from '@nestjs/swagger';
import { AccountStatus } from '../../common/enums/account-status.enum';
import { UserRole } from '../../common/enums/user-role.enum';
import { UserDocument } from '../../users/schemas/user.schema';

export class RegisteredUserDto {
  @ApiProperty({ example: '650000000000000000000001' })
  userId!: string;

  @ApiProperty({ example: 'Alex Traveler' })
  name!: string;

  @ApiProperty({ example: 'alex@example.com' })
  email!: string;

  @ApiProperty({ enum: UserRole, example: UserRole.USER })
  role!: UserRole;

  @ApiProperty({ enum: AccountStatus, example: AccountStatus.ACTIVE })
  status!: AccountStatus;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  static fromUser(user: UserDocument): RegisteredUserDto {
    return {
      userId: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
