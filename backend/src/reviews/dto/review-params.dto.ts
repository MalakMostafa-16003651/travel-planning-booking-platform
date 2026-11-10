import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsMongoId, IsOptional, Min } from 'class-validator';

export class ReviewIdParamsDto {
  @ApiProperty({ description: 'reviewId', pattern: '^[a-fA-F0-9]{24}$', example: '507f1f77bcf86cd799439011' })
  @IsMongoId({ message: 'Review ID must be a valid ID' })
  id!: string;
}

export class HotelIdParamsDto {
  @ApiProperty({ description: 'hotelId', pattern: '^[a-fA-F0-9]{24}$', example: '507f1f77bcf86cd799439011' })
  @IsMongoId({ message: 'Hotel ID must be a valid ID' })
  id!: string;
}

export class ListReviewsQueryDto {
  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Page must be a whole number' })
  @Min(1, { message: 'Page must be at least 1' })
  page?: number;
}
