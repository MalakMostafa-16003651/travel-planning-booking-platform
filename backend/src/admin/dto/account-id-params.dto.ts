import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';

export class AccountIdParamsDto {
  @ApiProperty({ pattern: '^[a-fA-F0-9]{24}$', description: 'The account (user or moderator) ID.' })
  @IsMongoId({ message: 'Account ID must be a valid ID' })
  id!: string;
}
