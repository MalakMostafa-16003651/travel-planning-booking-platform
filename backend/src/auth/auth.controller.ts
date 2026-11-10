import { clearAuthenticationCookies } from './auth-cookies';
import { EmailVerificationService } from './email-verification.service';
import { EmailVerificationRequestedDto, EmailVerificationStatusDto, ResendVerificationDto, VerifyEmailDto } from './dto/email-verification.dto';
import { ApiAcceptedResponse, ApiServiceUnavailableResponse, ApiTooManyRequestsResponse } from '@nestjs/swagger';
import { Request } from 'express';
import { ForgotPasswordDto, ForgotPasswordResponseDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { PasswordRecoveryService } from './password-recovery.service';
import { Body, Controller, Cookies, Get, Header, HttpCode, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBadRequestResponse, ApiConflictResponse, ApiCookieAuth, ApiCreatedResponse, ApiExtraModels, ApiForbiddenResponse, ApiInternalServerErrorResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse, getSchemaPath } from '@nestjs/swagger';
import { Response } from 'express';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { ACCESS_TOKEN_COOKIE, ACCESS_TOKEN_TTL_SECONDS, AUTH_COOKIE_OPTIONS, PASSWORD_CHANGE_TOKEN_COOKIE, PASSWORD_CHANGE_TOKEN_TTL_SECONDS, REFRESH_TOKEN_COOKIE, REFRESH_TOKEN_TTL_MS } from './auth.constants';
import { AuthGuard, AuthenticatedRequest } from './auth.guard';
import { AuthSessionsService } from './auth-sessions.service';
import { AuthService } from './auth.service';
import { AuthenticatedUserDto } from './dto/authenticated-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RegisteredUserDto } from './dto/registered-user.dto';
import { PasswordChangeRequiredDto } from './dto/password-change-required.dto';
import { PasswordChangeGuard, PasswordChangeRequest } from './password-change.guard';
import { PasswordManagementService } from './password-management.service';

@ApiTags('Authentication')
@ApiExtraModels(AuthenticatedUserDto, PasswordChangeRequiredDto)
@Controller('auth')
export class AuthController {
  constructor(
    private readonly verification: EmailVerificationService,
    private readonly recovery: PasswordRecoveryService,
    private readonly auth: AuthService,
    private readonly sessions: AuthSessionsService,
    private readonly passwords: PasswordManagementService,
  ) {}

  @Get('email-verification')
  @UseGuards(AuthGuard)
  @Header('Cache-Control', 'no-store')
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: 'ACC-02 bonus: view your live email verification status', description: 'Returns your verification state and whether verification is required for booking. It exposes no proof, private timestamp or account directory.' })
  @ApiOkResponse({ type: EmailVerificationStatusDto })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  emailVerificationStatus(@Req() request: AuthenticatedRequest): Promise<EmailVerificationStatusDto> { return this.verification.status(request.user!.userId); }

  @Post('resend-verification')
  @UseGuards(AuthGuard)
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: 'ACC-02 bonus: resend your own verification link', description: 'Normal login required. No email/userId/role is accepted. Generic response for verified or silently limited accounts. The newest link replaces the previous one and expires after 24 hours. Registration also queues verification when SMTP and EMAIL_VERIFICATION_URL are configured.' })
  @ApiAcceptedResponse({ type: EmailVerificationRequestedDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  @ApiForbiddenResponse({ type: ApiErrorDto })
  @ApiServiceUnavailableResponse({ type: ApiErrorDto })
  resendVerification(@Body() _input: ResendVerificationDto, @Req() request: AuthenticatedRequest): Promise<EmailVerificationRequestedDto> { return this.verification.request(request.user!.userId, request.ip ?? request.socket.remoteAddress ?? 'unknown'); }

  @Post('verify-email')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'ACC-02 bonus: verify the email using its single-use proof', description: 'Public proof-only endpoint. Submit the URL fragment token in JSON. Atomically verifies the current active account/email and consumes the latest unexpired proof. No password, role, status or credential epoch change; no login cookie or automatic login. Password-reset proofs cannot be used here.' })
  @ApiNoContentResponse({ description: 'Email verified.' })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiForbiddenResponse({ type: ApiErrorDto })
  @ApiTooManyRequestsResponse({ type: ApiErrorDto })
  verifyEmail(@Body() input: VerifyEmailDto, @Req() request: Request): Promise<void> { return this.verification.verify(input.token, request.ip ?? request.socket.remoteAddress ?? 'unknown'); }

  @Post('forgot-password')
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'ACC-07 bonus: request an emailed password reset', description: 'Same accepted response for known, unknown, suspended, deactivated and silently rate-limited addresses. Account lookup and delivery run asynchronously. Only hashed tokens are persisted. A newer accepted request invalidates the older link; expiry is 30 minutes. Requires configured SMTP and a trusted PASSWORD_RESET_URL. No account changes or login happen here.' })
  @ApiAcceptedResponse({ type: ForgotPasswordResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'Cross-origin browser request.' })
  @ApiServiceUnavailableResponse({ type: ApiErrorDto, description: 'Recovery configuration absent or worker capacity unavailable, independent of account existence.' })
  forgotPassword(@Body() input: ForgotPasswordDto, @Req() request: Request): Promise<ForgotPasswordResponseDto> {
    return this.recovery.request(input.email, request.ip ?? request.socket.remoteAddress ?? 'unknown');
  }

  @Post('reset-password')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'ACC-07 bonus: replace a forgotten password using the emailed token', description: 'Submit the URL fragment token in this JSON body. Requires no login. Atomically consumes the single-use unexpired latest token and replaces the password using the shared policy/hasher. Invalidates every previous session and clears auth cookies. Does not reactivate an account, change its role or automatically log in. Log in again.' })
  @ApiNoContentResponse({ description: 'Password reset. A fresh login is required.' })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid/expired/used/superseded link, ineligible account, invalid fields or unchanged password.' })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'Cross-origin browser request.' })
  @ApiTooManyRequestsResponse({ type: ApiErrorDto })
  async resetForgottenPassword(@Body() input: ResetPasswordDto, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<void> {
    await this.recovery.reset(input, request.ip ?? request.socket.remoteAddress ?? 'unknown');
    this.clearAuthenticationCookies(response);
  }

  @Post('register')
  @ApiOperation({
    summary: 'ACC-01: register a user',
    description: 'Creates an ACTIVE USER account with mandatory consent and a salted password hash (GEN-13).',
  })
  @ApiCreatedResponse({ type: RegisteredUserDto, description: 'User registered successfully.' })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid fields, missing consent, or unknown properties.' })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'Email is already registered.' })
  register(@Body() input: RegisterDto, @Req() request: Request): Promise<RegisteredUserDto> {
    return this.auth.register(input, request.ip ?? request.socket.remoteAddress ?? 'unknown');
  }

  @Post('login')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'ACC-04/ACC-05: log in with email and password',
    description: 'Five failed logins lock new attempts for 15 minutes. Eligible login resets the counter. Ordinary login issues protected access/refresh cookies and public identity. ACC-07a temporary-password login instead returns passwordChangeRequired=true and a 15-minute restricted cookie allowing only password change/logout; it clears normal cookies. Tokens are never in JSON. Automatic renewal is not implemented.',
  })
  @ApiOkResponse({
    schema: { oneOf: [{ $ref: getSchemaPath(AuthenticatedUserDto) }, { $ref: getSchemaPath(PasswordChangeRequiredDto) }] },
    description: 'Public identity with normal cookies, or passwordChangeRequired with only a restricted password-change cookie.',
  })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid fields or unknown properties.' })
  @ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'Invalid email/password, deactivated account, or temporary lockout. Locked accounts receive: Account temporarily locked. Try again later.' })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'Suspended account or cross-origin request.' })
  async login(
    @Body() input: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthenticatedUserDto | PasswordChangeRequiredDto> {
    const user = await this.auth.verifyCredentials(input);
    if (user.mustChangePassword) {
      const token = await this.sessions.createPasswordChange(user._id.toString(), user.credentialVersion);
      response.clearCookie(ACCESS_TOKEN_COOKIE, AUTH_COOKIE_OPTIONS);
      response.clearCookie(REFRESH_TOKEN_COOKIE, AUTH_COOKIE_OPTIONS);
      response.cookie(PASSWORD_CHANGE_TOKEN_COOKIE, token, { ...AUTH_COOKIE_OPTIONS, maxAge: PASSWORD_CHANGE_TOKEN_TTL_SECONDS * 1000 });
      return { passwordChangeRequired: true };
    }
    const tokens = await this.sessions.create(user._id.toString(), user.credentialVersion);
    response.cookie(ACCESS_TOKEN_COOKIE, tokens.accessToken, { ...AUTH_COOKIE_OPTIONS, maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000 });
    response.cookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, { ...AUTH_COOKIE_OPTIONS, maxAge: REFRESH_TOKEN_TTL_MS });
    response.clearCookie(PASSWORD_CHANGE_TOKEN_COOKIE, AUTH_COOKIE_OPTIONS);
    return AuthenticatedUserDto.fromUser(user);
  }

  @Post('logout')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'ACC-06: log out the current browser session',
    description: 'Revokes only sessions identified by presented refresh/access/password-change cookies before clearing all three cookies. No JSON body is required. Idempotent for missing/invalid credentials. Expired access does not prevent logout through the refresh cookie.',
  })
  @ApiNoContentResponse({ description: 'Matching server sessions revoked and all authentication cookies expired.' })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'Cross-origin browser request rejected before logout.' })
  @ApiInternalServerErrorResponse({ type: ApiErrorDto, description: 'Server revocation failed; cookies are preserved for retry.' })
  async logout(
    @Cookies(ACCESS_TOKEN_COOKIE) accessToken: string | undefined,
    @Cookies(REFRESH_TOKEN_COOKIE) refreshToken: string | undefined,
    @Cookies(PASSWORD_CHANGE_TOKEN_COOKIE) passwordChangeToken: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.sessions.logout(accessToken, refreshToken, passwordChangeToken);
    this.clearAuthenticationCookies(response);
  }

  @Patch('change-password')
  @UseGuards(PasswordChangeGuard)
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  @ApiCookieAuth('accessToken')
  @ApiCookieAuth('passwordChangeToken')
  @ApiOperation({
    summary: 'ACC-07a/ACC-08: change your own password',
    description: 'Accepts either a normal access cookie or the restricted password-change cookie. Verifies the current password; replacement must meet registration policy and differ from it. Atomically invalidates all prior sessions and clears cookies. A new normal login is required. No user ID, role or status is accepted from the caller.',
  })
  @ApiNoContentResponse({ description: 'Password changed. All previous sessions are invalid; log in again.' })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid fields, noncompliant/unchanged new password, or unknown properties.' })
  @ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'Invalid current password or stale/ineligible normal/restricted session.' })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'Cross-origin request.' })
  async changePassword(
    @Req() request: PasswordChangeRequest,
    @Body() input: ChangePasswordDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.passwords.changePassword(request.passwordChangeIdentity!, input);
    this.clearAuthenticationCookies(response);
  }

  private clearAuthenticationCookies(response: Response): void {
    clearAuthenticationCookies(response);
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
