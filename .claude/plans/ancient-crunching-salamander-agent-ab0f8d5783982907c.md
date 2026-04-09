# Design Review: Bazi Element Encyclopedia Audit Fixes

## Issues Found (Low to High severity)

---

### 1. [Low] Fix 7 is under-specified — no concrete test count given

Fix 7 says "Update test count to current" but doesn't state what the current count is. The implementer will need to run the tests to find out, which is fine, but worth noting that this is a "figure it out at implementation time" item rather than a concrete spec.

**Suggestion**: No change needed — just be aware of it during implementation.

---

### 2. [Low] Fix 6 (seasonal states Layer B) content is vaguely specified

The plan says "Since seasonal states aren't truly pillar-specific, each pillar key explains the significance of having this state's element in that pillar position." This is contradictory — if they aren't pillar-specific, writing 4 pillar variants is forced content padding. The plan also says "Keep short (1-2 sentences)" but doesn't provide any sample content, leaving the Bazi domain accuracy entirely to the implementer's judgment.

**Suggestion**: Either (a) provide concrete sample content for at least one state to set the tone/accuracy bar, or (b) consider whether seasonal states genuinely benefit from Layer B at all — if not, add a brief comment in the JSON explaining why Layer B is intentionally empty (like stems Layer D).

---

### 3. [Medium] Fix 5 has an incorrect `pillarLabelToKey` mapping — `sha.pillar` is already English

The plan proposes `pillarLabelToKey: Record<string, string> = { '時柱':'hour', '日柱':'day', '月柱':'month', '年柱':'year' }` to convert `sha.pillar` from Chinese to English. But the engine's `get_all_shen_sha()` in `shen_sha.py` (line 447) already stores `'pillar': pillar_name` where `pillar_name` is `'year'|'month'|'day'|'hour'` — it's already English.

The proposed mapping would fail: `pillarLabelToKey[sha.pillar]` would be `undefined` for `sha.pillar='day'`, falling through to the `|| 'year'` default, meaning ALL shensha would incorrectly map to 'year'.

**Fix**: Drop the `pillarLabelToKey` mapping entirely. Just use `sha.pillar` directly:
```tsx
onClick={() => handleElementClick("shensha", sha.name, sha.pillar)}
```

Additionally, this reveals a pre-existing display bug: line 602 renders `{sha.pillar}` directly as English text — users see "天乙貴人（day·午）" instead of "天乙貴人（日柱·午）". Consider mapping to Chinese for display: `{PILLAR_LABELS[sha.pillar] || sha.pillar}`.

---

### 4. [Medium] Fix 1 (Kong Wang pillar) logic is semantically wrong

The plan scans `fourPillars` branches to find which pillar's branch matches the kong wang branch. But this is backwards — kong wang branches are the VOID branches (the ones ABSENT or unlucky). A kong wang branch might happen to appear in one of the four pillars, but that's coincidental, not definitional. The kong wang is always derived from the day pillar's 旬 (sexagenary cycle group). The correct pillar for kong wang is ALWAYS 'day' because that's where it's calculated from.

However, the explanation system's Layer B content is pillar-keyed, and `'day'` is the correct pillar context for kong wang (it tells the user "your day pillar's 旬 produces these void branches"). The current hardcoded `'day'` is actually correct.

If the intent is different — e.g., "which pillar CONTAINS this void branch, making it significant" — then the logic should scan `data.fourPillars` branches for a match. But kong wang branches that DON'T appear in any pillar are still displayed and clickable, so the scan would return `'day'` as fallback anyway for most cases.

**Suggestion**: Keep the hardcoded `'day'` — it's semantically correct. Kong wang is derived from the day pillar and Layer B content should explain it in that context. If per-pillar kong wang significance is desired, that's a feature enhancement (using the existing `kongWangPerPillar` data), not a bug fix. Downgrade from HIGH to remove/skip, or reframe as "add kongWangPerPillar-aware explanation" as a future enhancement.

---

### 5. [Medium] Fix 8 cache guard checks `data.error` but the response structure nests it differently

The plan proposes: `if (data && !data.error) { cache?.set(cacheKey, data); }`

Looking at the actual flow:
- Engine `get_element_explanation()` returns `{"error": "No template for: X"}` (a dict with just an "error" key)
- `main.py` wraps it: `{"status": "success", "data": {"error": "..."}}`
- Frontend extracts: `const data = json.data as ElementExplanationData`
- So `data` would be `{"error": "No template for: X"}`

The `ElementExplanationData` interface has `error?: string`, so `data.error` would be populated. The guard `!data.error` is correct.

However, the `as ElementExplanationData` cast is unsafe — when the engine returns an error, the response has NO `generic` or `personalized` fields, just `{"error": "..."}`. The cast silently produces an object missing required interface fields. The calling component likely crashes or shows empty UI when accessing `data.generic.name` etc.

**Suggestion**: In addition to the cache guard, add a structural check or early return with a proper error object when `data.error` is present:
```ts
if (data?.error) {
  return {
    generic: { name: '', category: '', meaning: '', keywords: [] },
    personalized: {},
    error: data.error,
  };
}
cache?.set(cacheKey, data);
return data;
```

---

### 6. [Medium] Fixes 2/3/4 — bulk JSON edits (170 entries) have no automation or validation strategy

Fixes 2, 3, and 4 require editing 170 Layer C entries across three JSON files (50 stems + 60 branches + 60 life_stages). The plan describes the changes but provides no automation approach. Manual editing of 170 JSON string entries is error-prone:
- Missing/extra `{strengthLabel}` placeholder
- Disclaimer text with typos or inconsistent punctuation
- Breaking JSON syntax (unescaped quotes, missing commas)

**Suggestion**: Write a one-off Python script to programmatically:
1. Load each JSON file
2. For 仇神 entries missing `{strengthLabel}`, prepend the standard phrase
3. For all Layer C entries missing the disclaimer, append it
4. Write back with consistent formatting
5. Run `test_explanations.py` to validate

This is safer and faster than manual editing of 170 entries.

---

### 7. [Medium] No rollback or diff verification for bulk JSON changes

The plan's verification section says "Run Python tests" and "Browser test" but doesn't mention reviewing the actual JSON diffs. With 170 entries changed, a `git diff` review step should be explicit to catch unintended changes (e.g., accidentally modifying Layer A content, breaking existing correct entries).

**Suggestion**: Add a verification step: "Review `git diff` for each JSON file to confirm only Layer C entries were modified and no other content was altered."

---

## Summary

No Critical issues found. The plan is generally sound but has one code-level bug (Fix 5's pillarLabelToKey mapping would silently fail) and one questionable fix (Fix 1 proposes changing correct behavior). The bulk JSON edits would benefit from scripted automation rather than manual editing.

**Verdict**: Approve with required changes to Fix 5 (drop the Chinese-to-English mapping) and recommended reconsideration of Fix 1 (current `'day'` hardcode is correct).
