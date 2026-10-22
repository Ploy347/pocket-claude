import { b64, deriveDeviceId, generateIdentity, type SessionEvent } from '@pocket/protocol';
import { describe, expect, it, vi } from 'vitest';
import { ChatClient } from '../src/chat-client.js';

/** A client whose link never connects; brain messages are injected straight into its handler. */
function client(deltaIntervalMs: number) {
  const identity = generateIdentity();
  const brain = generateIdentity();
  const brainDeviceId = deriveDeviceId(brain.signPub);
  const c = new ChatClient({
    relayUrl: 'http://127.0.0.1:1',
    accountId: 'acc',
    deviceId: deriveDeviceId(identity.signPub),
    identity,
    brainDeviceId,
    brainEncPub: b64.encode(brain.encPub),
    deltaIntervalMs,
  });
  const inject = (event: SessionEvent) =>
    (c as unknown as { onMessage: (m: { from: string; message: unknown }) => void }).onMessage({ from: brainDeviceId, message: { type: 'session.event', payload: { sessionId: 's', event } } });
  return { c, inject };
}

describe('ChatClient streaming', () => {
  it('batches text deltas so listeners run a few times a second, and flushes before other events', () => {
    vi.useFakeTimers();
    try {
      const { c, inject } = client(100);
      let renders = 0;
      c.subscribe(() => renders++);
      inject({ kind: 'user', text: 'hi', from: 'phone' });
      expect(renders).toBe(1);
      for (const word of ['Hel', 'lo', ' wo', 'rld']) inject({ kind: 'text_delta', text: word });
      expect(renders).toBe(1);
      expect(c.getState().threads.s).toHaveLength(1);
      vi.advanceTimersByTime(100);
      expect(renders).toBe(2);
      expect(c.getState().threads.s?.[1]).toMatchObject({ type: 'assistant', text: 'Hello world', streaming: true });
      inject({ kind: 'text_delta', text: '!' });
      inject({ kind: 'text', text: 'Hello world!' });
      expect(renders).toBe(4);
      expect(c.getState().threads.s?.[1]).toMatchObject({ type: 'assistant', text: 'Hello world!', streaming: false });
      expect(c.getState().threads.s).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
