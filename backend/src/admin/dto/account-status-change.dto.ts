import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class AccountStatusChangeDto {
  @ApiPropertyOptional({ example: 'Repeated abusive comments', description: 'Optional reason, kept in the audit log (GEN-07).' })
  @IsOptional()
  @IsString({ message: 'Reason must be text' })
  @MinLength(3, { message: 'Reason must be at least 3 characters' })
  @MaxLength(500, { message: 'Reason must be at most 500 characters' })
  reason?: string;
}
