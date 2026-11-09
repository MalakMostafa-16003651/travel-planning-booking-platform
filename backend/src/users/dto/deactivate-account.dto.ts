import { ApiProperty } from '@nestjs/swagger';
import { Equals } from 'class-validator';

export class DeactivateAccountDto {
  @ApiProperty({ example: true, description: 'Explicitly confirm deactivation of your own account.' })
  @Equals(true)
  confirmed!: boolean;
}