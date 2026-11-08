import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, MaxLength } from 'class-validator';
export class ForgotPasswordDto {
  @ApiProperty({ example: 'alex@example.com', format: 'email', maxLength: 254 })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail({}, { message: 'Email must be a valid email address' })
  @MaxLength(254, { message: 'Email must contain at most 254 characters' })
  email!: string;
}
export class ForgotPasswordResponseDto {
  @ApiProperty({ example: 'If an eligible account exists, a password reset link will be sent.' })
  message!: string;
}
