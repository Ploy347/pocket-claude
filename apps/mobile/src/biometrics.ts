import * as LocalAuthentication from 'expo-local-authentication';
import { telegramWebApp, type TelegramWebApp } from './telegram';

/** Face ID / fingerprint on the phone; Telegram's BiometricManager (Bot API 7.2) in the Mini App; nothing in a plain browser. */

type Manager = NonNullable<TelegramWebApp['BiometricManager']>;

/** Telegram Desktop and Web never answer biometry requests, so a silent client counts as "no biometrics". */
const INIT_TIMEOUT_MS = 2_000;
const PROMPT_TIMEOUT_MS = 60_000;

function manager(): Manager | null {
  const tg = telegramWebApp();
  if (!tg?.BiometricManager || !tg.isVersionAtLeast('7.2')) return null;
  return tg.platform === 'android' || tg.platform === 'ios' ? tg.BiometricManager : null;
}

function withTimeout<T>(ms: number, fallback: T, run: (done: (v: T) => void) => void): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    run((v) => {
      clearTimeout(timer);
      resolve(v);
    });
  });
}

function init(bm: Manager): Promise<boolean> {
  return bm.isInited ? Promise.resolve(true) : withTimeout(INIT_TIMEOUT_MS, false, (done) => bm.init(() => done(true)));
}

export async function biometricsAvailable(): Promise<boolean> {
  const bm = manager();
  if (bm) return (await init(bm)) && bm.isBiometricAvailable;
  return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
}

export async function authenticateBiometric(reason: string): Promise<boolean> {
  const bm = manager();
  if (!bm) return (await LocalAuthentication.authenticateAsync({ promptMessage: reason })).success;
  if (!(await init(bm)) || !bm.isBiometricAvailable) return false;
  if (!bm.isAccessGranted) {
    const granted = await withTimeout(PROMPT_TIMEOUT_MS, false, (done) => bm.requestAccess({ reason }, (ok) => done(ok)));
    if (!granted) return false;
  }
  return withTimeout(PROMPT_TIMEOUT_MS, false, (done) => bm.authenticate({ reason }, (ok) => done(ok)));
}
