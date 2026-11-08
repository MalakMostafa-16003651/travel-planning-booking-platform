import { Controller, Get, Header, Param, Req, StreamableFile, UseGuards } from '@nestjs/common';
import { ApiBadRequestResponse, ApiCookieAuth, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiProduces, ApiProperty, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';
import { AuthGuard, AuthenticatedRequest } from '../auth/auth.guard';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { ItinerariesService } from '../itineraries/itineraries.service';
import { ItineraryPdfService } from './itinerary-pdf.service';
export class ItineraryPdfParamsDto { @ApiProperty() @IsMongoId({ message: 'Itinerary ID must be a valid ID' }) itineraryId!: string; }
@ApiTags('Itinerary exports')
@Controller('itineraries')
export class ItineraryExportsController {
  constructor(private readonly itineraries: ItinerariesService, private readonly pdf: ItineraryPdfService) {}
  @Get(':itineraryId/pdf')
  @UseGuards(AuthGuard)
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @ApiCookieAuth('accessToken')
  @ApiProduces('application/pdf')
  @ApiOperation({ summary: 'ITN-28 bonus: download a printable itinerary PDF', description: 'Logged-in users can export readable public itineraries and their own private itineraries. Reuses ItinerariesService.getReadable, so admins/moderators gain no private access. Includes dates/day order, activities, recorded budget entries, transport costs and attribution. Read-only; no FX or external image download. This separate module changes no itinerary implementation.' })
  @ApiOkResponse({ description: 'Printable A4 PDF.', schema: { type: 'string', format: 'binary' } })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'Missing, private to another owner, or unavailable under the existing itinerary visibility rules.' })
  async exportPdf(@Param() params: ItineraryPdfParamsDto, @Req() request: AuthenticatedRequest): Promise<StreamableFile> {
    const itinerary = await this.itineraries.getReadable(params.itineraryId, request.user);
    const data = await this.pdf.generate(itinerary);
    return new StreamableFile(data, { type: 'application/pdf', length: data.length, disposition: 'attachment; filename="itinerary-' + params.itineraryId + '.pdf"' });
  }
}
