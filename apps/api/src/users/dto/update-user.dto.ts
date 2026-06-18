import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
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

  // Set to true the first time the user explicitly picks a script (繁/簡), so the
  // one-time first-run modal never fires again. Spreads straight into
  // prisma.user.update via UsersService.updateProfile (no service change needed).
  @ApiProperty({ required: false, example: true })
  @IsOptional()
  @IsBoolean()
  languageChosen?: boolean;
}
