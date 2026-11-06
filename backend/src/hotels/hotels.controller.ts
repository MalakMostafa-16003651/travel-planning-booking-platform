import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiInternalServerErrorResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { AuthGuard, AuthenticatedRequest } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { BlockRoomDatesDto } from './dto/block-room-dates.dto';
import { CreateHotelDto } from './dto/create-hotel.dto';
import { CreateRoomDto } from './dto/create-room.dto';
import { HotelAvailabilityQueryDto } from './dto/hotel-availability-query.dto';
import { UpdateHotelDto } from './dto/update-hotel.dto';
import { UpdateRoomAvailabilityDto } from './dto/update-room-availability.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { Hotel } from './schemas/hotel.schema';
import { Room } from './schemas/room.schema';
import { RoomAvailability } from './schemas/room-availability.schema';
import { HotelsService, RoomAvailabilityOverview } from './hotels.service';
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
  create(@Body() body: CreateHotelDto): Promise<Hotel> {
    return this.hotels.create(body);
  }

  @Get(':id')
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({ summary: 'View a hotel profile (HTL-02)' })
  @ApiOkResponse({ description: 'The hotel profile' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'Not found, or deactivated and not visible to the caller.' })
  getById(@Param('id') id: string, @Req() req: AuthenticatedRequest): Promise<Hotel> {
    return this.hotels.getById(id, req.user);
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
  @ApiOperation({ summary: 'Remove a room from the moderator\'s own hotel (HTL-06)', description: 'A soft deactivation: existing bookings referencing the room keep a valid id.' })
  @ApiNoContentResponse()
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  @ApiForbiddenResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'Not :id\'s hotel, or the room does not belong to it.' })
  async deactivateRoom(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Param('roomId') roomId: string): Promise<void> {
    await this.hotels.deactivateRoom(req.user!.userId, id, roomId);
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
}
