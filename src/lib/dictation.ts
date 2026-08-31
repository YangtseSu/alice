import { COMPOUNDS, LEARNED } from "./compounds";

/**
 * Split multiline word-list input into entries (one per non-empty line).
 */
export function parseWords(text: string): string[] {
  return text
    .split(/[\n\r]+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 0);
}

export interface WordEntry {
  /** 单词/词组（可能含 = 展开语法） */
  word: string;
  /** 词性，如 "n." "v." "adj." */
  pos?: string;
  /** 中文释义 */
  meaning?: string;
}

/** 词性前缀（ECDICT 与用户词表通用），如 "n." "vt." "adj."。 */
export const POS_PREFIX_RE =
  /^(n\.|v\.|vt\.|vi\.|adj\.|adv\.|prep\.|conj\.|pron\.|num\.|art\.|int\.|aux\.|abbr\.|contr\.|a\.)\s*/i;

const PIPE = "|";
const FULLWIDTH_PIPE = "｜";

/**
 * Parse a single line into a structured entry.
 *
 * Format: `word | pos | meaning` (pipe-separated). Only `word` is required;
 * `pos` and `meaning` are optional. A line with no pipe is just a word.
 */
export function parseWordLine(line: string): WordEntry {
  const trimmed = line.trim();
  if (!trimmed) return { word: "" };

  const parts = trimmed.split(new RegExp(`[${PIPE}${FULLWIDTH_PIPE}]`));
  const word = parts[0]?.trim() ?? "";
  const pos = parts[1]?.trim() || undefined;
  const meaning = parts[2]?.trim() || undefined;

  return { word, pos, meaning };
}

/**
 * Parse multiline text into structured entries.
 */
export function parseWordEntries(text: string): WordEntry[] {
  return parseWords(text).map(parseWordLine);
}

/**
 * Serialize a WordEntry back to a line string.
 */
export function entryToLine(entry: WordEntry): string {
  const { word, pos, meaning } = entry;
  if (!pos && !meaning) return word;
  return [word, pos ?? "", meaning ?? ""].join(` ${PIPE} `);
}

/**
 * Text to speak for a list entry.
 *
 * - Strips `|`-delimited pos/meaning suffix (TTS must not read them).
 * - Supports expansion-style entries like `you're = you are`: speak the left
 *   side (`you're`), while the full line remains the display/answer text.
 */
export function speakTextFromEntry(entry: string): string {
  let text = entry.trim();
  if (!text) return "";

  // Strip pos/meaning after the pipe delimiter
  const pipe = text.indexOf(PIPE);
  if (pipe !== -1) text = text.slice(0, pipe).trim();
  if (!text) return "";

  const eq = text.search(/[=＝]/);
  if (eq === -1) return text;

  const left = text.slice(0, eq).trim();
  return left || text;
}

const CJK_RE = /[\u4e00-\u9fff]/;

/**
 * True when the speakable headword is Chinese (汉字/词语听写): playback then
 * speaks zh-CN and the reveal shows pinyin-based hints instead of English
 * spelling/grammar hints.
 */
export function isCjkEntry(entry: string): boolean {
  return CJK_RE.test(speakTextFromEntry(entry));
}

/** 虚词/助词字读 "X的X" 很别扭，直接读单字。 */
const NO_COMPOUND_HEADS = new Set([
  "的",
  "地",
  "得",
  "着",
  "了",
  "吗",
  "呢",
  "吧",
  "啊",
  "呀",
  "啦",
  "嘛",
  "么",
]);

/** 带调拼音字母 → 无调字母 + 调号数字："yuè" → "yue4"；ü → v（与常用词表一致）。 */
const TONE_DIGIT: Record<string, string> = {
  ā: "a1", á: "a2", ǎ: "a3", à: "a4",
  ē: "e1", é: "e2", ě: "e3", è: "e4",
  ī: "i1", í: "i2", ǐ: "i3", ì: "i4",
  ō: "o1", ó: "o2", ǒ: "o3", ò: "o4",
  ū: "u1", ú: "u2", ǔ: "u3", ù: "u4",
  ǖ: "v1", ǘ: "v2", ǚ: "v3", ǜ: "v4",
};

/** 带调拼音转数字调形式（无声调输入原样返回）。 */
function toneToDigit(pinyin: string): string {
  let out = "";
  let tone = "";
  for (const ch of pinyin.trim().toLowerCase()) {
    const t = TONE_DIGIT[ch];
    if (t) {
      out += t[0];
      tone = t[1]!;
    } else {
      out += ch;
    }
  }
  return out + tone;
}

/**
 * 组词候选的读音是否可用：条目带调拼音与词中该字音节（数字调）须一致；
 * 任一方无调（轻声或未标注）时放行（如 "头" tóu vs "石头" shí·tou）。
 */
function syllableMatches(headPinyin: string, syllable: string): boolean {
  if (!headPinyin || !syllable) return true;
  if (syllable === headPinyin) return true;
  return !/\d$/.test(syllable) || !/\d$/.test(headPinyin);
}

/**
 * 中文单字的组词朗读文本（传统听写模式）："月 | yuè | 月亮" → "月亮的月"。
 *
 * - 仅单字条目有效；词语/短句返回 ""（只读词语本身）；
 * - 候选按「已学词 > 常用词」两级选取，已学词内按常用词表频级排序：
 *   1. 释义列义项（教学同步，如 "月亮"）；
 *   2. 当前词表其他词 + 内置教材词表（人教版小学语文）释义；
 *   3. 现代汉语常用词表兜底（如手动输入 "生" → "生活的生"）。
 * - 条目带拼音时，候选按该字在词中的读音过滤（多音字："长 | cháng" →
 *   "长期" 而非 "增长"）；轻声或不带调的候选放行。
 * - 虚词/助词（的、了、吗…）不组词。
 */
export function cjkWordSpeech(
  entry: string,
  learnedWords: Iterable<string> = [],
): string {
  const head = speakTextFromEntry(entry);
  if ([...head].length !== 1 || !CJK_RE.test(head)) return "";
  if (NO_COMPOUND_HEADS.has(head)) return "";

  const parsed = parseWordLine(entry);
  const headPinyin = parsed.pos ? toneToDigit(parsed.pos) : "";

  // 候选 1：释义列义项（教学释义，不按读音过滤）。义项按「；」与「，、」拆分，
  // 使 "出生、生长、生活" 的每个词都参与频级排序（"生活" 胜出）。
  const fromMeaning: [string, string][] = [];
  for (const raw of (parsed.meaning ?? "").split(SENSE_SPLIT_RE)) {
    for (const chunk of raw.split(GLOSS_SPLIT_RE)) {
      const word = chunk
        .replace(MEANING_PAREN_RE, "")
        .replace(MEANING_EDGE_PUNCT_RE, "");
      if (word.length !== 2 || word === head || !word.includes(head)) continue;
      if (!fromMeaning.some(([w]) => w === word)) fromMeaning.push([word, ""]);
    }
  }

  // 候选 2：已学词 —— 当前词表其他词 + 内置教材词表。
  const fromLearned: [string, string][] = [];
  const seen = new Set<string>();
  for (const line of learnedWords) {
    const word = speakTextFromEntry(line);
    if (word.length !== 2 || word === head || !word.includes(head)) continue;
    if (seen.has(word)) continue;
    seen.add(word);
    fromLearned.push([word, ""]);
  }
  for (const [word, syllable] of LEARNED[head] ?? []) {
    if (seen.has(word)) continue;
    seen.add(word);
    if (syllableMatches(headPinyin, syllable)) fromLearned.push([word, syllable]);
  }

  // 候选 3：常用词表兜底。
  const fromCommon = (COMPOUNDS[head] ?? []).filter(([, syllable]) =>
    syllableMatches(headPinyin, syllable),
  );

  // 已学词整体优先；其内部按常用词表频级排序，未收录的词按出现顺序排后。
  const rank = new Map<string, number>();
  fromCommon.forEach(([word], i) => rank.set(word, i));
  const learned = [...fromMeaning, ...fromLearned].sort(
    (a, b) => (rank.get(a[0]) ?? rank.size) - (rank.get(b[0]) ?? rank.size),
  );
  const picked = learned.find(([word]) => word) ?? fromCommon[0];
  if (!picked) return "";
  return `${picked[0]}的${head}`;
}

const SENSE_SPLIT_RE = /[；;]/;
const GLOSS_SPLIT_RE = /[，,、]/;
const MEANING_PAREN_RE = /[（(][^（）()]*[）)]/g;
const MEANING_EDGE_PUNCT_RE = /^[\s，,、。.：:；;]+|[\s，,、。.：:；;]+$/g;
/** 朗读释义的长度上限（视觉宽度，全角 1、半角 0.5），超过则截取首个词条。 */
const SPEAK_MEANING_MAX_WIDTH = 12;

/** 全角记 1 字宽、半角记 0.5（与 dictionary.ts 的 sensesClamped 同一口径）。 */
function meaningWidth(text: string): number {
  let width = 0;
  for (const ch of text) width += ch.charCodeAt(0) > 0x2e7f ? 1 : 0.5;
  return width;
}

/**
 * 朗读用的中文释义。与释义展示不同，TTS 只需要最核心的一个意思：
 *
 * - 去掉词性前缀（"n." "vt." 等会被 TTS 逐字念出）；
 * - 多义项（「；」分隔，构建脚本与 enrichWordListText 保证）只取第一个非空义项；
 * - 括号补注（缩写的英文全称等）不朗读；
 * - 首义项仍超长时（同义词枚举）截取首个词条。
 *
 * 返回空串表示没有可朗读的内容（如整个释义只有词性标记）。
 */
export function speakableMeaning(meaning: string | undefined): string {
  if (!meaning) return "";
  for (const raw of meaning.split(SENSE_SPLIT_RE)) {
    let text = raw.trim();
    const pos = text.match(POS_PREFIX_RE);
    if (pos) text = text.slice(pos[0].length).trim();
    text = text.replace(MEANING_PAREN_RE, "").trim();
    text = text.replace(MEANING_EDGE_PUNCT_RE, "");
    if (!text) continue;

    if (meaningWidth(text) > SPEAK_MEANING_MAX_WIDTH) {
      text = text.split(GLOSS_SPLIT_RE)[0] ?? text;
      text = text.replace(MEANING_EDGE_PUNCT_RE, "");
      if (!text) continue;
    }
    return text;
  }
  return "";
}

