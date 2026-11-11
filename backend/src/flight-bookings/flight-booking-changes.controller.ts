import { FlightBookingChangeDto } from './dto/flight-booking-change.dto';
import { Body, Controller, Get, Header, Param, Post, Req, UseGuards, Patch } from '@nestjs/common';
import { ApiBadRequestResponse, ApiConflictResponse, ApiCookieAuth, ApiCreatedResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthGuard, AuthenticatedRequest } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from '../common/enums/user-role.enum';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { CreateFlightBookingChangeDto } from './dto/create-flight-booking-change.dto';
import { FlightBookingChangesService } from './flight-booking-changes.service';
@ApiTags('Flight booking changes')
@ApiCookieAuth('accessToken')
@UseGuards(AuthGuard,RolesGuard)
@Roles(UserRole.USER)
@ApiBadRequestResponse({type:ApiErrorDto})
@ApiUnauthorizedResponse({type:ApiErrorDto})
@ApiForbiddenResponse({type:ApiErrorDto})
@ApiNotFoundResponse({type:ApiErrorDto})
@ApiConflictResponse({type:ApiErrorDto})
@Controller()
export class FlightBookingChangesController {
  constructor(private readonly changes:FlightBookingChangesService) {}
  @Post('flight-bookings/:id/changes') @Header('Cache-Control','no-store')
  @ApiOperation({summary:'FLT-27: hold a replacement trip and quote its fare difference'})
  @ApiCreatedResponse({type:FlightBookingChangeDto,description:'10-minute change hold; original booking stays Confirmed.'})
  create(@Param('id')id:string,@Req()request:AuthenticatedRequest,@Body()input:CreateFlightBookingChangeDto){return this.changes.create(id,request.user!.userId,input);}
  @Patch('flight-bookings/:id/change-flight') @Header('Cache-Control','no-store')
  @ApiOperation({summary:'FLT-27: change flight (PDF path for POST /api/flight-bookings/{id}/changes)',description:'Same request and result: holds the replacement trip for 10 minutes and quotes the fare difference. Finish with POST /api/flight-booking-changes/{id}/confirm (equal/lower fare) or a Stripe payment of type flight-change (higher fare).'})
  @ApiOkResponse({type:FlightBookingChangeDto,description:'10-minute change hold; original booking stays Confirmed.'})
  changeFlight(@Param('id')id:string,@Req()request:AuthenticatedRequest,@Body()input:CreateFlightBookingChangeDto){return this.changes.create(id,request.user!.userId,input);}
  @Get('flight-booking-changes/:id') @Header('Cache-Control','no-store')
  @ApiOperation({summary:'FLT-27: view your change quote and result'})
  @ApiOkResponse({type:FlightBookingChangeDto,description:'Own change, amount to pay/refund and status.'})
  async get(@Param('id')id:string,@Req()request:AuthenticatedRequest){return this.changes.view(await this.changes.owned(id,request.user!.userId));}
  @Post('flight-booking-changes/:id/confirm') @Header('Cache-Control','no-store')
  @ApiOperation({summary:'FLT-27: apply an accepted equal/lower fare; higher fare uses Stripe'})
  @ApiCreatedResponse({type:FlightBookingChangeDto,description:'Atomic replacement, preserving original reference.'})
  confirm(@Param('id')id:string,@Req()request:AuthenticatedRequest){return this.changes.confirmFree(id,request.user!.userId);}
  @Post('flight-booking-changes/:id/cancel') @Header('Cache-Control','no-store')
  @ApiOperation({summary:'FLT-27: cancel your pending replacement hold'})
  @ApiCreatedResponse({type:FlightBookingChangeDto,description:'Replacement inventory released; original booking preserved.'})
  cancel(@Param('id')id:string,@Req()request:AuthenticatedRequest){return this.changes.cancel(id,request.user!.userId);}
}
