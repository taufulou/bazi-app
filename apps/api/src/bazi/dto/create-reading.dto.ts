import { IsIn, IsEnum, IsOptional, IsString, IsInt, IsBoolean, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ReadingType, ComparisonType } from '@prisma/client';

/**
 * The reading types this Bazi endpoint may create.
 *
 * ⚠️ NOT `ReadingType` wholesale. `@IsEnum(ReadingType)` accepted all 17 values
 * while the `@ApiProperty` one line below documented five — and class-validator
 * does not read Swagger metadata, so the docs and the validator disagreed.
 * `createReading` has no other family check (its only gate is an active `Service`
 * row, and all ten ZWDS rows are active), so `POST /api/bazi/readings` with
 * `readingType: 'ZWDS_LIFETIME'` deducted 2 credits and dispatched into the ZWDS
 * prompt map, narrating a 紫微斗數 reading over Bazi-shaped calculation data.
 * Paid output, coherent-looking, describing a chart that was never computed.
 *
 * ZWDS was deleted for never shipping; this is the door it was still reachable
 * through. Kept as a validator rather than a DB flag so it survives a re-seed,
 * and next to the `@ApiProperty` so the two can be seen to agree.
 */
export const BAZI_CREATABLE_READING_TYPES = [
  ReadingType.LIFETIME,
  ReadingType.ANNUAL,
  ReadingType.CAREER,
  ReadingType.LOVE,
  ReadingType.HEALTH,
] as const;

export class CreateReadingDto {
  @ApiProperty({ description: 'Birth profile ID' })
  @IsString()
  birthProfileId!: string;

  @ApiProperty({ enum: BAZI_CREATABLE_READING_TYPES })
  @IsIn(BAZI_CREATABLE_READING_TYPES as unknown as ReadingType[])
  readingType!: ReadingType;

  @ApiProperty({ required: false, example: 2026, description: 'Target year (for ANNUAL readings)' })
  @IsOptional()
  @IsInt()
  @Min(1900)
  @Max(2100)
  targetYear?: number;

  @ApiProperty({ required: false, description: 'Enable SSE streaming for LIFETIME readings' })
  @IsOptional()
  @IsBoolean()
  stream?: boolean;
}

export class CreateComparisonDto {
  @ApiProperty({ description: 'First birth profile ID' })
  @IsString()
  profileAId!: string;

  @ApiProperty({ description: 'Second birth profile ID' })
  @IsString()
  profileBId!: string;

  @ApiProperty({ enum: ['ROMANCE', 'BUSINESS', 'FRIENDSHIP'] })
  @IsEnum(ComparisonType)
  comparisonType!: ComparisonType;

  @ApiProperty({ required: false, description: 'Skip AI interpretation (return calculation data only)' })
  @IsOptional()
  @IsBoolean()
  skipAI?: boolean;
}
