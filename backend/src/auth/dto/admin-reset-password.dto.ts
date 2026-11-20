import { ApiProperty } from '@nestjs/swagger';
import { CompliantPassword } from '../password-policy.decorator';

export class AdminResetPasswordDto {
  @ApiProperty({
    format: 'password',
    minLength: 8,
    maxLength: 128,
    writeOnly: true,
    description: 'Administrator-set temporary password: 8 to 128 characters, including a letter and a digit (ACC-01).',
  })
  @CompliantPassword('Temporary password')
  temporaryPassword!: string;
}
