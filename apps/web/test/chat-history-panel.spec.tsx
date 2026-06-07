/**
 * ChatHistoryPanel — Phase Fortune+ row-label dispatch regression lock.
 *
 * Verifies SessionRow renders:
 *   - FORTUNE DAY sessions   → 「日運 · YYYY-MM-DD」  (anchor date the pin)
 *   - FORTUNE MONTH sessions → 「月運 · YYYY-MM」    (Phase 2 placeholder)
 *   - FORTUNE YEAR sessions  → 「年運 · YYYY」       (Phase 3 placeholder)
 *   - non-FORTUNE sessions   → relative date         (LIFETIME / LOVE / etc.)
 *
 * Without these labels, FORTUNE history rows are ambiguous («哪一天的日運？»)
 * since each anchor date spawns a separate session per the date-navigator
 * pinning policy.
 */
import { render, screen } from '@testing-library/react';
import ChatHistoryPanel from '../app/components/chat/ChatHistoryPanel';
import type { ChatSession } from '../app/lib/chat-types';

function makeSession(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: overrides.id ?? 's-' + Math.random().toString(36).slice(2, 8),
    // Use a startedAt 2 hours ago by default so the relative-date fallback
    // is deterministic and human-readable («2 小時前»). Tests that need
    // FORTUNE labels override fortuneScope + fortuneAnchorDate.
    startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    endedAt: null,
    messageCount: 5,
    unusedPaidMessages: 0,
    lastMessagePreview: null,
    fortuneScope: null,
    fortuneAnchorDate: null,
    profileId: null,
    ...overrides,
  };
}

describe('ChatHistoryPanel — row label dispatch', () => {
  const noop = () => {};

  it('FORTUNE DAY session renders 「日運 · YYYY-MM-DD」', () => {
    const session = makeSession({
      id: 'fortune-day',
      fortuneScope: 'DAY',
      fortuneAnchorDate: '2026-05-25',
    });
    render(
      <ChatHistoryPanel
        isOpen
        sessions={[session]}
        loading={false}
        activeSessionId={null}
        hardCap={30}
        onPickSession={noop}
        onClose={noop}
      />,
    );
    expect(screen.getByText('日運 · 2026-05-25')).toBeInTheDocument();
  });

  it('FORTUNE MONTH session renders 「月運 · YYYY-MM」 (slices to year-month)', () => {
    const session = makeSession({
      id: 'fortune-month',
      fortuneScope: 'MONTH',
      fortuneAnchorDate: '2026-05-01',
    });
    render(
      <ChatHistoryPanel
        isOpen
        sessions={[session]}
        loading={false}
        activeSessionId={null}
        hardCap={30}
        onPickSession={noop}
        onClose={noop}
      />,
    );
    expect(screen.getByText('月運 · 2026-05')).toBeInTheDocument();
  });

  it('FORTUNE YEAR session renders 「年運 · YYYY」 (slices to year)', () => {
    const session = makeSession({
      id: 'fortune-year',
      fortuneScope: 'YEAR',
      fortuneAnchorDate: '2026-01-01',
    });
    render(
      <ChatHistoryPanel
        isOpen
        sessions={[session]}
        loading={false}
        activeSessionId={null}
        hardCap={30}
        onPickSession={noop}
        onClose={noop}
      />,
    );
    expect(screen.getByText('年運 · 2026')).toBeInTheDocument();
  });

  it('non-FORTUNE session (LIFETIME) keeps the original relative-date label (no regression)', () => {
    const session = makeSession({
      id: 'lifetime-session',
      // No fortune fields — pure non-FORTUNE.
      fortuneScope: null,
      fortuneAnchorDate: null,
    });
    render(
      <ChatHistoryPanel
        isOpen
        sessions={[session]}
        loading={false}
        activeSessionId={null}
        hardCap={30}
        onPickSession={noop}
        onClose={noop}
      />,
    );
    // The relative-date fallback for a session started ~2h ago is
    // 「2 小時前」. We don't assert the exact number to avoid timing flake
    // — just verify a non-FORTUNE label format (no «日運 ·» prefix).
    const rowLabels = screen.getAllByText(/小時前|分鐘前|剛才|天前/);
    expect(rowLabels.length).toBe(1);
  });

  it('FORTUNE session WITHOUT anchor date falls back to relative date', () => {
    // Defensive: should never happen in practice (the engine always emits
    // anchor date for FORTUNE sessions), but if backend ever returns a
    // FORTUNE row with null anchorDate we don't want a crash — just fall
    // back to the relative-date label.
    const session = makeSession({
      id: 'fortune-no-anchor',
      fortuneScope: 'DAY',
      fortuneAnchorDate: null,
    });
    render(
      <ChatHistoryPanel
        isOpen
        sessions={[session]}
        loading={false}
        activeSessionId={null}
        hardCap={30}
        onPickSession={noop}
        onClose={noop}
      />,
    );
    expect(screen.queryByText(/日運 · /)).not.toBeInTheDocument();
  });

  it('mixed list (FORTUNE + LIFETIME) renders correct label per row', () => {
    const sessions = [
      makeSession({
        id: 'a',
        fortuneScope: 'DAY',
        fortuneAnchorDate: '2026-05-25',
      }),
      makeSession({ id: 'b' }),
      makeSession({
        id: 'c',
        fortuneScope: 'DAY',
        fortuneAnchorDate: '2026-05-24',
      }),
    ];
    render(
      <ChatHistoryPanel
        isOpen
        sessions={sessions}
        loading={false}
        activeSessionId={null}
        hardCap={30}
        onPickSession={noop}
        onClose={noop}
      />,
    );
    expect(screen.getByText('日運 · 2026-05-25')).toBeInTheDocument();
    expect(screen.getByText('日運 · 2026-05-24')).toBeInTheDocument();
    // The non-FORTUNE row shows a relative-date label.
    expect(screen.getAllByText(/小時前|分鐘前|剛才/).length).toBe(1);
  });
});
