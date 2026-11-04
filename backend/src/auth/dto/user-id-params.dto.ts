import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';

export class UserIdParamsDto {
  @ApiProperty({ type: String, pattern: '^[a-fA-F0-9]{24}$', description: 'Target user or moderator MongoDB identifier.' })
  @IsMongoId({ message: 'User ID must be a valid MongoDB identifier' })
  userId!: string;
}
