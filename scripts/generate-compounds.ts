import * as fs from "fs";
import * as path from "path";

/**
 * Generates src/lib/compounds.ts — per-character word-compound data for
 * single-char dictation ("生" → "生活的生").
 *
 * Data sources:
 * 1. scripts/data/xiandaihanyuchangyongcibiao.txt — 《现代汉语常用词表（草案）》
 *    (Ministry of Education; word frequency levels, 56008 words). Frequency
 *    level = commonness rank (smaller = more common). Used as the fallback
 *    common-word pool and as the canonical "is a real word" check.
 * 2. data/人教版小学语文/*.txt — the built-in Chinese char list. The
 *    meaning column of each entry is the textbook's own compound for the
 *    char ("月 | yuè | 月亮" → 月亮); these become the "already learned"
 *    pool, preferred over the common-word fallback.
 *
 * Output: src/lib/compounds.ts
 *   COMPOUNDS: char → [word, syllable-of-char-in-word][] sorted by frequency
 *   LEARNED:   char → textbook compounds, sorted by frequency
 *
 * Syllables come from the frequency list (tone digits, ü written as v, light
 * tone = no digit) and let runtime filter candidates by the headword's own
 * reading for polyphonic chars (长: 长期 cháng vs 增长 zhǎng).
 */

const DATA_DIR = path.resolve(import.meta.dirname, "../data");
const FREQ_FILE = path.resolve(
  import.meta.dirname,
  "data/xiandaihanyuchangyongcibiao.txt",
);
const OUTPUT_FILE = path.resolve(import.meta.dirname, "../src/lib/compounds.ts");

/** Entries per char in COMPOUNDS (frequency-ordered). */
const COMPOUNDS_PER_CHAR = 6;

const CJK2_RE = /^[\u4e00-\u9fff]{2}$/;

interface FreqWord {
  word: string;
  pinyin: string;
  level: number;
}

/** Parse "word\tpinyin\tlevel" lines. */
function parseFreqTable(text: string): FreqWord[] {
  const out: FreqWord[] = [];
  for (const line of text.split("\n")) {
    const [word, pinyin, level] = line.split("\t");
    if (!word || !pinyin || !level) continue;
    if (!CJK2_RE.test(word)) continue;
    out.push({ word, pinyin, level: Number(level) });
  }
  return out;
}

/** Split a textbook meaning cell into candidate senses ("月亮；月宫" → ["月亮", "月宫"]). */
function splitSenses(meaning: string): string[] {
  const out: string[] = [];
  for (const raw of meaning.split(/[；;]/)) {
    let text = raw
      .replace(/[（(][^（）()]*[）)]/g, "")
      .replace(/^[\s，,、。.：:；;]+|[\s，,、。.：:；;]+$/g, "")
      .trim();
    if (!text) continue;
    // Meaning cells may concatenate senses with commas; keep only the first
    // chunk (e.g. "天空、大地" → "天空") — shorter reads better aloud.
    text = text.split(/[，,、]/)[0] ?? text;
    text = text.replace(/^[\s，,、。.：:；;]+|[\s，,、。.：:；;]+$/g, "").trim();
    if (text) out.push(text);
  }
  return out;
}

/** Parse data/人教版小学语文/*.txt ("字 | 拼音 | 释义" lines) into textbook compounds. */
function collectLearned(): Map<string, [string, string][]> {
  const learned = new Map<string, [string, string][]>();
  const dirPath = path.join(DATA_DIR, "人教版小学语文");
  if (!fs.existsSync(dirPath)) return learned;

  for (const filename of fs.readdirSync(dirPath)) {
    if (!filename.endsWith(".txt")) continue;
    const content = fs.readFileSync(path.join(dirPath, filename), "utf-8");
    for (const line of content.split("\n")) {
      const parts = line.split("|").map((s) => s.trim());
      const head = parts[0];
      if (!head || head.length !== 1) continue;
      const meaning = parts[2];
      if (!meaning) continue;
      for (const sense of splitSenses(meaning)) {
        if (sense.length !== 2 || !sense.includes(head) || sense === head) continue;
        const list = learned.get(head) ?? [];
        list.push([sense, ""]); // syllable filled in later from freq table
        learned.set(head, list);
      }
    }
  }
  return learned;
}

// Frequency list file is pinyin-ordered; sort by level (stable: same-level
// ties keep the file's pinyin order).
const freqWords = parseFreqTable(fs.readFileSync(FREQ_FILE, "utf-8")).sort(
  (a, b) => a.level - b.level,
);
const freqLevel: Record<string, number> = {};
for (const w of freqWords) freqLevel[w.word] = w.level;

// Frequency-ordered index: char → [word, syllable][]
const byChar = new Map<string, [string, string][]>();
for (const w of freqWords) {
  for (let i = 0; i < w.word.length; i++) {
    const ch = w.word[i]!;
    const list = byChar.get(ch) ?? [];
    if (list.length < COMPOUNDS_PER_CHAR) {
      list.push([w.word, w.pinyin.split("'")[i] ?? ""]);
      byChar.set(ch, list);
    }
  }
}

// Textbook compounds, deduped, filtered to real words, frequency-ordered.
const learned = new Map<string, [string, string][]>();
for (const [head, senses] of collectLearned()) {
  const seen = new Set<string>();
  const list: [string, string][] = [];
  for (const [sense] of senses) {
    if (seen.has(sense)) continue;
    seen.add(sense);
    const level = freqLevel[sense];
    if (level === undefined) continue; // not a real word (e.g. "称对方")
    const wi = sense.indexOf(head);
    if (wi === -1) continue;
    const pinyin = freqWords.find((w) => w.word === sense)?.pinyin ?? "";
    list.push([sense, pinyin.split("'")[wi] ?? ""]);
  }
  list.sort((a, b) => freqLevel[a[0]]! - freqLevel[b[0]]!);
  if (list.length) learned.set(head, list);
}

const lines: string[] = [];
lines.push(`// Auto-generated by scripts/generate-compounds.ts`);
lines.push(`// DO NOT EDIT MANUALLY`);
lines.push(`//`);
lines.push(`// Word compounds for single-char dictation ("生" → "生活的生").`);
lines.push(`// Sources: 《现代汉语常用词表（草案）》(教育部) — common-word frequency;`);
lines.push(`// data/人教版小学语文 — textbook "already learned" compounds.`);
lines.push(`// [word, syllable-of-char]: syllable has tone digits, ü = v, light tone = no digit.`);
lines.push(``);
lines.push(`/** 字 → 常用组词（按常用词表频级升序）。 */`);
lines.push(`export const COMPOUNDS: Record<string, [word: string, syllable: string][]> = {`);
for (const [ch, list] of [...byChar.entries()].sort((a, b) => a[0].localeCompare(b[0], "zh"))) {
  lines.push(`  ${JSON.stringify(ch)}: [`);
  for (const [word, syllable] of list) {
    lines.push(`    [${JSON.stringify(word)}, ${JSON.stringify(syllable)}],`);
  }
  lines.push(`  ],`);
}
lines.push(`};`);
lines.push(``);
lines.push(`/** 字 → 教材已学组词（人教版小学语文释义列，按常用词表频级升序）。 */`);
lines.push(`export const LEARNED: Record<string, [word: string, syllable: string][]> = {`);
for (const [ch, list] of [...learned.entries()].sort((a, b) => a[0].localeCompare(b[0], "zh"))) {
  lines.push(`  ${JSON.stringify(ch)}: [`);
  for (const [word, syllable] of list) {
    lines.push(`    [${JSON.stringify(word)}, ${JSON.stringify(syllable)}],`);
  }
  lines.push(`  ],`);
}
lines.push(`};`);
lines.push(``);

fs.writeFileSync(OUTPUT_FILE, lines.join("\n"), "utf-8");

console.log(
  `Generated ${OUTPUT_FILE}: ${byChar.size} chars in COMPOUNDS, ${learned.size} chars in LEARNED (from ${freqWords.length} two-char freq words).`,
);
