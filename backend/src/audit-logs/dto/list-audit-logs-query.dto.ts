import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsISO8601, IsMongoId, IsOptional, Min } from 'class-validator';
import { AuditAction, AuditTargetType } from '../audit-log.enums';

export class ListAuditLogsQueryDto {
  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Page must be a whole number' })
  @Min(1, { message: 'Page must be at least 1' })
  page?: number;

  @ApiPropertyOptional({ enum: AuditAction })
  @IsOptional()
  @IsEnum(AuditAction, { message: 'Action is not a known audit action' })
  action?: AuditAction;

  @ApiPropertyOptional({ enum: AuditTargetType })
  @IsOptional()
  @IsEnum(AuditTargetType, { message: 'Target type is not a known audit target type' })
  targetType?: AuditTargetType;

  @ApiPropertyOptional({ description: 'Only actions by this administrator.', pattern: '^[a-fA-F0-9]{24}$' })
  @IsOptional()
  @IsMongoId({ message: 'Admin ID must be a valid ID' })
  adminId?: string;

  @ApiPropertyOptional({ example: '2026-11-01T00:00:00Z', description: 'Earliest action time, inclusive (ISO 8601).' })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'From must be an ISO 8601 date' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-11-30T23:59:59Z', description: 'Latest action time, inclusive (ISO 8601).' })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'To must be an ISO 8601 date' })
  to?: string;
}
