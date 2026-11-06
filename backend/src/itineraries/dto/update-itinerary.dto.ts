import { PartialType } from '@nestjs/swagger';
import { CreateItineraryDto } from './create-itinerary.dto';

/** ITN-01, ITN-20: any subset of fields. Changing startDate shifts every day's date. */
export class UpdateItineraryDto extends PartialType(CreateItineraryDto, { skipNullProperties: false }) {}
