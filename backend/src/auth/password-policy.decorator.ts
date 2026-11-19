import { applyDecorators } from '@nestjs/common';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

// One registration policy for signup, temporary passwords and replacements.
export function CompliantPassword(label = 'Password'): PropertyDecorator {
  return applyDecorators(
    IsString({ message: `${label} must be a string` }),
    MinLength(8, { message: `${label} must contain at least 8 characters` }),
    MaxLength(128, { message: `${label} must contain at most 128 characters` }),
    Matches(/\p{L}/u, { message: `${label} must contain at least one letter` }),
    Matches(/\p{Nd}/u, { message: `${label} must contain at least one digit` }),
  );
}
