import {
  IsString,
  IsUrl,
  IsOptional,
  IsBoolean,
  IsInt,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { INTERNAL_PATH_REGEX } from './create-banner-slide.dto';

export class UpdateBannerSlideDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @IsUrl({ require_protocol: true, protocols: ['https'] })
  imageUrlDesktop?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @IsUrl({ require_protocol: true, protocols: ['https'] })
  imageUrlMobile?: string;

  @ApiProperty({ required: false, description: 'R2 URL for the Simplified (簡體) desktop crop' })
  @IsOptional()
  @IsString()
  @IsUrl({ require_protocol: true, protocols: ['https'] })
  imageUrlDesktopSimplified?: string;

  @ApiProperty({ required: false, description: 'R2 URL for the Simplified (簡體) mobile crop' })
  @IsOptional()
  @IsString()
  @IsUrl({ require_protocol: true, protocols: ['https'] })
  imageUrlMobileSimplified?: string;

  @ApiProperty({ required: false, example: '/reading/annual' })
  @IsOptional()
  @IsString()
  @Matches(INTERNAL_PATH_REGEX, {
    message:
      'linkHref must be an internal absolute path (start with "/", not "//", no protocol or whitespace).',
  })
  linkHref?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  altText?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
