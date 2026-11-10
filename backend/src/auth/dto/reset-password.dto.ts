import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';
import { CompliantPassword } from '../password-policy.decorator';
export class ResetPasswordDto {
  @ApiProperty({ writeOnly: true, minLength: 64, maxLength: 64, description: 'Single-use token from the reset link. Never put it in the API URL.' })
  @IsString({ message: 'Reset token must be a string' })
  @Matches(/^[a-f0-9]{64}$/, { message: 'Reset token has an invalid format' })
  token!: string;
  @ApiProperty({ format: 'password', writeOnly: true, minLength: 8, description: 'At least eight characters including a letter and digit; differs from the current password.' })
  @CompliantPassword('New password')
  newPassword!: string;
}
