import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';
export class VerifyEmailDto {
  @ApiProperty({ writeOnly: true, minLength: 64, maxLength: 64, description: 'Single-use token from the verification email URL fragment; submit it in the JSON body.' })
  @IsString({ message: 'Verification token must be a string' })
  @Matches(/^[a-f0-9]{64}$/, { message: 'Verification token has an invalid format' })
  token!: string;
}
export class EmailVerificationStatusDto {
  @ApiProperty({ readOnly: true }) emailVerified!: boolean;
  @ApiProperty({ readOnly: true }) requiredForBooking!: boolean;
}
export class EmailVerificationRequestedDto {
  @ApiProperty({ example: 'If verification is needed, a verification link will be sent.' }) message!: string;
}
export class ResendVerificationDto {}
