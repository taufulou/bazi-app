# Credit Display Implementation Plan (v3 — Final, Approved)

## Overview
Implement 4 credit display features across the frontend to show users their credit balance, reading costs, insufficient credits messaging, and subscription tier information.

### Review History
- **v1:** 21 issues identified by staff engineer review
- **v2:** All 21 issues addressed; 5 minor notes from second review
- **v3 (this):** Final version incorporating all feedback. **APPROVED by staff engineer.**

### Key Design Decisions
- **Credit costs from shared constants** — `creditCost` added to `READING_TYPE_META`, eliminating `getServices()` API call
- **Dashboard keeps server component pattern** — `CreditBadge` and `AccountPanel` are self-contained client islands, each fetching independently (2 small GETs, HTTP/2 multiplexed, ~500 bytes each)
- **Reading page: 2 parallel API calls** — consolidated from 3 separate effects into one `Promise.all([fetchBirthProfiles, getUserProfile])`
- **Optimistic credit update** — use `response.creditsUsed` from NestJS response (not hardcoded cost) to correctly handle free readings
- **Credit Info Bar as sibling** — rendered outside BirthDataForm to avoid coupling concerns
- **No progress bar** — no meaningful denominator available without extra API call

---

## Step 0: Add `creditCost` to Shared Constants
**Location:** `packages/shared/src/constants.ts`

### Rationale
Credit costs are seeded in the DB and rarely change. Embedding them in the shared constant eliminates:
- A network request (`GET /api/bazi/services`) on every reading page load
- NestJS dependency for unauthenticated users
- Fetching 16 records to extract one integer

### Changes

**Modify: `packages/shared/src/constants.ts`**
- Add `creditCost: number` to the `READING_TYPE_META` type definition
- Add values matching seed data (`prisma/seed.ts`):
  - `lifetime`: 2, `annual`: 2, `career`: 2, `love`: 2, `health`: 2, `compatibility`: 3
  - `zwds-lifetime`: 2, `zwds-annual`: 2, `zwds-career`: 2, `zwds-love`: 2, `zwds-health`: 2, `zwds-compatibility`: 3
  - `zwds-monthly`: 1, `zwds-daily`: 0, `zwds-major-period`: 2, `zwds-qa`: 1

---

## Step 1: API Client Functions
**Location:** `apps/web/app/lib/api.ts`

### Changes

Add `getUserProfile()` function:
```typescript
export interface UserProfile {
  id: string;
  credits: number;
  subscriptionTier: 'FREE' | 'BASIC' | 'PRO' | 'MASTER';
  freeReadingUsed: boolean;
  name: string | null;
}

export async function getUserProfile(token: string): Promise<UserProfile> {
  return apiFetch<UserProfile>('/api/users/me', { token });
}
```

Notes:
- Actual `GET /api/users/me` returns more fields — TypeScript structural typing handles extra properties
- Prisma serializes `SubscriptionTier` as uppercase (`FREE`, `BASIC`, `PRO`, `MASTER`) — verified
- `canUseFreeReading()` in `stripe.service.ts` is simply `return !user.freeReadingUsed` — safe to use raw field

---

## Feature 1: Dashboard Header Credit Badge
**Location:** `apps/web/app/dashboard/page.tsx` + new component

### Architecture
- `CreditBadge` is a **self-contained client component** with internal data fetching
- Uses `useAuth()` from Clerk to get JWT token
- Calls `getUserProfile(token)` on mount via `useEffect`
- Manages its own loading/error/data state internally
- Dashboard page remains a server component — CreditBadge is a client island

### Changes

**New file: `apps/web/app/components/CreditBadge.tsx`**
- Client component (`"use client"`)
- Internal state: `credits`, `subscriptionTier`, `freeReadingUsed`, `isLoading`
- Uses `useAuth()` → `getToken()` → `getUserProfile(token)` on mount
- Renders:
  - If loading: inline skeleton shimmer (small, 60px wide)
  - If data loaded: `💎 {credits}` gold badge + tier label
  - Tier labels: FREE → "免費", BASIC → "基本", PRO → "專業", MASTER → "大師"
  - If `!freeReadingUsed`: small "🎁" indicator
  - If API fails or not signed in: render nothing (silent degrade)

**New file: `apps/web/app/components/CreditBadge.module.css`**
- Follow existing badge pattern from `ProfileCard.module.css`
- Gold accent (#e8d5b7) for credit count
- Tier badge colors: FREE=#a0a0a0, BASIC=#64b5f6, PRO=#9c27b0, MASTER=#e8d5b7
- Responsive: `@media (max-width: 768px)` → badge shrinks font to 0.75rem

**Modify: `apps/web/app/dashboard/page.tsx`**
- Import `CreditBadge`
- Render `<CreditBadge />` in the `headerRight` div, before the pricing link
- No other changes — dashboard stays a server component

---

## Feature 2: Pre-Action Cost Confirmation on Reading Page
**Location:** `apps/web/app/reading/[type]/page.tsx` + `page.module.css`

### Changes

**Modify: `apps/web/app/reading/[type]/page.tsx`**

1. **Remove old imports and effects:**
   - Remove imports: `getSubscriptionStatus`, `checkFreeReading` from `../../lib/api`
   - Remove the `checkSubscription` useEffect (lines 174-200)
   - Remove the `fetchBirthProfiles` useEffect (lines 144-157) — merged into consolidated effect
   - Add import: `getUserProfile` from `../../lib/api`

2. **Add new state:**
   ```typescript
   const [userCredits, setUserCredits] = useState<number | null>(null);
   const [userTier, setUserTier] = useState<string>('FREE');
   ```

3. **Consolidate mount-time fetches into ONE useEffect:**
   ```typescript
   useEffect(() => {
     if (!isSignedIn) return;
     (async () => {
       const token = await getToken();
       if (!token) return;
       const [profiles, profile] = await Promise.all([
         fetchBirthProfiles(token).catch(() => []),
         getUserProfile(token).catch(() => null),
       ]);
       setSavedProfiles(profiles);
       if (profile) {
         setUserCredits(profile.credits);
         setUserTier(profile.subscriptionTier);
         setIsSubscriber(profile.subscriptionTier !== 'FREE');
         setHasFreeReading(!profile.freeReadingUsed);
       }
     })();
   }, [isSignedIn, getToken]);
   ```
   This replaces BOTH existing effects, consolidating 3 API calls into 2 parallel calls.

4. **Get reading cost from shared constant (no API call):**
   ```typescript
   const readingCost = READING_TYPE_META[readingType as ReadingTypeSlug]?.creditCost ?? null;
   ```

5. **Render Credit Info Bar as SIBLING after BirthDataForm:**
   ```jsx
   {step === "input" && (
     <>
       <BirthDataForm ...>
         {/* existing children: month picker, date picker, Q&A */}
       </BirthDataForm>

       {/* Credit Info Bar — rendered for all users, gated per-condition inside */}
       {readingCost !== null && (
         <div className={styles.creditInfoBar}>
           {/* content based on state */}
         </div>
       )}
     </>
   )}
   ```

   **Credit Info Bar display logic:**
   - If not signed in: "💡 登入後即可獲得免費體驗" (subtle hint — conversion touchpoint)
   - If `readingCost === 0`: "✨ 免費分析 — 不消耗點數" (green)
   - If `hasFreeReading`: "🎁 免費體驗 — 本次分析免費" (green)
   - If `userCredits !== null && userCredits >= readingCost`: "💎 需要 {cost} 點數 · 剩餘 {credits} 點" (neutral)
   - If `userCredits !== null && userCredits < readingCost`: "⚠️ 額度不足 — 需要 {cost} 點，剩餘 {credits} 點" + Link to /pricing (amber)
   - If `userCredits === null` (still loading): don't show credit section (form still submittable — backend is source of truth)

   Note: The info bar is NOT gated by `isSignedIn` so the "not signed in" hint message can render for unauthenticated users.

6. **Update credits after successful submission using `response.creditsUsed`:**
   In `callNestJSReading`, after successful response:
   ```typescript
   // Use response.creditsUsed (not hardcoded readingCost) to correctly handle free readings
   setUserCredits(prev => prev !== null ? Math.max(0, prev - response.creditsUsed) : null);
   // If free reading was consumed (creditsUsed === 0 and hasFreeReading was true)
   if (response.creditsUsed === 0 && hasFreeReading) {
     setHasFreeReading(false);
   }
   ```

**Modify: `apps/web/app/reading/[type]/page.module.css`**
- Add `.creditInfoBar` — bg rgba(255,255,255,0.03), border 1px solid rgba(232,213,183,0.15), border-radius 8px, padding 0.75rem 1rem, text-align center, margin-top 1rem
- Add `.creditInfoBarFree` — bg rgba(76, 175, 80, 0.1), border-color rgba(76, 175, 80, 0.3), color #81c784
- Add `.creditInfoBarWarning` — bg rgba(255, 152, 0, 0.1), border-color rgba(255, 152, 0, 0.3), color #ffb74d
- Add `.creditInfoBarLink` — color #e8d5b7, text-decoration underline

---

## Feature 3: Insufficient Credits Modal
**Location:** New component + reading page integration

### Changes

**New file: `apps/web/app/components/InsufficientCreditsModal.tsx`**
- Client component
- Props: `isOpen: boolean`, `onClose: () => void`, `onViewChart: () => void`, `currentCredits: number`, `requiredCredits: number`, `readingName: string`
- Content:
  - Icon: 💎
  - Title: "額度不足" (with `id="credits-modal-title"` for aria-labelledby)
  - Body: "「{readingName}」需要 {required} 點數，您目前剩餘 {current} 點"
  - Primary CTA button: "升級方案" → Link to `/pricing`
  - Secondary CTA button: "查看免費命盤" → calls `onViewChart()` (loads chart-only via direct engine)
- **Accessibility:**
  - Container: `role="dialog"`, `aria-modal="true"`, `aria-labelledby="credits-modal-title"`
  - `useEffect` on open: `document.body.style.overflow = 'hidden'`; cleanup: restore
  - `useEffect` on open: add `keydown` listener for Escape → `onClose()`
  - Focus trap: auto-focus the primary CTA on open, trap Tab within modal
  - `useRef` on modal container, focus on mount
- Overlay: `background: rgba(0, 0, 0, 0.7)`, `backdrop-filter: blur(4px)`
- Animation: CSS `@keyframes fadeIn` + `scaleUp`

**New file: `apps/web/app/components/InsufficientCreditsModal.module.css`**
- `.overlay` — position fixed, inset 0, z-index 1000, display flex, align-items center, justify-content center
- `.modal` — max-width 420px, width 100%, bg #16213e, border-radius 16px, padding 2rem, border 1px solid rgba(232,213,183,0.2)
- `.modalTitle` — color #e8d5b7, font-size 1.3rem, font-weight 700
- `.primaryBtn` — gold gradient (matching existing CTA buttons in design system)
- `.secondaryBtn` — transparent bg, border 1px solid rgba(232,213,183,0.3), color #e8d5b7
- **Responsive:** `@media (max-width: 600px)` → `width: calc(100% - 2rem)`, `padding: 1.5rem`

**Modify: `apps/web/app/reading/[type]/page.tsx`**
- Add state: `const [showCreditsModal, setShowCreditsModal] = useState(false)`
- Modify `callNestJSReading` catch block: when "Insufficient credits" or "Free reading already used":
  - Set `showCreditsModal = true`
  - Do NOT immediately call `callDirectEngine` (let user choose via modal)
- Modify `handleNestJSError`: when "Insufficient credits", set `showCreditsModal = true` instead of just `setError()`
- Render modal at bottom of component:
  ```jsx
  <InsufficientCreditsModal
    isOpen={showCreditsModal}
    onClose={() => setShowCreditsModal(false)}
    onViewChart={async () => {
      setShowCreditsModal(false);
      if (formValues) {
        setIsLoading(true);
        try { await callDirectEngine(formValues); }
        catch { setError("排盤失敗，請稍後再試"); }
        finally { setIsLoading(false); }
      }
    }}
    currentCredits={userCredits ?? 0}
    requiredCredits={readingCost ?? 2}
    readingName={meta.nameZhTw}
  />
  ```

---

## Feature 4: Dashboard Account Panel
**Location:** `apps/web/app/dashboard/page.tsx` + new component

### Changes

**New file: `apps/web/app/components/AccountPanel.tsx`**
- Client component (`"use client"`)
- Uses `useAuth()` to get token
- Calls `getUserProfile(token)` on mount via `useEffect`
- **Loading state:** Skeleton card matching ctaBanner dimensions (gradient bg shimmer)
- **Error state:** If API fails (network error OR 404 for unsynced user), fall back to rendering the ORIGINAL static CTA banner content ("🔓 解鎖完整命理分析...") — never show a blank space
- **Success state renders:**
  - Row 1: Tier badge pill + credit count
    - Tier: "免費方案" (gray), "基本方案" (blue), "專業方案" (purple), "大師方案" (gold)
    - Credits: `💎 {credits} 點數` in large font (1.5rem)
  - Row 2 (conditional):
    - If `credits <= 3` and tier is FREE/BASIC: amber warning bar "⚠️ 點數即將用完"
    - If `!freeReadingUsed`: green highlight "🎁 您有一次免費體驗機會！"
  - Row 3: CTA button
    - FREE tier: "升級方案" (gold gradient button → /pricing)
    - Paid tier: "管理訂閱" (outlined gold button → /pricing)
- **NO progress bar** (no meaningful denominator available)

**New file: `apps/web/app/components/AccountPanel.module.css`**
- `.panel` — same gradient bg as existing `ctaBanner`, border-radius 16px, padding 2rem, text-align center
- `.tierBadge` — display inline-block, padding 0.25rem 0.75rem, border-radius 20px, font-size 0.8rem, font-weight 600
- `.tierFREE` — bg rgba(160,160,160,0.15), color #a0a0a0
- `.tierBASIC` — bg rgba(100,181,246,0.15), color #64b5f6
- `.tierPRO` — bg rgba(156,39,176,0.15), color #ce93d8
- `.tierMASTER` — bg rgba(232,213,183,0.15), color #e8d5b7
- `.creditCount` — font-size 1.5rem, font-weight 700, color #e8d5b7, margin 0.75rem 0
- `.warningBar` — bg rgba(255,152,0,0.1), border 1px solid rgba(255,152,0,0.3), color #ffb74d, border-radius 8px, padding 0.5rem 1rem, margin-bottom 1rem
- `.freeTrialBar` — bg rgba(76,175,80,0.1), border 1px solid rgba(76,175,80,0.3), color #81c784, border-radius 8px, padding 0.5rem 1rem, margin-bottom 1rem
- `.ctaBtn` — gold gradient button (same as existing `.ctaButton`)
- `.ctaBtnOutline` — transparent bg, border 1px solid rgba(212,175,55,0.4), color #d4af37
- **Responsive:** `@media (max-width: 768px)` → `padding: 1.5rem`, `.creditCount` font-size 1.2rem

**Modify: `apps/web/app/dashboard/page.tsx`**
- Import `AccountPanel`
- Replace the `ctaBanner` section (lines 126-136) with `<AccountPanel />`

**Modify: `apps/web/app/dashboard/page.module.css`**
- Remove orphaned styles: `.ctaBanner`, `.ctaContent`, `.ctaTitle`, `.ctaText`, `.ctaButton`, `.ctaButton:hover` (lines 199-241)

---

## Implementation Order
1. **`packages/shared/src/constants.ts`** — Add `creditCost` to `READING_TYPE_META` (Step 0)
2. **`apps/web/app/lib/api.ts`** — Add `getUserProfile()` function (Step 1)
3. **`CreditBadge` component** — Create component + CSS (Feature 1)
4. **`AccountPanel` component** — Create component + CSS (Feature 4)
5. **Dashboard page** — Wire CreditBadge + AccountPanel, remove ctaBanner (Features 1+4)
6. **`InsufficientCreditsModal` component** — Create component + CSS (Feature 3)
7. **Reading page** — Credit info bar + modal + consolidated effects + optimistic update (Features 2+3)

## Files Changed Summary

| Action | File | Description |
|--------|------|-------------|
| Modify | `packages/shared/src/constants.ts` | Add `creditCost` to `READING_TYPE_META` |
| Modify | `apps/web/app/lib/api.ts` | Add `UserProfile` interface + `getUserProfile()` |
| Create | `apps/web/app/components/CreditBadge.tsx` | Self-contained header credit badge |
| Create | `apps/web/app/components/CreditBadge.module.css` | Badge styles |
| Create | `apps/web/app/components/AccountPanel.tsx` | Self-contained account panel with error fallback |
| Create | `apps/web/app/components/AccountPanel.module.css` | Account panel styles |
| Create | `apps/web/app/components/InsufficientCreditsModal.tsx` | Accessible insufficient credits modal |
| Create | `apps/web/app/components/InsufficientCreditsModal.module.css` | Modal styles |
| Modify | `apps/web/app/dashboard/page.tsx` | Import CreditBadge + AccountPanel, replace CTA |
| Modify | `apps/web/app/dashboard/page.module.css` | Remove orphaned ctaBanner styles |
| Modify | `apps/web/app/reading/[type]/page.tsx` | Consolidate effects, credit info bar, modal, optimistic update |
| Modify | `apps/web/app/reading/[type]/page.module.css` | Add creditInfoBar styles |

## API Dependencies
- `GET /api/users/me` — returns `credits`, `subscriptionTier`, `freeReadingUsed` (authenticated)
- No new backend changes required
- No `GET /api/bazi/services` needed (credit costs from shared constants)

## Edge Cases Handled
1. **Not signed in** — CreditBadge/AccountPanel don't render; Credit Info Bar shows "登入後即可獲得免費體驗"
2. **API unreachable** — CreditBadge: silent. AccountPanel: falls back to static CTA banner
3. **User not in DB (Clerk webhook delay)** — AccountPanel shows static CTA, CreditBadge silent
4. **Zero credits** — Warning state with upgrade CTA in info bar + modal on submit
5. **`creditCost === 0` (zwds-daily)** — Shows "免費分析 — 不消耗點數"
6. **Free reading available** — Green "免費體驗" display, no credits deducted
7. **Stale credits after submission** — Optimistic update using `response.creditsUsed` (handles free reading correctly)
8. **Form submitted before credit data loads** — Submit not blocked; backend is source of truth
9. **Mobile (≤768px / ≤600px)** — All new components have responsive breakpoints
10. **Modal accessibility** — Focus trap, aria-modal, ESC key, body scroll lock
