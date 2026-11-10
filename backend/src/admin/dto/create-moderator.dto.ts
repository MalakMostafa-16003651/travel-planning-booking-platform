import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsMongoId, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { CompliantPassword } from '../../auth/password-policy.decorator';
import { UserRole } from '../../common/enums/user-role.enum';

export const MODERATOR_ROLES = [UserRole.AIRLINE_MODERATOR, UserRole.HOTEL_MODERATOR] as const;
export type ModeratorRole = (typeof MODERATOR_ROLES)[number];

export class CreateModeratorDto {
  @ApiProperty({ example: 'Nile Air Desk' })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString({ message: 'Name must be a string' })
  @IsNotEmpty({ message: 'Name is required' })
  @MaxLength(120, { message: 'Name must be at most 120 characters' })
  name!: string;

  @ApiProperty({ example: 'desk@nileair.com', format: 'email' })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail({}, { message: 'Email must be a valid email address' })
  email!: string;

  @ApiProperty({ enum: MODERATOR_ROLES })
  @IsIn(MODERATOR_ROLES, { message: 'Role must be AIRLINE_MODERATOR or HOTEL_MODERATOR' })
  role!: ModeratorRole;

  @ApiProperty({ pattern: '^[a-fA-F0-9]{24}$', description: 'The airline (for AIRLINE_MODERATOR) or hotel (for HOTEL_MODERATOR) to manage.' })
  @IsMongoId({ message: 'Provider ID must be a valid ID' })
  providerId!: string;

  @ApiProperty({
    format: 'password',
    minLength: 8,
    writeOnly: true,
    description: 'Admin-set temporary password: at least 8 characters, including a letter and a digit. The moderator must change it at first login.',
  })
  @CompliantPassword('Temporary password')
  temporaryPassword!: string;
}
