import {
  IsString,
  IsDateString,
  IsEnum,
  IsOptional,
  IsNumber,
  IsBoolean,
  Matches,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Gender, RelationshipTag } from '@prisma/client';

export class CreateBirthProfileDto {
  @ApiProperty({ example: '張三' })
  @IsString()
  name!: string;

  @ApiProperty({ example: '1990-05-15', description: 'Birth date (YYYY-MM-DD)' })
  @IsDateString()
  birthDate!: string;

  @ApiProperty({ example: '14:30', description: 'Birth time (HH:MM, 24-hour)' })
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'birthTime must be in HH:MM format (24-hour)',
  })
  birthTime!: string;

  @ApiProperty({ example: '台北市' })
  @IsString()
  birthCity!: string;

  @ApiProperty({ example: 'Asia/Taipei', description: 'IANA timezone string' })
  @IsString()
  birthTimezone!: string;

  @ApiProperty({ required: false, example: 121.5654, description: 'Birth location longitude' })
  @IsOptional()
  @IsNumber()
  birthLongitude?: number;

  @ApiProperty({ required: false, example: 25.033, description: 'Birth location latitude' })
  @IsOptional()
  @IsNumber()
  birthLatitude?: number;

  @ApiProperty({ enum: ['MALE', 'FEMALE'] })
  @IsEnum(Gender)
  gender!: Gender;

  @ApiProperty({ required: false, enum: ['SELF', 'FAMILY', 'FRIEND'], default: 'SELF' })
  @IsOptional()
  @IsEnum(RelationshipTag)
  relationshipTag?: RelationshipTag;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class UpdateBirthProfileDto {
  @ApiProperty({ required: false, example: '張三' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ required: false, example: '1990-05-15' })
  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @ApiProperty({ required: false, example: '14:30' })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'birthTime must be in HH:MM format (24-hour)',
  })
  birthTime?: string;

  @ApiProperty({ required: false, example: '台北市' })
  @IsOptional()
  @IsString()
  birthCity?: string;

  @ApiProperty({ required: false, example: 'Asia/Taipei' })
  @IsOptional()
  @IsString()
  birthTimezone?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  birthLongitude?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  birthLatitude?: number;

  @ApiProperty({ required: false, enum: ['MALE', 'FEMALE'] })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @ApiProperty({ required: false, enum: ['SELF', 'FAMILY', 'FRIEND'] })
  @IsOptional()
  @IsEnum(RelationshipTag)
  relationshipTag?: RelationshipTag;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}
