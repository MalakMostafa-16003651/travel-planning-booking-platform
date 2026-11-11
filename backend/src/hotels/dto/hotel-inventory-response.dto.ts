import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { RoomBookableDatesDto } from './set-room-bookable-ranges.dto';
export class AvailableRoomDto {
  @ApiProperty() roomId!:string;
  @ApiPropertyOptional({description:'Legacy Mongo ID alias.'}) _id?:string;
  @ApiProperty() name!:string;
  @ApiPropertyOptional({description:'Missing on legacy records until completed.'}) type?:string;
  @ApiPropertyOptional({minimum:1}) beds?:number;
  @ApiProperty({minimum:1}) capacity!:number;
  @ApiProperty({description:'USD minor units.'}) pricePerNight!:number;
  @ApiProperty({description:'Nights multiplied by nightly price, USD minor units.'}) totalStayPrice!:number;
  @ApiProperty({example:'USD'}) currency!:string;
}
export class AvailableRoomsPageDto {
  @ApiProperty({type:[AvailableRoomDto]}) items!:AvailableRoomDto[];
  @ApiProperty() page!:number;
  @ApiProperty({example:10}) pageSize!:number;
  @ApiProperty() total!:number;
  @ApiProperty() totalPages!:number;
}
export class RoomDayDto {
  @ApiProperty({format:'date'}) date!:string;
  @ApiProperty({enum:['AVAILABLE','BOOKED','BLOCKED'],description:'Live Pending holds count as Booked with bookingStatus PENDING; no confirmed reference is invented.'}) status!:string;
  @ApiPropertyOptional() bookingReference?:string;
  @ApiPropertyOptional() hotelBookingId?:string;
  @ApiPropertyOptional({enum:BookingStatus}) bookingStatus?:BookingStatus;
  @ApiPropertyOptional() reason?:string;
}
export class RoomAvailabilityItemDto {
  @ApiProperty() roomId!:string;
  @ApiProperty() roomName!:string;
  @ApiProperty() isActive!:boolean;
  @ApiProperty({type:[RoomBookableDatesDto]}) bookableRanges!:RoomBookableDatesDto[];
  @ApiProperty({type:[Object]}) blockedRanges!:object[];
  @ApiProperty({type:[Object]}) bookedRanges!:object[];
  @ApiProperty({type:[RoomDayDto]}) days!:RoomDayDto[];
}
export class RoomAvailabilityPageDto {
  @ApiProperty({type:[RoomAvailabilityItemDto]}) items!:RoomAvailabilityItemDto[];
  @ApiProperty() page!:number;
  @ApiProperty({example:10}) pageSize!:number;
  @ApiProperty() total!:number;
  @ApiProperty() totalPages!:number;
  @ApiProperty({format:'date'}) from!:string;
  @ApiProperty({format:'date',description:'Exclusive end.'}) to!:string;
}
