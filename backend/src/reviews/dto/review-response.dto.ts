import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** ACC-12: a deactivated or missing author is "Deleted user" with no id. */
export class ReviewAuthorDto {
  @ApiPropertyOptional({ nullable: true, description: 'Null for a deactivated author.' }) userId!: string | null;
  @ApiProperty({ example: 'Alice' }) name!: string;
}

export class ReviewDto {
  @ApiProperty() reviewId!: string;
  @ApiProperty() hotelId!: string;
  @ApiProperty({ minimum: 1, maximum: 5, example: 4 }) rating!: number;
  @ApiProperty({ nullable: true, example: 'Friendly staff and a great view of the Nile.' }) comment!: string | null;
  @ApiProperty({ description: 'GEN-10: hidden reviews are shown only to their author and admins.' }) isHidden!: boolean;
  @ApiProperty({ type: ReviewAuthorDto }) author!: ReviewAuthorDto;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

/** HTL-24: newest first, page size 10, with the hotel's rating summary. */
export class HotelReviewsPageDto {
  @ApiProperty({ type: [ReviewDto] }) items!: ReviewDto[];
  @ApiProperty({ example: 1 }) page!: number;
  @ApiProperty({ example: 10 }) pageSize!: number;
  @ApiProperty({ description: 'Reviews this viewer can see.', example: 1 }) total!: number;
  @ApiProperty({ nullable: true, description: 'Average of visible ratings, 2 decimals; null when unrated.', example: 4.5 }) averageRating!: number | null;
  @ApiProperty({ description: 'Number of visible ratings.', example: 2 }) ratingCount!: number;
}
