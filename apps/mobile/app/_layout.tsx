import { GrandHotel_400Regular, useFonts } from '@expo-google-fonts/grand-hotel';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState, type ReactNode } from 'react';
import { SafeAreaInsetsContext, SafeAreaProvider } from 'react-native-safe-area-context';
import { CallBar, CallProvider } from '../src/call';
import { LockProvider } from '../src/lock';
import { PcClipboardProvider } from '../src/pc-clipboard';
import { SessionProvider, useSession } from '../src/session';
import { setupTelegram, telegramInsets, telegramWebApp } from '../src/telegram';
import { colors } from '../src/theme';

void SplashScreen.preventAutoHideAsync();

const telegram = telegramWebApp();
if (telegram) setupTelegram(telegram, colors.bg);

/** Inside Telegram the client reports the insets (its header, the home indicator); the browser's env() values are not for the Mini App. */
function TelegramInsets({ children }: { children: ReactNode }) {
  const [insets, setInsets] = useState(() => (telegram ? telegramInsets(telegram) : null));
  useEffect(() => {
    if (!telegram) return;
    const update = () => setInsets(telegramInsets(telegram));
    telegram.onEvent('safeAreaChanged', update);
    telegram.onEvent('contentSafeAreaChanged', update);
    return () => {
      telegram.offEvent('safeAreaChanged', update);
      telegram.offEvent('contentSafeAreaChanged', update);
    };
  }, []);
  if (!insets) return <>{children}</>;
  return <SafeAreaInsetsContext.Provider value={insets}>{children}</SafeAreaInsetsContext.Provider>;
}

/** Telegram's own back arrow in the header stands in for the phone's back gesture. */
function TelegramBackButton() {
  const router = useRouter();
  const segments = useSegments();
  useEffect(() => {
    if (!telegram) return;
    const back = () => router.back();
    if (router.canGoBack()) {
      telegram.BackButton.onClick(back);
      telegram.BackButton.show();
      return () => telegram.BackButton.offClick(back);
    }
    telegram.BackButton.hide();
    return undefined;
  }, [router, segments]);
  return null;
}

function Routes({ fontsReady }: { fontsReady: boolean }) {
  const { phase } = useSession();
  const ready = phase !== 'loading' && fontsReady;

  useEffect(() => {
    if (!ready) return;
    void SplashScreen.hideAsync();
    telegram?.ready();
  }, [ready]);

  if (!ready) return null;
  const paired = phase === 'paired';

  return (
    <>
      <TelegramBackButton />
      {/* Hidden screens (the feed under a chat, a chat under the call) do not re-render while covered. */}
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'slide_from_right', freezeOnBlur: true }}>
        <Stack.Protected guard={paired}>
          <Stack.Screen name="(tabs)" options={{ animation: 'none' }} />
          <Stack.Screen name="direct/index" />
          <Stack.Screen name="direct/[id]" />
          <Stack.Screen name="direct/activity" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="direct/computers" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="direct/call" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom', gestureEnabled: false }} />
          <Stack.Screen name="settings" />
          <Stack.Screen name="new-post" options={{ presentation: 'transparentModal', animation: 'fade' }} />
        </Stack.Protected>
        <Stack.Protected guard={!paired}>
          <Stack.Screen name="pair" />
        </Stack.Protected>
      </Stack>
      {paired ? <CallBar /> : null}
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({ GrandHotel_400Regular });
  return (
    <SafeAreaProvider>
      <TelegramInsets>
        <StatusBar style="light" />
        <SessionProvider>
          <PcClipboardProvider>
            <CallProvider>
              <LockProvider>
                <Routes fontsReady={fontsLoaded || fontError !== null} />
              </LockProvider>
            </CallProvider>
          </PcClipboardProvider>
        </SessionProvider>
      </TelegramInsets>
    </SafeAreaProvider>
  );
}
