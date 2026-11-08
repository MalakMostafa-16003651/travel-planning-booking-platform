import { ApiProperty } from '@nestjs/swagger';
import { AccountStatus } from '../../common/enums/account-status.enum';
import { UserRole } from '../../common/enums/user-role.enum';

export class AccountDto {
  @ApiProperty() userId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ enum: UserRole }) role!: UserRole;
  @ApiProperty({ enum: AccountStatus }) status!: AccountStatus;
  @ApiProperty({ description: 'Registration date.' }) createdAt!: Date;
}

export class AccountPageDto {
  @ApiProperty({ type: AccountDto, isArray: true }) items!: AccountDto[];
  @ApiProperty({ example: 1 }) page!: number;
  @ApiProperty({ example: 10 }) pageSize!: number;
  @ApiProperty({ example: 57 }) total!: number;
}
