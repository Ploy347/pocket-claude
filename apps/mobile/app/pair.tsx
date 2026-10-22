import { parsePairingUri, type PairingCode } from '@pocket/protocol';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from '../src/haptics';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Wordmark } from '../src/components/Wordmark';
import { useSession } from '../src/session';
import { forgetLaunchCode, launchPairing, telegramWebApp, type LaunchPairing } from '../src/telegram';
import { colors, mono, radius, space } from '../src/theme';

const telegram = telegramWebApp();

export default function PairScreen() {
  const insets = useSafeAreaInsets();
  const { pair } = useSession();
  const params = useLocalSearchParams<{ code?: string; relay?: string; invite?: string }>();
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState<'scan' | 'paste'>('scan');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** An invite link was read; the person picks a name before joining. */
  const [invite, setInvite] = useState<{ relayUrl: string; code: PairingCode } | null>(null);
  const [userName, setUserName] = useState('');
  const handling = useRef(false);

  const joinParsed = useCallback(
    async (parsed: LaunchPairing & { invite?: boolean }) => {
      if (handling.current) return;
      handling.current = true;
      setBusy(true);
      setError(null);
      try {
        if (parsed.invite) {
          setInvite({ relayUrl: parsed.relayUrl, code: parsed.code });
          setBusy(false);
          handling.current = false;
          void Haptics.selectionAsync();
          return;
        }
        await pair(parsed);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch (e) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setError(e instanceof Error ? e.message : 'Pairing failed');
        setBusy(false);
        handling.current = false;
      }
    },
    [pair],
  );

  const join = useCallback(
    async (uri: string) => {
      let parsed;
      try {
        parsed = parsePairingUri(uri.trim());
      } catch (e) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setError(e instanceof Error ? e.message : 'Not a pairing link');
        return;
      }
      await joinParsed(parsed);
    },
    [joinParsed],
  );

  // Opened from the bot's /app button or a startapp link: the code is in the address, pairing needs no scanning.
  useEffect(() => {
    const launch = launchPairing();
    if (!launch) return;
    forgetLaunchCode();
    void joinParsed(launch);
  }, [joinParsed]);

  const scanWithTelegram = () => {
    telegram?.showScanQrPopup({ text: 'Scan the code from pocket-claude pair' }, (data) => {
      try {
        parsePairingUri(data.trim());
      } catch {
        return false;
      }
      void join(data);
      return true;
    });
  };

  const register = useCallback(async () => {
    const name = userName.trim();
    if (!invite || !name || handling.current) return;
    handling.current = true;
    setBusy(true);
    setError(null);
    try {
      await pair({ ...invite, userName: name });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(e instanceof Error ? e.message : 'Pairing failed');
      setBusy(false);
      handling.current = false;
    }
  }, [invite, userName, pair]);

  useEffect(() => {
    if (params.code && params.relay) {
      void join(`pocketclaude://pair?code=${params.code}&relay=${encodeURIComponent(params.relay)}${params.invite ? '&invite=1' : ''}`);
    }
  }, [params.code, params.relay, params.invite, join]);

  const showCamera = mode === 'scan' && permission?.granted === true && !busy && !telegram;

  if (invite) {
    const ready = userName.trim().length > 0 && !busy;
    return (
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.xl }]}
          keyboardShouldPersistTaps="handled"
        >
          <Wordmark size={64} style={styles.wordmark} />
          <Text style={styles.subtitle}>You have been invited. Your chats and computers will be yours alone.</Text>
          <TextInput
            style={styles.name}
            value={userName}
            onChangeText={setUserName}
            placeholder="Your name"
            placeholderTextColor={colors.textMuted}
            autoFocus
            maxLength={64}
            returnKeyType="done"
            onSubmitEditing={() => void register()}
            selectionColor={colors.accent}
          />
          <Pressable disabled={!ready} onPress={() => void register()} style={({ pressed }) => [styles.primary, !ready && { opacity: 0.4 }, pressed && { opacity: 0.8 }]}>
            {busy ? <ActivityIndicator color={colors.userText} /> : <Text style={styles.primaryText}>Join</Text>}
          </Pressable>
          <Pressable disabled={busy} onPress={() => setInvite(null)} hitSlop={8}>
            <Text style={styles.link}>Scan a different code</Text>
          </Pressable>
          {error && <Text style={styles.error}>{error}</Text>}
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        <Wordmark size={64} style={styles.wordmark} />
        <Text style={styles.subtitle}>Run <Text style={styles.code}>pocket-claude pair</Text> on your Mac and scan the QR code, or scan an invite from someone.</Text>

        <View style={styles.tabs}>
          {(['scan', 'paste'] as const).map((m) => (
            <Pressable key={m} onPress={() => setMode(m)} style={[styles.tab, mode === m && styles.tabOn]}>
              <Text style={[styles.tabText, mode === m && { color: colors.text }]}>{m === 'scan' ? 'Scan QR' : 'Paste link'}</Text>
            </Pressable>
          ))}
        </View>

        {mode === 'scan' ? (
          <View style={styles.viewfinder}>
            {showCamera ? (
              <CameraView
                style={StyleSheet.absoluteFill}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={({ data }) => void join(data)}
              />
            ) : busy ? (
              <View style={styles.center}>
                <ActivityIndicator color={colors.text} />
                <Text style={styles.hint}>Pairing with your Mac…</Text>
              </View>
            ) : telegram ? (
              <View style={styles.center}>
                <Pressable onPress={scanWithTelegram} style={styles.secondary}>
                  <Text style={styles.secondaryText}>Scan with Telegram</Text>
                </Pressable>
                <Text style={styles.hint}>Or send /app to the bot: its button pairs this app in one tap.</Text>
              </View>
            ) : permission && !permission.granted ? (
              <View style={styles.center}>
                <Text style={styles.hint}>Camera access is needed to scan the code.</Text>
                <Pressable onPress={requestPermission} style={styles.secondary}>
                  <Text style={styles.secondaryText}>{permission.canAskAgain ? 'Allow camera' : 'Paste the link instead'}</Text>
                </Pressable>
              </View>
            ) : null}
            {showCamera && <View pointerEvents="none" style={styles.frame} />}
          </View>
        ) : (
          <View style={{ gap: space.md }}>
            <TextInput
              style={styles.input}
              value={link}
              onChangeText={setLink}
              placeholder="pocketclaude://pair?code=…"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              multiline
              selectionColor={colors.accent}
            />
            <Pressable
              disabled={busy || link.trim().length === 0}
              onPress={() => void join(link)}
              style={({ pressed }) => [styles.primary, (busy || link.trim().length === 0) && { opacity: 0.4 }, pressed && { opacity: 0.8 }]}
            >
              {busy ? <ActivityIndicator color={colors.userText} /> : <Text style={styles.primaryText}>Pair</Text>}
            </Pressable>
          </View>
        )}

        {error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: space.xl, gap: space.lg },
  wordmark: { alignSelf: 'center', marginTop: space.xl },
  subtitle: { color: colors.textMuted, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  code: { fontFamily: mono, color: colors.text },
  tabs: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, marginTop: space.md },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'transparent' },
  tabOn: { borderBottomColor: colors.text },
  tabText: { color: colors.textMuted, fontWeight: '600', fontSize: 14 },
  viewfinder: {
    aspectRatio: 1,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  frame: {
    position: 'absolute',
    top: '15%',
    left: '15%',
    right: '15%',
    bottom: '15%',
    borderWidth: 2,
    borderColor: colors.accent,
    borderRadius: radius.md,
    opacity: 0.8,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.xl },
  hint: { color: colors.textDim, textAlign: 'center', fontSize: 14 },
  secondary: { backgroundColor: colors.borderHi, paddingHorizontal: space.xl, paddingVertical: space.md, borderRadius: 8 },
  secondaryText: { color: colors.text, fontWeight: '600' },
  input: {
    minHeight: 96,
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderHi,
    padding: space.lg,
    color: colors.text,
    fontFamily: mono,
    fontSize: 13,
    textAlignVertical: 'top',
  },
  primary: { backgroundColor: colors.accent, borderRadius: 8, alignItems: 'center', justifyContent: 'center', height: 44 },
  primaryText: { color: colors.userText, fontWeight: '600', fontSize: 15 },
  name: {
    height: 48,
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderHi,
    paddingHorizontal: space.lg,
    color: colors.text,
    fontSize: 16,
  },
  link: { color: colors.accent, fontSize: 14, fontWeight: '600', textAlign: 'center', paddingVertical: space.sm },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
});
