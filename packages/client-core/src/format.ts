export type Inline = { code: boolean; text: string };
export type Block = { type: 'paragraph'; inline: Inline[] } | { type: 'code'; lang: string; text: string };

const FENCE = /^ {0,3}```\s*([^\s`]*)\s*$/;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const re = /`([^`\n]+)`/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ code: false, text: text.slice(last, m.index) });
    out.push({ code: true, text: m[1] ?? '' });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ code: false, text: text.slice(last) });
  return out;
}

/** Light markdown: paragraphs, inline code, fenced code blocks. An unterminated fence runs to the end (streaming). */
export function parseMarkdown(text: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let code: { lang: string; lines: string[] } | undefined;

  const flush = () => {
    if (para.length) blocks.push({ type: 'paragraph', inline: parseInline(para.join('\n')) });
    para = [];
  };

  for (const line of text.split('\n')) {
    if (code) {
      if (FENCE.test(line) && FENCE.exec(line)?.[1] === '') {
        blocks.push({ type: 'code', lang: code.lang, text: code.lines.join('\n') });
        code = undefined;
      } else code.lines.push(line);
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      code = { lang: fence[1] ?? '', lines: [] };
    } else if (line.trim() === '') flush();
    else para.push(line);
  }
  flush();
  if (code) blocks.push({ type: 'code', lang: code.lang, text: code.lines.join('\n') });
  return blocks;
}

/** A run of text with its styles; `link` carries the target of `[text](url)`. */
export type RichInline = { text: string; code?: boolean; bold?: boolean; italic?: boolean; link?: string };
export type RichBlock =
  | { type: 'paragraph'; inline: RichInline[] }
  | { type: 'heading'; level: 1 | 2 | 3; inline: RichInline[] }
  | { type: 'list'; ordered: boolean; items: RichInline[][] }
  | { type: 'quote'; inline: RichInline[] }
  | { type: 'rule' }
  | { type: 'code'; lang: string; text: string };

const LINK = /^\[([^\]\n]+)\]\(([^)\s]+)\)/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const LIST_ITEM = /^ {0,3}(?:([-*+•])|(\d{1,3})[.)])\s+(.*)$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;

function closing(text: string, from: number, marker: string): number {
  // A closer needs content before it and must not be preceded by whitespace; markers inside `code` do not count.
  // An unterminated marker is literal (streaming).
  for (let i = from; i < text.length; i++) {
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1);
      if (end > i) {
        i = end;
        continue;
      }
    }
    if (text.startsWith(marker, i) && i > from && !/\s/.test(text[i - 1] ?? '')) return i;
  }
  return -1;
}

/** Inline markdown: `code`, **bold**, *italic*, [links](url). Unterminated markers stay literal so streaming text never flickers. */
export function parseRichInline(text: string, style: { bold?: boolean; italic?: boolean } = {}): RichInline[] {
  const out: RichInline[] = [];
  let literal = '';
  const flush = () => {
    if (literal) out.push({ text: literal, ...style });
    literal = '';
  };
  let i = 0;
  while (i < text.length) {
    const ch = text[i] ?? '';
    if (ch === '`') {
      const end = text.indexOf('`', i + 1);
      const nl = text.indexOf('\n', i + 1);
      if (end > i + 1 && (nl < 0 || end < nl)) {
        flush();
        out.push({ text: text.slice(i + 1, end), code: true, ...style });
        i = end + 1;
        continue;
      }
    } else if ((ch === '*' || ch === '_') && !style.bold && text.startsWith(ch + ch, i) && !/\s/.test(text[i + 2] ?? ' ')) {
      const end = closing(text, i + 2, ch + ch);
      if (end > 0) {
        flush();
        out.push(...parseRichInline(text.slice(i + 2, end), { ...style, bold: true }));
        i = end + 2;
        continue;
      }
    } else if ((ch === '*' || ch === '_') && !style.italic && !/\s/.test(text[i + 1] ?? ' ') && (ch === '*' || !/\w/.test(text[i - 1] ?? ' '))) {
      const end = closing(text, i + 1, ch);
      if (end > 0 && text[end + 1] !== ch) {
        flush();
        out.push(...parseRichInline(text.slice(i + 1, end), { ...style, italic: true }));
        i = end + 1;
        continue;
      }
    } else if (ch === '[') {
      const m = LINK.exec(text.slice(i));
      if (m) {
        flush();
        out.push({ text: m[1] ?? '', link: m[2] ?? '', ...style });
        i += m[0].length;
        continue;
      }
    }
    literal += ch;
    i++;
  }
  flush();
  return out;
}

/** Markdown the way Claude writes it: headings, lists, quotes, rules, fenced code and styled text. Streaming-tolerant. */
export function parseRichMarkdown(text: string): RichBlock[] {
  const blocks: RichBlock[] = [];
  let para: string[] = [];
  let quote: string[] = [];
  let list: { ordered: boolean; items: string[] } | undefined;
  let code: { lang: string; lines: string[] } | undefined;

  const flush = () => {
    if (para.length) blocks.push({ type: 'paragraph', inline: parseRichInline(para.join('\n')) });
    if (quote.length) blocks.push({ type: 'quote', inline: parseRichInline(quote.join('\n')) });
    if (list) blocks.push({ type: 'list', ordered: list.ordered, items: list.items.map((item) => parseRichInline(item)) });
    para = [];
    quote = [];
    list = undefined;
  };

  for (const line of text.split('\n')) {
    if (code) {
      if (FENCE.test(line) && FENCE.exec(line)?.[1] === '') {
        blocks.push({ type: 'code', lang: code.lang, text: code.lines.join('\n') });
        code = undefined;
      } else code.lines.push(line);
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      code = { lang: fence[1] ?? '', lines: [] };
      continue;
    }
    if (line.trim() === '') {
      flush();
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      const ordered = item[2] !== undefined;
      if (!list || list.ordered !== ordered) {
        flush();
        list = { ordered, items: [] };
      }
      list.items.push(item[3] ?? '');
      continue;
    }
    if (list && /^\s{2,}\S/.test(line)) {
      // Indented continuation of the previous item.
      list.items[list.items.length - 1] += `\n${line.trim()}`;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      const level = Math.min(3, heading[1]?.length ?? 1) as 1 | 2 | 3;
      blocks.push({ type: 'heading', level, inline: parseRichInline(heading[2] ?? '') });
      continue;
    }
    if (RULE.test(line)) {
      flush();
      blocks.push({ type: 'rule' });
      continue;
    }
    const q = QUOTE.exec(line);
    if (q) {
      if (para.length || list) flush();
      quote.push(q[1] ?? '');
      continue;
    }
    if (quote.length || list) flush();
    para.push(line);
  }
  flush();
  if (code) blocks.push({ type: 'code', lang: code.lang, text: code.lines.join('\n') });
  return blocks;
}

/** The text of a block without any markup, for copying and for plain-text fallbacks. */
export function richBlockText(block: RichBlock): string {
  const runs = (inline: RichInline[]) => inline.map((r) => r.text).join('');
  switch (block.type) {
    case 'paragraph':
    case 'heading':
    case 'quote':
      return runs(block.inline);
    case 'list':
      return block.items.map((item, i) => `${block.ordered ? `${i + 1}.` : '•'} ${runs(item)}`).join('\n');
    case 'rule':
      return '———';
    case 'code':
      return block.text;
  }
}

const SUMMARY_KEYS = ['command', 'file_path', 'pattern', 'path', 'glob', 'query', 'url', 'description'] as const;

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function shortToolName(name: string): string {
  const i = name.lastIndexOf('__');
  return i >= 0 && i + 2 < name.length ? name.slice(i + 2) : name;
}

/** One-line description of a tool call: its path, command or pattern. */
export function summarizeTool(input: unknown, max = 100): string {
  if (typeof input === 'string') return truncate(input.split('\n')[0] ?? '', max);
  if (typeof input !== 'object' || input === null) return '';
  const obj = input as Record<string, unknown>;
  for (const key of SUMMARY_KEYS) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) {
      const extra = key === 'pattern' && typeof obj.path === 'string' ? ` in ${obj.path}` : '';
      return truncate(`${v.trim().split('\n')[0] ?? ''}${extra}`, max);
    }
  }
  const json = JSON.stringify(input);
  return json === '{}' ? '' : truncate(json, max);
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function formatCost(usd: number): string {
  return `$${usd.toFixed(usd < 0.01 ? 4 : 2)}`;
}

export function formatResultLine(durationMs?: number, costUsd?: number): string {
  const parts: string[] = [];
  if (durationMs !== undefined) parts.push(formatDuration(durationMs));
  if (costUsd !== undefined) parts.push(formatCost(costUsd));
  return parts.join(' · ');
}

export function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? '';
  } catch {
    return String(value);
  }
}

export function tail(text: string, max: number): string {
  return text.length > max ? `…${text.slice(-max)}` : text;
}

export type PreviewLine = { kind: 'add' | 'del' | 'ctx'; text: string };

const MAX_PREVIEW_LINES = 60;

/** What the user needs to see to approve a tool call: the command, or the change as a diff. */
export function permissionPreview(tool: string, input: unknown): PreviewLine[] {
  const args = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const lines = (s: unknown) => (typeof s === 'string' ? s.split('\n') : []);
  let out: PreviewLine[];
  switch (shortToolName(tool)) {
    case 'run_command':
      out = lines(args.command).map((text) => ({ kind: 'ctx', text }));
      break;
    case 'edit_file':
      out = [...lines(args.old_string).map((text) => ({ kind: 'del' as const, text })), ...lines(args.new_string).map((text) => ({ kind: 'add' as const, text }))];
      break;
    case 'write_file':
      out = lines(args.content).map((text) => ({ kind: 'add', text }));
      break;
    default:
      out = prettyJson(input).split('\n').map((text) => ({ kind: 'ctx', text }));
  }
  if (out.length <= MAX_PREVIEW_LINES) return out;
  return [...out.slice(0, MAX_PREVIEW_LINES), { kind: 'ctx', text: `… ${out.length - MAX_PREVIEW_LINES} more lines` }];
}
