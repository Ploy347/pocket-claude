import { useEffect, useState } from 'react';
import { PocketCall, type PowerState } from '../modules/pocket-call';

function read(): PowerState | null {
  try {
    return PocketCall?.getPowerState() ?? null;
  } catch {
    return null;
  }
}

/** The phone is hot or in Low Power Mode: skip what is only decoration, like autoplaying video. iPhone only. */
export function usePowerSaving(): boolean {
  const [state, setState] = useState<PowerState | null>(read);
  useEffect(() => {
    if (!PocketCall) return;
    const sub = PocketCall.addListener('onPowerChange', setState);
    return () => sub.remove();
  }, []);
  return state !== null && (state.lowPower || state.thermalState === 'serious' || state.thermalState === 'critical');
}
