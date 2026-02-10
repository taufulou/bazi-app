import { IsEnum, IsOptional, IsString, IsInt, Min, Max, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ReadingType, ComparisonType } from '@prisma/client';

const ZWDS_READING_TYPES = [
  'ZWDS_LIFETIME',
  'ZWDS_ANNUAL',
  'ZWDS_CAREER',
  'ZWDS_LOVE',
  'ZWDS_HEALTH',
  'ZWDS_MONTHLY',
  'ZWDS_DAILY',
  'ZWDS_MAJOR_PERIOD',
  'ZWDS_QA',
] as const;

export class CreateZwdsReadingDto {
  @ApiProperty({ description: 'Birth profile ID' })
  @IsString()
  birthProfileId!: string;

  @ApiProperty({
    enum: ZWDS_READING_TYPES,
    description: 'ZWDS reading type',
  })
  @IsEnum(ReadingType)
  readingType!: ReadingType;

  @ApiProperty({ required: false, example: 2026, description: 'Target year (for ZWDS_ANNUAL/ZWDS_MONTHLY readings)' })
  @IsOptional()
  @IsInt()
  @Min(1900)
  @Max(2100)
  targetYear?: number;

  @ApiProperty({ required: false, example: 3, description: 'Target month 1-12 (for ZWDS_MONTHLY readings)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  targetMonth?: number;

  @ApiProperty({ required: false, example: '2026-3-15', description: 'Target day in YYYY-M-D format (for ZWDS_DAILY readings)' })
  @IsOptional()
  @IsString()
  targetDay?: string;

  @ApiProperty({ required: false, description: 'Question text (for ZWDS_QA readings, max 500 chars)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  questionText?: string;
}

export class CreateZwdsComparisonDto {
  @ApiProperty({ description: 'First birth profile ID' })
  @IsString()
  profileAId!: string;

  @ApiProperty({ description: 'Second birth profile ID' })
  @IsString()
  profileBId!: string;

  @ApiProperty({ enum: ['ROMANCE', 'BUSINESS', 'FRIENDSHIP'] })
  @IsEnum(ComparisonType)
  comparisonType!: ComparisonType;
}

export class CrossSystemReadingDto {
  @ApiProperty({ description: 'Birth profile ID' })
  @IsString()
  birthProfileId!: string;
}

export class DeepStarReadingDto {
  @ApiProperty({ description: 'Birth profile ID' })
  @IsString()
  birthProfileId!: string;
}

export class ZwdsChartPreviewDto {
  @ApiProperty({ description: 'Birth profile ID' })
  @IsString()
  birthProfileId!: string;
}

export class ZwdsHoroscopeDto {
  @ApiProperty({ description: 'Birth profile ID' })
  @IsString()
  birthProfileId!: string;

  @ApiProperty({ description: 'Target date in YYYY-M-D format', example: '2026-2-10' })
  @IsString()
  targetDate!: string;
}
