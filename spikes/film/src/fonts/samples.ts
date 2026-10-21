// The fixed Japanese sample set every Japanese-claiming Font Asset must cover, in addition to
// the glyphs of the fixture captions and titles: 46 hiragana, 46 katakana, and 108 common kanji.
export const JA_SAMPLE_SET_ID = "ja-common-200@1";

const HIRAGANA = "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん";
const KATAKANA = "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン";
const KANJI =
  "一右雨円王音下火花貝学気九休玉金空月犬見五口校左三山子四糸字耳七車手十出女小上森人水正生青夕石赤千川先早草足村大男竹中虫町天田土二日入年白八百文木本名目立力林六" +
  "引羽雲園遠何科夏家歌画回会海絵外角楽活間丸岩顔汽記帰弓牛";

export const JA_SAMPLE_SET: readonly string[] = [...HIRAGANA, ...KATAKANA, ...KANJI];

export const LATIN_SAMPLE_SET: readonly string[] = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"];

/** Characters that need a glyph: everything except whitespace and line breaks. */
export function glyphChars(text: string): string[] {
  return [...new Set([...text].filter((c) => !/\s/u.test(c)))];
}
