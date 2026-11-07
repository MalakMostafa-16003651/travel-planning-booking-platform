import { ApiProperty } from '@nestjs/swagger';
import { PROVIDER_TYPES, ProviderType } from './provider-params.dto';

export class ProviderStatusDto {
  @ApiProperty({ enum: PROVIDER_TYPES }) type!: ProviderType;
  @ApiProperty() providerId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() isActive!: boolean;
  @ApiProperty({ example: 4, description: 'Moderators and users with Confirmed bookings who were notified (GEN-01).' })
  notifiedCount!: number;
}
