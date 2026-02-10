import { IsBoolean, IsObject, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateGatewayDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({ required: false, description: 'Provider-specific configuration (non-sensitive)' })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}
