import { describe, expect, it } from 'vitest';
import { parseRichInline, parseRichMarkdown, richBlockText } from '../src/format.js';

describe('parseRichInline', () => {
  it('styles bold, italic, code and links', () => {
    expect(parseRichInline('a **b** *c* `d` [e](http://x)')).toEqual([
      { text: 'a ' },
      { text: 'b', bold: true },
      { text: ' ' },
      { text: 'c', italic: true },
      { text: ' ' },
      { text: 'd', code: true },
      { text: ' ' },
      { text: 'e', link: 'http://x' },
    ]);
  });

  it('nests italic inside bold and keeps code verbatim', () => {
    expect(parseRichInline('**x *y* `**`**')).toEqual([
      { text: 'x ', bold: true },
      { text: 'y', bold: true, italic: true },
      { text: ' ', bold: true },
      { text: '**', code: true, bold: true },
    ]);
  });

  it('leaves unterminated markers, lone stars and snake_case alone', () => {
    expect(parseRichInline('2 * 3 * 4')).toEqual([{ text: '2 * 3 * 4' }]);
    expect(parseRichInline('**streaming')).toEqual([{ text: '**streaming' }]);
    expect(parseRichInline('my_var_name here')).toEqual([{ text: 'my_var_name here' }]);
    expect(parseRichInline('a ` b')).toEqual([{ text: 'a ` b' }]);
  });
});

describe('parseRichMarkdown', () => {
  it('parses headings, lists, quotes, rules and code', () => {
    const md = ['# Title', '', 'Para **one**', '- a', '- b `c`', '', '1. x', '2. y', '', '> quoted', '---', '```sh', 'ls -la', '```'].join('\n');
    expect(parseRichMarkdown(md)).toEqual([
      { type: 'heading', level: 1, inline: [{ text: 'Title' }] },
      { type: 'paragraph', inline: [{ text: 'Para ' }, { text: 'one', bold: true }] },
      { type: 'list', ordered: false, items: [[{ text: 'a' }], [{ text: 'b ' }, { text: 'c', code: true }]] },
      { type: 'list', ordered: true, items: [[{ text: 'x' }], [{ text: 'y' }]] },
      { type: 'quote', inline: [{ text: 'quoted' }] },
      { type: 'rule' },
      { type: 'code', lang: 'sh', text: 'ls -la' },
    ]);
  });

  it('keeps an open fence running while streaming and clamps heading levels', () => {
    expect(parseRichMarkdown('#### deep\n```\nlet x')).toEqual([
      { type: 'heading', level: 3, inline: [{ text: 'deep' }] },
      { type: 'code', lang: '', text: 'let x' },
    ]);
  });

  it('folds indented continuation lines into the list item', () => {
    expect(parseRichMarkdown('- first\n  more\n- second')).toEqual([
      { type: 'list', ordered: false, items: [[{ text: 'first\nmore' }], [{ text: 'second' }]] },
    ]);
  });

  it('renders plain text for copying', () => {
    expect(parseRichMarkdown('1. a\n2. **b**').map(richBlockText)).toEqual(['1. a\n2. b']);
    expect(richBlockText({ type: 'code', lang: '', text: 'x' })).toBe('x');
  });
});
