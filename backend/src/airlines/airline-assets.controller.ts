import { Controller, Get, Header, HttpCode, Param, Post, Req, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiCookieAuth, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { AuthGuard, AuthenticatedRequest } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { UserRole } from '../common/enums/user-role.enum';
import { AIRLINE_LOGO_FIELD, AIRLINE_LOGO_MAX_BYTES } from './airline-logo.storage';
import { AirlineLogoService, UploadedLogo } from './airline-logo.service';
import { Airline } from './schemas/airline.schema';

/**
 * Logo upload plus the public airline pages. Registered AFTER AirlinesController in AirlinesModule,
 * so its fixed routes ('me', 'me/policies') are matched before ':id'.
 */
@ApiTags('Airlines')
@Controller('airlines')
export class AirlineAssetsController {
  constructor(private readonly logos: AirlineLogoService) {}

  @Post('me/logo')
  @HttpCode(200)
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.AIRLINE_MODERATOR)
  @ApiCookieAuth('accessToken')
  @UseInterceptors(FileInterceptor(AIRLINE_LOGO_FIELD, { limits: { fileSize: AIRLINE_LOGO_MAX_BYTES, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: [AIRLINE_LOGO_FIELD], properties: { [AIRLINE_LOGO_FIELD]: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Upload your airline logo: one JPG or PNG, max 5 MB (FLT-01, GEN-08)', description: 'A new upload replaces the old logo. The airline then shows logo = /api/airlines/{airlineId}/logo.' })
  @ApiOkResponse({ type: Object, description: 'The airline with its logo URL' })
  uploadLogo(@Req() req: AuthenticatedRequest, @UploadedFile() file: UploadedLogo | undefined): Promise<Airline> {
    return this.logos.saveMine(req.user!.userId, file);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'View one airline with its baggage and cancellation policies (FLT-01, FLT-08, FLT-09)', description: 'Public. A deactivated airline returns 404.' })
  @ApiOkResponse({ type: Object })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such active airline.' })
  get(@Param('id') id: string): Promise<Airline> {
    return this.logos.getPublic(id);
  }

  @Get(':id/logo')
  @Header('Cache-Control', 'no-cache')
  @Header('X-Content-Type-Options', 'nosniff')
  @ApiOperation({ summary: 'Download an airline logo image (GEN-08)', description: 'Public. This is the URL stored in the airline logo field.' })
  @ApiProduces('image/png', 'image/jpeg')
  @ApiOkResponse({ description: 'The logo image', schema: { type: 'string', format: 'binary' } })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such airline, or it has no logo.' })
  async logo(@Param('id') id: string): Promise<StreamableFile> {
    const { data, mimeType } = await this.logos.read(id);
    return new StreamableFile(data, { type: mimeType });
  }
}
