import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength } from 'class-validator';

export class CreateFlightDto {
  @ApiProperty({ example: 'MS985' }) @IsString() @Matches(/^[A-Z0-9]{2,10}$/) flightNumber!: string;
  @ApiProperty({ example: 'CAI' }) @IsString() @Matches(/^[A-Z]{3}$/) departureAirportCode!: string;
  @ApiProperty({ example: 'DXB' }) @IsString() @Matches(/^[A-Z]{3}$/) arrivalAirportCode!: string;
  @ApiProperty({ example: '2026-12-10T14:00', description: 'Local time at departure airport, no UTC offset.' }) @IsString() @MaxLength(19) @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/) departureLocalDateTime!: string;
  @ApiProperty({ example: '2026-12-10T18:00', description: 'Local time at arrival airport, no UTC offset.' }) @IsString() @MaxLength(19) @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/) arrivalLocalDateTime!: string;
}
