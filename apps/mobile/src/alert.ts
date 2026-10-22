import { Alert, Platform, type AlertButton } from 'react-native';
import { popupButtons, telegramWebApp } from './telegram';

/**
 * `Alert.alert` for every platform. react-native-web ships no Alert at all, so on web the confirmations would
 * silently do nothing: inside Telegram they become its popup, in a plain browser the native dialogs.
 */
export function alert(title: string, message?: string, buttons: AlertButton[] = []): void {
  if (Platform.OS !== 'web') return Alert.alert(title, message, buttons);
  const tg = telegramWebApp();
  if (tg && tg.isVersionAtLeast('6.2')) {
    const shown = buttons.slice(0, 3);
    tg.showPopup({ ...(message ? { title: title.slice(0, 64) } : {}), message: (message ?? title).slice(0, 256), buttons: popupButtons(shown) }, (id) => {
      const pressed = id == null ? shown.find((b) => b.style === 'cancel') : shown[Number(id)];
      pressed?.onPress?.();
    });
    return;
  }
  const text = message ? `${title}\n\n${message}` : title;
  const cancel = buttons.find((b) => b.style === 'cancel');
  const actions = buttons.filter((b) => b.style !== 'cancel');
  if (actions.length === 0) {
    window.alert(text);
    cancel?.onPress?.();
  } else if (actions.length === 1) {
    (window.confirm(`${text}\n\n${actions[0]?.text ?? 'OK'}?`) ? actions[0] : cancel)?.onPress?.();
  } else {
    const menu = actions.map((b, i) => `${i + 1} — ${b.text ?? 'OK'}`).join('\n');
    const picked = Number(window.prompt(`${text}\n\n${menu}`, '') ?? NaN);
    (Number.isInteger(picked) && actions[picked - 1] ? actions[picked - 1] : cancel)?.onPress?.();
  }
}
