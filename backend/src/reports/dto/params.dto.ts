import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsMongoId } from 'class-validator';
import { CONTENT_TYPES, ContentType } from '../report.enums';

export class ReportIdParamsDto {
  @ApiProperty({ pattern: '^[a-fA-F0-9]{24}$' })
  @IsMongoId({ message: 'Report ID must be a valid ID' })
  id!: string;
}

export class ContentParamsDto {
  @ApiProperty({ enum: CONTENT_TYPES, description: 'Case-insensitive, so the uppercase report targetType (e.g. POST) is accepted too.' })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.toLowerCase() : value)
  @IsIn(CONTENT_TYPES, { message: 'Type must be post, comment, review or itinerary' })
  type!: ContentType;

  @ApiProperty({ pattern: '^[a-fA-F0-9]{24}$' })
  @IsMongoId({ message: 'Content ID must be a valid ID' })
  id!: string;
}
