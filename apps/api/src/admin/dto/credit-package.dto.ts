import { IsString, IsNumber, IsBoolean, IsInt, IsOptional, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Credit-package admin DTOs.
 *
 * These exist primarily to enforce `creditAmount >= 1`. Both routes previously
 * took a raw inline `@Body()` type, so the global ValidationPipe had nothing to
 * check and a package could be saved with `creditAmount: 0`.
 *
 * That is not a cosmetic problem. `createCreditPackageCheckout` writes the value
 * into Stripe checkout metadata as `String(pkg.creditAmount)`, and
 * `handleOneTimePayment` refuses to acknowledge a webhook whose metadata cannot
 * produce a grant — deliberately, so the customer's payment stays replayable
 * instead of being silently swallowed. A zero-credit package would therefore make
 * EVERY purchase of it fail its webhook and retry for ~3 days, turning one
 * data-entry slip into a sustained error storm that buries real alerts.
 *
 * So the guard belongs here, upstream, where a human gets an immediate 400.
 */
export class CreateCreditPackageDto {
  @ApiProperty()
  @IsString()
  slug!: string;

  @ApiProperty()
  @IsString()
  nameZhTw!: string;

  @ApiProperty()
  @IsString()
  nameZhCn!: string;

  /** Must be >= 1 — a pack that grants nothing is never a valid product. */
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  creditAmount!: number;

  @ApiProperty({ minimum: 0 })
  @IsNumber()
  @Min(0)
  priceUsd!: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class UpdateCreditPackageDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  nameZhTw?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  nameZhCn?: string;

  /** Same floor as create — an update must not be a back door to 0. */
  @ApiProperty({ required: false, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  creditAmount?: number;

  @ApiProperty({ required: false, minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  priceUsd?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
