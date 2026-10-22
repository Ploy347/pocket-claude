import { newPairingCode } from '@pocket/protocol';
import { describe, expect, it } from 'vitest';
import { launchPairing, popupButtons, telegramInsets } from '../src/telegram';

describe('launchPairing', () => {
  const code = newPairingCode();

  it('reads the code the bot put in the address and pairs with the origin that serves the app', () => {
    const launch = launchPairing({ search: `?code=${code.display}`, startParam: undefined, origin: 'https://mac.tail.ts.net:10000' });
    expect(launch?.relayUrl).toBe('https://mac.tail.ts.net:10000');
    expect(launch?.code.pairingId).toBe(code.pairingId);
  });

  it('accepts the code from a startapp link and lets a build point at another relay', () => {
    const launch = launchPairing({ search: '', startParam: code.display.replace(/-/g, ''), origin: 'https://pages.example', relayUrl: 'https://relay.example' });
    expect(launch?.relayUrl).toBe('https://relay.example');
    expect(launch?.code.pairingId).toBe(code.pairingId);
  });

  it('ignores missing or malformed codes', () => {
    expect(launchPairing({ search: '', startParam: undefined, origin: 'https://x' })).toBeNull();
    expect(launchPairing({ search: '?code=not-a-code', startParam: undefined, origin: 'https://x' })).toBeNull();
    expect(launchPairing({ search: `?code=${code.display}`, startParam: undefined, origin: '', relayUrl: undefined })).toBeNull();
  });
});

describe('telegramInsets', () => {
  it('adds the device safe area to the client chrome and is absent on old clients', () => {
    expect(telegramInsets({ safeAreaInset: { top: 47, bottom: 34, left: 0, right: 0 }, contentSafeAreaInset: { top: 56, bottom: 0, left: 0, right: 0 } })).toEqual({ top: 103, bottom: 34, left: 0, right: 0 });
    expect(telegramInsets({ safeAreaInset: { top: 0, bottom: 0, left: 0, right: 0 } })).toBeNull();
    expect(telegramInsets({})).toBeNull();
  });
});

describe('popupButtons', () => {
  it('maps alert buttons onto Telegram popup buttons', () => {
    expect(popupButtons([{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive' }, { text: 'Hide' }])).toEqual([
      { id: '0', type: 'cancel' },
      { id: '1', type: 'destructive', text: 'Delete' },
      { id: '2', type: 'default', text: 'Hide' },
    ]);
    expect(popupButtons([])).toEqual([{ id: '0', type: 'default', text: 'OK' }]);
    expect(popupButtons([{ text: 'a' }, { text: 'b' }, { text: 'c' }, { text: 'd' }])).toHaveLength(3);
  });
});
