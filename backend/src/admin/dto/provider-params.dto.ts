import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsMongoId } from 'class-validator';

export const PROVIDER_TYPES = ['airline', 'hotel'] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];

export class ProviderParamsDto {
  @ApiProperty({ enum: PROVIDER_TYPES })
  @IsIn(PROVIDER_TYPES, { message: 'Type must be airline or hotel' })
  type!: ProviderType;

  @ApiProperty({ pattern: '^[a-fA-F0-9]{24}$', description: 'The airline or hotel ID.' })
  @IsMongoId({ message: 'Provider ID must be a valid ID' })
  id!: string;
}
