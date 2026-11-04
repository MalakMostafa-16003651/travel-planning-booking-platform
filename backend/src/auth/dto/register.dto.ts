import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { Equals, IsBoolean, IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { CompliantPassword } from '../password-policy.decorator';

export class RegisterDto {
  @ApiProperty({ example: 'Alex Traveler' })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString({ message: 'Name must be a string' })
  @IsNotEmpty({ message: 'Name is required' })
  name!: string;

  @ApiProperty({ example: 'alex@example.com', format: 'email' })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail({}, { message: 'Email must be a valid email address' })
  email!: string;

  @ApiProperty({
    example: 'Travel123',
    format: 'password',
    minLength: 8,
    writeOnly: true,
    description: 'At least 8 characters, including a letter and a digit (ACC-01).',
  })
  @CompliantPassword()
  password!: string;

  @ApiProperty({ example: true, enum: [true], description: 'Mandatory terms and privacy consent.' })
  @IsBoolean({ message: 'Terms consent must be a boolean' })
  @Equals(true, { message: 'You must accept the terms and privacy policy' })
  termsAccepted!: boolean;
}
