/**
 * ChatMetricsService — Phase 3.1d
 *
 * Reading-type-bucketed observability for the chat feature:
 *   1. Cost per session (P50/P95) per reading type
 *   2. refuseRate per reading type (fraction of assistant messages with
 *      `is_refuse=true`)
 *   3. Avg session length + total session count
 *
 * Healthy bands (per plan):
 *   - refuseRate 5-25% per reading type (too low = AI leaking past topic
 *     boundary; too high = topic scope too aggressive)
 *   - Cost watchdog: P50 < $0.40/session, P95 < $0.80/session for
 *     non-COMPATIBILITY types; COMPATIBILITY may run higher due to
 *     dual-chart payload (P50 < $0.50, P95 < $1.00).
 *
 * Exposed via `GET /api/admin/chat/metrics?days=7` for admin/operator
 * polling. Scheduled persistence (cron snapshotting to a `chat_metrics`
 * table) deferred to Phase 3.2 if needed — on-demand polling is
 * sufficient for early production observability.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Anthropic Sonnet 4.x pricing per million tokens (USD)
const USD_PER_MTOK_INPUT = 3.0;
const USD_PER_MTOK_OUTPUT = 15.0;
// 1h cache TTL pricing (per plan cost model)
const USD_PER_MTOK_CACHE_READ = 0.3;    // 0.1× regular input
const USD_PER_MTOK_CACHE_WRITE_1H = 6.0; // 2× regular input

export interface ReadingTypeBucket {
  readingType: string;
  sessionCount: number;
  messageCount: number;
  assistantMessageCount: number;
  refuseCount: number;
  refuseRate: number;     // refuseCount / assistantMessageCount, 0-1
  refuseRateHealthy: boolean; // true if 0.05 ≤ rate ≤ 0.25
  totalCostUsd: number;
  costPerSession: {
    p50: number;
    p95: number;
    avg: number;
  };
  avgMessagesPerSession: number;
}

export interface ChatMetricsReport {
  windowDays: number;
  windowStart: string;     // ISO timestamp
  windowEnd: string;
  generatedAt: string;
  buckets: ReadingTypeBucket[];
  totals: {
    sessionCount: number;
    messageCount: number;
    totalCostUsd: number;
  };
}

@Injectable()
export class ChatMetricsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Per-message cost in USD. Uses cache_read_tokens + cache_creation_tokens
   * + tokens_input + tokens_output to compute the full Anthropic bill.
   *
   * Note: tokens_input is the total input (includes cached portions);
   * cache_read_tokens are the BILLABLE-at-cache-rate subset of those.
   * The non-cached input is `tokens_input - cache_read_tokens - cache_creation_tokens`.
   */
  private static computeMessageCostUsd(msg: {
    tokensInput: number | null;
    tokensOutput: number | null;
    cacheReadTokens: number | null;
    cacheCreationTokens: number | null;
  }): number {
    const tokensIn = msg.tokensInput ?? 0;
    const tokensOut = msg.tokensOutput ?? 0;
    const cacheRead = msg.cacheReadTokens ?? 0;
    const cacheWrite = msg.cacheCreationTokens ?? 0;
    // Non-cached input portion
    const uncachedIn = Math.max(0, tokensIn - cacheRead - cacheWrite);
    const cost =
      (uncachedIn * USD_PER_MTOK_INPUT +
        cacheRead * USD_PER_MTOK_CACHE_READ +
        cacheWrite * USD_PER_MTOK_CACHE_WRITE_1H +
        tokensOut * USD_PER_MTOK_OUTPUT) /
      1_000_000;
    return cost;
  }

  /** Percentile helper. arr must be pre-sorted ascending. */
  private static percentile(sortedAsc: number[], p: number): number {
    if (sortedAsc.length === 0) return 0;
    const idx = Math.min(
      sortedAsc.length - 1,
      Math.floor((sortedAsc.length - 1) * (p / 100)),
    );
    return sortedAsc[idx]!;
  }

  /**
   * Query chat_messages joined with chat_sessions over the last N days,
   * compute per-reading-type buckets.
   */
  async getMetrics(windowDays = 7): Promise<ChatMetricsReport> {
    const now = new Date();
    const windowStart = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);

    // Pull all messages in window with their session.reading_type
    // (limit window to bounded memory — adjust if traffic grows past
    // 100k messages/week per type, but unlikely in Phase 3 beta).
    const messages = await this.prisma.chatMessage.findMany({
      where: {
        createdAt: { gte: windowStart, lte: now },
      },
      select: {
        sessionId: true,
        role: true,
        tokensInput: true,
        tokensOutput: true,
        cacheReadTokens: true,
        cacheCreationTokens: true,
        isRefuse: true,
        session: { select: { readingType: true } },
      },
    });

    // Bucket by reading_type → session → cost
    const byType = new Map<
      string,
      {
        sessions: Map<string, number>;  // session_id → cumulative cost
        messageCount: number;
        assistantCount: number;
        refuseCount: number;
      }
    >();

    for (const msg of messages) {
      const type = msg.session?.readingType ?? 'UNKNOWN';
      let bucket = byType.get(type);
      if (!bucket) {
        bucket = {
          sessions: new Map(),
          messageCount: 0,
          assistantCount: 0,
          refuseCount: 0,
        };
        byType.set(type, bucket);
      }
      bucket.messageCount++;
      if (msg.role === 'ASSISTANT') {
        bucket.assistantCount++;
        if (msg.isRefuse) bucket.refuseCount++;
      }
      const cost = ChatMetricsService.computeMessageCostUsd(msg);
      bucket.sessions.set(msg.sessionId, (bucket.sessions.get(msg.sessionId) ?? 0) + cost);
    }

    // Build report
    const buckets: ReadingTypeBucket[] = [];
    let totalSessions = 0;
    let totalMessages = 0;
    let totalCost = 0;

    for (const [type, b] of byType.entries()) {
      const sessionCosts = [...b.sessions.values()].sort((a, b) => a - b);
      const sessionCount = sessionCosts.length;
      const totalBucketCost = sessionCosts.reduce((a, b) => a + b, 0);
      const refuseRate = b.assistantCount > 0 ? b.refuseCount / b.assistantCount : 0;
      const refuseRateHealthy = refuseRate >= 0.05 && refuseRate <= 0.25;

      buckets.push({
        readingType: type,
        sessionCount,
        messageCount: b.messageCount,
        assistantMessageCount: b.assistantCount,
        refuseCount: b.refuseCount,
        refuseRate: Number(refuseRate.toFixed(4)),
        refuseRateHealthy,
        totalCostUsd: Number(totalBucketCost.toFixed(4)),
        costPerSession: {
          p50: Number(ChatMetricsService.percentile(sessionCosts, 50).toFixed(4)),
          p95: Number(ChatMetricsService.percentile(sessionCosts, 95).toFixed(4)),
          avg: sessionCount > 0
            ? Number((totalBucketCost / sessionCount).toFixed(4))
            : 0,
        },
        avgMessagesPerSession: sessionCount > 0
          ? Number((b.messageCount / sessionCount).toFixed(2))
          : 0,
      });

      totalSessions += sessionCount;
      totalMessages += b.messageCount;
      totalCost += totalBucketCost;
    }

    // Sort buckets in canonical order
    const ORDER = ['LIFETIME', 'LOVE', 'CAREER', 'ANNUAL', 'COMPATIBILITY'];
    buckets.sort((a, b) => {
      const ai = ORDER.indexOf(a.readingType);
      const bi = ORDER.indexOf(b.readingType);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });

    return {
      windowDays,
      windowStart: windowStart.toISOString(),
      windowEnd: now.toISOString(),
      generatedAt: now.toISOString(),
      buckets,
      totals: {
        sessionCount: totalSessions,
        messageCount: totalMessages,
        totalCostUsd: Number(totalCost.toFixed(4)),
      },
    };
  }
}
