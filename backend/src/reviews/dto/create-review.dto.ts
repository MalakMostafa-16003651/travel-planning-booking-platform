import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { REVIEW_COMMENT_MAX_LENGTH } from '../schemas/review.schema';

/** Trims text; an empty review text means "no review text". */
export function normalizeComment({ value }: { value: unknown }): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** HTL-23: a rating from 1 to 5 and an optional review of up to 1000 characters. */
export class CreateReviewDto {
  @ApiProperty({ minimum: 1, maximum: 5, example: 4 })
  @IsInt({ message: 'Rating must be a whole number' })
  @Min(1, { message: 'Rating must be between 1 and 5' })
  @Max(5, { message: 'Rating must be between 1 and 5' })
  rating!: number;

  @ApiPropertyOptional({ maxLength: REVIEW_COMMENT_MAX_LENGTH, example: 'Friendly staff and a great view of the Nile.', nullable: true })
  @IsOptional()
  @Transform(normalizeComment)
  @IsString({ message: 'Comment must be text' })
  @MaxLength(REVIEW_COMMENT_MAX_LENGTH, { message: `Comment must be at most ${REVIEW_COMMENT_MAX_LENGTH} characters` })
  comment?: string | null;
}
