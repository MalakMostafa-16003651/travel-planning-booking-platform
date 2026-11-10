import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { REVIEW_REPLY_MAX_LENGTH } from '../schemas/review.schema';

const trimmed = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;

/** HTL-26 (bonus): the text of the hotel's reply to a review; also used to edit it. */
export class ReviewReplyDto {
  @ApiProperty({ maxLength: REVIEW_REPLY_MAX_LENGTH, example: 'Thank you for staying with us. We look forward to welcoming you again.' })
  @Transform(trimmed)
  @IsString({ message: 'Reply must be text' })
  @IsNotEmpty({ message: 'Reply is required' })
  @MaxLength(REVIEW_REPLY_MAX_LENGTH, { message: `Reply must be at most ${REVIEW_REPLY_MAX_LENGTH} characters` })
  text!: string;
}
