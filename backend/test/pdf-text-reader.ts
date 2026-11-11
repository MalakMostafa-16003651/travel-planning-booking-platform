import { inflateSync } from 'node:zlib';

/** Read PDFKit's text streams through their font ToUnicode maps, rather than treating glyph IDs as ASCII. */
export function pdfText(buffer: Buffer): string {
  const raw = buffer.toString('latin1');
  const objects = new Map([...raw.matchAll(/(\d+) 0 obj\s*([\s\S]*?)endobj/g)].map((match) => [match[1], match[2]]));
  const stream = (object: string): string => {
    const match = /stream\r?\n([\s\S]*?)\r?\nendstream/.exec(object);
    if (!match) return '';
    return /FlateDecode/.test(object) ? inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1') : match[1];
  };
  const unicode = (hex: string) => {
    const bytes = Buffer.from(hex, 'hex');
    bytes.swap16();
    return bytes.toString('utf16le');
  };
  const fonts = new Map<string, Map<number, string>>();
  for (const resource of raw.matchAll(/\/(F\d+) (\d+) 0 R/g)) {
    const font = objects.get(resource[2]) ?? '';
    const ref = /\/ToUnicode (\d+) 0 R/.exec(font);
    if (!ref) continue;
    const cmap = stream(objects.get(ref[1]) ?? '');
    const codes = new Map<number, string>();
    for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
      for (const pair of block[1].matchAll(/<([\da-f]+)>\s*<([\da-f]+)>/ig)) codes.set(parseInt(pair[1], 16), unicode(pair[2]));
    }
    for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
      for (const range of block[1].matchAll(/<([\da-f]+)>\s*<([\da-f]+)>\s*\[([^\]]+)\]/ig)) {
        let code = parseInt(range[1], 16);
        for (const value of range[3].matchAll(/<([\da-f]+)>/ig)) codes.set(code++, unicode(value[1]));
      }
      for (const range of block[1].matchAll(/^\s*<([\da-f]+)>\s*<([\da-f]+)>\s*<([\da-f]+)>\s*$/igm)) {
        const first = parseInt(range[1], 16), last = parseInt(range[2], 16), target = parseInt(range[3], 16);
        for (let code = first; code <= last; code++) codes.set(code, String.fromCodePoint(target + code - first));
      }
    }
    fonts.set(resource[1], codes);
  }
  let result = '';
  for (const object of objects.values()) {
    let content: string;
    try { content = stream(object); } catch { continue; }
    if (!/\bBT\b/.test(content)) continue;
    let font: Map<number, string> | undefined;
    for (const token of content.matchAll(/\/(F\d+)\s+[\d.]+\s+Tf|<([\da-f]+)>|\bET\b/ig)) {
      if (token[1]) font = fonts.get(token[1]);
      else if (token[2]) {
        if (font) for (const code of token[2].match(/.{4}/g) ?? []) result += font.get(parseInt(code, 16)) ?? '';
        else result += Buffer.from(token[2], 'hex').toString('latin1');
      } else result += '\n';
    }
  }
  return result;
}
