import { Body, Controller, Get, Header, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBadRequestResponse, ApiConflictResponse, ApiCookieAuth, ApiCreatedResponse, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { Response } from 'express';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { ACCESS_TOKEN_COOKIE, ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_COOKIE, REFRESH_TOKEN_TTL_MS } from './auth.constants';
import { AuthGuard, AuthenticatedRequest } from './auth.guard';
import { AuthSessionsService } from './auth-sessions.service';
import { AuthService } from './auth.service';
import { AuthenticatedUserDto } from './dto/authenticated-user.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RegisteredUserDto } from './dto/registered-user.dto';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly sessions: AuthSessionsService) {}

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

  @Post('login')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'ACC-04/ACC-05: log in with email and password',
    description: 'Five consecutive failed logins lock new login attempts for 15 minutes and return a lockout message. An eligible successful login resets the counter. Issues HttpOnly, Secure, SameSite=Lax access/refresh cookies; tokens are excluded from JSON. Access expires in 15 minutes; token renewal and logout are separate steps.',
  })
  @ApiOkResponse({ type: AuthenticatedUserDto, description: 'Current public user; authentication cookies are set separately.' })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid fields or unknown properties.' })
  @ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'Invalid email/password, deactivated account, or temporary lockout. Locked accounts receive: Account temporarily locked. Try again later.' })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'Suspended account, mandatory password change, or cross-origin request.' })
  async login(@Body() input: LoginDto, @Res({ passthrough: true }) response: Response): Promise<AuthenticatedUserDto> {
    const user = await this.auth.verifyCredentials(input);
    const tokens = await this.sessions.create(user._id.toString());
    const options = { httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/' };
    response.cookie(ACCESS_TOKEN_COOKIE, tokens.accessToken, { ...options, maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000 });
    response.cookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, { ...options, maxAge: REFRESH_TOKEN_TTL_MS });
    return AuthenticatedUserDto.fromUser(user);
  }

  @Get('me')
  @UseGuards(AuthGuard)
  @Header('Cache-Control', 'no-store')
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: 'ACC-19 foundation: view the currently authenticated user' })
  @ApiOkResponse({ type: AuthenticatedUserDto })
  @ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'Missing, invalid, expired, revoked, inactive, or ineligible session.' })
  me(@Req() request: AuthenticatedRequest): AuthenticatedUserDto {
    return request.authenticatedUser!;
  }
}
