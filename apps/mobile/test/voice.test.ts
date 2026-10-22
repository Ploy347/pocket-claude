import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-speech', () => ({ speak: vi.fn(), stop: vi.fn(async () => {}) }));
vi.mock('expo-speech-recognition', () => ({ ExpoSpeechRecognitionModule: { start: vi.fn(), stop: vi.fn(), abort: vi.fn(), addListener: vi.fn(() => ({ remove: () => {} })), requestPermissionsAsync: vi.fn(async () => ({ granted: true })) } }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

const { callLanguage, completeSentences, speakable, VoiceCall } = await import('../src/voice');
const Speech = await import('expo-speech');
const { ExpoSpeechRecognitionModule } = await import('expo-speech-recognition');

describe('voice helpers', () => {
  it('strips markdown and code from what is read aloud', () => {
    expect(speakable('**Done.** Run `npm test`:\n```sh\nnpm test\n```\n- one\n- two\nSee [docs](https://x.y).')).toBe('Done. Run npm test:\none\ntwo\nSee docs.');
    expect(speakable('Here it is:\n```sh\nstill streaming')).toBe('Here it is:');
  });

  it('reads only complete sentences while streaming', () => {
    expect(completeSentences('Готово. Я вижу терминал! А ещё')).toEqual({ done: ['Готово.', 'Я вижу терминал!'], rest: 'А ещё' });
    expect(completeSentences('no end yet')).toEqual({ done: [], rest: 'no end yet' });
  });

  it('picks the call language from the phone', () => {
    expect(callLanguage('ru-RU')).toBe('ru-RU');
    expect(callLanguage('ru')).toBe('ru-RU');
    expect(callLanguage('en-GB')).toBe('en-GB');
    expect(callLanguage(undefined)).toBe('en-US');
  });
});

describe('VoiceCall', () => {
  it('sends an utterance after a pause, speaks the streamed reply sentence by sentence, then listens again', async () => {
    vi.useFakeTimers();
    try {
      const sent: string[] = [];
      const phases: string[] = [];
      const listeners: Record<string, (e: unknown) => void> = {};
      vi.mocked(ExpoSpeechRecognitionModule.addListener).mockImplementation(((name: string, fn: (e: unknown) => void) => {
        listeners[name] = fn;
        return { remove: () => {} };
      }) as never);
      const call = new VoiceCall({ send: (t) => (sent.push(t), true), onChange: (s) => phases.push(s.phase), language: 'ru-RU', silenceMs: 500 });
      await call.start();
      expect(ExpoSpeechRecognitionModule.start).toHaveBeenCalledWith(expect.objectContaining({ lang: 'ru-RU', continuous: true }));
      expect(phases.at(-1)).toBe('listening');

      listeners.result!({ isFinal: false, results: [{ transcript: 'сделай' }] });
      listeners.result!({ isFinal: false, results: [{ transcript: 'сделай скриншот' }] });
      vi.advanceTimersByTime(499);
      expect(sent).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(sent).toEqual(['сделай скриншот']);
      expect(phases.at(-1)).toBe('thinking');
      expect(ExpoSpeechRecognitionModule.abort).toHaveBeenCalled();

      call.newReply();
      call.onReply('Готово. Я вижу', true);
      expect(vi.mocked(Speech.speak).mock.calls.map((c) => c[0])).toEqual(['Готово.']);
      expect(phases.at(-1)).toBe('speaking');
      call.onReply('Готово. Я вижу терминал с ошибкой', true);
      call.onReply('Готово. Я вижу терминал с ошибкой.', false);
      // The first sentence is still being spoken; the rest is queued and read when it ends.
      const first = vi.mocked(Speech.speak).mock.calls[0]![1] as { onDone: () => void };
      first.onDone();
      expect(vi.mocked(Speech.speak).mock.calls.map((c) => c[0])).toEqual(['Готово.', 'Я вижу терминал с ошибкой.']);
      const second = vi.mocked(Speech.speak).mock.calls[1]![1] as { onDone: () => void };
      vi.mocked(ExpoSpeechRecognitionModule.start).mockClear();
      second.onDone();
      expect(phases.at(-1)).toBe('listening');
      expect(ExpoSpeechRecognitionModule.start).toHaveBeenCalledTimes(1);

      call.end();
      expect(phases.at(-1)).toBe('ended');
    } finally {
      vi.useRealTimers();
    }
  });
});
