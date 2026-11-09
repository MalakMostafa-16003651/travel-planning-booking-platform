import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsMongoId, Validate, ValidateIf, ValidationArguments, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';

@ValidatorConstraint({ name: 'exactlyOneFavoriteTarget', async: false })
class ExactlyOneFavoriteTarget implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const input = args.object as CreateFavoriteDto;
    return (input.hotelId !== undefined) !== (input.itineraryId !== undefined);
  }

  defaultMessage(): string { return 'Exactly one of hotelId or itineraryId is required'; }
}

export class CreateFavoriteDto {
  @ApiPropertyOptional({ description: 'An active hotel ID. Supply exactly one target ID.' })
  @ValidateIf((input: CreateFavoriteDto) => input.hotelId !== undefined || input.itineraryId === undefined)
  @IsMongoId({ message: 'hotelId must be a MongoDB ID' })
  @Validate(ExactlyOneFavoriteTarget)
  hotelId?: string;

  @ApiPropertyOptional({ description: 'A currently public, visible itinerary ID. Supply exactly one target ID.' })
  @ValidateIf((input: CreateFavoriteDto) => input.itineraryId !== undefined || input.hotelId === undefined)
  @IsMongoId({ message: 'itineraryId must be a MongoDB ID' })
  @Validate(ExactlyOneFavoriteTarget)
  itineraryId?: string;
}
