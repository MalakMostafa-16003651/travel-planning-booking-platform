import { Transform } from 'class-transformer';
const trimmed = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayUnique, IsArray, IsInt, Max, Min, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateHotelDto {
  @ApiProperty({ example: 'Nile Grand Hotel' })
  @Transform(trimmed) @IsString() @MinLength(2) @MaxLength(150)
  name!: string;

  @ApiProperty({ example: 'Cairo', description: 'Resolved against the official reference city/country catalog.' })
  @IsString() @MinLength(1) @MaxLength(100)
  city!: string;

  @ApiPropertyOptional({ example: 'EG', description: 'Disambiguates the city when more than one match exists.' })
  @IsOptional() @IsString() @Matches(/^[A-Z]{2}$/)
  countryCode?: string;

  @ApiProperty({ example: '12 Nile Corniche, Cairo' })
  @IsString() @MinLength(2) @MaxLength(300)
  address!: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional() @IsString() @MaxLength(2000)
  description?: string;

  @ApiProperty({ example: 4, minimum: 1, maximum: 5 })
  @IsInt() @Min(1) @Max(5)
  starClass!: number;

  @ApiProperty({ type: [String], example: ['Wi-Fi', 'Pool'], maxItems: 50 })
  @Transform(({value}) => Array.isArray(value) ? value.map(v=>typeof v==='string'?v.trim():v) : value)
  @IsArray() @ArrayMaxSize(50) @ArrayUnique() @IsString({each:true}) @MinLength(1,{each:true}) @MaxLength(100,{each:true})
  amenities!: string[];
}
