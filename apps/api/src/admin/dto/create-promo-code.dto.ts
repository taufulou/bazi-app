import {
  IsString,
  IsNumber,
  IsInt,
  IsBoolean,
  IsOptional,
  IsEnum,
  IsDateString,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { DiscountType } from '@prisma/client';

export class CreatePromoCodeDto {
  @ApiProperty({ example: 'SUMMER2026' })
  @IsString()
  code!: string;

  @ApiProperty({ enum: ['PERCENTAGE', 'FIXED'] })
  @IsEnum(DiscountType)
  discountType!: DiscountType;

  @ApiProperty({ example: 20, description: 'Discount value (percentage or fixed amount)' })
  @IsNumber()
  @Min(0)
  discountValue!: number;

  @ApiProperty({ example: 100 })
  @IsInt()
  @Min(1)
  maxUses!: number;

  @ApiProperty({ example: '2026-01-01T00:00:00Z' })
  @IsDateString()
  validFrom!: string;

  @ApiProperty({ example: '2026-12-31T23:59:59Z' })
  @IsDateString()
  validUntil!: string;

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
