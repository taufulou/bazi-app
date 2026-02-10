import { IsInt, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AdjustCreditsDto {
  @ApiProperty({ example: 10, description: 'Positive to add, negative to subtract' })
  @IsInt()
  amount!: number;

  @ApiProperty({ example: 'Complimentary credits for support case #123' })
  @IsString()
  reason!: string;
}
