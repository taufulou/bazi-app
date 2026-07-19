import { Text, Pressable } from 'react-native';
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react-native';
import ChatMessage from '../ChatMessage';
import type { ChatMessage as ChatMessageType, ChatStreamEvent } from '../../../lib/chat-types';
import { useChatStream } from '../hooks/useChatStream';

// Interactive harness — renders the hook's state as findable text + a send
// button. Reading committed text (not a captured module var) sidesteps RNTL
// 14 / React 19 async-render flakiness with null-rendering roots, and
// fireEvent.press wraps sendMessage in act automatically.
type HarnessProps = Parameters<typeof useChatStream>[0] & {
  content?: string;
  hint?: string;
};
function StreamHarness({ content = 'x', hint, ...hookArgs }: HarnessProps) {
  const api = useChatStream(hookArgs);
  return (
    <>
      <Text>{`streaming:${api.streaming}`}</Text>
      <Text>{`error:${api.error?.code ?? 'none'}`}</Text>
      <Pressable testID="send" onPress={() => void api.sendMessage(content, hint)}>
        <Text>send</Text>
      </Pressable>
    </>
  );
}

// Mock Clerk getToken (stable) for the hook.
jest.mock('@clerk/clerk-expo', () => ({
  useAuth: () => ({ getToken: async () => 'test-token' }),
}));

// Capture the streamChatMessage callbacks so the test can drive SSE events.
let capturedOnEvent: ((e: ChatStreamEvent) => void) | null = null;
let capturedOnClose: (() => void) | null = null;
jest.mock('../../../lib/chat-api', () => ({
  streamChatMessage: (args: {
    onEvent: (e: ChatStreamEvent) => void;
    onClose: () => void;
  }) => {
    capturedOnEvent = args.onEvent;
    capturedOnClose = args.onClose;
    return () => {};
  },
}));

function msg(over: Partial<ChatMessageType> & { id: string; role: ChatMessageType['role'] }): ChatMessageType {
  return { content: '', isRegrounding: false, errorCode: null, refundedAt: null, createdAt: '', ...over };
}

describe('ChatMessage', () => {
  it('renders a user bubble', async () => {
    await render(<ChatMessage message={msg({ id: 'u1', role: 'USER', content: '我命中缺什麼' })} />);
    expect(screen.getByText('我命中缺什麼')).toBeTruthy();
  });
  it('renders an assistant bubble with bold', async () => {
    await render(<ChatMessage message={msg({ id: 'a1', role: 'ASSISTANT', content: '您的**用神是火**' })} />);
    expect(screen.getByText('用神是火')).toBeTruthy();
  });
});

describe('useChatStream — SSE event dispatch', () => {
  const callbacks = {
    appendUserMessage: jest.fn((): string => 'local-1'),
    replaceUserMessageId: jest.fn(),
    appendAssistantPlaceholder: jest.fn(),
    appendAssistantDelta: jest.fn(),
    finalizeAssistantMessage: jest.fn(),
    markUserFailed: jest.fn(),
    applyDoneEvent: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    capturedOnEvent = null;
    capturedOnClose = null;
  });
  // Explicit unmount between renders — RTL auto-cleanup + React 19 concurrent
  // renderer can otherwise leave a prior test's tree pending, so a 2nd
  // render() in the same file never commits.
  afterEach(() => cleanup());

  it('drives the full session_start → delta → done lifecycle onto the session callbacks', async () => {
    await render(
      <StreamHarness sessionId="sess-1" content="我命中缺什麼" hint="chart_identity" {...callbacks} />,
    );

    // fireEvent.press wraps in act; the async act flushes getToken's microtask
    // so streamChatMessage runs + captures the SSE callbacks.
    await act(async () => {
      fireEvent.press(screen.getByTestId('send'));
    });
    // Optimistic user message appended before the stream opens.
    expect(callbacks.appendUserMessage).toHaveBeenCalledWith('我命中缺什麼');
    expect(screen.getByText('streaming:true')).toBeTruthy();

    // Drive the SSE events (async act → React 19 flushes state updates fully).
    await act(async () => {
      capturedOnEvent?.({ type: 'session_start', messageId: 'srv-user-1' });
    });
    expect(callbacks.replaceUserMessageId).toHaveBeenCalledWith('local-1', 'srv-user-1');
    expect(callbacks.appendAssistantPlaceholder).toHaveBeenCalled();

    await act(async () => {
      capturedOnEvent?.({ type: 'delta', text: '您的' });
      capturedOnEvent?.({ type: 'delta', text: '用神是火' });
    });
    expect(callbacks.appendAssistantDelta).toHaveBeenCalledWith('您的');
    expect(callbacks.appendAssistantDelta).toHaveBeenCalledWith('用神是火');

    await act(async () => {
      capturedOnEvent?.({
        type: 'done',
        messageId: 'srv-a-1',
        messageCount: 3,
        messagesRemaining: 27,
        consecutiveRefuses: 0,
        usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0 },
      });
      capturedOnClose?.();
    });
    expect(callbacks.finalizeAssistantMessage).toHaveBeenCalledWith({ messageId: 'srv-a-1' });
    expect(callbacks.applyDoneEvent).toHaveBeenCalledWith({
      messageCount: 3,
      messagesRemaining: 27,
      consecutiveRefuses: 0,
    });
    expect(screen.getByText('streaming:false')).toBeTruthy();
  });

  it('surfaces an error event + marks the user message failed', async () => {
    await render(<StreamHarness sessionId="sess-1" {...callbacks} />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('send'));
    });
    await act(async () => {
      capturedOnEvent?.({ type: 'error', code: 'NEEDS_EXTENSION', message: '需購買延伸' });
      capturedOnClose?.();
    });
    expect(screen.getByText('error:NEEDS_EXTENSION')).toBeTruthy();
    expect(callbacks.markUserFailed).toHaveBeenCalledWith('NEEDS_EXTENSION');
  });

  it('no-ops sendMessage without a session', async () => {
    await render(<StreamHarness sessionId={null} {...callbacks} />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('send'));
    });
    expect(screen.getByText('error:NO_SESSION')).toBeTruthy();
    expect(callbacks.appendUserMessage).not.toHaveBeenCalled();
  });
});
