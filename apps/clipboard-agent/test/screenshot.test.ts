import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CAPTURE_PS, parseCapture } from '../src/screenshot.js';

describe('screenshot', () => {
  it('parses the capture output and rejects anything else', () => {
    expect(parseCapture('\uFEFF1600 900 QUJD\r\n')).toEqual({ mime: 'image/jpeg', dataBase64: 'QUJD', width: 1600, height: 900 });
    expect(() => parseCapture('error')).toThrow(/Screenshot failed/);
  });

  const pwsh = process.env.POCKET_PWSH ?? 'pwsh';
  const hasPwsh = (() => {
    try {
      execFileSync(pwsh, ['-NoProfile', '-c', '1'], { stdio: 'ignore', env: { ...process.env, DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: '1' } });
      return true;
    } catch {
      return false;
    }
  })();
  it.skipIf(!hasPwsh)('capture script parses without syntax errors', () => {
    const file = join(tmpdir(), `pocket-capture-${process.pid}.ps1`);
    writeFileSync(file, CAPTURE_PS);
    const check = [
      '$t = $null; $e = $null',
      "[System.Management.Automation.Language.Parser]::ParseFile('" + file.replace(/'/g, "''") + "', [ref]$t, [ref]$e) | Out-Null",
      'if ($e) { $e | ForEach-Object { "{0}: {1}" -f $_.Extent.StartLineNumber, $_.Message }; exit 1 }',
      "'ok'",
    ].join('; ');
    const out = execFileSync(pwsh, ['-NoProfile', '-c', check], { encoding: 'utf8', env: { ...process.env, DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: '1' } });
    expect(out.trim()).toBe('ok');
  });
});
