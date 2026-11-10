import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReportStatus, ReportTargetType } from '../report.enums';

export class ReportDto {
  @ApiProperty() reportId!: string;
  @ApiProperty() userId!: string;
  @ApiPropertyOptional({ description: 'Reporter name, for the admin list.' }) userName?: string;
  @ApiProperty({ enum: ReportTargetType }) targetType!: ReportTargetType;
  @ApiProperty() targetId!: string;
  @ApiProperty() reason!: string;
  @ApiProperty({ enum: ReportStatus }) status!: ReportStatus;
  @ApiPropertyOptional({ type: String, nullable: true }) resolvedBy!: string | null;
  @ApiPropertyOptional({ type: Date, nullable: true }) resolvedAt!: Date | null;
  @ApiProperty() createdAt!: Date;
}

export class ReportPageDto {
  @ApiProperty({ type: ReportDto, isArray: true }) items!: ReportDto[];
  @ApiProperty({ example: 1 }) page!: number;
  @ApiProperty({ example: 10 }) pageSize!: number;
  @ApiProperty({ example: 4 }) total!: number;
}

export class ContentModerationResultDto {
  @ApiProperty({ enum: ['post', 'comment', 'review', 'itinerary'] }) type!: string;
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['HIDDEN', 'VISIBLE', 'DELETED'] }) state!: 'HIDDEN' | 'VISIBLE' | 'DELETED';
  @ApiProperty({ example: 2, description: 'Open reports about this content that were closed by this action.' }) closedReports!: number;
}
