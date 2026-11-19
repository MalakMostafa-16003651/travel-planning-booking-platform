import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { FlightStatus } from '../../common/enums/flight-status.enum';

export class MyFlightsQueryDto {
  @ApiPropertyOptional({ example: 1, minimum: 1, description: 'Page number, 10 flights per page (GEN-05).' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @ApiPropertyOptional({ enum: FlightStatus, description: 'Only flights with this status (FLT-30).' })
  @IsOptional() @IsEnum(FlightStatus)
  status?: FlightStatus;
}
