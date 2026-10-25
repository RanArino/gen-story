// Writes minimal, deterministic TrueType fonts whose glyphs are boxes. They exercise the Font
// Asset lifecycle (coverage, truncation, collisions, scope) with bytes the spike authored itself,
// so tests never depend on third-party font files. They are not meant to look good.

export interface FixtureFontSpec {
  family: string;
  postscriptName: string;
  codepoints: number[];
  advance: number; // font units at 1000 units per em
  weight: number;
}

const UNITS_PER_EM = 1000;
const ASCENDER = 880;
const DESCENDER = -120;

class Writer {
  private bytes: number[] = [];
  u8(v: number): this {
    this.bytes.push(v & 0xff);
    return this;
  }
  u16(v: number): this {
    return this.u8(v >> 8).u8(v);
  }
  i16(v: number): this {
    return this.u16(v < 0 ? v + 0x10000 : v);
  }
  u32(v: number): this {
    return this.u16(Math.floor(v / 0x10000) & 0xffff).u16(v & 0xffff);
  }
  raw(data: Uint8Array | number[]): this {
    for (const b of data) this.bytes.push(b);
    return this;
  }
  zeros(n: number): this {
    for (let i = 0; i < n; i += 1) this.bytes.push(0);
    return this;
  }
  done(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

function checksum(data: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    const word = ((data[i] ?? 0) << 24) | ((data[i + 1] ?? 0) << 16) | ((data[i + 2] ?? 0) << 8) | (data[i + 3] ?? 0);
    sum = (sum + (word >>> 0)) >>> 0;
  }
  return sum;
}

function boxGlyph(x0: number, x1: number): Uint8Array {
  const y0 = -50;
  const y1 = 750;
  const w = new Writer().i16(1).i16(x0).i16(y0).i16(x1).i16(y1);
  w.u16(3).u16(0); // endPtsOfContours, instructionLength
  w.u8(1).u8(1).u8(1).u8(1); // four on-curve points with full-size coordinates
  for (const dx of [x0, 0, x1 - x0, 0]) w.i16(dx);
  for (const dy of [y0, y1 - y0, 0, y0 - y1]) w.i16(dy);
  w.zeros(2); // pad 34 bytes to 36
  return w.done();
}

function cmapTable(codepoints: number[], glyphFor: (cp: number) => number): Uint8Array {
  const segments: { start: number; end: number }[] = [];
  for (const cp of codepoints) {
    const last = segments.at(-1);
    if (last && cp === last.end + 1) last.end = cp;
    else segments.push({ start: cp, end: cp });
  }
  const segCount = segments.length + 1; // plus the 0xFFFF terminator
  const entrySelector = Math.floor(Math.log2(segCount));
  const searchRange = 2 * 2 ** entrySelector;
  const glyphIds: number[] = [];
  const rangeOffsets: number[] = [];
  segments.forEach((s, i) => {
    rangeOffsets.push(2 * (segCount - i + glyphIds.length));
    for (let cp = s.start; cp <= s.end; cp += 1) glyphIds.push(glyphFor(cp));
  });
  const length = 16 + segCount * 8 + glyphIds.length * 2;
  const sub = new Writer().u16(4).u16(length).u16(0).u16(segCount * 2).u16(searchRange).u16(entrySelector).u16(segCount * 2 - searchRange);
  for (const s of segments) sub.u16(s.end);
  sub.u16(0xffff).u16(0);
  for (const s of segments) sub.u16(s.start);
  sub.u16(0xffff);
  for (let i = 0; i < segments.length; i += 1) sub.u16(0);
  sub.u16(1);
  for (const off of rangeOffsets) sub.u16(off);
  sub.u16(0);
  for (const g of glyphIds) sub.u16(g);
  return new Writer().u16(0).u16(2).u16(0).u16(3).u32(20).u16(3).u16(1).u32(20).raw(sub.done()).done();
}

function nameTable(spec: FixtureFontSpec): Uint8Array {
  const names: [number, string][] = [
    [1, spec.family],
    [2, "Regular"],
    [3, `${spec.postscriptName};1.000;FILM-SPIKE`],
    [4, `${spec.family} Regular`],
    [5, "Version 1.000"],
    [6, spec.postscriptName],
  ];
  const strings = names.map(([, s]) => {
    const w = new Writer();
    for (const ch of s) w.u16(ch.charCodeAt(0));
    return w.done();
  });
  const w = new Writer().u16(0).u16(names.length).u16(6 + names.length * 12);
  let offset = 0;
  names.forEach(([id], i) => {
    w.u16(3).u16(1).u16(0x409).u16(id).u16(strings[i]!.length).u16(offset);
    offset += strings[i]!.length;
  });
  for (const s of strings) w.raw(s);
  return w.done();
}

export function buildFixtureFont(spec: FixtureFontSpec): Uint8Array {
  const codepoints = [...new Set(spec.codepoints)].filter((cp) => cp > 0 && cp < 0xffff).sort((a, b) => a - b);
  const isSpace = (cp: number) => cp === 0x20 || cp === 0x3000;
  const glyphFor = (cp: number) => (isSpace(cp) ? 2 : 1);
  const numGlyphs = 3; // .notdef, box, space
  const inset = Math.round(spec.advance * 0.1);
  const box = boxGlyph(inset, spec.advance - inset);

  const head = new Writer()
    .u32(0x00010000).u32(0x00010000).u32(0).u32(0x5f0f3cf5).u16(0x000b).u16(UNITS_PER_EM)
    .zeros(16) // created, modified
    .i16(0).i16(-50).i16(spec.advance).i16(750)
    .u16(0).u16(8).i16(2).i16(1).i16(0)
    .done();
  const hhea = new Writer()
    .u32(0x00010000).i16(ASCENDER).i16(DESCENDER).i16(0).u16(spec.advance).i16(0).i16(inset).i16(spec.advance - inset)
    .i16(1).i16(0).i16(0).zeros(8).i16(0).u16(numGlyphs)
    .done();
  const hmtx = new Writer().u16(spec.advance).i16(0).u16(spec.advance).i16(inset).u16(spec.advance).i16(0).done();
  const maxp = new Writer().u32(0x00010000).u16(numGlyphs).u16(4).u16(1).zeros(22).done();
  const glyf = box;
  const loca = new Writer().u32(0).u32(0).u32(box.length).u32(box.length).done();
  const os2 = new Writer()
    .u16(4).i16(spec.advance).u16(spec.weight).u16(5).u16(0)
    .i16(650).i16(600).i16(0).i16(75).i16(650).i16(600).i16(0).i16(350).i16(50).i16(300)
    .i16(0).zeros(10).zeros(16)
    .raw([..."NONE"].map((c) => c.charCodeAt(0)))
    .u16(0x0040).u16(codepoints[0] ?? 0x20).u16(codepoints.at(-1) ?? 0x20)
    .i16(ASCENDER).i16(DESCENDER).i16(0).u16(ASCENDER).u16(-DESCENDER)
    .u32(1).u32(0).i16(500).i16(700).u16(0).u16(0x20).u16(0)
    .done();
  const post = new Writer().u32(0x00030000).u32(0).i16(-100).i16(50).u32(0).zeros(16).done();

  const tables: [string, Uint8Array][] = (
    [
      ["OS/2", os2],
      ["cmap", cmapTable(codepoints, glyphFor)],
      ["glyf", glyf],
      ["head", head],
      ["hhea", hhea],
      ["hmtx", hmtx],
      ["loca", loca],
      ["maxp", maxp],
      ["name", nameTable(spec)],
      ["post", post],
    ] as [string, Uint8Array][]
  ).sort(([a], [b]) => (a < b ? -1 : 1));

  const entrySelector = Math.floor(Math.log2(tables.length));
  const searchRange = 16 * 2 ** entrySelector;
  const header = new Writer().u32(0x00010000).u16(tables.length).u16(searchRange).u16(entrySelector).u16(tables.length * 16 - searchRange);
  let offset = 12 + tables.length * 16;
  const body = new Writer();
  const records = new Writer();
  let headOffset = 0;
  for (const [tag, data] of tables) {
    const padded = new Uint8Array(Math.ceil(data.length / 4) * 4);
    padded.set(data);
    if (tag === "head") headOffset = offset;
    records.raw([...tag].map((c) => c.charCodeAt(0))).u32(checksum(padded)).u32(offset).u32(data.length);
    body.raw(padded);
    offset += padded.length;
  }
  const font = new Writer().raw(header.done()).raw(records.done()).raw(body.done()).done();
  const adjustment = (0xb1b0afba - checksum(font)) >>> 0;
  new DataView(font.buffer).setUint32(headOffset + 8, adjustment);
  return font;
}
