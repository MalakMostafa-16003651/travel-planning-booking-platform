import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsMongoId, IsString, MaxLength, MinLength } from 'class-validator';
import { ReportTargetType } from '../report.enums';

export class CreateReportDto {
  @ApiProperty({ enum: ReportTargetType, description: 'Itineraries can be reported only while PUBLIC.' })
  @IsEnum(ReportTargetType, { message: 'Target type must be POST, COMMENT, REVIEW or ITINERARY' })
  targetType!: ReportTargetType;

  @ApiProperty({ pattern: '^[a-fA-F0-9]{24}$' })
  @IsMongoId({ message: 'Target ID must be a valid ID' })
  targetId!: string;

  @ApiProperty({ example: 'Insulting language towards other travellers', minLength: 5, maxLength: 500 })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString({ message: 'Reason must be text' })
  @MinLength(5, { message: 'Reason must be at least 5 characters' })
  @MaxLength(500, { message: 'Reason must be at most 500 characters' })
  reason!: string;
}
