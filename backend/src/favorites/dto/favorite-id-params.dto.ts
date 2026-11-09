import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';

export class FavoriteIdParamsDto {
  @ApiProperty()
  @IsMongoId({ message: 'favoriteId must be a MongoDB ID' })
  favoriteId!: string;
}
