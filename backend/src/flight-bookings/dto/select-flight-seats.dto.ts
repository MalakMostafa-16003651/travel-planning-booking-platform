import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsMongoId, Max, Min, ValidateNested } from 'class-validator';

export class FlightSeatSelectionDto {
  @ApiProperty() @IsMongoId() flightId!: string;
  @ApiProperty() @IsMongoId() passengerId!: string;
  @ApiProperty({ minimum: 1, description: 'Seat number within this cabin, from 1 to its capacity.' })
  @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) seatNumber!: number;
}
export class SelectFlightSeatsDto {
  @ApiProperty({ type: [FlightSeatSelectionDto], description: 'Replace selections for future segments; an empty array clears them. Past-segment history is retained.' })
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => FlightSeatSelectionDto)
  selections!: FlightSeatSelectionDto[];
}
export class FlightSeatMapSegmentDto {
  @ApiProperty() flightId!: string;
  @ApiProperty() cabinId!: string;
  @ApiProperty() capacity!: number;
  @ApiProperty() modifiable!: boolean;
  @ApiProperty({ type: [Number], description: 'Unavailable seat numbers only; never another booking or passenger ID. Numbers not listed within 1..capacity are free.' }) occupiedSeatNumbers!: number[];
}
export class FlightSeatMapDto {
  @ApiProperty() flightBookingId!: string;
  @ApiProperty({ type: [FlightSeatMapSegmentDto] }) segments!: FlightSeatMapSegmentDto[];
  @ApiProperty({ type: [FlightSeatSelectionDto] }) selections!: FlightSeatSelectionDto[];
}
