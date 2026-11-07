import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { ReportStatus, ReportTargetType } from '../report.enums';

export class ListReportsQueryDto {
  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Page must be a whole number' })
  @Min(1, { message: 'Page must be at least 1' })
  page?: number;

  @ApiPropertyOptional({ enum: ReportStatus, default: ReportStatus.OPEN })
  @IsOptional()
  @IsEnum(ReportStatus, { message: 'Status is not a known report status' })
  status?: ReportStatus;

  @ApiPropertyOptional({ enum: ReportTargetType })
  @IsOptional()
  @IsEnum(ReportTargetType, { message: 'Target type must be POST, COMMENT, REVIEW or ITINERARY' })
  targetType?: ReportTargetType;
}
