import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength } from 'class-validator';

/**
 * Body of `POST /api/users/me/ai-consent` — the AI-data disclosure version the
 * client DISPLAYED. The service then checks it against the server's accepted
 * list (`legal/legal-constants.ts`); this DTO only bounds its shape.
 */
export class RecordAiConsentDto {
  @ApiProperty({ example: 'ai-2026-11-21' })
  @IsString()
  @MaxLength(32)
  @Matches(/^[A-Za-z0-9._-]+$/)
  version!: string;
}
