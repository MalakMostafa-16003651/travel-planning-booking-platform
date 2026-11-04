import { ApiProperty } from '@nestjs/swagger';

export class PasswordChangeRequiredDto {
  @ApiProperty({ type: Boolean, enum: [true], example: true, description: 'Only the mandatory password-change flow is available.' })
  passwordChangeRequired: true = true;
}
