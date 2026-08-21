import { IsInt, IsNotEmpty, IsString, Max, Min, NotEquals } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

/**
 * The bounds here are guard rails against a slipped keystroke, not a trust
 * boundary — the caller is already an authenticated admin. A mistyped
 * `1000000` is far more likely than a malicious admin, and it is the one that
 * silently mints real money.
 */
export const ADMIN_CREDIT_ADJUST_MAX = 10_000;

export class AdjustCreditsDto {
  @ApiProperty({
    example: 10,
    description: `Positive to add, negative to subtract. Non-zero, |amount| <= ${ADMIN_CREDIT_ADJUST_MAX}.`,
  })
  @IsInt()
  // A zero adjustment writes an audit row that records nothing happening.
  @NotEquals(0)
  @Min(-ADMIN_CREDIT_ADJUST_MAX)
  @Max(ADMIN_CREDIT_ADJUST_MAX)
  amount!: number;

  @ApiProperty({ example: 'Complimentary credits for support case #123' })
  @IsString()
  // The reason is the whole point of the audit row — an empty string is a
  // silent grant with a paper trail that explains nothing. Trim first, or
  // `"   "` satisfies @IsNotEmpty and lands in the ledger as blank.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsNotEmpty()
  reason!: string;
}
