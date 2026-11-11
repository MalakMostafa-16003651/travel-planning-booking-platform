import { Header } from '@nestjs/common';
import { HotelReservationsPageDto } from './dto/hotel-reservations-response.dto';
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Req, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiInternalServerErrorResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiProduces,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { AuthGuard, AuthenticatedRequest } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { AvailableRoomsQueryDto } from './dto/available-rooms-query.dto';
import { BlockRoomDatesDto } from './dto/block-room-dates.dto';
import { CreateHotelDto } from './dto/create-hotel.dto';
import { CreateRoomDto } from './dto/create-room.dto';
import { HotelAvailabilityQueryDto } from './dto/hotel-availability-query.dto';
import { PageQueryDto } from './dto/page-query.dto';
import { SearchHotelsQueryDto } from './dto/search-hotels-query.dto';
import { UpdateHotelDto } from './dto/update-hotel.dto';
import { UpdateHotelPoliciesDto } from './dto/update-hotel-policies.dto';
import { UpdateRoomAvailabilityDto } from './dto/update-room-availability.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { HotelReservationsPage } from './ports/hotel-reservations.port';
import { MAX_HOTEL_PHOTOS, MAX_PHOTO_BYTES } from './hotels.rules';
import { Hotel } from './schemas/hotel.schema';
import { Room } from './schemas/room.schema';
import { RoomAvailability } from './schemas/room-availability.schema';
import { HotelsService, HotelSearchPage, RoomAvailabilityOverview, UploadedPhoto } from './hotels.service';
import { OptionalAuthGuard } from './optional-auth.guard';

@ApiTags('Hotels')
@ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid request fields.' })
@ApiInternalServerErrorResponse({ type: ApiErrorDto })
@Controller('hotels')
export class HotelsController {
  constructor(private readonly hotels: HotelsService) {}

  @Post()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: 'Create a hotel profile (Admin, HTL-01)' })
  @ApiCreatedResponse({ description: 'Hotel created', type: Object })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'Admin role required.' })
  create(@Req() req: AuthenticatedRequest, @Body() body: CreateHotelDto): Promise<Hotel> {
    return this.hotels.create(body, req.user!.userId);
  }

  @Get('search')
  @ApiOperation({ summary: 'Search hotels by destination, dates and guest count (HTL-11, HTL-12)', description: 'Only active hotels with enough free, unblocked rooms for the whole stay are returned. Page size 10.' })
  @ApiOkResponse({ description: 'A page of matching hotels', type: Object })
  search(@Query() query: SearchHotelsQueryDto): Promise<HotelSearchPage> {
    return this.hotels.search(query);
  }

  @Get(':id')
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({ summary: 'View a hotel profile (HTL-02)', description: 'Includes averageRating/ratingCount from Person 6\'s visible reviews (null/0 with none yet).' })
  @ApiOkResponse({ description: 'The hotel profile, with averageRating and ratingCount', type: Object })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'Not found, or deactivated and not visible to the caller.' })
  getById(@Param('id') id: string, @Req() req: AuthenticatedRequest): Promise<Record<string, unknown>> {
    return this.hotels.getDetail(id, req.user);
  }

  @Patch(':id')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.HOTEL_MODERATOR)
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: "Edit the moderator's own hotel profile (HTL-01)" })
  @ApiOkResponse({ description: 'Updated hotel profile' })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'Hotel moderator role and one assigned hotel are required.' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: ':id is not the caller\'s assigned hotel.' })
  updateOwn(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() body: UpdateHotelDto): Promise<Hotel> {
    return this.hotels.updateOwn(req.user!.userId, id, body);
  }

  @Put(':id/policies')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.HOTEL_MODERATOR)
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: "Update check-in/check-out times and cancellation tiers (HTL-09, HTL-10)" })
  @ApiOkResponse({ description: 'Updated hotel policies' })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'Hotel moderator role and one assigned hotel are required.' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: ':id is not the caller\'s assigned hotel.' })
  updatePolicies(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() body: UpdateHotelPoliciesDto): Promise<Hotel> {
    return this.hotels.updatePoliciesOwn(req.user!.userId, id, body);
  }

  @Post(':id/rooms')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.HOTEL_MODERATOR)
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: 'Add a room to the moderator\'s own hotel (HTL-03)' })
  @ApiCreatedResponse({ description: 'Room created', type: Object })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'Hotel moderator role and one assigned hotel are required.' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: ':id is not the caller\'s assigned hotel.' })
  createRoom(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() body: CreateRoomDto): Promise<Room> {
    return this.hotels.createRoom(req.user!.userId, id, body);
  }

  @Patch(':id/rooms/:roomId')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.HOTEL_MODERATOR)
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: 'Edit a room of the moderator\'s own hotel (HTL-05)' })
  @ApiOkResponse({ description: 'Updated room' })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  @ApiForbiddenResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'Not :id\'s hotel, or the room does not belong to it.' })
  updateRoom(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('roomId') roomId: string,
    @Body() body: UpdateRoomDto,
  ): Promise<Room> {
    return this.hotels.updateRoom(req.user!.userId, id, roomId, body);
  }

  @Delete(':id/rooms/:roomId')
  @HttpCode(204)
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.HOTEL_MODERATOR)
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: 'Remove a room from the moderator\'s own hotel (HTL-06)', description: 'A soft deactivation: existing bookings referencing the room keep a valid id. Refused while the room has an active reservation (an unexpired hold or a confirmed stay not yet checked out).' })
  @ApiNoContentResponse()
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  @ApiForbiddenResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'Not :id\'s hotel, or the room does not belong to it.' })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'The room has an active reservation.' })
  async deactivateRoom(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Param('roomId') roomId: string): Promise<void> {
    await this.hotels.deactivateRoom(req.user!.userId, id, roomId);
  }

  @Get(':id/rooms/available')
  @ApiOperation({ summary: 'List this hotel\'s individually available rooms for a stay (HTL-15)' })
  @ApiOkResponse({ description: 'Rooms with no blocked or booked overlap for the stay, cheapest first', type: Object, isArray: true })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'Hotel not found or not active.' })
  getAvailableRooms(@Param('id') id: string, @Query() query: AvailableRoomsQueryDto): Promise<Room[]> {
    return this.hotels.getAvailableRooms(id, query);
  }

  @Post(':id/rooms/:roomId/availability')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.HOTEL_MODERATOR)
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: 'Block dates for a room of the moderator\'s own hotel (HTL-04)' })
  @ApiCreatedResponse({ description: 'The room\'s availability record, with the new blocked range', type: Object })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  @ApiForbiddenResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'Not :id\'s hotel, or the room does not belong to it.' })
  blockDates(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('roomId') roomId: string,
    @Body() body: BlockRoomDatesDto,
  ): Promise<RoomAvailability> {
    return this.hotels.blockDates(req.user!.userId, id, roomId, body);
  }

  @Patch(':id/rooms/:roomId/availability')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.HOTEL_MODERATOR)
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: 'Edit or unblock a room\'s blocked date range (HTL-05, HTL-06)' })
  @ApiOkResponse({ description: 'The room\'s updated availability record', type: Object })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  @ApiForbiddenResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'Not :id\'s hotel, the room does not belong to it, or the blocked range does not exist.' })
  updateAvailability(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('roomId') roomId: string,
    @Body() body: UpdateRoomAvailabilityDto,
  ): Promise<RoomAvailability> {
    return this.hotels.updateBlockedRange(req.user!.userId, id, roomId, body);
  }

  @Get(':id/availability')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.HOTEL_MODERATOR)
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: 'List every active room\'s blocked/booked ranges for the moderator\'s own hotel (HTL-08)' })
  @ApiOkResponse({ description: 'One entry per active room', type: Object, isArray: true })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  @ApiForbiddenResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: ':id is not the caller\'s assigned hotel.' })
  getHotelAvailability(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Query() query: HotelAvailabilityQueryDto,
  ): Promise<RoomAvailabilityOverview[]> {
    return this.hotels.getHotelAvailability(req.user!.userId, id, query);
  }

  @Post(':id/photos')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.HOTEL_MODERATOR)
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: MAX_PHOTO_BYTES, files: 1 } }))
  @ApiCookieAuth('accessToken')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['photo'], properties: { photo: { type: 'string', format: 'binary' } } } })
  @ApiOperation({
    summary: 'Add a photo to the moderator\'s own hotel (HTL-01, GEN-08)',
    description: `JPG or PNG (checked by file content), at most ${MAX_PHOTO_BYTES / 1024 / 1024} MB, at most ${MAX_HOTEL_PHOTOS} per hotel. Returns the hotel with its photo URLs.`,
  })
  @ApiCreatedResponse({ description: 'The hotel, with its photo URLs', type: Object })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Missing file, not a JPG or PNG, or already at the photo limit.' })
  @ApiPayloadTooLargeResponse({ type: ApiErrorDto, description: 'File larger than 5 MB.' })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  @ApiForbiddenResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: ':id is not the caller\'s assigned hotel.' })
  addPhoto(@Req() req: AuthenticatedRequest, @Param('id') id: string, @UploadedFile() file: UploadedPhoto | undefined): Promise<Hotel> {
    return this.hotels.addPhoto(req.user!.userId, id, file);
  }

  @Get(':id/photos/:photoId')
  @UseGuards(OptionalAuthGuard)
  @Header('Cache-Control', 'no-cache')
  @Header('X-Content-Type-Options', 'nosniff')
  @ApiProduces('image/jpeg', 'image/png')
  @ApiOperation({ summary: 'View a hotel photo (HTL-02, GEN-08)', description: 'Same visibility as the hotel: hidden if deactivated, except to its own moderator or an admin.' })
  @ApiOkResponse({ description: 'Photo bytes.' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such hotel or photo you may see.' })
  async getPhoto(@Param('id') id: string, @Param('photoId') photoId: string, @Req() req: AuthenticatedRequest): Promise<StreamableFile> {
    const photo = await this.hotels.getPhoto(id, photoId, req.user);
    return new StreamableFile(photo.data, { type: photo.contentType, length: photo.data.length });
  }

  @Delete(':id/photos/:photoId')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.HOTEL_MODERATOR)
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: 'Remove a photo from the moderator\'s own hotel (HTL-01)' })
  @ApiOkResponse({ description: 'The hotel', type: Object })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  @ApiForbiddenResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: ':id is not the caller\'s assigned hotel, or no such photo.' })
  removePhoto(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Param('photoId') photoId: string): Promise<Hotel> {
    return this.hotels.removePhoto(req.user!.userId, id, photoId);
  }

  @Get(':id/reservations')
  @Header('Cache-Control', 'no-store')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.HOTEL_MODERATOR)
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: "List reservations for the moderator's own hotel (HTL-22)", description: 'ACC-11: read-only multi-room reservations for the assigned hotel, ten per page. Reuses HotelBookingsService and excludes payment/policy/private profile data.' })
  @ApiOkResponse({ description: 'A page of reservations', type: HotelReservationsPageDto })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  @ApiForbiddenResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: ':id is not the caller\'s assigned hotel.' })
  getReservations(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Query() query: PageQueryDto,
  ): Promise<HotelReservationsPage> {
    return this.hotels.getReservations(req.user!.userId, id, query.page ?? 1);
  }
}
