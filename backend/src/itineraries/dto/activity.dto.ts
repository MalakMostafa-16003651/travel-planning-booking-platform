import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { TIME_OF_DAY, Trim } from './transforms';

export class CreateActivityDto {
  @ApiProperty({ example: 'Visit the Egyptian Museum' })
  @Trim()
  @IsString({ message: 'Title must be text' })
  @Length(1, 120, { message: 'Title must be 1 to 120 characters' })
  title!: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @Trim()
  @IsString({ message: 'Description must be text' })
  @MaxLength(2000, { message: 'Description must be at most 2000 characters' })
  description?: string;

  @ApiPropertyOptional({ example: 'Tahrir Square' })
  @IsOptional()
  @Trim()
  @IsString({ message: 'Location must be text' })
  @MaxLength(200, { message: 'Location must be at most 200 characters' })
  location?: string;

  @ApiPropertyOptional({ description: 'Id from the seeded attractions dataset.' })
  @IsOptional()
  @Trim()
  @IsString({ message: 'attractionId must be text' })
  @Length(1, 64, { message: 'attractionId must be 1 to 64 characters' })
  attractionId?: string;

  @ApiPropertyOptional({ example: '09:30', description: 'Local time HH:mm' })
  @IsOptional()
  @Matches(TIME_OF_DAY, { message: 'Start time must be HH:mm' })
  startTime?: string;

  @ApiPropertyOptional({ example: '12:00', description: 'Local time HH:mm, not before startTime' })
  @IsOptional()
  @Matches(TIME_OF_DAY, { message: 'End time must be HH:mm' })
  endTime?: string;
}

export class UpdateActivityDto extends PartialType(CreateActivityDto) {}
