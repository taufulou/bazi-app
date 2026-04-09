# Code Review Fixes — PR #30

## Context
Automated code review of PR #30 found 4 issues worth fixing.

## Fixes

### Fix 1: `cross_pillar.py` — Add try/except to `_load_interaction_templates()`
**File**: `packages/bazi-engine/app/cross_pillar.py` (lines 42-61)
**Problem**: No error handling around `json.load(f)` or `os.listdir()`. A malformed JSON file or permission error crashes the entire server on startup.
**Fix**: Match `explanations.py` `_load_templates()` pattern exactly:
- Wrap `os.listdir(data_dir)` in try/except for OSError
- Wrap each `json.load(f)` in try/except `(json.JSONDecodeError, IOError, OSError)` with per-file logging
- Add `logger.info()` summary after loading

### Fix 2: `ElementExplanation.tsx` — Replace `window.location.href` with `useRouter`
**File**: `apps/web/app/components/ElementExplanation.tsx` (lines 267, 403)
**Problem**: `window.location.href = '/pricing'` causes full page reload instead of client-side navigation.
**Fix**: Import `useRouter` from `next/navigation`. Use `router.push('/pricing')` in onClick handlers. This preserves button semantics and avoids full page reload.

### Fix 3: `main.py` — Revert CORS `allow_methods` to `["POST", "GET"]`
**File**: `packages/bazi-engine/app/main.py` (line 30)
**Problem**: `allow_methods=["*"]` allows DELETE/PUT/PATCH unnecessarily on an engine with only GET and POST endpoints.
**Fix**: Change to `allow_methods=["POST", "GET"]`.

### Fix 4: `BaziChart.tsx` + `ElementExplanation.tsx` — Defensive memoization + fix deps
**Files**:
- `apps/web/app/components/BaziChart.tsx` (lines 175-176)
- `apps/web/app/components/ElementExplanation.tsx` (line 128)

**Problem**: `extractGodRoles(data)` and `extractFourPillars(data)` create new object references on every render. This is defensive — the cache in `fetchElementExplanation` prevents duplicate network calls, but the `setLoading(true)` still fires before the cache hit resolves, causing a brief flash.

**Fix**:
1. Import `useMemo` in BaziChart.tsx. Wrap both calls:
```tsx
const godRoles = useMemo(() => extractGodRoles(data), [data]);
const fourPillarsPayload = useMemo(() => extractFourPillars(data), [data]);
```
2. Add `fourPillars` to the useEffect dependency array in ElementExplanation.tsx:
```tsx
}, [isOpen, elementType, value, pillar, gender, godRoles, fourPillars]);
```

**Note**: This is defensive optimization. The memoization prevents unnecessary effect re-fires when BaziChart parent re-renders (e.g., during staged reveal animation). The deps fix ensures correctness if fourPillars ever changes independently.

## Verification
1. `python -m pytest tests/test_cross_pillar.py tests/test_explanations.py --tb=short` — all pass
2. Restart servers, click elements — verify no loading flash during staged reveal
3. Verify `/pricing` navigation is smooth (no full reload)
4. Verify malformed JSON doesn't crash server: temporarily corrupt a JSON file, restart, check server still starts
