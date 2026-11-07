import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { AccountStatus } from '../../common/enums/account-status.enum';
import { UserRole } from '../../common/enums/user-role.enum';

export class ListAccountsQueryDto {
  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Page must be a whole number' })
  @Min(1, { message: 'Page must be at least 1' })
  page?: number;

  @ApiPropertyOptional({ example: 'nour', description: 'Part of the name or email, case-insensitive.' })
  @IsOptional()
  @IsString({ message: 'Search must be text' })
  @MinLength(1, { message: 'Search must not be empty' })
  @MaxLength(100, { message: 'Search must be at most 100 characters' })
  search?: string;

  @ApiPropertyOptional({ enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole, { message: 'Role must be USER, ADMIN, AIRLINE_MODERATOR or HOTEL_MODERATOR' })
  role?: UserRole;

  @ApiPropertyOptional({ enum: AccountStatus })
  @IsOptional()
  @IsEnum(AccountStatus, { message: 'Status must be ACTIVE, SUSPENDED or DEACTIVATED' })
  status?: AccountStatus;
}
