import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Internal absolute path matcher for `linkHref`.
 * - `^\/`        must start with a slash (same-origin)
 * - `(?!\/)`     reject protocol-relative `//evil.com` (open-redirect)
 * - `[^\s\\]*$`  no whitespace / backslash anywhere
 * `javascript:` / `http(s)://` fail the leading `^/` and are rejected too.
 */
export const INTERNAL_PATH_REGEX = /^\/(?!\/)[^\s\\]*$/;

export class CreateBannerSlideDto {
  @ApiProperty({ required: false, description: 'Admin-only label (not rendered)' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;

  @ApiProperty({ description: 'R2 public URL for the desktop crop' })
  @IsString()
  imageUrlDesktop!: string;

  @ApiProperty({ description: 'R2 public URL for the mobile crop' })
  @IsString()
  imageUrlMobile!: string;

  @ApiProperty({ example: '/reading/annual', description: 'Internal absolute path' })
  @IsString()
  @Matches(INTERNAL_PATH_REGEX, {
    message:
      'linkHref must be an internal absolute path (start with "/", not "//", no protocol or whitespace).',
  })
  linkHref!: string;

  @ApiProperty({ required: false, description: 'Image alt text for accessibility' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  altText?: string;

  @ApiProperty({ required: false, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
