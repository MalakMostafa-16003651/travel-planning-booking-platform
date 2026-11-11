import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { REVIEW_COMMENT_MAX_LENGTH } from '../schemas/review.schema';
import { normalizeComment } from './create-review.dto';

/** HTL-23: change the rating, the review text, or both. An empty or null comment removes the text. */
export class UpdateReviewDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 5, example: 5 })
  @ValidateIf((_, value) => value !== undefined)
  @IsInt({ message: 'Rating must be a whole number' })
  @Min(1, { message: 'Rating must be between 1 and 5' })
  @Max(5, { message: 'Rating must be between 1 and 5' })
  rating?: number;

  @ApiPropertyOptional({ maxLength: REVIEW_COMMENT_MAX_LENGTH, example: 'Even better on a second look.', nullable: true })
  @Transform(normalizeComment)
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString({ message: 'Comment must be text' })
  @MaxLength(REVIEW_COMMENT_MAX_LENGTH, { message: `Comment must be at most ${REVIEW_COMMENT_MAX_LENGTH} characters` })
  comment?: string | null;
}
