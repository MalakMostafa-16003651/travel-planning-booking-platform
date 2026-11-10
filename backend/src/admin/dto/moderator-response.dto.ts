import { ApiProperty } from '@nestjs/swagger';
import { AccountStatus } from '../../common/enums/account-status.enum';
import { MODERATOR_ROLES, ModeratorRole } from './create-moderator.dto';

export class ModeratorDto {
  @ApiProperty() userId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ enum: MODERATOR_ROLES }) role!: ModeratorRole;
  @ApiProperty({ enum: AccountStatus }) status!: AccountStatus;
  @ApiProperty({ enum: ['airline', 'hotel'] }) providerType!: 'airline' | 'hotel';
  @ApiProperty() providerId!: string;
  @ApiProperty() providerName!: string;
  @ApiProperty({ example: true, description: 'Always true for a new moderator: the temporary password must be changed at first login.' })
  mustChangePassword!: boolean;
  @ApiProperty() createdAt!: Date;
}
