import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { FAVORITES_PAGE_SIZE } from '../favorites.constants';

export class ListFavoritesQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: Math.floor(Number.MAX_SAFE_INTEGER / FAVORITES_PAGE_SIZE) })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Math.floor(Number.MAX_SAFE_INTEGER / FAVORITES_PAGE_SIZE))
  page?: number;
}
