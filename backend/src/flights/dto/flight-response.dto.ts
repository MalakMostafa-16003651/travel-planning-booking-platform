import { ApiProperty } from '@nestjs/swagger';

export class FlightResponseDto {
  @ApiProperty() flightId!: string;
  @ApiProperty() airlineId!: string;
  @ApiProperty() airlineName!: string;
  @ApiProperty() airlineCode!: string;
  @ApiProperty() flightNumber!: string;
  @ApiProperty() status!: string;
  @ApiProperty() departureAirport!: { code: string; name: string; city: string; country: string; timeZone: string };
  @ApiProperty() arrivalAirport!: { code: string; name: string; city: string; country: string; timeZone: string };
  @ApiProperty() departureAtUtc!: string;
  @ApiProperty() arrivalAtUtc!: string;
  @ApiProperty() departureLocalDateTime!: string;
  @ApiProperty() arrivalLocalDateTime!: string;
  @ApiProperty() durationMinutes!: number;
  @ApiProperty({ type: [Object] }) cabins!: Array<{ cabinId: string; cabinClass: string; price: number; totalSeats: number; bookedSeats: number; heldSeats: number; seatsRemaining: number; baggageAllowanceCount: number; baggageMaxWeightKg: number }>;
}
