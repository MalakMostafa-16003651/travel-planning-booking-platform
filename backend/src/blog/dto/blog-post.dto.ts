import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEnum, IsInt, IsMongoId, IsOptional, IsString, Length, Min, ValidateIf } from 'class-validator';
import { CONTENT_LENGTH, MAX_TAG_LENGTH, MAX_TAGS_PER_POST, PostStatus, TITLE_LENGTH } from '../blog.rules';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Tags are trimmed, lowercased and de-duplicated before they are validated. */
function normalizeTags({ value }: { value: unknown }): unknown {
  if (!Array.isArray(value)) return value;
  return [...new Set(value.map((tag: unknown) => (typeof tag === 'string' ? tag.trim().toLowerCase() : tag)))];
}

/** Like @IsOptional(), but only for a missing field: null is validated, and rejected. */
const OptionalNotNull = () => ValidateIf((_object, value: unknown) => value !== undefined);

export class CreateBlogPostDto {
  @ApiProperty({ minLength: TITLE_LENGTH.min, maxLength: TITLE_LENGTH.max, example: 'Three days in Luxor' })
  @Transform(trim)
  @IsString()
  @Length(TITLE_LENGTH.min, TITLE_LENGTH.max)
  title!: string;

  @ApiProperty({ minLength: CONTENT_LENGTH.min, maxLength: CONTENT_LENGTH.max, example: 'We started at Karnak at sunrise...' })
  @Transform(trim)
  @IsString()
  @Length(CONTENT_LENGTH.min, CONTENT_LENGTH.max)
  content!: string;

  @ApiPropertyOptional({ type: [String], maxItems: MAX_TAGS_PER_POST, example: ['egypt', 'nile'], description: `At most ${MAX_TAGS_PER_POST}, each 1-${MAX_TAG_LENGTH} characters; trimmed, lowercased, duplicates removed.` })
  @OptionalNotNull()
  @Transform(normalizeTags)
  @IsArray()
  @ArrayMaxSize(MAX_TAGS_PER_POST)
  @IsString({ each: true })
  @Length(1, MAX_TAG_LENGTH, { each: true })
  tags?: string[];

  @ApiPropertyOptional({ enum: PostStatus, default: PostStatus.DRAFT, description: 'DRAFT saves; PUBLISHED publishes.' })
  @OptionalNotNull()
  @IsEnum(PostStatus)
  status?: PostStatus;

  @ApiPropertyOptional({ description: 'BLG-13 (bonus): attach one of your own PUBLIC itineraries.' })
  @OptionalNotNull()
  @IsMongoId({ message: 'itineraryId must be a valid id' })
  itineraryId?: string;
}

/** Every field optional, but null is rejected. Written out because PartialType lets null through. */
export class UpdateBlogPostDto {
  @ApiPropertyOptional({ minLength: TITLE_LENGTH.min, maxLength: TITLE_LENGTH.max })
  @OptionalNotNull()
  @Transform(trim)
  @IsString()
  @Length(TITLE_LENGTH.min, TITLE_LENGTH.max)
  title?: string;

  @ApiPropertyOptional({ minLength: CONTENT_LENGTH.min, maxLength: CONTENT_LENGTH.max })
  @OptionalNotNull()
  @Transform(trim)
  @IsString()
  @Length(CONTENT_LENGTH.min, CONTENT_LENGTH.max)
  content?: string;

  @ApiPropertyOptional({ type: [String], maxItems: MAX_TAGS_PER_POST })
  @OptionalNotNull()
  @Transform(normalizeTags)
  @IsArray()
  @ArrayMaxSize(MAX_TAGS_PER_POST)
  @IsString({ each: true })
  @Length(1, MAX_TAG_LENGTH, { each: true })
  tags?: string[];

  @ApiPropertyOptional({ enum: PostStatus })
  @OptionalNotNull()
  @IsEnum(PostStatus)
  status?: PostStatus;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'BLG-13 (bonus): attach one of your own PUBLIC itineraries; null removes it.' })
  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsMongoId({ message: 'itineraryId must be a valid id' })
  itineraryId?: string | null;
}

/** GEN-05: page size is fixed at 10. */
export class PageQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;
}

/** BLG-12: `page` is for the posts, `itinerariesPage` for the public itineraries. */
export class AuthorPageQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1, description: 'Page of the public itineraries (page size 10).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  itinerariesPage: number = 1;
}

export class ListPostsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: 'BLG-09: keyword in the title, tags or author name. Results are ordered by likes + comments, newest first on ties.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  q?: string;

  @ApiPropertyOptional({ description: 'BLG-02: only posts with this tag.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, MAX_TAG_LENGTH)
  tag?: string;
}

export class PostIdParamDto {
  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  @IsMongoId({ message: 'id must be a valid id' })
  id!: string;
}

export class TagParamDto {
  @ApiProperty({ example: 'egypt' })
  @Transform(trim)
  @IsString()
  @Length(1, MAX_TAG_LENGTH)
  tag!: string;
}

export class AuthorIdParamDto {
  @ApiProperty({ description: 'The author\'s userId', example: '507f1f77bcf86cd799439011' })
  @IsMongoId({ message: 'id must be a valid id' })
  id!: string;
}


export class PostImageParamsDto {
  @ApiProperty({ description: 'postId', example: '507f1f77bcf86cd799439011' })
  @IsMongoId({ message: 'id must be a valid id' })
  id!: string;

  @ApiProperty({ example: '507f1f77bcf86cd799439012' })
  @IsMongoId({ message: 'imageId must be a valid id' })
  imageId!: string;
}
