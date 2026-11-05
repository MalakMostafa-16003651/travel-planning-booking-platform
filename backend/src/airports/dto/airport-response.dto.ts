import { ApiProperty } from '@nestjs/swagger';
import { Airport } from '../schemas/airport.schema';

export class AirportResponseDto {
  @ApiProperty({ example: 'CAI' }) code!: string;
  @ApiProperty({ example: 'Cairo International Airport' }) name!: string;
  @ApiProperty({ example: 'Cairo' }) city!: string;
  @ApiProperty({ example: 'Egypt' }) country!: string;
  @ApiProperty({ example: 'Africa/Cairo' }) timeZone!: string;

  static from(airport: Airport): AirportResponseDto {
    return { code: airport.code, name: airport.name, city: airport.city, country: airport.country, timeZone: airport.timeZone };
  }
}
