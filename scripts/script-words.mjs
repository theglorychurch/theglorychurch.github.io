// Quentin 필기체를 웹폰트로 배포하지 않고, 쓰는 단어만 SVG 패스로 굽는다.
// 사용: node scripts/script-words.mjs [폰트경로]
import opentype from 'opentype.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';

const fontPath = process.argv[2] ?? `${homedir()}/Library/Fonts/Quentin.otf`;
const words = { 'glory-to-glory': 'Glory to Glory', 'the-glory-church': 'The Glory Church' };
const SIZE = 100;

const buf = readFileSync(fontPath);
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const scale = SIZE / font.unitsPerEm;
const f = (n) => Math.round(n * 10) / 10;

// opentype.js의 getPath는 이 폰트에서 NaN 좌표를 만들어서, 글리프 윤곽을 직접 변환한다.
for (const [name, text] of Object.entries(words)) {
  let x = 0;
  let d = '';
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  const pt = (px, py) => {
    const X = f(x + px * scale), Y = f(-py * scale);
    x1 = Math.min(x1, X); x2 = Math.max(x2, X); y1 = Math.min(y1, Y); y2 = Math.max(y2, Y);
    return `${X} ${Y}`;
  };
  for (const ch of text) {
    const glyph = font.charToGlyph(ch);
    for (const c of glyph.path.commands) {
      if (c.type === 'M') d += `M${pt(c.x, c.y)}`;
      else if (c.type === 'L') d += `L${pt(c.x, c.y)}`;
      else if (c.type === 'C') d += `C${pt(c.x1, c.y1)} ${pt(c.x2, c.y2)} ${pt(c.x, c.y)}`;
      else if (c.type === 'Q') d += `Q${pt(c.x1, c.y1)} ${pt(c.x, c.y)}`;
      else if (c.type === 'Z') d += 'Z';
    }
    x += glyph.advanceWidth * scale;
  }
  const pad = 4;
  const vb = [x1 - pad, y1 - pad, x2 - x1 + pad * 2, y2 - y1 + pad * 2].map(f).join(' ');
  writeFileSync(
    `src/assets/script/${name}.svg`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" role="img" aria-label="${text}"><path fill="currentColor" d="${d}"/></svg>\n`,
  );
  console.log(name, vb);
}
