import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Language } from '@prisma/client';

export class UpdateUserDto {
  @ApiProperty({ required: false, example: '張三' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ required: false, enum: ['ZH_TW', 'ZH_CN'], example: 'ZH_TW' })
  @IsOptional()
  @IsEnum(Language)
  languagePref?: Language;
}
