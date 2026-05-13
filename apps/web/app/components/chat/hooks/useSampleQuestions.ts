'use client';

/**
 * Phase 2 — `useSampleQuestions(readingType, sectionKey)`.
 *
 * Replaces the Phase 1 hardcoded `LIFETIME_SAMPLE_QUESTIONS` import with
 * a runtime fetch from `/api/chat/sample-questions`. Cached client-side
 * via a process-wide `Map<cacheKey, {data, fetchedAt}>` with 5-minute
 * staleness tolerance — matches the backend's batch-aware version-stamp
 * cache so admin edits propagate within ~5min worst case.
 *
 * Failure mode: returns empty list. The InlineAskCard renders nothing in
 * that case (best-effort UI sugar; never blocks chat).
 *
 * `sectionKey === null` fetches the «general» floating-button questions.
 */

import { useEffect, useState } from 'react';
import {
  getAllSampleQuestions,
  getSampleQuestions,
  type ChatReadingType,
  type SampleQuestionItem,
} from '../../../lib/chat-api';

const CACHE_TTL_MS = 5 * 60 * 1000;

type CacheKey = string;
type CacheEntry = { data: SampleQuestionItem[]; fetchedAt: number };

const cache = new Map<CacheKey, CacheEntry>();
const inflight = new Map<CacheKey, Promise<SampleQuestionItem[]>>();

function makeCacheKey(readingType: ChatReadingType, sectionKey: string | null): CacheKey {
  return `${readingType}:${sectionKey ?? '*'}`;
}

/** Synchronous cache peek — used for SSR-friendly initial render. */
function peekCache(key: CacheKey): SampleQuestionItem[] | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

async function fetchAndCache(
  key: CacheKey,
  readingType: ChatReadingType,
  sectionKey: string | null,
): Promise<SampleQuestionItem[]> {
  const existingInflight = inflight.get(key);
  if (existingInflight) return existingInflight;

  const promise = getSampleQuestions({ readingType, sectionKey })
    .then((data) => {
      cache.set(key, { data, fetchedAt: Date.now() });
      return data;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, promise);
  return promise;
}

export interface UseSampleQuestionsResult {
  /** The fetched (or cached) questions. Empty array while loading or on
   *  fetch failure — caller should treat empty same as "render nothing". */
  questions: SampleQuestionItem[];
  loading: boolean;
}

/**
 * Hook to load sample questions for a (readingType, sectionKey) tuple.
 *
 * Phase 2 (round-1 MED-#3) — readingType is a required prop. Caller must
 * thread it from the reading page through ChatDrawer / InlineAskCard.
 */
export function useSampleQuestions(
  readingType: ChatReadingType,
  sectionKey: string | null,
): UseSampleQuestionsResult {
  const cacheKey = makeCacheKey(readingType, sectionKey);
  const [questions, setQuestions] = useState<SampleQuestionItem[]>(
    () => peekCache(cacheKey) ?? [],
  );
  const [loading, setLoading] = useState<boolean>(() => peekCache(cacheKey) === null);

  useEffect(() => {
    let cancelled = false;
    const cached = peekCache(cacheKey);
    if (cached) {
      setQuestions(cached);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchAndCache(cacheKey, readingType, sectionKey)
      .then((data) => {
        if (!cancelled) {
          setQuestions(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setQuestions([]);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [cacheKey, readingType, sectionKey]);

  return { questions, loading };
}

/**
 * Imperative cache invalidation. Used by admin UI's optimistic-refetch on
 * save (round-1 LOW-#2): after a successful PATCH/POST, call this with
 * the affected (readingType, sectionKey) so the public list reflects
 * the change immediately rather than waiting up to 5min cache TTL.
 *
 * Phase 4 — also invalidates the `__ALL__` sentinel cache entries used
 * by `useAllSampleQuestions` (they share the same module-level `cache`
 * Map). The `startsWith(${readingType}:)` sweep covers both forms.
 */
export function invalidateSampleQuestionsCache(
  readingType?: ChatReadingType,
  sectionKey?: string | null,
): void {
  if (!readingType) {
    cache.clear();
    return;
  }
  if (sectionKey !== undefined) {
    cache.delete(makeCacheKey(readingType, sectionKey));
    return;
  }
  // readingType only — clear all sections for this reading type AND
  // the `__ALL__` Phase-4 sentinel entry (both share the prefix).
  for (const key of cache.keys()) {
    if (key.startsWith(`${readingType}:`)) cache.delete(key);
  }
}

// ============================================================
// Phase 4 — useAllSampleQuestions
// ============================================================

/**
 * Sentinel for the «all questions» cache key. Co-located with
 * `useSampleQuestions` so they share the module-level `cache` Map —
 * `invalidateSampleQuestionsCache` automatically clears `__ALL__`
 * entries via its `startsWith(${readingType}:)` sweep when admin
 * writes bump the version stamp.
 */
const ALL_QUESTIONS_SENTINEL = '__ALL__';

function makeAllCacheKey(readingType: ChatReadingType): CacheKey {
  return `${readingType}:${ALL_QUESTIONS_SENTINEL}`;
}

async function fetchAndCacheAll(
  key: CacheKey,
  readingType: ChatReadingType,
): Promise<SampleQuestionItem[]> {
  const existingInflight = inflight.get(key);
  if (existingInflight) return existingInflight;

  const promise = getAllSampleQuestions({ readingType })
    .then((data) => {
      cache.set(key, { data, fetchedAt: Date.now() });
      return data;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, promise);
  return promise;
}

/**
 * Phase 4 — load ALL active sample questions for a reading type (across
 * all sectionKeys). Used by the in-drawer SampleQuestionsBrowser overlay.
 *
 * Return-type shape mirrors `useSampleQuestions` exactly (no `error`
 * field — failure silently returns empty list, caller renders empty
 * state). Module-level cache is shared with `useSampleQuestions` so
 * admin invalidation reaches both via the same `__ALL__` sentinel key
 * sweep.
 */
export function useAllSampleQuestions(
  readingType: ChatReadingType,
): UseSampleQuestionsResult {
  const cacheKey = makeAllCacheKey(readingType);
  const [questions, setQuestions] = useState<SampleQuestionItem[]>(
    () => peekCache(cacheKey) ?? [],
  );
  const [loading, setLoading] = useState<boolean>(() => peekCache(cacheKey) === null);

  useEffect(() => {
    let cancelled = false;
    const cached = peekCache(cacheKey);
    if (cached) {
      setQuestions(cached);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchAndCacheAll(cacheKey, readingType)
      .then((data) => {
        if (!cancelled) {
          setQuestions(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setQuestions([]);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [cacheKey, readingType]);

  return { questions, loading };
}
