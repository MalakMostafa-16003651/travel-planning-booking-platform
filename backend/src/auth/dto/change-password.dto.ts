import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { CompliantPassword } from '../password-policy.decorator';

export class ChangePasswordDto {
  @ApiProperty({ format: 'password', writeOnly: true, description: 'Current password; used exactly as supplied.' })
  @IsString({ message: 'Current password must be a string' })
  @IsNotEmpty({ message: 'Current password is required' })
  currentPassword!: string;

  @ApiProperty({
    format: 'password',
    minLength: 8,
    writeOnly: true,
    description: 'At least 8 characters, including a letter and a digit (ACC-01). Used exactly as supplied.',
  })
  @CompliantPassword('New password')
  newPassword!: string;
}
