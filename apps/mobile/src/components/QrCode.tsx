import qrcode from 'qrcode-generator';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

/** A QR code drawn with plain views (no native module): runs of dark modules become one view each. */
export function QrCode({ value, size }: { value: string; size: number }) {
  const rows = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value, 'Byte');
    qr.make();
    const n = qr.getModuleCount();
    const out: { y: number; runs: { x: number; w: number }[] }[] = [];
    for (let y = 0; y < n; y++) {
      const runs: { x: number; w: number }[] = [];
      for (let x = 0; x < n; x++) {
        if (!qr.isDark(y, x)) continue;
        const last = runs[runs.length - 1];
        if (last && last.x + last.w === x) last.w++;
        else runs.push({ x, w: 1 });
      }
      out.push({ y, runs });
    }
    return { n, out };
  }, [value]);
  const quiet = 2;
  const cell = size / (rows.n + quiet * 2);
  return (
    <View style={[styles.box, { width: size, height: size }]} accessibilityLabel="QR code">
      {rows.out.map((row) => (
        <View key={row.y} style={{ position: 'absolute', top: (row.y + quiet) * cell, left: 0, height: cell, width: size }}>
          {row.runs.map((r) => (
            <View key={r.x} style={{ position: 'absolute', left: (r.x + quiet) * cell, width: r.w * cell, height: cell, backgroundColor: '#000' }} />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: '#FFF', borderRadius: 12, overflow: 'hidden' },
});
