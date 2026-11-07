import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsEnum, IsInt, IsNumber, Min, ValidateNested } from 'class-validator';
import { CabinClass } from '../schemas/cabin-inventory.schema';

export class CabinDefinitionDto {
  @ApiProperty({ enum: CabinClass, example: CabinClass.ECONOMY }) @IsEnum(CabinClass) cabinClass!: CabinClass;
  @ApiProperty({ example: 120 }) @IsInt() @Min(1) totalSeats!: number;
  @ApiProperty({ example: 125000, description: 'Integer minor units. Confirm platform currency with Person 8.' }) @IsInt() @Min(1) price!: number;
  @ApiProperty({ example: 1 }) @IsInt() @Min(0) baggageAllowanceCount!: number;
  @ApiProperty({ example: 23 }) @IsNumber() @Min(0.1) baggageMaxWeightKg!: number;
}

export class CreateCabinsDto {
  @ApiProperty({ type: [CabinDefinitionDto] }) @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => CabinDefinitionDto) cabins!: CabinDefinitionDto[];
}
