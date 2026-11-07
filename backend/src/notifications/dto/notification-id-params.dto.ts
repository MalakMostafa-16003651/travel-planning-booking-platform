import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';

export class NotificationIdParamsDto {
  @ApiProperty({ pattern: '^[a-fA-F0-9]{24}$' })
  @IsMongoId({ message: 'Notification ID must be a valid ID' })
  id!: string;
}
