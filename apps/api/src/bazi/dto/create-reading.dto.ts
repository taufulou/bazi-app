import { IsEnum, IsOptional, IsString, IsInt, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ReadingType, ComparisonType } from '@prisma/client';

export class CreateReadingDto {
  @ApiProperty({ description: 'Birth profile ID' })
  @IsString()
  birthProfileId!: string;

  @ApiProperty({ enum: ['LIFETIME', 'ANNUAL', 'CAREER', 'LOVE', 'HEALTH'] })
  @IsEnum(ReadingType)
  readingType!: ReadingType;

  @ApiProperty({ required: false, example: 2026, description: 'Target year (for ANNUAL readings)' })
  @IsOptional()
  @IsInt()
  @Min(1900)
  @Max(2100)
  targetYear?: number;
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
}
