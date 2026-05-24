import type { BirthProfile } from './birth-profiles-api';

/**
 * Returns the display name for a birth profile in UI chrome
 * (header chips, navigation labels).
 *
 * Design (2026-05-19): always returns `profile.name` for ALL relationship
 * types (SELF / FAMILY / FRIEND). The earlier 「本人」 substitution for SELF
 * was dropped — the user's own profile name (e.g., "Roger") is more
 * informative and consistent across the row when switching profiles.
 *
 * - any profile → `profile.name`
 * - undefined profile → `''` (caller decides whether to render; the page
 *   gates the chip on truthy return so it hides cleanly during the
 *   profile-fetch loading window)
 * - profile with null `name` (API schema drift) → `''` (defensive)
 */
export function getProfileDisplayName(profile: BirthProfile | undefined): string {
  if (!profile) return '';
  // Defensive `?? ''` for null/undefined name (API schema drift, partial
  // response). Without this, function would return `null` cast as string.
  return profile.name ?? '';
}
