import { Ionicons } from '@expo/vector-icons';
import { setAudioModeAsync } from 'expo-audio';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ClaudeAvatar } from '../../src/components/ClaudeAvatar';
import { personaFor } from '../../src/persona';
import { useChatSelector, useSession } from '../../src/session';
import { colors } from '../../src/theme';
import { callLanguage, VoiceCall, type CallSnapshot } from '../../src/voice';

const PHASE_LABEL: Record<CallSnapshot['phase'], string> = {
  starting: 'Connecting…',
  listening: 'Listening',
  thinking: 'Thinking…',
  speaking: 'Speaking',
  muted: 'Muted',
  ended: 'Call ended',
  error: 'Call failed',
};

function deviceLanguage(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return undefined;
  }
}

/** A voice call with the chat: speak, pause, hear the answer; works with the screen off (background audio). */
export default function CallScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const sessionId = id ?? '';
  const { client } = useSession();
  const persona = useMemo(() => personaFor(sessionId), [sessionId]);
  const thread = useChatSelector((s) => s.threads[sessionId]);
  const brainOnline = useChatSelector((s) => s.brainOnline);
  const [snap, setSnap] = useState<CallSnapshot>({ phase: 'starting', heard: '', said: '' });
  const [muted, setMuted] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const call = useRef<VoiceCall | null>(null);
  const lastReplyKey = useRef<string | null>(null);

  useEffect(() => {
    if (!client) return;
    const language = callLanguage(deviceLanguage());
    const c = new VoiceCall({ send: (text) => client.send(sessionId, text, undefined, { voice: true }), onChange: setSnap, language });
    call.current = c;
    void setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' }).catch(() => {});
    void c.start();
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => {
      clearInterval(timer);
      c.end();
      call.current = null;
      void setAudioModeAsync({ allowsRecording: false, shouldPlayInBackground: false }).catch(() => {});
    };
  }, [client, sessionId]);

  // Read the latest reply aloud as it streams; a new reply resets what was spoken.
  useEffect(() => {
    const c = call.current;
    if (!c || !thread) return;
    const last = thread[thread.length - 1];
    if (!last || last.type !== 'assistant') return;
    if (last.key !== lastReplyKey.current) {
      lastReplyKey.current = last.key;
      c.newReply();
    }
    c.onReply(last.text, last.streaming);
  }, [thread]);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    call.current?.setMuted(next);
  };

  const hangUp = () => {
    call.current?.end();
    router.back();
  };

  const status = !brainOnline ? 'Mac offline' : snap.phase === 'error' ? (snap.error ?? PHASE_LABEL.error) : PHASE_LABEL[snap.phase];
  const line = snap.phase === 'speaking' ? snap.said : snap.heard;

  return (
    <View style={[styles.root, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.top}>
        <ClaudeAvatar size={120} persona={persona} active={snap.phase === 'listening'} />
        <Text style={styles.name}>{persona.name}</Text>
        <Text style={styles.timer}>
          {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
        </Text>
        <Text style={[styles.status, snap.phase === 'error' && { color: colors.danger }, snap.phase === 'listening' && { color: colors.ok }]}>{status}</Text>
      </View>
      <Pressable onPress={() => call.current?.interrupt()} style={styles.transcript} disabled={snap.phase !== 'speaking'}>
        <Text style={styles.line} numberOfLines={6}>
          {line || (snap.phase === 'listening' ? 'Say something; a short pause sends it.' : ' ')}
        </Text>
        {snap.phase === 'speaking' ? <Text style={styles.hint}>Tap to interrupt</Text> : null}
      </Pressable>
      <View style={styles.controls}>
        <Pressable onPress={toggleMute} style={[styles.round, muted && styles.roundOn]} accessibilityLabel={muted ? 'Unmute' : 'Mute'}>
          <Ionicons name={muted ? 'mic-off' : 'mic'} size={28} color={muted ? colors.bg : colors.text} />
        </Pressable>
        <Pressable onPress={hangUp} style={[styles.round, styles.hangUp]} accessibilityLabel="End call">
          <Ionicons name="call" size={30} color="#FFFFFF" style={{ transform: [{ rotate: '135deg' }] }} />
        </Pressable>
        <Pressable onPress={() => router.back()} style={styles.round} accessibilityLabel="Back to chat">
          <Ionicons name="chatbubble-ellipses-outline" size={26} color={colors.text} />
        </Pressable>
      </View>
      {Platform.OS === 'web' ? <Text style={styles.hint}>Calls work in the phone app.</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24 },
  top: { alignItems: 'center', gap: 8 },
  name: { color: colors.text, fontSize: 26, fontWeight: '700', marginTop: 12 },
  timer: { color: colors.textMuted, fontSize: 15, fontVariant: ['tabular-nums'] },
  status: { color: colors.textMuted, fontSize: 15, marginTop: 4 },
  transcript: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 24 },
  line: { color: colors.text, fontSize: 18, lineHeight: 26, textAlign: 'center' },
  hint: { color: colors.textMuted, fontSize: 13, marginTop: 12, textAlign: 'center' },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 28 },
  round: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  roundOn: { backgroundColor: colors.text },
  hangUp: { backgroundColor: colors.danger, width: 76, height: 76, borderRadius: 38 },
});
