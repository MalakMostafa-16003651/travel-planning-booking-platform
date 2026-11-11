import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ARABIC = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/u;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\uff00-\uffef]/u;
const RUNS = /([\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]+(?: +[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]+)*|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\uff00-\uffef]+)/u;

export function registerPdfFonts(doc: PDFKit.PDFDocument): void {
  const directory = [resolve(__dirname, '../../assets/fonts'), resolve(process.cwd(), 'assets/fonts'), resolve(process.cwd(), 'backend/assets/fonts')]
    .find((candidate) => existsSync(resolve(candidate, 'NotoSans-Regular.ttf')));
  if (!directory) throw new Error('Bundled PDF fonts are missing');
  doc.registerFont('Body', resolve(directory, 'NotoSans-Regular.ttf'))
    .registerFont('Strong', resolve(directory, 'NotoSans-Bold.ttf'))
    .registerFont('Arabic', resolve(directory, 'NotoSansArabic-Regular.ttf'))
    .registerFont('CJK', resolve(directory, 'NotoSansCJKsc-Regular.otf'));
}

/** Embed real Unicode glyphs, including shaped Arabic and CJK names, in both PDF exports. */
export function writePdfText(doc: PDFKit.PDFDocument, value: string, options: PDFKit.Mixins.TextOptions = {}, strong = false): void {
  const clean = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  const runs = clean.split(RUNS).filter(Boolean);
  for (let i = 0; i < runs.length; i++) {
    doc.font(ARABIC.test(runs[i]) ? 'Arabic' : CJK.test(runs[i]) ? 'CJK' : strong ? 'Strong' : 'Body')
      // Explicit features let fontkit shape the entire Arabic run, preserving RTL word order/spaces.
      .text(runs[i], { ...options, features: ARABIC.test(runs[i]) ? ['kern', 'liga'] : options.features, continued: i < runs.length - 1 });
  }
  // Empty strings still terminate a pending text line.
  if (!runs.length) doc.font(strong ? 'Strong' : 'Body').text('', options);
}
