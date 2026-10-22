import { parsePairingCode, type PairingCode } from '@pocket/protocol';

/**
 * Telegram Mini App bridge: the parts of `window.Telegram.WebApp` Pocket uses when the web build runs inside
 * Telegram (the script is loaded by `public/index.html`). Everything here is a no-op elsewhere, so screens can
 * call it without checking the platform. Kept free of React Native imports so the helpers run under vitest.
 */

export interface Inset {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface PopupButton {
  id?: string;
  type?: 'default' | 'ok' | 'close' | 'cancel' | 'destructive';
  text?: string;
}

export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: { start_param?: string; user?: { id: number; first_name: string; username?: string; language_code?: string } };
  version: string;
  /** `android`, `ios`, `tdesktop`, `macos`, `weba`, `webk`… and `unknown` outside Telegram. */
  platform: string;
  colorScheme: 'light' | 'dark';
  viewportHeight: number;
  viewportStableHeight: number;
  safeAreaInset?: Inset;
  contentSafeAreaInset?: Inset;
  isVersionAtLeast(version: string): boolean;
  ready(): void;
  expand(): void;
  close(): void;
  setHeaderColor(color: string): void;
  setBackgroundColor(color: string): void;
  setBottomBarColor?(color: string): void;
  disableVerticalSwipes?(): void;
  onEvent(event: string, handler: () => void): void;
  offEvent(event: string, handler: () => void): void;
  openLink(url: string, options?: { try_instant_view?: boolean }): void;
  openTelegramLink(url: string): void;
  showPopup(params: { title?: string; message: string; buttons?: PopupButton[] }, callback?: (buttonId: string | null | undefined) => void): void;
  showScanQrPopup(params: { text?: string }, callback?: (text: string) => boolean | void): void;
  closeScanQrPopup(): void;
  HapticFeedback: {
    impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
    notificationOccurred(type: 'error' | 'success' | 'warning'): void;
    selectionChanged(): void;
  };
  BackButton: { isVisible: boolean; show(): void; hide(): void; onClick(handler: () => void): void; offClick(handler: () => void): void };
  BiometricManager?: {
    isInited: boolean;
    isBiometricAvailable: boolean;
    biometricType: 'finger' | 'face' | 'unknown';
    isAccessRequested: boolean;
    isAccessGranted: boolean;
    init(callback?: () => void): void;
    requestAccess(params: { reason?: string }, callback?: (granted: boolean) => void): void;
    authenticate(params: { reason?: string }, callback?: (ok: boolean, token?: string) => void): void;
  };
}

/** The bridge when the page runs inside Telegram; `null` in a plain browser and on native. */
export function telegramWebApp(): TelegramWebApp | null {
  const tg = (globalThis as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
  return tg && tg.platform !== 'unknown' ? tg : null;
}

/** Captured on load: Expo Router rewrites the address once it mounts, taking `?code=` with it. */
const launchSearch = typeof location !== 'undefined' ? location.search : '';

export interface LaunchPairing {
  relayUrl: string;
  code: PairingCode;
}

/**
 * The pairing code the app was opened with: `?code=` from the bot's /app button, or `start_param` from a
 * `t.me/<bot>/<app>?startapp=<code>` link. The relay is the origin that serves the app, unless a build sets
 * `EXPO_PUBLIC_RELAY_URL`.
 */
export function launchPairing(
  args: { search?: string; startParam?: string | undefined; origin?: string; relayUrl?: string | undefined } = {},
): LaunchPairing | null {
  const search = args.search ?? launchSearch;
  const startParam = 'startParam' in args ? args.startParam : telegramWebApp()?.initDataUnsafe.start_param;
  const raw = new URLSearchParams(search).get('code') ?? startParam;
  if (!raw) return null;
  const relayUrl = (args.relayUrl ?? process.env.EXPO_PUBLIC_RELAY_URL) || args.origin || (typeof location !== 'undefined' ? location.origin : '');
  if (!relayUrl) return null;
  try {
    return { relayUrl, code: parsePairingCode(raw) };
  } catch {
    return null;
  }
}

/** Drops `?code=` from the address so a reload does not retry a used code. */
export function forgetLaunchCode(): void {
  if (typeof history === 'undefined' || typeof location === 'undefined' || !new URLSearchParams(location.search).has('code')) return;
  history.replaceState(history.state, '', location.pathname + location.hash);
}

/** Device safe area plus Telegram's own chrome, when the client reports them (Bot API 8.0); `null` otherwise. */
export function telegramInsets(tg: Pick<TelegramWebApp, 'safeAreaInset' | 'contentSafeAreaInset'>): Inset | null {
  const a = tg.safeAreaInset;
  const b = tg.contentSafeAreaInset;
  if (!a || !b) return null;
  return { top: a.top + b.top, bottom: a.bottom + b.bottom, left: a.left + b.left, right: a.right + b.right };
}

/** Telegram's `showPopup` takes at most three buttons; a cancel button gets Telegram's own label. */
export function popupButtons(buttons: { text?: string; style?: 'default' | 'cancel' | 'destructive' }[]): PopupButton[] {
  const list = buttons.length ? buttons.slice(0, 3) : [{ text: 'OK' }];
  return list.map((b, i) =>
    b.style === 'cancel' ? { id: String(i), type: 'cancel' } : { id: String(i), type: b.style === 'destructive' ? 'destructive' : 'default', text: (b.text ?? 'OK').slice(0, 64) },
  );
}

/** Opens `t.me/…` links inside Telegram when running there, so the Mini App is not left for a browser. */
export function openTelegramLink(url: string): boolean {
  const tg = telegramWebApp();
  if (!tg) return false;
  tg.openTelegramLink(url);
  return true;
}

/** Telegram's share sheet for a text (and the link in it), used instead of the system share sheet. */
export function shareViaTelegram(url: string, text: string): boolean {
  return openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`);
}

/** One-time setup once the bridge is there: full height, dark chrome, no swipe-to-close while scrolling. */
export function setupTelegram(tg: TelegramWebApp, background: string): void {
  tg.expand();
  tg.setHeaderColor(background);
  tg.setBackgroundColor(background);
  tg.setBottomBarColor?.(background);
  if (tg.isVersionAtLeast('7.7')) tg.disableVerticalSwipes?.();
}
