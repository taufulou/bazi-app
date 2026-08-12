import type { Appearance } from "@clerk/types";

/**
 * Typography + colour for the Clerk-rendered auth screens.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Clerk renders its own DOM. Nothing in `apps/web/app/styles/type.module.css`
 * reaches it, and the typography guards cannot see it either — so the sign-in and
 * sign-up screens sat entirely outside the type migration while being the FIRST
 * screen a new user sees.
 *
 * Measured before this file existed (390px viewport, /sign-in and /sign-up):
 *
 *   18 of 19 text nodes on /sign-up below the 14px content floor
 *   11px CJK hint text (「選填」)
 *   13px field labels, 13px footer, 13px submit button
 *   ⚠️ ALL SEVEN form inputs at 13px
 *
 * That last line is the load-bearing one. Mobile Safari force-zooms the viewport
 * when a focused input is under 16px and does NOT zoom back out — so a new user
 * on an iPhone got a zoomed, horizontally-panned page the moment they tapped the
 * email field, on the very first screen. This is the exact defect the `control`
 * role (17px) exists to prevent everywhere else in the app.
 *
 * The cause is a default, not a mistake: Clerk's `variables.fontSize` defaults to
 * **`0.8125rem` (13px)** and every other step (`xs`/`sm`/`lg`/`xl`) is derived
 * from it. Raising only the base would scale the card proportionally but still
 * land the inputs around 14px — under 16, so the zoom bug would survive. The
 * scale is therefore pinned explicitly, and the input is pinned AGAIN at the
 * element level so it cannot drift with a future Clerk multiplier change.
 *
 * KEEP IN SYNC with `apps/web/app/styles/type.module.css`. The mapping is:
 *   xs → caption 12 · sm → meta 13 · md → control 17 · lg → section 19 · xl → title 24
 * `md` is the body/control step, which is why it is 17 and not 15.
 */

/** Mirrors the token file. Duplicated because Clerk needs plain values, not CSS. */
const T = {
  caption: "0.75rem", // 12
  meta: "0.8125rem", // 13
  cell: "0.875rem", // 14
  control: "1.0625rem", // 17
  section: "1.1875rem", // 19
  title: "1.5rem", // 24
} as const;

export const clerkAppearance: Appearance = {
  variables: {
    colorPrimary: "#E23D28",
    colorBackground: "#FFFBF5",
    colorText: "#3C2415",
    colorInputBackground: "#FFFFFF",
    colorInputText: "#3C2415",
    fontSize: {
      xs: T.caption,
      sm: T.meta,
      md: T.control,
      lg: T.section,
      xl: T.title,
    },
  },
  elements: {
    /**
     * ⚠️ DO NOT LOWER — this is the iOS auto-zoom guard, not a style preference.
     * Pinned at the element level so it survives any change to Clerk's internal
     * scale multipliers. Mirrors Guard C in test/typography-guards.spec.ts, which
     * enforces the same floor on our own controls but cannot see Clerk's DOM.
     */
    formFieldInput: { fontSize: T.control },
    /** Was 11px CJK (「選填」) — the smallest text on either auth screen. */
    formFieldHintText: { fontSize: T.caption },
    formFieldLabel: { fontSize: T.cell },
    formButtonPrimary: { fontSize: T.control },
    footerActionText: { fontSize: T.cell },
    footerActionLink: { fontSize: T.cell },
    headerSubtitle: { fontSize: T.cell },
    dividerText: { fontSize: T.meta },
    socialButtonsBlockButtonText: { fontSize: T.cell },
    formFieldAction: { fontSize: T.meta },
    otpCodeFieldInput: { fontSize: T.control },
    identityPreviewText: { fontSize: T.cell },
  },
};
