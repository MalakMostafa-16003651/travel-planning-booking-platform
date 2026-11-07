import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AuditAction, AuditTargetType } from '../audit-log.enums';

export class AuditLogDto {
  @ApiProperty() auditLogId!: string;
  @ApiProperty() adminId!: string;
  @ApiPropertyOptional({ description: 'Absent if the admin account no longer exists.' }) adminName?: string;
  @ApiProperty({ enum: AuditAction }) action!: AuditAction;
  @ApiProperty({ enum: AuditTargetType }) targetType!: AuditTargetType;
  @ApiProperty() targetId!: string;
  @ApiPropertyOptional() details?: string;
  @ApiProperty() createdAt!: Date;
}

export class AuditLogPageDto {
  @ApiProperty({ type: AuditLogDto, isArray: true }) items!: AuditLogDto[];
  @ApiProperty({ example: 1 }) page!: number;
  @ApiProperty({ example: 10 }) pageSize!: number;
  @ApiProperty({ example: 42 }) total!: number;
}
