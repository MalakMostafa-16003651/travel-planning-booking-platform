import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class FavoriteHotelDto {
  @ApiProperty() hotelId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() city!: string;
  @ApiProperty() countryCode!: string;
}

export class FavoriteItineraryDto {
  @ApiProperty() itineraryId!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ type: [String] }) countries!: string[];
  @ApiProperty({ type: [String] }) cities!: string[];
  @ApiProperty() startDate!: string;
  @ApiPropertyOptional() endDate?: string;
  @ApiProperty() dayCount!: number;
  @ApiProperty() currency!: string;
}

export class FavoriteDto {
  @ApiProperty() favoriteId!: string;
  @ApiProperty() userId!: string;
  @ApiPropertyOptional() hotelId?: string;
  @ApiPropertyOptional() itineraryId?: string;
  @ApiProperty({ description: 'False when the saved target is no longer publicly available. Its content is omitted.' })
  available!: boolean;
  @ApiPropertyOptional({ type: FavoriteHotelDto }) hotel?: FavoriteHotelDto;
  @ApiPropertyOptional({ type: FavoriteItineraryDto }) itinerary?: FavoriteItineraryDto;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

export class FavoritePageDto {
  @ApiProperty({ type: [FavoriteDto] }) items!: FavoriteDto[];
  @ApiProperty() page!: number;
  @ApiProperty({ example: 10 }) pageSize!: number;
  @ApiProperty({ description: 'Saved entries, including unavailable bookmarks. No hidden target content is returned.' }) total!: number;
  @ApiProperty() totalPages!: number;
}
