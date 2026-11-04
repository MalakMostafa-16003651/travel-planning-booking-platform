import { Body, Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse, ApiConflictResponse, ApiCookieAuth, ApiCreatedResponse, ApiForbiddenResponse, ApiNoContentResponse, ApiNotFoundResponse,
  ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags, ApiUnauthorizedResponse, ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { AuthGuard, AuthenticatedRequest } from '../auth/auth.guard';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { BudgetSummaryDto } from './dto/budget-summary.dto';
import { CreateItineraryDto } from './dto/create-itinerary.dto';
import { CreateItineraryDayDto, ReorderItineraryDaysDto, UpdateItineraryDayDto } from './dto/itinerary-day.dto';
import { BudgetSummaryQueryDto, ItineraryFlightsQueryDto, ItineraryHotelsQueryDto, PageQueryDto, SearchPublicItinerariesQueryDto } from './dto/itinerary-queries.dto';
import { ItineraryDto, ItineraryPageDto } from './dto/itinerary-response.dto';
import { CreateActivityDto } from './dto/activity.dto';
import { CreateBudgetEntryDto } from './dto/budget-entry.dto';
import { CreateTransportCostDto } from './dto/transport-cost.dto';
import { UpdateItineraryDto } from './dto/update-itinerary.dto';
import { ItinerariesService, SearchResult } from './itineraries.service';
import { OptionalAuthGuard } from './optional-auth.guard';
import { ItineraryFlightSearch, ItineraryHotelSearch } from './ports/travel-search.port';

const NOT_FOUND_DOC = 'Not found, or not yours. Private itineraries are owner-only, including for admins (ACC-11).';
const READ_NOT_FOUND_DOC = 'Not found, private and not yours, or the author is deactivated (ACC-11, ACC-12).';

@ApiTags('Itineraries')
@Controller('itineraries')
export class ItinerariesController {
  constructor(private readonly itineraries: ItinerariesService) {}

  // Static paths come before ":id" so Nest does not treat "public" as an id.

  @Get('public/search')
  @ApiOperation({
    summary: 'ITN-20/ITN-21: search public itineraries',
    description: 'Guests allowed. Filters by text, country, city and length; sorts by NEWEST, OLDEST, TITLE, SHORTEST or LONGEST. Page size 10. Itineraries by deactivated authors are excluded before counting (ACC-12).',
  })
  @ApiOkResponse({ type: ItineraryPageDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  searchPublic(@Query() query: SearchPublicItinerariesQueryDto): Promise<ItineraryPageDto> {
    return this.itineraries.searchPublic(query);
  }

  @Get('public/:id')
  @ApiOperation({ summary: 'ITN-21: view a public itinerary', description: 'Guests allowed.' })
  @ApiOkResponse({ type: ItineraryDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'Not found, not public, or the author is deactivated.' })
  getPublic(@Param('id') id: string): Promise<ItineraryDto> {
    return this.itineraries.getPublic(id);
  }

  @Post()
  @UseGuards(AuthGuard)
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: 'ITN-01: create an itinerary', description: "Starts with no days. Currency defaults to the user's preferredCurrency, else USD." })
  @ApiCreatedResponse({ type: ItineraryDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid fields or unsupported currency.' })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'Only role USER can create itineraries.' })
  create(@Body() input: CreateItineraryDto, @Req() request: AuthenticatedRequest): Promise<ItineraryDto> {
    return this.itineraries.create(input, request.user!);
  }

  @Get()
  @UseGuards(AuthGuard)
  @Header('Cache-Control', 'no-store')
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: 'ITN-03: list your itineraries', description: 'Most recently updated first. Page size 10.' })
  @ApiOkResponse({ type: ItineraryPageDto })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  listMine(@Query() query: PageQueryDto, @Req() request: AuthenticatedRequest): Promise<ItineraryPageDto> {
    return this.itineraries.listMine(request.user!.userId, query.page);
  }

  @Get(':id')
  @UseGuards(OptionalAuthGuard)
  @Header('Cache-Control', 'no-store')
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: 'ITN-03: view an itinerary', description: 'Owners see their own; anyone may see a public one.' })
  @ApiOkResponse({ type: ItineraryDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: READ_NOT_FOUND_DOC })
  get(@Param('id') id: string, @Req() request: AuthenticatedRequest): Promise<ItineraryDto> {
    return this.itineraries.getReadable(id, request.user);
  }

  @Patch(':id')
  @UseGuards(AuthGuard)
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: 'ITN-01/ITN-20: update an itinerary', description: 'Includes visibility. Changing startDate moves every day date.' })
  @ApiOkResponse({ type: ItineraryDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: NOT_FOUND_DOC })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'Edited concurrently; reload and retry.' })
  update(@Param('id') id: string, @Body() input: UpdateItineraryDto, @Req() request: AuthenticatedRequest): Promise<ItineraryDto> {
    return this.itineraries.update(id, request.user!.userId, input);
  }

  @Delete(':id')
  @UseGuards(AuthGuard)
  @HttpCode(204)
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: 'ITN-01: delete an itinerary', description: 'Also deletes its images. Clones made by others are unaffected.' })
  @ApiNoContentResponse()
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: NOT_FOUND_DOC })
  async remove(@Param('id') id: string, @Req() request: AuthenticatedRequest): Promise<void> {
    await this.itineraries.remove(id, request.user!.userId);
  }

  @Post(':id/days')
  @UseGuards(AuthGuard)
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: 'ITN-05: add a day', description: 'Appends, or inserts at `position`. Later days are renumbered and their dates move forward.' })
  @ApiCreatedResponse({ type: ItineraryDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: NOT_FOUND_DOC })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'Day limit reached, or edited concurrently.' })
  addDay(@Param('id') id: string, @Body() input: CreateItineraryDayDto, @Req() request: AuthenticatedRequest): Promise<ItineraryDto> {
    return this.itineraries.addDay(id, request.user!.userId, input);
  }

  @Patch(':id/days/reorder')
  @UseGuards(AuthGuard)
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: 'ITN-08: reorder days', description: 'Send every dayId in the new order. Day numbers, dates and city grouping follow the new order.' })
  @ApiOkResponse({ type: ItineraryDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'dayIds is not exactly the set of days.' })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: NOT_FOUND_DOC })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'Edited concurrently; reload and retry.' })
  reorderDays(@Param('id') id: string, @Body() input: ReorderItineraryDaysDto, @Req() request: AuthenticatedRequest): Promise<ItineraryDto> {
    return this.itineraries.reorderDays(id, request.user!.userId, input);
  }

  @Patch(':id/days/:dayId')
  @UseGuards(AuthGuard)
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: 'ITN-05: update a day', description: 'City, country and notes. Send an empty string to clear an optional field.' })
  @ApiOkResponse({ type: ItineraryDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: NOT_FOUND_DOC })
  updateDay(@Param('id') id: string, @Param('dayId') dayId: string, @Body() input: UpdateItineraryDayDto, @Req() request: AuthenticatedRequest): Promise<ItineraryDto> {
    return this.itineraries.updateDay(id, dayId, request.user!.userId, input);
  }

  @Delete(':id/days/:dayId')
  @UseGuards(AuthGuard)
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: 'ITN-07: delete a day', description: 'Deletes its activities, images and budget entries. Later days move back one day. Linked transport costs are kept but unlinked.' })
  @ApiOkResponse({ type: ItineraryDto })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: NOT_FOUND_DOC })
  deleteDay(@Param('id') id: string, @Param('dayId') dayId: string, @Req() request: AuthenticatedRequest): Promise<ItineraryDto> {
    return this.itineraries.deleteDay(id, dayId, request.user!.userId);
  }

  @Post(':id/days/:dayId/activities')
  @UseGuards(AuthGuard)
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: 'ITN-10: add an activity to a day' })
  @ApiCreatedResponse({ type: ItineraryDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: NOT_FOUND_DOC })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'Activity limit reached, or edited concurrently.' })
  addActivity(@Param('id') id: string, @Param('dayId') dayId: string, @Body() input: CreateActivityDto, @Req() request: AuthenticatedRequest): Promise<ItineraryDto> {
    return this.itineraries.addActivity(id, dayId, request.user!.userId, input);
  }

  @Post(':id/days/:dayId/budgets')
  @UseGuards(AuthGuard)
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: 'ITN-14: add a budget entry to a day', description: 'Category FOOD, ACCOMMODATION, ACTIVITIES or LOCAL_TRANSPORT; currency from the shared catalog.' })
  @ApiCreatedResponse({ type: ItineraryDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid fields or unsupported currency.' })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: NOT_FOUND_DOC })
  addBudget(@Param('id') id: string, @Param('dayId') dayId: string, @Body() input: CreateBudgetEntryDto, @Req() request: AuthenticatedRequest): Promise<ItineraryDto> {
    return this.itineraries.addBudget(id, dayId, request.user!.userId, input);
  }

  @Post(':id/transport-costs')
  @UseGuards(AuthGuard)
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: 'ITN-16: add an intercity transport cost' })
  @ApiCreatedResponse({ type: ItineraryDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid fields, unsupported currency, or unknown dayId.' })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: NOT_FOUND_DOC })
  addTransportCost(@Param('id') id: string, @Body() input: CreateTransportCostDto, @Req() request: AuthenticatedRequest): Promise<ItineraryDto> {
    return this.itineraries.addTransportCost(id, request.user!.userId, input);
  }

  @Get(':id/budget-summary')
  @UseGuards(OptionalAuthGuard)
  @Header('Cache-Control', 'no-store')
  @ApiCookieAuth('accessToken')
  @ApiOperation({
    summary: 'ITN-14/ITN-18: budget summary in a chosen currency',
    description: 'Totals per category, day, city stop and intercity transport, converted with FXRatesAPI rates (cached for 1 hour). If the provider fails, cached rates up to 7 days old are used and ratesStale is true.',
  })
  @ApiOkResponse({ type: BudgetSummaryDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Unsupported currency.' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: READ_NOT_FOUND_DOC })
  @ApiUnprocessableEntityResponse({ type: ApiErrorDto, description: 'The provider has no rate for one of the currencies.' })
  @ApiServiceUnavailableResponse({ type: ApiErrorDto, description: 'FXRatesAPI failed and no cached rates are available.' })
  budgetSummary(@Param('id') id: string, @Query() query: BudgetSummaryQueryDto, @Req() request: AuthenticatedRequest): Promise<BudgetSummaryDto> {
    return this.itineraries.budgetSummary(id, request.user, query.currency);
  }

  @Post(':id/clone')
  @UseGuards(AuthGuard)
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: 'ITN-21: clone a public itinerary', description: 'Creates your own PRIVATE copy with clonedFrom attribution (original id, author and title). Later changes to either copy do not affect the other.' })
  @ApiCreatedResponse({ type: ItineraryDto })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'Only role USER can clone.' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'Not found, not public, or the author is deactivated.' })
  clone(@Param('id') id: string, @Req() request: AuthenticatedRequest): Promise<ItineraryDto> {
    return this.itineraries.clone(id, request.user!);
  }

  @Get(':id/hotels')
  @UseGuards(OptionalAuthGuard)
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: 'ITN-25: search hotels for a city stop', description: 'Derives city, check-in and check-out from the stop containing dayId, then calls the Hotels module search.' })
  @ApiOkResponse({ description: '{ itineraryId, criteria, results } where results come from hotel search.' })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: READ_NOT_FOUND_DOC })
  @ApiServiceUnavailableResponse({ type: ApiErrorDto, description: 'Hotel search is not connected yet.' })
  searchHotels(@Param('id') id: string, @Query() query: ItineraryHotelsQueryDto, @Req() request: AuthenticatedRequest): Promise<SearchResult<ItineraryHotelSearch>> {
    return this.itineraries.searchHotels(id, request.user, query);
  }

  @Get(':id/flights')
  @UseGuards(OptionalAuthGuard)
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: 'ITN-26: search flights into a city stop', description: 'dayId must be the first day of a stop. Origin is the previous stop (or originCity for the first stop); the date is that day. Calls the Flights module search.' })
  @ApiOkResponse({ description: '{ itineraryId, criteria, results } where results come from flight search.' })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: READ_NOT_FOUND_DOC })
  @ApiServiceUnavailableResponse({ type: ApiErrorDto, description: 'Flight search is not connected yet.' })
  searchFlights(@Param('id') id: string, @Query() query: ItineraryFlightsQueryDto, @Req() request: AuthenticatedRequest): Promise<SearchResult<ItineraryFlightSearch>> {
    return this.itineraries.searchFlights(id, request.user, query);
  }
}
