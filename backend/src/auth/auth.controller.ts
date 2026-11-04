import { Body, Controller, Cookies, Get, Header, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBadRequestResponse, ApiConflictResponse, ApiCookieAuth, ApiCreatedResponse, ApiForbiddenResponse, ApiInternalServerErrorResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { Response } from 'express';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { ACCESS_TOKEN_COOKIE, ACCESS_TOKEN_TTL_SECONDS, AUTH_COOKIE_OPTIONS, REFRESH_TOKEN_COOKIE, REFRESH_TOKEN_TTL_MS } from './auth.constants';
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
    description: 'Five consecutive failed logins lock new login attempts for 15 minutes and return a lockout message. An eligible successful login resets the counter. Issues HttpOnly, Secure, SameSite=Lax access/refresh cookies; tokens are excluded from JSON. Access expires in 15 minutes; automatic token renewal is not implemented.',
  })
  @ApiOkResponse({ type: AuthenticatedUserDto, description: 'Current public user; authentication cookies are set separately.' })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid fields or unknown properties.' })
  @ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'Invalid email/password, deactivated account, or temporary lockout. Locked accounts receive: Account temporarily locked. Try again later.' })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'Suspended account, mandatory password change, or cross-origin request.' })
  async login(@Body() input: LoginDto, @Res({ passthrough: true }) response: Response): Promise<AuthenticatedUserDto> {
    const user = await this.auth.verifyCredentials(input);
    const tokens = await this.sessions.create(user._id.toString());
    response.cookie(ACCESS_TOKEN_COOKIE, tokens.accessToken, { ...AUTH_COOKIE_OPTIONS, maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000 });
    response.cookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, { ...AUTH_COOKIE_OPTIONS, maxAge: REFRESH_TOKEN_TTL_MS });
    return AuthenticatedUserDto.fromUser(user);
  }

  @Post('logout')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'ACC-06: log out the current browser session',
    description: 'Revokes only sessions identified by the presented refresh/access cookies before clearing both cookies. No JSON body is required. Idempotent for missing/invalid credentials. An expired access cookie does not prevent logout through the refresh cookie.',
  })
  @ApiNoContentResponse({ description: 'Matching server sessions revoked and both authentication cookies expired.' })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'Cross-origin browser request rejected before logout.' })
  @ApiInternalServerErrorResponse({ type: ApiErrorDto, description: 'Server revocation failed; cookies are preserved for retry.' })
  async logout(
    @Cookies(ACCESS_TOKEN_COOKIE) accessToken: string | undefined,
    @Cookies(REFRESH_TOKEN_COOKIE) refreshToken: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.sessions.logout(accessToken, refreshToken);
    response.clearCookie(ACCESS_TOKEN_COOKIE, AUTH_COOKIE_OPTIONS);
    response.clearCookie(REFRESH_TOKEN_COOKIE, AUTH_COOKIE_OPTIONS);
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
