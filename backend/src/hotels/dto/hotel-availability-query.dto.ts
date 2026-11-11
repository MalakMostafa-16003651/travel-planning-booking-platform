import { PageQueryDto } from './page-query.dto';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, Matches } from 'class-validator';
import { DATE_ONLY } from './transforms';

/** HTL-08. An optional window; either bound may be omitted, and omitting both returns every stored range. */
export class HotelAvailabilityQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ example: '2026-12-01' })
  @IsOptional() @IsISO8601({strict:true}) @Matches(DATE_ONLY, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional() @IsISO8601({strict:true}) @Matches(DATE_ONLY, { message: 'to must be YYYY-MM-DD' })
  to?: string;
}
