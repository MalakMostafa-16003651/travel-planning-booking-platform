import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Matches, ValidateIf } from 'class-validator';

export class UpdateUserDto {
  @ApiPropertyOptional({ description: 'Display name; surrounding whitespace is trimmed.' })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString({ message: 'Name must be a string' })
  @IsNotEmpty({ message: 'Name is required' })
  name?: string;

  @ApiPropertyOptional({
    example: '+201012345678',
    pattern: '^\\+[1-9]\\d{7,14}$',
    description: 'International phone format: + followed by 8–15 digits, without separators. Omit to retain the existing value.',
  })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString({ message: 'Phone number must be a string' })
  @Matches(/^\+[1-9]\d{7,14}$/, { message: 'Phone number must use international format with + and 8 to 15 digits' })
  phoneNumber?: string;

  @ApiPropertyOptional({
    example: 'EGP',
    pattern: '^[A-Z]{3}$',
    description: 'Code from GET /api/currencies; trimmed and uppercased. Omit to retain the existing value.',
  })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().toUpperCase() : value)
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString({ message: 'Preferred currency must be a string' })
  @Matches(/^[A-Z]{3}$/, { message: 'Preferred currency must be a three-letter supported code' })
  preferredCurrency?: string;
}
