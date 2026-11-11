import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsISO8601, Matches, ValidateNested } from 'class-validator';
import { DATE_ONLY } from './transforms';
export class RoomBookableDatesDto {
  @ApiProperty({example:'2026-12-01'}) @Matches(DATE_ONLY) @IsISO8601({strict:true}) startDate!:string;
  @ApiProperty({example:'2027-01-01',description:'Exclusive checkout boundary.'}) @Matches(DATE_ONLY) @IsISO8601({strict:true}) endDate!:string;
}
export class SetRoomBookableRangesDto {
  @ApiProperty({type:[RoomBookableDatesDto],description:'Replace positive availability. [] closes the room to new stays; protected reservation dates cannot be removed. Adjacent ranges merge.'})
  @IsArray() @ArrayMaxSize(100) @ValidateNested({each:true}) @Type(()=>RoomBookableDatesDto)
  ranges!:RoomBookableDatesDto[];
}
