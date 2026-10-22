import * as Haptics from 'expo-haptics';
import { telegramWebApp } from './telegram';

/** Same API as expo-haptics; inside Telegram the feedback goes through the Mini App bridge, which the WebView cannot do itself. */

export const ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle;
export const NotificationFeedbackType = Haptics.NotificationFeedbackType;

const IMPACT: Record<Haptics.ImpactFeedbackStyle, 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'> = {
  [Haptics.ImpactFeedbackStyle.Light]: 'light',
  [Haptics.ImpactFeedbackStyle.Medium]: 'medium',
  [Haptics.ImpactFeedbackStyle.Heavy]: 'heavy',
  [Haptics.ImpactFeedbackStyle.Rigid]: 'rigid',
  [Haptics.ImpactFeedbackStyle.Soft]: 'soft',
};

const NOTIFICATION: Record<Haptics.NotificationFeedbackType, 'error' | 'success' | 'warning'> = {
  [Haptics.NotificationFeedbackType.Success]: 'success',
  [Haptics.NotificationFeedbackType.Warning]: 'warning',
  [Haptics.NotificationFeedbackType.Error]: 'error',
};

export async function impactAsync(style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Medium): Promise<void> {
  const tg = telegramWebApp();
  if (tg) return tg.HapticFeedback.impactOccurred(IMPACT[style]);
  return Haptics.impactAsync(style);
}

export async function notificationAsync(type: Haptics.NotificationFeedbackType = Haptics.NotificationFeedbackType.Success): Promise<void> {
  const tg = telegramWebApp();
  if (tg) return tg.HapticFeedback.notificationOccurred(NOTIFICATION[type]);
  return Haptics.notificationAsync(type);
}

export async function selectionAsync(): Promise<void> {
  const tg = telegramWebApp();
  if (tg) return tg.HapticFeedback.selectionChanged();
  return Haptics.selectionAsync();
}
