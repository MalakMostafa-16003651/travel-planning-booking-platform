import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsMongoId, IsString, Length } from 'class-validator';
import { MAX_COMMENT_LENGTH } from '../blog.rules';

/** BLG-05 / BLG-07: non-empty, at most 500 characters, trimmed first. */
export class CreateCommentDto {
  @ApiProperty({ minLength: 1, maxLength: MAX_COMMENT_LENGTH, example: 'Great tips, thanks!' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, MAX_COMMENT_LENGTH)
  content!: string;
}

export class UpdateCommentDto extends CreateCommentDto {}

export class CommentIdParamDto {
  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  @IsMongoId({ message: 'id must be a valid id' })
  id!: string;
}
