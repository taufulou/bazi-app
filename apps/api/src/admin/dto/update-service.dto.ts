import { IsString, IsInt, IsBoolean, IsOptional, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateServiceDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  nameZhTw?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  nameZhCn?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  descriptionZhTw?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  descriptionZhCn?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  creditCost?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
