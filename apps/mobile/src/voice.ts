import * as Speech from 'expo-speech';
import { ExpoSpeechRecognitionModule, type ExpoSpeechRecognitionResultEvent } from 'expo-speech-recognition';
import { Platform } from 'react-native';

export type CallPhase = 'starting' | 'listening' | 'thinking' | 'speaking' | 'muted' | 'ended' | 'error';

export interface CallSnapshot {
  phase: CallPhase;
  /** What the recognizer heard so far of the current utterance. */
  heard: string;
  /** The last sentence read aloud. */
  said: string;
  error?: string;
}

export interface VoiceCallDeps {
  /** Sends one spoken utterance to the chat; false when not connected. */
  send: (text: string) => boolean;
  onChange: (s: CallSnapshot) => void;
  /** BCP 47, e.g. ru-RU; decides both recognition and the voice. */
  language: string;
  /** Silence after the last heard word that ends an utterance. */
  silenceMs?: number;
}

const SILENCE_MS = 1200;
/** Sentence ends we can read aloud before the rest of the reply has streamed in. */
const SENTENCE_END = /[.!?…]+["»)]?\s+/g;

/** Strips what makes no sense read aloud: fences, inline code marks, list markers, emphasis. */
export function speakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/```[\s\S]*$/, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^\s{0,3}(?:[-*+•]|\d+[.)])\s+/gm, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/\*\*|__|(?<!\w)[*_](?!\s)|(?<!\s)[*_](?!\w)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'ссылка')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \n]+/g, '\n')
    .trim();
}

/** Splits streamed text into the sentences that are complete; the tail stays until more arrives or the reply ends. */
export function completeSentences(text: string): { done: string[]; rest: string } {
  const done: string[] = [];
  let last = 0;
  for (const m of text.matchAll(SENTENCE_END)) {
    done.push(text.slice(last, m.index! + m[0].length).trim());
    last = m.index! + m[0].length;
  }
  return { done: done.filter(Boolean), rest: text.slice(last) };
}

/**
 * The call: listens until the user pauses, sends what was said, reads the reply aloud sentence by sentence as it streams,
 * then listens again. The microphone is off while the phone speaks so the recognizer does not hear the reply.
 */
export class VoiceCall {
  private snapshot: CallSnapshot = { phase: 'starting', heard: '', said: '' };
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private subs: { remove: () => void }[] = [];
  private listening = false;
  private muted = false;
  private ended = false;
  /** Reply being spoken: the characters already handed to the speech engine. */
  private spokenUpTo = 0;
  private speakQueue: string[] = [];
  private speaking = false;
  private awaitingReply = false;
  /** The user cut a reply short: the rest of it is not read. */
  private skipReply = false;

  constructor(private readonly deps: VoiceCallDeps) {}

  async start(): Promise<void> {
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) return this.fail('Microphone or speech recognition was not allowed.');
    this.subs.push(
      ExpoSpeechRecognitionModule.addListener('result', (e: ExpoSpeechRecognitionResultEvent) => this.onResult(e)),
      ExpoSpeechRecognitionModule.addListener('error', (e) => {
        if (e.error === 'no-speech' || e.error === 'aborted') return;
        this.fail(e.message || e.error);
      }),
      ExpoSpeechRecognitionModule.addListener('end', () => {
        // The platform stops a session on its own (iOS after ~1 min); keep the line open.
        this.listening = false;
        if (!this.ended && !this.muted && !this.speaking && !this.awaitingReply) this.listen();
      }),
    );
    this.listen();
  }

  end(): void {
    this.ended = true;
    this.stopListening();
    void Speech.stop();
    for (const s of this.subs) s.remove();
    this.subs = [];
    this.set({ phase: 'ended', heard: '' });
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) {
      this.stopListening();
      this.set({ phase: 'muted', heard: '' });
    } else if (!this.speaking && !this.awaitingReply) this.listen();
  }

  /** The user taps while the phone talks: stop reading and listen. */
  interrupt(): void {
    this.speakQueue = [];
    this.skipReply = true;
    void Speech.stop();
    this.speaking = false;
    this.awaitingReply = false;
    if (!this.muted) this.listen();
  }

  /** The chat changed: `text` is the assistant's reply so far, `streaming` whether more is coming. */
  onReply(text: string, streaming: boolean): void {
    if (this.ended || this.skipReply) return;
    const clean = speakable(text);
    const pending = clean.slice(this.spokenUpTo);
    const { done, rest } = completeSentences(pending);
    let fresh: string[];
    if (streaming) {
      fresh = done;
      this.spokenUpTo += pending.length - rest.length;
    } else {
      fresh = [...done, rest.trim()].filter(Boolean);
      this.spokenUpTo = clean.length;
    }
    this.awaitingReply = streaming;
    if (fresh.length) {
      this.speakQueue.push(...fresh);
      if (!this.speaking) this.speakNext();
    } else if (!streaming && !this.speaking) this.replyFinished();
  }

  /** A new reply starts: forget what was spoken of the previous one. */
  newReply(): void {
    this.spokenUpTo = 0;
    this.skipReply = false;
  }

  private listen(): void {
    if (this.ended || this.listening || this.muted) return;
    this.listening = true;
    this.set({ phase: 'listening', heard: '' });
    try {
      ExpoSpeechRecognitionModule.start({
        lang: this.deps.language,
        interimResults: true,
        continuous: true,
        addsPunctuation: true,
        iosTaskHint: 'dictation',
        iosCategory: { category: 'playAndRecord', categoryOptions: ['defaultToSpeaker', 'allowBluetooth'], mode: 'voiceChat' },
      });
    } catch (e) {
      this.listening = false;
      this.fail(e instanceof Error ? e.message : String(e));
    }
  }

  private stopListening(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = null;
    if (!this.listening) return;
    this.listening = false;
    try {
      ExpoSpeechRecognitionModule.abort();
    } catch {}
  }

  private onResult(e: ExpoSpeechRecognitionResultEvent): void {
    if (!this.listening || this.ended) return;
    const heard = e.results[0]?.transcript?.trim() ?? '';
    if (!heard) return;
    this.set({ heard });
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    // iOS and Android both keep sending interim results; a pause with nothing new ends the utterance.
    this.silenceTimer = setTimeout(() => this.commit(heard), e.isFinal ? 150 : (this.deps.silenceMs ?? SILENCE_MS));
  }

  private commit(text: string): void {
    this.silenceTimer = null;
    this.stopListening();
    this.spokenUpTo = 0;
    this.awaitingReply = true;
    if (!this.deps.send(text)) return this.fail('Not connected to the Mac.');
    this.set({ phase: 'thinking', heard: text });
  }

  private speakNext(): void {
    const next = this.speakQueue.shift();
    if (next === undefined) {
      this.speaking = false;
      if (!this.awaitingReply) this.replyFinished();
      return;
    }
    this.speaking = true;
    this.stopListening();
    this.set({ phase: 'speaking', said: next });
    Speech.speak(next, {
      language: this.deps.language,
      rate: Platform.OS === 'ios' ? 0.52 : 1.0,
      onDone: () => this.speakNext(),
      onStopped: () => {
        this.speaking = false;
      },
      onError: () => this.speakNext(),
    });
  }

  private replyFinished(): void {
    this.awaitingReply = false;
    if (!this.ended && !this.muted) this.listen();
  }

  private fail(error: string): void {
    this.stopListening();
    this.set({ phase: 'error', error });
  }

  private set(patch: Partial<CallSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.deps.onChange(this.snapshot);
  }
}

/** ru for Russian phones, otherwise the device language; both the recognizer and the voice follow it. */
export function callLanguage(locale: string | undefined): string {
  if (!locale) return 'en-US';
  if (/^ru/i.test(locale)) return 'ru-RU';
  return locale.includes('-') ? locale : `${locale}-${locale.toUpperCase()}`;
}
