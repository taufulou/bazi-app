import { IsString, IsBoolean, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdatePromptTemplateDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  systemPrompt?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  userPromptTemplate?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  outputFormatInstructions?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
