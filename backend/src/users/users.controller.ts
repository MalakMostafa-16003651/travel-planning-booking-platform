import { Body, Controller, Get, Header, Patch, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiBadRequestResponse, ApiCookieAuth, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthenticatedRequest, AuthGuard } from '../auth/auth.guard';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { UserProfileDto } from './dto/user-profile.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

@ApiTags('Users')
@ApiCookieAuth('accessToken')
@UseGuards(AuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'ACC-09/ACC-11: view your own profile',
    description: 'All logged-in roles can view their own public account fields and optional phone/currency preference. Identity comes from the session; query identifiers do not select another account. Credential and session internals are never returned.',
  })
  @ApiOkResponse({ type: UserProfileDto })
  @ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'Missing, restricted, expired, revoked, or ineligible session/account.' })
  async me(@Req() request: AuthenticatedRequest): Promise<UserProfileDto> {
    const user = await this.users.findOwnProfile(request.user!.userId, request.authenticatedCredentialVersion!);
    if (!user) throw new UnauthorizedException('Invalid or expired session');
    return UserProfileDto.fromUser(user);
  }

  @Patch('me')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'ACC-09: update your own profile',
    description: 'All logged-in roles may change only name, phoneNumber and preferredCurrency. All supplied fields must validate before any write. Omitted fields stay unchanged; null/blank values are rejected and no defaults are assigned. Currency must exist in the shared catalog. Identity and credential version come from the authenticated session, never request fields.',
  })
  @ApiOkResponse({ type: UserProfileDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid/unknown fields, unsupported currency or empty patch.' })
  @ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'Missing, restricted, expired, revoked, or ineligible session/account.' })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'Cross-origin request.' })
  async updateMe(@Req() request: AuthenticatedRequest, @Body() input: UpdateUserDto): Promise<UserProfileDto> {
    const user = await this.users.updateOwnProfile(request.user!.userId, request.authenticatedCredentialVersion!, input);
    return UserProfileDto.fromUser(user);
  }
}
