import { ApiPropertyOptional } from '@nestjs/swagger';
import { RegisteredUserDto } from '../../auth/dto/registered-user.dto';
import { UserDocument } from '../schemas/user.schema';

export class UserProfileDto extends RegisteredUserDto {
  @ApiPropertyOptional({ type: String, description: 'Profile phone number, when set.' })
  phoneNumber?: string;

  @ApiPropertyOptional({ type: String, description: 'Preferred currency code, when set.' })
  preferredCurrency?: string;

  static override fromUser(user: UserDocument): UserProfileDto {
    return {
      ...RegisteredUserDto.fromUser(user),
      ...(typeof user.phoneNumber === 'string' ? { phoneNumber: user.phoneNumber } : {}),
      ...(typeof user.preferredCurrency === 'string' ? { preferredCurrency: user.preferredCurrency } : {}),
    };
  }
}
