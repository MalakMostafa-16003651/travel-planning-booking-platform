import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { ReportAction } from '../report.enums';

export class ResolveReportDto {
  @ApiProperty({ enum: ReportAction, description: 'DISMISS closes this report only. HIDE or DELETE acts on the content and closes every open report about it.' })
  @IsEnum(ReportAction, { message: 'Action must be DISMISS, HIDE or DELETE' })
  action!: ReportAction;
}
