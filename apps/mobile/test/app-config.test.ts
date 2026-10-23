import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const config = JSON.parse(readFileSync(join(__dirname, '..', 'app.json'), 'utf8')).expo;

describe('app.json', () => {
  it('never strips the microphone permission that voice calls need', () => {
    // `microphonePermission: false` on any plugin removes NSMicrophoneUsageDescription on iOS (TCC crash on the first
    // call) and RECORD_AUDIO on Android.
    for (const plugin of config.plugins) {
      if (Array.isArray(plugin)) expect(plugin[1]?.microphonePermission, String(plugin[0])).not.toBe(false);
    }
    expect(config.ios.infoPlist.NSMicrophoneUsageDescription).toBeTruthy();
  });

  it('keeps calls alive with the screen locked', () => {
    // audio: the call's audio keeps running in the background; voip: CallKit calls.
    expect(config.ios.infoPlist.UIBackgroundModes).toEqual(expect.arrayContaining(['audio', 'voip']));
    expect(config.ios.infoPlist.NSSpeechRecognitionUsageDescription).toBeTruthy();
  });
});
