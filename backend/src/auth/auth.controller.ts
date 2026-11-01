import { Body, Controller, Post } from '@nestjs/common';
import { ApiBadRequestResponse, ApiConflictResponse, ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { RegisteredUserDto } from './dto/registered-user.dto';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @ApiOperation({
    summary: 'ACC-01: register a user',
    description: 'Creates an ACTIVE USER account with mandatory consent and a salted password hash (GEN-13).',
  })
  @ApiCreatedResponse({ type: RegisteredUserDto, description: 'User registered successfully.' })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid fields, missing consent, or unknown properties.' })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'Email is already registered.' })
  register(@Body() input: RegisterDto): Promise<RegisteredUserDto> {
    return this.auth.register(input);
  }
}
