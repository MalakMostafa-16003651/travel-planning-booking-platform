import {
  Body, Controller, Delete, Get, Param, Patch, Post, Req, Res, StreamableFile, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse, ApiBody, ApiConflictResponse, ApiConsumes, ApiCookieAuth, ApiCreatedResponse, ApiNotFoundResponse, ApiOkResponse,
  ApiOperation, ApiPayloadTooLargeResponse, ApiProduces, ApiTags, ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Response } from 'express';
import { AuthGuard, AuthenticatedRequest } from '../auth/auth.guard';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { UpdateActivityDto } from './dto/activity.dto';
import { UpdateBudgetEntryDto } from './dto/budget-entry.dto';
import { ItineraryDto } from './dto/itinerary-response.dto';
import { UpdateTransportCostDto } from './dto/transport-cost.dto';
import { ItinerariesService, UploadedImage } from './itineraries.service';
import { MAX_IMAGE_BYTES, MAX_IMAGES_PER_ACTIVITY } from './itinerary.rules';
import { OptionalAuthGuard } from './optional-auth.guard';

const NOT_FOUND_DOC = 'Not found, or not yours (ACC-11).';

/** Activities, budget entries and transport costs addressed by their own id (PDF 8.8). */
@ApiTags('Itineraries')
@Controller()
export class ItineraryItemsController {
  constructor(private readonly itineraries: ItinerariesService) {}

  @Patch('activities/:id')
  @UseGuards(AuthGuard)
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: 'ITN-10: update an activity', description: 'Send an empty string to clear an optional field.' })
  @ApiOkResponse({ type: ItineraryDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: NOT_FOUND_DOC })
  updateActivity(@Param('id') id: string, @Body() input: UpdateActivityDto, @Req() request: AuthenticatedRequest): Promise<ItineraryDto> {
    return this.itineraries.updateActivity(id, request.user!.userId, input);
  }

  @Delete('activities/:id')
  @UseGuards(AuthGuard)
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: 'ITN-10: delete an activity', description: 'Also deletes its images.' })
  @ApiOkResponse({ type: ItineraryDto })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: NOT_FOUND_DOC })
  deleteActivity(@Param('id') id: string, @Req() request: AuthenticatedRequest): Promise<ItineraryDto> {
    return this.itineraries.deleteActivity(id, request.user!.userId);
  }

  @Post('activities/:id/images')
  @UseGuards(AuthGuard)
  @UseInterceptors(FileInterceptor('image', { limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } }))
  @ApiCookieAuth('accessToken')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['image'], properties: { image: { type: 'string', format: 'binary' } } } })
  @ApiOperation({
    summary: 'ITN-12/GEN-08: upload an activity image',
    description: `JPEG, PNG or WebP, checked by file content, at most ${MAX_IMAGE_BYTES / 1024 / 1024} MB, at most ${MAX_IMAGES_PER_ACTIVITY} per activity.`,
  })
  @ApiCreatedResponse({ type: ItineraryDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Missing file or not a supported image.' })
  @ApiPayloadTooLargeResponse({ type: ApiErrorDto, description: 'File too large.' })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: NOT_FOUND_DOC })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'Image limit reached.' })
  addImage(@Param('id') id: string, @UploadedFile() file: UploadedImage | undefined, @Req() request: AuthenticatedRequest): Promise<ItineraryDto> {
    return this.itineraries.addImage(id, request.user!.userId, file);
  }

  @Get('activities/:id/images/:imageId')
  @UseGuards(OptionalAuthGuard)
  @ApiCookieAuth('accessToken')
  @ApiProduces('image/jpeg', 'image/png', 'image/webp')
  @ApiOperation({ summary: 'ITN-12: download an activity image', description: 'Same visibility as the itinerary.' })
  @ApiOkResponse({ description: 'Image bytes.' })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  async getImage(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const image = await this.itineraries.getImage(id, imageId, request.user);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'private, no-cache');
    return new StreamableFile(image.data, { type: image.contentType, length: image.data.length });
  }

  @Delete('activities/:id/images/:imageId')
  @UseGuards(AuthGuard)
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: 'ITN-12: delete an activity image' })
  @ApiOkResponse({ type: ItineraryDto })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: NOT_FOUND_DOC })
  deleteImage(@Param('id') id: string, @Param('imageId') imageId: string, @Req() request: AuthenticatedRequest): Promise<ItineraryDto> {
    return this.itineraries.deleteImage(id, imageId, request.user!.userId);
  }

  @Patch('budgets/:id')
  @UseGuards(AuthGuard)
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: 'ITN-14: update a budget entry' })
  @ApiOkResponse({ type: ItineraryDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid fields or unsupported currency.' })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: NOT_FOUND_DOC })
  updateBudget(@Param('id') id: string, @Body() input: UpdateBudgetEntryDto, @Req() request: AuthenticatedRequest): Promise<ItineraryDto> {
    return this.itineraries.updateBudget(id, request.user!.userId, input);
  }

  @Delete('budgets/:id')
  @UseGuards(AuthGuard)
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: 'ITN-14: delete a budget entry' })
  @ApiOkResponse({ type: ItineraryDto })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: NOT_FOUND_DOC })
  deleteBudget(@Param('id') id: string, @Req() request: AuthenticatedRequest): Promise<ItineraryDto> {
    return this.itineraries.deleteBudget(id, request.user!.userId);
  }

  @Patch('transport-costs/:id')
  @UseGuards(AuthGuard)
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: 'ITN-16: update an intercity transport cost' })
  @ApiOkResponse({ type: ItineraryDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: NOT_FOUND_DOC })
  updateTransportCost(@Param('id') id: string, @Body() input: UpdateTransportCostDto, @Req() request: AuthenticatedRequest): Promise<ItineraryDto> {
    return this.itineraries.updateTransportCost(id, request.user!.userId, input);
  }

  @Delete('transport-costs/:id')
  @UseGuards(AuthGuard)
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: 'ITN-16: delete an intercity transport cost' })
  @ApiOkResponse({ type: ItineraryDto })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: NOT_FOUND_DOC })
  deleteTransportCost(@Param('id') id: string, @Req() request: AuthenticatedRequest): Promise<ItineraryDto> {
    return this.itineraries.deleteTransportCost(id, request.user!.userId);
  }
}
