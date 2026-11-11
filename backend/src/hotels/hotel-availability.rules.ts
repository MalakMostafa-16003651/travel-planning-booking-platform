import { BadRequestException } from '@nestjs/common';
export interface BookableDates { startDate: string; endDate: string; }
export function isCalendarDate(value: unknown): value is string {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const date=new Date(value+'T00:00:00.000Z');
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}
export function assertDates(startDate:string,endDate:string):void {
  if(!isCalendarDate(startDate)||!isCalendarDate(endDate)||startDate>=endDate)throw new BadRequestException('Supply real dates with startDate before endDate');
}
/** Reject overlaps; merge adjacent intervals so one Mongo containment predicate covers a stay. */
export function normalizeBookableRanges(input:BookableDates[]):BookableDates[] {
  const sorted=input.map(r=>{assertDates(r.startDate,r.endDate);return {...r};}).sort((a,b)=>a.startDate.localeCompare(b.startDate));
  const result:BookableDates[]=[];
  for(const row of sorted) {
    const previous=result.at(-1);
    if(previous&&row.startDate<previous.endDate)throw new BadRequestException('Bookable ranges must not overlap');
    if(previous&&row.startDate===previous.endDate)previous.endDate=row.endDate;
    else result.push(row);
  }
  return result;
}
export function coversStay(ranges:BookableDates[]|undefined,start:string,end:string):boolean {
  let through=start;
  for(const range of [...(ranges??[])].sort((a,b)=>a.startDate.localeCompare(b.startDate))) {
    if(range.endDate<=through)continue;
    if(range.startDate>through)return false;
    through=range.endDate;
    if(through>=end)return true;
  }
  return false;
}
export function activeBookedRange(range:{status:string;holdExpiresAt?:Date},now=new Date()):boolean {
  return range.status==='BOOKED'||(range.status==='HELD'&&(!range.holdExpiresAt||range.holdExpiresAt>now));
}
