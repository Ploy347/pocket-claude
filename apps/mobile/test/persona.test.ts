import { describe, expect, it } from 'vitest';
import { PERSONAS, personaFor } from '../src/persona';

describe('personas', () => {
  it('gives every chat a stable brand and spreads chats across brands', () => {
    const ids = Array.from({ length: 200 }, (_, i) => `session-${i}-${(i * 7919) % 101}`);
    const picked = new Set(ids.map((id) => personaFor(id).name));
    expect(picked.size).toBeGreaterThan(PERSONAS.length / 2);
    expect(personaFor('abc')).toBe(personaFor('abc'));
    expect(personaFor(undefined).name).toBe('Lipton');
    expect(new Set(PERSONAS.map((p) => p.username)).size).toBe(PERSONAS.length);
  });
});
