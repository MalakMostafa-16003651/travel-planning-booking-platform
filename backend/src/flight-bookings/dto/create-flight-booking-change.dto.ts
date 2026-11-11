import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, ValidateNested } from 'class-validator';
import { FlightSelectionDto } from './create-flight-booking.dto';
export class CreateFlightBookingChangeDto {
  @ApiProperty({ type: [FlightSelectionDto], description: 'Replacement outbound/return, same airport pairs and cabin classes. Passengers remain unchanged.' })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(2) @ValidateNested({ each: true }) @Type(() => FlightSelectionDto)
  segments!: FlightSelectionDto[];
}
