import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

export interface CallPrefs {
  /** 'auto' follows the phone's language; otherwise a BCP 47 tag such as ru-RU. */
  language: string;
  /** A voice identifier; null takes the best installed voice for the language. */
  voice: string | null;
  /** Loudspeaker rather than the earpiece (headsets win either way). */
  speaker: boolean;
  /** iPhone: the call shows in the system call UI (lock screen, green status pill, Dynamic Island). */
  callKit: boolean;
  /** Talking while the phone answers stops it. */
  bargeIn: boolean;
}

export const DEFAULT_CALL_PREFS: CallPrefs = { language: 'auto', voice: null, speaker: true, callKit: true, bargeIn: true };

const KEY = 'pc.call';
let prefs = DEFAULT_CALL_PREFS;
let loading: Promise<CallPrefs> | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function loadCallPrefs(): Promise<CallPrefs> {
  loading ??= AsyncStorage.getItem(KEY)
    .then((raw) => {
      if (raw) prefs = { ...DEFAULT_CALL_PREFS, ...(JSON.parse(raw) as Partial<CallPrefs>) };
      notify();
      return prefs;
    })
    .catch(() => prefs);
  return loading;
}

export function getCallPrefs(): CallPrefs {
  return prefs;
}

export function setCallPrefs(patch: Partial<CallPrefs>): void {
  prefs = { ...prefs, ...patch };
  notify();
  void AsyncStorage.setItem(KEY, JSON.stringify(prefs)).catch(() => {});
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  void loadCallPrefs();
  return () => listeners.delete(listener);
}

export function useCallPrefs(): CallPrefs {
  return useSyncExternalStore(subscribe, getCallPrefs, getCallPrefs);
}
