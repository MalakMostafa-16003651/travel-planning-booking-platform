import { ApiProperty } from '@nestjs/swagger';
import { Equals } from 'class-validator';

/** PAY-02: the acceptance checkbox. Like registration consent, only the literal `true` is accepted. */
export class AcceptPoliciesDto {
  @ApiProperty({ enum: [true], example: true })
  @Equals(true, { message: 'You must accept the booking policies' })
  accepted!: true;
}
