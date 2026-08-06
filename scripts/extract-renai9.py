#!/usr/bin/env python3
"""
Extract word list from 仁爱版九年级上册 单词表 PDF using pdfplumber.

The PDF uses a two-column, multi-line layout per entry:
    word  /ipa/ ; /ipa_AmE/  pos. 中文释义；中文释义续
          （音标续行、词性符、标点、页码 (NN) 常排到第二行）
We therefore reconstruct entries by detecting headword anchors (English words
flush-left in each column) and collecting all subsequent characters until the
next headword (or column boundary).
"""
from __future__ import annotations
import os
import re
import sys
from collections import OrderedDict

try:
    import pdfplumber
except ImportError:
    sys.stderr.write("pdfplumber is required. Install with: pip3 install pdfplumber\n")
    sys.exit(1)


# ---------- character normalisation ----------
def fw2hw(ch: str) -> str:
    cp = ord(ch)
    if ch == "　":
        return " "
    if 0xFF01 <= cp <= 0xFF5E:
        return chr(cp - 0xFEE0)
    mapping = {
        "／": "/", "；": ";", "，": ",", "：": ":", "（": "(", "）": ")",
        "．": ".", "＇": "'", "－": "-", "～": "~", "！": "!", "？": "?",
        "＊": "*", "＆": "&", "％": "%", "＠": "@", "＃": "#", "Ｘ": "X",
    }
    if ch in mapping:
        return mapping[ch]
    if ch in ("∗",):
        return ""
    if ch in ("⁃", "▪", "􀱻", "􀱺", "􀱷", "􀍰"):
        return "-"
    return ch


def _is_cjk(ch: str) -> bool:
    cp = ord(ch)
    return (
        0x4E00 <= cp <= 0x9FFF or   # CJK Unified
        0x3400 <= cp <= 0x4DBF or   # CJK Ext A
        0x3000 <= cp <= 0x303F or   # CJK punctuation
        0xFF00 <= cp <= 0xFFEF      # Halfwidth/Fullwidth
    )


def _is_latin_or_digit(ch: str) -> bool:
    return ch.isascii() and (ch.isalnum() or ch in "'.-")


def norm(s: str) -> str:
    s = "".join(fw2hw(c) for c in s)
    # Insert spaces between CJK and Latin/digit runs so that "adv现今" splits
    # into "adv 现今", "n.治疗" into "n. 治疗", "开心a" into "开心 a", etc.
    out = []
    for i, ch in enumerate(s):
        if i > 0:
            prev = s[i - 1]
            if _is_cjk(ch) and _is_latin_or_digit(prev):
                out.append(" ")
            elif _is_cjk(prev) and _is_latin_or_digit(ch):
                out.append(" ")
        out.append(ch)
    return "".join(out)


# ---------- column split ----------
def detect_mid_x(chars, page_width: float) -> float:
    xs = sorted(c["x0"] for c in chars if c.get("text", "").strip())
    if not xs:
        return page_width / 2
    lo, hi = page_width * 0.25, page_width * 0.75
    mid_xs = [x for x in xs if lo <= x <= hi]
    if len(mid_xs) < 2:
        return page_width / 2
    mid_xs.sort()
    max_gap = 0
    best = (mid_xs[0] + mid_xs[-1]) / 2
    for a, b in zip(mid_xs, mid_xs[1:]):
        if b - a > max_gap:
            max_gap = b - a
            best = (a + b) / 2
    return best


# ---------- entry block reconstruction ----------
def build_entry_blobs(chars) -> list[str]:
    """Given a list of word-like dicts (with text/x0/x1/top/bottom) already
    filtered to one column, produce per-entry text blobs.
    Each blob looks like:  word /ipa/ ; /ipaAmE/ (notes) pos. 释义 ; 释义 (NN)

    Because the PDF places IPA/pos/meaning one line *above* the bold headword,
    we assign every word to the nearest following headword (by top) within a
    small vertical window. Section headings (e.g. "Preparing for the Topic") and
    "Unit N" markers are detected as contiguous left-edge words and excluded.
    """
    if not chars:
        return []

    words = sorted(chars, key=lambda c: (c["top"], c["x0"]))
    N = len(words)
    min_x0 = min(w["x0"] for w in words if w.get("text", "").strip())
    LEFT_TOL = 12
    ABOVE_WINDOW = 30  # pts: how far above a headword its IPA/meaning can reach

    # 1) Find all left-edge English word candidates (headings and real headwords).
    cand_idx: list[int] = []
    for i, w in enumerate(words):
        txt = norm(w["text"]).strip()
        if not txt:
            continue
        if w["x0"] > min_x0 + LEFT_TOL:
            continue
        if not re.match(r"^[A-Za-z\*][A-Za-z0-9'.\-]*$", txt):
            continue
        if len(txt) == 1 and not txt.isalpha():
            continue
        if len(txt) == 1 and txt.lower() not in {"i", "a"}:
            continue
        cand_idx.append(i)

    # 2) Mark section-title words and "Unit N" words so they are excluded from
    # entries (except "Unit N" which we keep as a special marker blob).
    # A section title is a cluster of consecutive candidates (in reading order
    # by top) that sit on almost the same top (within 4pt) whose concatenated
    # lowered text matches a known heading.
    exclude: set[int] = set()
    unit_markers: list[tuple[float, str]] = []  # (top, "Unit N")
    KNOWN_TITLES = [
        "words in each unit",
        "preparing for the topic", "exploring for the topic",
        "developing for the topic", "wrapping for the topic",
        "preparing forthe topic", "exploring forthe topic",
        "developing forthe topic", "wrapping forthe topic",
    ]
    HEADING_WORDS = {"preparing", "exploring", "developing", "wrapping",
                     "words", "topic", "in", "each", "for", "the"}
    # cluster candidates by top proximity (same line)
    clusters: list[list[int]] = []
    for idx in cand_idx:
        if not clusters:
            clusters.append([idx])
            continue
        last_cluster = clusters[-1]
        last_top = words[last_cluster[-1]]["top"]
        if abs(words[idx]["top"] - last_top) <= 4:
            last_cluster.append(idx)
        else:
            clusters.append([idx])
    # Extend clusters: a "unit" cluster may absorb a following digit word even
    # if the digit wasn't a candidate (digits are filtered from cand_idx but
    # still exist in the words list right after "Unit").
    expanded_clusters: list[list[int]] = []
    for cluster in clusters:
        cluster = list(cluster)
        txt0 = norm(words[cluster[0]]["text"]).lower()
        if txt0 == "unit" and cluster[-1] + 1 < len(words):
            next_w = words[cluster[-1] + 1]
            next_txt = norm(next_w["text"]).strip()
            if (re.fullmatch(r"\d{1,2}", next_txt)
                    and abs(next_w["top"] - words[cluster[-1]]["top"]) <= 4):
                cluster.append(cluster[-1] + 1)
        expanded_clusters.append(cluster)
    clusters = expanded_clusters

    for cluster in clusters:
        txt = " ".join(norm(words[i]["text"]).lower() for i in cluster)
        txt_compact = re.sub(r"\s+", " ", txt).strip()
        is_title = False
        is_unit = False
        if re.match(r"^unit\s+\d+$", txt_compact):
            is_title = True
            is_unit = True
        else:
            for kt in KNOWN_TITLES:
                if txt_compact == kt or txt_compact.startswith(kt):
                    is_title = True
                    break
        if txt_compact in HEADING_WORDS:
            is_title = True
        if is_title:
            for i in cluster:
                exclude.add(i)
            if is_unit:
                unit_no = re.search(r"(\d+)", txt_compact).group(1)
                avg_top = sum(words[i]["top"] for i in cluster) / len(cluster)
                unit_markers.append((avg_top, unit_no))

    # 3) Real headwords = candidates not excluded, sorted top-ascending.
    head_idx = sorted([i for i in cand_idx if i not in exclude],
                      key=lambda x: words[x]["top"])
    if not head_idx:
        return []
    # Compute mid-points between consecutive headwords (by top); these define
    # the vertical boundary for assigning words to headwords. A word at top t
    # belongs to headword h_i if m_{i-1} <= t < m_i, where m_i is the midpoint
    # between h_i.top and h_{i+1}.top.
    hw_tops = [words[hi]["top"] for hi in head_idx]
    boundaries: list[float] = []
    for a, b in zip(hw_tops, hw_tops[1:]):
        boundaries.append((a + b) / 2.0)

    def assign_hw(top: float) -> int | None:
        # binary search-like linear (small list)
        for i, b in enumerate(boundaries):
            if top < b:
                return head_idx[i]
        return head_idx[-1]

    # 4) Assign every non-excluded word to the headword whose vertical region
    # contains it. Also enforce a maximum distance to avoid pulling in faraway
    # page-header/footer content.
    BELOW_WINDOW = 35  # pts below a headword where its meaning can still extend
    blocks: dict[int, list[dict]] = {hi: [] for hi in head_idx}
    for i, w in enumerate(words):
        if i in exclude:
            continue
        txt = norm(w["text"]).strip()
        if not txt:
            continue
        if re.fullmatch(r"\d{1,3}", txt):
            continue
        hi = assign_hw(w["top"])
        if hi is None:
            continue
        ht = words[hi]["top"]
        if w["top"] < ht - ABOVE_WINDOW:
            continue
        if w["top"] > ht + BELOW_WINDOW:
            continue
        blocks[hi].append(w)

    # 5) Serialize each block. Group words into logical lines (top within 3pt),
    # then order lines as: the headword's line first (with hw word first within
    # that line), then lines above hw (superscript IPA), then lines below hw
    # (meaning). Within each line words are ordered by x0.
    blobs_with_top: list[tuple[float, str]] = []
    for hi in sorted(blocks.keys(), key=lambda x: words[x]["top"]):
        bw = blocks[hi]
        hw_word = words[hi]
        # Group into lines (single-linkage clustering by top proximity)
        line_groups: list[list[dict]] = []
        for w in sorted(bw, key=lambda c: c["top"]):
            placed = False
            for grp in line_groups:
                if abs(w["top"] - grp[0]["top"]) <= 3:
                    grp.append(w)
                    placed = True
                    break
            if not placed:
                line_groups.append([w])
        # Compute a representative top for each line
        line_info = []
        for grp in line_groups:
            avg_top = sum(c["top"] for c in grp) / len(grp)
            line_info.append((avg_top, grp))
        line_info.sort(key=lambda x: x[0])
        hw_line_idx = None
        for idx, (lt, grp) in enumerate(line_info):
            if any(w is hw_word for w in grp):
                hw_line_idx = idx
                break
        if hw_line_idx is None:
            ordered_words = [hw_word] + sorted(bw, key=lambda c: (c["top"], c["x0"]))
        else:
            ordered_words: list[dict] = []
            # hw line first, with hw_word at its head, then by x0
            hw_grp = list(line_info[hw_line_idx][1])
            hw_grp.sort(key=lambda c: (c is not hw_word, c["x0"]))
            ordered_words.extend(hw_grp)
            # then lines above hw (superscripts), closest to hw first
            for lt, grp in sorted(line_info[:hw_line_idx], key=lambda x: -x[0]):
                g = sorted(grp, key=lambda c: c["x0"])
                ordered_words.extend(g)
            # then lines below hw (meaning), top-ascending
            for lt, grp in line_info[hw_line_idx + 1:]:
                g = sorted(grp, key=lambda c: c["x0"])
                ordered_words.extend(g)
        blob = join_words_to_string(ordered_words, reorder=False)
        blob = norm(blob).strip()
        blob = re.sub(r"^Unit\s+\d+\s*", "", blob, flags=re.IGNORECASE)
        blob = re.sub(
            r"^(preparing|exploring|developing|wrapping)\s*(for)?\s*(the)?\s*(topic)?\s*",
            "", blob, flags=re.IGNORECASE,
        )
        if blob:
            blobs_with_top.append((hw_word["top"], blob))

    # Inject unit markers at the correct vertical positions.
    for utop, uno in unit_markers:
        blobs_with_top.append((utop - 0.5, f"Unit {uno}"))
    blobs_with_top.sort(key=lambda x: x[0])
    return [b for _, b in blobs_with_top]


def group_into_words(chars) -> list[dict]:
    """Group chars into words (similar to pdfplumber.extract_words logic)."""
    # We reuse pdfplumber's logic indirectly by calling extract_words with
    # explicit tolerances, but we need to operate on the subset of chars we've
    # already filtered to one column; pdfplumber doesn't expose that directly,
    # so implement a tiny version ourselves.
    X_TOL = 2.0
    Y_TOL = 3.0
    chars = sorted(chars, key=lambda c: (round(c["top"] / Y_TOL), c["x0"]))
    words: list[dict] = []
    cur: list = []
    cur_top = None
    cur_x1 = None
    for c in chars:
        txt = c.get("text", "")
        if not txt:
            continue
        top0 = c["top"]
        new_line = False
        if cur_top is None:
            new_line = True
        else:
            if abs(top0 - cur_top) > Y_TOL:
                new_line = True
            elif cur_x1 is not None and c["x0"] - cur_x1 > X_TOL + c.get("size", 10) * 0.3:
                new_line = True
        if new_line and cur:
            words.append(_make_word(cur))
            cur = []
            cur_top = None
            cur_x1 = None
        cur.append(c)
        if cur_top is None:
            cur_top = top0
        else:
            cur_top = (cur_top + top0) / 2
        cur_x1 = c.get("x1", c["x0"] + 5)
    if cur:
        words.append(_make_word(cur))
    return words


def _make_word(chars) -> dict:
    text = "".join(c["text"] for c in chars)
    return {
        "text": text,
        "x0": min(c["x0"] for c in chars),
        "x1": max(c.get("x1", c["x0"]) for c in chars),
        "top": min(c["top"] for c in chars),
        "bottom": max(c.get("bottom", c["top"]) for c in chars),
    }


def join_words_to_string(words, reorder=True) -> str:
    """Join word objects with spaces where x-gap is large.
    If reorder=True (default, legacy behaviour), words are sorted by
    (round(top/2), x0). Otherwise the caller-supplied order is preserved.
    """
    pieces: list[str] = []
    last_x1 = None
    last_top = None
    seq = sorted(words, key=lambda c: (round(c["top"] / 2.0), c["x0"])) if reorder else words
    for w in seq:
        if last_x1 is None:
            pieces.append(w["text"])
        else:
            dx = w["x0"] - last_x1
            same_line = last_top is not None and abs(w["top"] - last_top) <= 3
            if dx > 3 or not same_line:
                pieces.append(" ")
            pieces.append(w["text"])
        last_x1 = w["x1"]
        last_top = w["top"]
    return "".join(pieces)


# ---------- entry blob parsing ----------
# Phonetic block: starts with '/', ends at a '/' that is not inside parentheses;
# may contain multiple "/" segments separated by "; / ... /" for AmE alt.
PHONETIC_BLOCK_RE = re.compile(
    r"/\s*[^/()]*?(?:\([^)]*\)[^/()]*?)*?\s*/(?:\s*;\s*/\s*[^/()]*?(?:\([^)]*\)[^/()]*?)*?\s*/)*"
)

PAGE_END_RE = re.compile(r"\s*\((\d{1,3})\)\s*$")

POS_TAGS = [
    "ordinal num",
    "aux",
    "abbr",
    "contr",
    "excl",
    "det",
    "prep",
    "conj",
    "pron",
    "num",
    "art",
    "int",
    "adj",
    "adv",
    "vt",
    "vi",
    "n",
    "v",
]
POS_GROUP_RE = re.compile(
    r"(?:(?:" + "|".join(POS_TAGS) + r")\.\s*,?\s*)+"
)

# Regex to find the end of a "headword" — the headword starts at the beginning
# of the blob (possibly after asterisk) and ends just before the first '/'. But
# the headword might itself contain a parenthesised expansion like:
#   "AI (artificial intelligence) /.../"
#   "goodbye (bye /baI/) /.../"    ← note the '/' inside the parenthesised note!
#   "wolf (pl. wolves /wUlvz/) /.../"
# So we cannot simply stop at the first '/'; we need to skip slashes inside
# parentheses that immediately follow the headword.


def split_headword_and_phonetic(blob: str) -> tuple[str, str] | None:
    """Return (headword, rest_starting_with_slash) or None.
    The headword consists of leading Latin letters/digits/apostrophes/dots/
    hyphens/asterisks/spaces, plus any balanced-parenthesised expansions
    (which may themselves contain '/'). Between the headword and the real
    phonetic '/' there may be stray IPA glyphs (e.g. ˈʒəː;) that come from
    a bold duplicate rendering on the same line; we skip those.
    """
    blob = blob.strip()
    i = 0
    # Skip leading asterisk
    if i < len(blob) and blob[i] == "*":
        i += 1
    # Collect headword: letters, digits, ' . -, *, spaces, and balanced parens
    # (parens may contain any character including '/').
    HW_CHARS = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.-* ")
    depth = 0
    while i < len(blob):
        ch = blob[i]
        if ch == "(":
            depth += 1
            i += 1
            continue
        if ch == ")":
            if depth > 0:
                depth -= 1
                i += 1
                continue
            else:
                break
        if depth > 0:
            i += 1
            continue
        if ch in HW_CHARS:
            i += 1
            continue
        # Any other character ends the headword.
        break
    word = blob[:i].strip().lstrip("*").strip()
    # Now skip anything until we hit a top-level '/'
    depth = 0
    j = i
    while j < len(blob):
        ch = blob[j]
        if ch == "(":
            depth += 1
        elif ch == ")":
            if depth > 0:
                depth -= 1
        elif ch == "/" and depth == 0:
            break
        j += 1
    if j >= len(blob) or blob[j] != "/":
        return None
    rest = blob[j:]  # starts with '/'
    return word, rest


def consume_phonetic(text: str) -> tuple[str, str] | None:
    m = PHONETIC_BLOCK_RE.match(text)
    if not m:
        return None
    return m.group(0), text[m.end():]


def consume_parens(text: str) -> tuple[str, str]:
    out = []
    i = 0
    while i < len(text):
        while i < len(text) and text[i].isspace():
            i += 1
        if i >= len(text) or text[i] != "(":
            break
        depth = 0
        j = i
        while j < len(text):
            if text[j] == "(":
                depth += 1
            elif text[j] == ")":
                depth -= 1
                if depth == 0:
                    j += 1
                    break
            j += 1
        out.append(text[i:j])
        i = j
    return "".join(out), text[i:]


def clean_meaning(s: str) -> str:
    s = s.strip()
    s = re.sub(r"\s+", " ", s)
    # Drop any leading punctuation that leaked
    s = s.lstrip(" ,;，；：:·、.")
    return s.strip()


def parse_pos_meaning(after: str) -> tuple[str, str]:
    after = after.strip()
    after = PAGE_END_RE.sub("", after).strip()
    if not after:
        return "", ""
    # Sometimes there's a stray parenthesised note *after* the initial paren
    # block but before POS, e.g. "(94) ..." leaked — remove leading "(NN)" pages.
    after = re.sub(r"^\(\d{1,3}\)\s*", "", after)
    matches = list(POS_GROUP_RE.finditer(after))
    if not matches or matches[0].start() > 8:
        return "", clean_meaning(after)
    pairs: list[tuple[str, str]] = []
    for idx, m in enumerate(matches):
        pos_raw = m.group(0).strip().rstrip(",").strip()
        pos_norm = re.sub(r"\s*,?\s*([a-z])", lambda m2: ", " + m2.group(1), pos_raw)
        pos_norm = pos_norm.strip(", ")
        start = m.end()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(after)
        meaning = after[start:end].strip(" ,;，；：:·")
        meaning = clean_meaning(meaning)
        if meaning:
            pairs.append((pos_norm, meaning))
    if not pairs:
        return "", clean_meaning(after)
    return "; ".join(p for p, _ in pairs), "; ".join(m for _, m in pairs)


def parse_blob(blob: str) -> tuple[str, str, str] | None:
    blob = blob.strip()
    if not blob:
        return None
    sp = split_headword_and_phonetic(blob)
    if not sp:
        return None
    word, rest = sp
    word = re.sub(r"\s+", " ", word).strip(" -*")
    if not word:
        return None

    # Step 1: consume as many /.../ phonetic blocks as present, separated by
    # optional ';' and whitespace. After that we may still have stray IPA
    # glyphs/semicolons/dots/parentheses from bold duplicate rendering.
    after = rest
    while True:
        m = PHONETIC_BLOCK_RE.match(after)
        if m:
            after = after[m.end():]
            after = re.sub(r"^\s*;\s*", " ", after)
            continue
        break
    # Consume leading parenthesised page notes (e.g. (9) )
    _notes, after = consume_parens(after)
    after = after.lstrip(" \t;；,，.")

    # Step 2: find the first CJK character; everything from there is meaning.
    cjk_match = re.search(r"[\u4e00-\u9fff\u3400-\u4dbf]", after)
    if not cjk_match:
        return None
    pre = after[:cjk_match.start()]
    meaning_raw = after[cjk_match.start():]

    # Step 3: extract POS tag(s) from `pre` (between last phonetic block and CJK).
    pos_tags: list[str] = []
    pre = re.sub(r"[()（）\d,，;；.、/\\\-–—*ˈˌːʰʲʷˑˌ̯̩̃ˈ̩\s]+", " ", pre)
    for tok in pre.split():
        t = tok.lower().strip(" .")
        if t in {"n", "v", "vt", "vi", "adj", "adv", "prep", "conj", "pron",
                 "interj", "int", "excl", "num", "art", "aux", "abbr",
                 "ordinal", "pl", "sing", "modal"}:
            if t in ("int", "excl"):
                t = "interj"
            pos_tags.append(t)
    pos = ""
    if pos_tags:
        # Normalize order / dedupe while preserving order
        seen = set()
        uniq = []
        for p in pos_tags:
            if p not in seen:
                seen.add(p)
                uniq.append(p)
        pos = ", ".join(uniq)

    # Step 4: clean meaning — keep only CJK characters, common CJK punctuation
    # and spaces. This discards stray IPA glyphs, Latin letters, page numbers,
    # semicolons/dots that leaked from the phonetic rendering.
    meaning_raw = PAGE_END_RE.sub("", meaning_raw).strip()
    meaning_chars = []
    for ch in meaning_raw:
        cp = ord(ch)
        is_cjk = (0x4E00 <= cp <= 0x9FFF) or (0x3400 <= cp <= 0x4DBF)
        is_cjk_punct = ch in "，。、；：！？""''（）《》【】…—·~～ "
        if is_cjk or is_cjk_punct:
            meaning_chars.append(ch)
        else:
            meaning_chars.append(" ")
    meaning = "".join(meaning_chars)
    meaning = re.sub(r"\s+", " ", meaning).strip(" ,;；，.、")
    # Drop leading parenthesised digits (page refs) in case any survived.
    meaning = re.sub(r"^（\d{1,3}）\s*", "", meaning)
    meaning = re.sub(r"^\(\d{1,3}\)\s*", "", meaning)
    if not meaning:
        return None
    # Clean headword: strip trailing dots/stray punctuation
    word = word.strip(" .-")
    return (word, pos, meaning)


# ---------- page processing ----------
NOISE_LINE_RE = re.compile(
    r"^\s*(\d{1,3}|Words in Each Unit\s*\d*|注[：:]?.*|说明[：:]?.*|说明:本词汇表.*|)$",
    re.IGNORECASE,
)


def page_to_blobs(page) -> tuple[list[str], list[str]]:
    chars = [c for c in page.chars if c.get("text", "")]
    if not chars:
        return [], []
    mid_x = detect_mid_x(chars, page.width)
    # Use pdfplumber's built-in word segmentation (x_tolerance matches default).
    all_words = page.extract_words(x_tolerance=2, y_tolerance=3, keep_blank_chars=False)
    left_words = []
    right_words = []
    gutter_words = []
    for w in all_words:
        txt = norm(w["text"]).strip()
        if not txt:
            continue
        if w["x1"] < mid_x - 3:
            left_words.append(w)
        elif w["x0"] > mid_x + 3:
            right_words.append(w)
        else:
            gutter_words.append(w)
    left_blobs = build_entry_blobs(left_words)
    right_blobs = build_entry_blobs(right_words)

    # Detect "Unit N" headings that straddle the gutter (section titles are
    # usually centered and therefore straddle mid_x). We look for "Unit"
    # followed by a small integer in gutter_words.
    gutter_words_sorted = sorted(gutter_words, key=lambda c: (c["top"], c["x0"]))
    for i, w in enumerate(gutter_words_sorted):
        if norm(w["text"]).strip().lower() != "unit":
            continue
        # Look ahead for a digit word on the same line
        j = i + 1
        if j < len(gutter_words_sorted):
            nw = gutter_words_sorted[j]
            if abs(nw["top"] - w["top"]) <= 6 and re.fullmatch(r"\d{1,2}", norm(nw["text"]).strip()):
                unit_no = norm(nw["text"]).strip()
                marker = f"Unit {unit_no}"
                avg_top = (w["top"] + nw["top"]) / 2
                # Insert the marker into both columns if there is any content there.
                _insert_unit_marker(left_blobs, left_words, marker, avg_top)
                _insert_unit_marker(right_blobs, right_words, marker, avg_top)
    return left_blobs, right_blobs


def _insert_unit_marker(blobs: list[str], col_words: list[dict],
                        marker: str, marker_top: float) -> None:
    """Insert a 'Unit N' marker string into `blobs` at the position corresponding
    to marker_top. We use the first real entry's top as an anchor; if the marker
    is above all entries we prepend, otherwise we insert after entries whose
    headword top is less than marker_top.
    """
    # Blobs are already sorted top-ascending. We approximate by inserting at
    # the position corresponding to the fraction of total column height.
    if not col_words:
        return
    col_top = min(w["top"] for w in col_words)
    col_bot = max(w["bottom"] for w in col_words)
    if marker_top <= col_top + 10:
        blobs.insert(0, marker)
        return
    if marker_top >= col_bot - 10:
        blobs.append(marker)
        return
    # Binary-like search: count existing blobs with top below marker_top
    # We don't have top for blobs anymore; use a heuristic — insert at the
    # position where the marker's vertical position falls relative to the
    # column's word count. Since unit markers usually appear at natural page
    # break boundaries (before the first column entry of a new unit) and
    # because left/right blobs contain their own per-column unit markers for
    # in-column breaks, falling back to appending at the top is good enough
    # for the gutter case.
    blobs.insert(0, marker)


def words_to_chars(words) -> list[dict]:
    """We lost per-char info after grouping into words; fabricate pseudo-chars so
    build_entry_blobs can re-group them. Because build_entry_blobs uses word
    grouping anyway, we can directly feed words — but its internal code expects
    chars; easiest is to synthesize one "char" per word with its bounding box.
    """
    out = []
    for w in words:
        out.append({
            "text": w["text"],
            "x0": w["x0"],
            "x1": w["x1"],
            "top": w["top"],
            "bottom": w["bottom"],
            "size": w["bottom"] - w["top"],
        })
    return out


def collect_units(blobs_by_page: list[list[str]]) -> "OrderedDict[str, list[tuple[str,str,str]]]":
    """Given a list (per-page) of blob lists from a single column, group them
    into units by detecting 'Unit N' headings (which may appear as blobs themselves).
    """
    units: OrderedDict[str, list[tuple[str, str, str]]] = OrderedDict()
    current_unit: str | None = None
    unit_buf: list[str] = []

    def flush():
        nonlocal unit_buf, current_unit
        if current_unit is None:
            unit_buf = []
            return
        entries = []
        for b in unit_buf:
            # Skip residual "Unit N" or section heading blobs that leaked through.
            if re.match(r"^Unit\s+\d+\s*$", b, re.IGNORECASE):
                continue
            low = b.lower().strip()
            if low in {"preparing for the topic", "exploring for the topic",
                       "developing for the topic", "wrapping for the topic",
                       "preparing forthe topic", "exploring forthe topic",
                       "developing forthe topic", "wrapping forthe topic",
                       "preparingforthetopic", "exploringthetopic",
                       "developingthetopic", "wra ptingupthetopic",
                       "wrappingupthetopic"}:
                continue
            parsed = parse_blob(b)
            if parsed:
                entries.append(parsed)
        if current_unit in units:
            units[current_unit].extend(entries)
        else:
            units[current_unit] = entries
        unit_buf = []

    for page_blobs in blobs_by_page:
        for b in page_blobs:
            m = re.match(r"^\s*Unit\s+(\d+)\b", b, re.IGNORECASE)
            if m:
                flush()
                current_unit = m.group(1)
                # Any text on the same blob after "Unit N" belongs to next unit.
                rest = b[m.end():].strip()
                unit_buf = [rest] if rest else []
                continue
            if current_unit is None:
                # Before Unit 1 starts (e.g. notes/headers), ignore.
                continue
            unit_buf.append(b)
    flush()
    return units


def dedupe(entries):
    seen = set()
    out = []
    for w, p, m in entries:
        w = re.sub(r"\s+", " ", w).strip(" -*")
        if not w:
            continue
        key = w.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append((w, p, m))
    return out


def main() -> int:
    pdf_path = sys.argv[1] if len(sys.argv) > 1 else \
        "/Users/liwenfu/Downloads/2026年秋季新仁爱英语_九年级上册 2.pdf"
    out_dir = os.path.join(os.path.dirname(__file__), "../data/仁爱版初中")

    # Build a single stream of blobs in reading order: for each page, left
    # column first, then right column. Unit markers detected in either column
    # apply globally.
    blob_stream: list[str] = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            lb, rb = page_to_blobs(page)
            blob_stream.extend(lb)
            blob_stream.extend(rb)

    all_units: OrderedDict[str, list[tuple[str, str, str]]] = OrderedDict()
    current_unit: str | None = None
    unit_buf: list[str] = []

    def flush():
        nonlocal unit_buf, current_unit
        if current_unit is None:
            unit_buf = []
            return
        entries = []
        for b in unit_buf:
            if re.match(r"^Unit\s+\d+\s*$", b, re.IGNORECASE):
                continue
            low = b.lower().strip()
            if low in {"preparing for the topic", "exploring for the topic",
                       "developing for the topic", "wrapping for the topic",
                       "preparing forthe topic", "exploring forthe topic",
                       "developing forthe topic", "wrapping forthe topic",
                       "preparingforthetopic", "exploringthetopic",
                       "developingthetopic", "wra ptingupthetopic",
                       "wrappingupthetopic"}:
                continue
            parsed = parse_blob(b)
            if parsed:
                entries.append(parsed)
        if current_unit in all_units:
            all_units[current_unit].extend(entries)
        else:
            all_units[current_unit] = entries
        unit_buf = []

    for b in blob_stream:
        m = re.match(r"^\s*Unit\s+(\d+)\b", b, re.IGNORECASE)
        if m:
            flush()
            current_unit = m.group(1)
            rest = b[m.end():].strip()
            unit_buf = [rest] if rest else []
            continue
        if current_unit is None:
            continue
        unit_buf.append(b)
    flush()

    os.makedirs(out_dir, exist_ok=True)
    total = 0
    for unit_no in sorted(all_units.keys(), key=lambda x: int(x)):
        items = dedupe(all_units[unit_no])
        total += len(items)
        fn = f"九上 Unit {unit_no}.txt"
        path = os.path.join(out_dir, fn)
        lines_out = []
        for w, p, m in items:
            if p and m:
                lines_out.append(f"{w} | {p} | {m}")
            elif m:
                lines_out.append(f"{w} |  | {m}")
            else:
                lines_out.append(w)
        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines_out) + "\n")
        print(f"Wrote {path} ({len(items)} words)")
    print(f"Total words: {total}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
