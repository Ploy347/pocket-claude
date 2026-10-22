import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SessionEvent, SessionMeta } from '@pocket/protocol';
import { OverlayModel, type WindowOp } from '../src/overlay/model.js';
import { OVERLAY_PS } from '../src/overlay/script.js';

function setup() {
  const ops: WindowOp[] = [];
  const requests: string[] = [];
  const model = new OverlayModel({ window: (op) => ops.push(op), request: (b) => requests.push(b.type === 'session.history' ? `history:${b.payload.sessionId}` : b.type) });
  return { model, ops, requests, last: () => ops[ops.length - 1] as WindowOp };
}

const meta = (sessionId: string, updatedAt: number, extra: Partial<SessionMeta> = {}): SessionMeta => ({
  sessionId,
  title: `Chat ${sessionId}`,
  state: 'idle',
  createdAt: updatedAt,
  updatedAt,
  ...extra,
});

const event = (sessionId: string, event: SessionEvent) => ({ type: 'session.event' as const, payload: { sessionId, event } });

describe('OverlayModel', () => {
  it('asks for the chat list on connect, then follows the most recent visible chat', () => {
    const { model, ops, requests, last } = setup();
    model.connected();
    expect(requests).toEqual(['session.list']);
    model.handle({ type: 'session.list.result', payload: { sessions: [meta('old', 1), meta('new', 5), meta('hidden', 9, { hidden: true })] } });
    expect(requests).toEqual(['session.list', 'history:new']);
    expect(last()).toMatchObject({ op: 'reset', title: 'Chat new', messages: [] });

    model.handle({ type: 'session.history.result', payload: { sessionId: 'new', events: [{ kind: 'user', text: 'hi', from: 'phone' }, { kind: 'text', text: 'Hello `there`' }] } });
    const reset = last();
    expect(reset.op).toBe('reset');
    if (reset.op !== 'reset') return;
    expect(reset.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(reset.messages[1]?.blocks).toEqual([{ type: 'paragraph', inline: [{ text: 'Hello ' }, { text: 'there', code: true }] }]);
    expect(ops.filter((o) => o.op === 'reset')).toHaveLength(2);
  });

  it('streams a reply as upserts of the same message and finalises it', () => {
    const { model, ops, last } = setup();
    model.handle({ type: 'session.list.result', payload: { sessions: [meta('a', 1)] } });
    model.handle({ type: 'session.history.result', payload: { sessionId: 'a', events: [] } });
    ops.length = 0;

    model.handle(event('a', { kind: 'user', text: 'write code', from: 'phone' }));
    expect(last()).toMatchObject({ op: 'upsert', message: { role: 'user', text: 'write code' } });
    model.handle(event('a', { kind: 'text_delta', text: 'Sure:\n```py\nprint(1)' }));
    const first = last();
    expect(first).toMatchObject({ op: 'upsert', message: { role: 'assistant', streaming: true } });
    if (first.op !== 'upsert') return;
    expect(first.message.blocks).toEqual([
      { type: 'paragraph', inline: [{ text: 'Sure:' }] },
      { type: 'code', lang: 'py', text: 'print(1)' },
    ]);
    model.handle(event('a', { kind: 'text_delta', text: '\n```' }));
    model.handle(event('a', { kind: 'text', text: 'Sure:\n```py\nprint(1)\n```' }));
    const done = last();
    expect(done).toMatchObject({ op: 'upsert', message: { id: first.message.id, streaming: false, text: 'Sure:\n```py\nprint(1)\n```' } });
    model.handle(event('a', { kind: 'result', durationMs: 10 }));
    expect(last()).toBe(done);
    expect(ops.every((o) => o.op === 'upsert')).toBe(true);
  });

  it('shows tool calls as one line and marks failures', () => {
    const { model, last } = setup();
    model.handle({ type: 'session.list.result', payload: { sessions: [meta('a', 1)] } });
    model.handle({ type: 'session.history.result', payload: { sessionId: 'a', events: [] } });
    model.handle(event('a', { kind: 'tool_use', id: 't1', name: 'mcp__pocket__run_command', input: { command: 'dir /b' } }));
    expect(last()).toMatchObject({ op: 'upsert', message: { role: 'tool', text: 'run_command dir /b', streaming: true } });
    model.handle(event('a', { kind: 'tool_result', id: 't1', content: 'boom', isError: true }));
    expect(last()).toMatchObject({ op: 'upsert', message: { role: 'tool', streaming: false, note: 'failed' } });
  });

  it('switches to the chat the phone types in, to new chats, and away from deleted ones', () => {
    const { model, requests, last } = setup();
    model.handle({ type: 'session.list.result', payload: { sessions: [meta('a', 2), meta('b', 1)] } });
    model.handle({ type: 'session.history.result', payload: { sessionId: 'a', events: [] } });

    model.handle(event('b', { kind: 'user', text: 'over here', from: 'phone' }));
    expect(requests).toEqual(['history:a', 'history:b']);
    expect(last()).toMatchObject({ op: 'reset', title: 'Chat b' });
    model.handle({ type: 'session.history.result', payload: { sessionId: 'b', events: [{ kind: 'user', text: 'over here', from: 'phone' }] } });
    expect(last()).toMatchObject({ op: 'reset', title: 'Chat b', messages: [{ role: 'user', text: 'over here' }] });

    model.handle({ type: 'session.created', payload: { session: meta('c', 3) } });
    expect(last()).toMatchObject({ op: 'reset', title: 'Chat c', messages: [] });
    model.handle({ type: 'session.updated', payload: { session: meta('c', 4, { title: 'Renamed' }) } });
    expect(last()).toEqual({ op: 'title', title: 'Renamed' });

    model.handle({ type: 'session.deleted', payload: { sessionId: 'c' } });
    expect(last()).toMatchObject({ op: 'reset', title: 'Chat b' });
    model.handle({ type: 'session.deleted', payload: { sessionId: 'b' } });
    model.handle({ type: 'session.deleted', payload: { sessionId: 'a' } });
    expect(last()).toEqual({ op: 'reset', title: 'No chats yet', messages: [], theme: 'dark' });
  });

  it('carries the theme in snapshots and pushes a change to the window', () => {
    const { model, ops, last } = setup();
    model.handle({ type: 'session.list.result', payload: { sessions: [] } });
    expect(last()).toMatchObject({ op: 'reset', theme: 'dark' });
    model.setTheme('light');
    expect(last()).toEqual({ op: 'theme', theme: 'light' });
    model.setTheme('light');
    expect(ops.filter((o) => o.op === 'theme')).toHaveLength(1);
    expect(model.snapshot()).toMatchObject({ op: 'reset', theme: 'light' });
    expect(new OverlayModel({ window: () => {}, request: () => {} }, 'light').snapshot()).toMatchObject({ theme: 'light' });
  });

  it('ignores events for the active chat until its history arrived, then draws from the history', () => {
    const { model, ops, last } = setup();
    model.handle({ type: 'session.list.result', payload: { sessions: [meta('a', 1)] } });
    ops.length = 0;
    model.handle(event('a', { kind: 'text', text: 'early' }));
    expect(ops).toEqual([]);
    model.handle({ type: 'session.history.result', payload: { sessionId: 'a', events: [{ kind: 'text', text: 'early' }] } });
    expect(last()).toMatchObject({ op: 'reset', messages: [{ role: 'assistant', text: 'early' }] });
  });

  it('reloads after a reconnect', () => {
    const { model, requests } = setup();
    model.handle({ type: 'session.list.result', payload: { sessions: [meta('a', 1)] } });
    model.handle({ type: 'session.history.result', payload: { sessionId: 'a', events: [] } });
    model.offline();
    model.connected();
    model.handle({ type: 'session.list.result', payload: { sessions: [meta('a', 1)] } });
    expect(requests).toEqual(['history:a', 'session.list', 'history:a']);
  });
});

describe('overlay script', () => {
  it('is plain PowerShell 5.1 without template leftovers', () => {
    const script = readFileSync(new URL('../src/overlay/script.ts', import.meta.url), 'utf8');
    expect(script).not.toMatch(/\$\{/);
    expect(script).toContain('GetAsyncKeyState');
    expect(script).toContain('ShowWithoutActivation');
  });

  // PowerShell 7 parses 5.1 syntax; CI runners and Macs with pwsh get a real syntax check, elsewhere the test is skipped.
  const pwsh = process.env.POCKET_PWSH ?? 'pwsh';
  const hasPwsh = (() => {
    try {
      execFileSync(pwsh, ['-NoProfile', '-c', '1'], { stdio: 'ignore', env: { ...process.env, DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: '1' } });
      return true;
    } catch {
      return false;
    }
  })();
  it.skipIf(!hasPwsh)('parses without syntax errors', () => {
    const file = join(tmpdir(), `pocket-overlay-${process.pid}.ps1`);
    writeFileSync(file, OVERLAY_PS);
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
