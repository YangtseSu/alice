import AsyncStorage from "@react-native-async-storage/async-storage";

import { LIBRARY_ITEMS, type LibraryItem } from "./library";
import { parseWords, speakTextFromEntry } from "./dictation";

const WRONG_WORDS_KEY = "dictation_wrong_words";
const WORD_INPUT_KEY = "dictation_word_input";
const WORD_HISTORY_KEY = "dictation_word_history";
const FAVORITES_KEY = "dictation_favorites";
/** Cap for user-added history entries. Built-in lists live in code, not storage. */
const MAX_USER_HISTORY_ENTRIES = 50;

export interface WordHistoryEntry {
  id: string;
  text: string;
  timestamp: number;
  /** Enriched version (word | pos | meaning) — stored as expansion data so
   *  the original plain-word `text` is preserved for history display. */
  enrichedText?: string;
}

/** True for ids belonging to built-in library entries. The `default_` prefix is
 *  kept for backwards compatibility with older installs that persisted rows. */
export function isLibraryId(id: string): boolean {
  return id.startsWith("default_");
}

/**
 * Built-in library grouped by category, for the 词库 drawer.
 * Source of truth is LIBRARY_ITEMS (bundled in code); never mutated.
 */
export interface LibraryGroup {
  category: string;
  items: LibraryItem[];
}

export function getLibraryGroups(): LibraryGroup[] {
  const map = new Map<string, LibraryItem[]>();
  for (const item of LIBRARY_ITEMS) {
    if (!map.has(item.category)) map.set(item.category, []);
    map.get(item.category)!.push(item);
  }
  return [...map.entries()].map(([category, items]) => ({ category, items }));
}

/** Look up a built-in library item by its entry id. */
export function getLibraryItemById(id: string): LibraryItem | undefined {
  return LIBRARY_ITEMS.find((item) => item.entry.id === id);
}

/**
 * Normalize a word list for comparison: strip POS/meaning and keep speakable
 * headwords so enriched text still matches its plain library counterpart.
 */
export function plainWordList(text: string): string {
  return parseWords(text)
    .map((line) => speakTextFromEntry(line))
    .filter(Boolean)
    .join("\n");
}

function matchesLibraryText(text: string): boolean {
  const plain = plainWordList(text);
  if (!plain) return false;
  return LIBRARY_ITEMS.some((h) => plainWordList(h.entry.text) === plain);
}

function sanitizeEntry(item: unknown): WordHistoryEntry | null {
  if (typeof item !== "object" || item === null) return null;
  const e = item as WordHistoryEntry;
  if (
    typeof e.id !== "string" ||
    typeof e.text !== "string" ||
    typeof e.timestamp !== "number"
  ) {
    return null;
  }
  return {
    id: e.id,
    text: e.text,
    timestamp: e.timestamp,
    enrichedText:
      typeof e.enrichedText === "string" && e.enrichedText.length > 0
        ? e.enrichedText
        : undefined,
  };
}

/**
 * Sanitize stored rows into clean user entries:
 * - drop library-id rows (left over from older versions that persisted defaults)
 * - drop rows whose text duplicates a built-in list
 * - cap to MAX_USER_HISTORY_ENTRIES
 */
function toUserEntries(stored: WordHistoryEntry[]): WordHistoryEntry[] {
  return stored
    .filter((e) => !isLibraryId(e.id))
    .filter((e) => !matchesLibraryText(e.text))
    .filter(
      (e) => !(e.enrichedText && matchesLibraryText(e.enrichedText)),
    )
    .slice(0, MAX_USER_HISTORY_ENTRIES);
}

async function persistHistory(entries: WordHistoryEntry[]): Promise<void> {
  await AsyncStorage.setItem(WORD_HISTORY_KEY, JSON.stringify(entries));
}

export function loadWrongWords(): string[] {
  // Sync read from memory cache
  return _cachedWrongWords;
}

let _cachedWrongWords: string[] = [];

export async function loadPersistedWrongWords(): Promise<string[]> {
  try {
    const data = await AsyncStorage.getItem(WRONG_WORDS_KEY);
    if (!data) {
      _cachedWrongWords = [];
      return [];
    }
    const parsed = JSON.parse(data) as unknown;
    const words = Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
    _cachedWrongWords = words;
    return words;
  } catch {
    _cachedWrongWords = [];
    return [];
  }
}

export async function saveWrongWords(words: string[]): Promise<void> {
  _cachedWrongWords = words;
  try {
    await AsyncStorage.setItem(WRONG_WORDS_KEY, JSON.stringify(words));
  } catch {
    // ignore
  }
}

export async function loadWordInput(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(WORD_INPUT_KEY);
  } catch {
    return null;
  }
}

export async function saveWordInput(value: string): Promise<void> {
  try {
    await AsyncStorage.setItem(WORD_INPUT_KEY, value);
  } catch {
    // ignore
  }
}

/**
 * Load USER history only. Built-in lists are served via getLibraryGroups().
 * Older installs that persisted library rows are healed automatically.
 */
export async function loadWordHistory(): Promise<WordHistoryEntry[]> {
  try {
    const data = await AsyncStorage.getItem(WORD_HISTORY_KEY);
    if (!data) return [];
    const parsed = JSON.parse(data) as unknown;
    const stored = Array.isArray(parsed)
      ? parsed.map(sanitizeEntry).filter((e): e is WordHistoryEntry => e !== null)
      : [];
    const users = toUserEntries(stored);
    // Heal storage if stale library rows were found.
    if (users.length !== stored.length) {
      await persistHistory(users);
    }
    return users;
  } catch {
    return [];
  }
}

export async function addWordHistory(text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  // Starting from a built-in list must not create a user row.
  if (matchesLibraryText(trimmed)) return;
  try {
    const users = await loadWordHistory();
    const existing = users.find(
      (e) => e.text === trimmed || e.enrichedText === trimmed,
    );
    let nextUsers: WordHistoryEntry[];
    if (existing) {
      nextUsers = [
        { ...existing, timestamp: Date.now() },
        ...users.filter((e) => e.id !== existing.id),
      ].slice(0, MAX_USER_HISTORY_ENTRIES);
    } else {
      const entry: WordHistoryEntry = {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        text: trimmed,
        timestamp: Date.now(),
      };
      nextUsers = [entry, ...users].slice(0, MAX_USER_HISTORY_ENTRIES);
    }
    await persistHistory(nextUsers);
  } catch {
    // ignore
  }
}

/**
 * Attach enriched text to a *user* history entry. Library entries are ignored.
 */
export async function enrichHistoryEntry(
  originalText: string,
  enrichedText: string,
): Promise<void> {
  try {
    if (matchesLibraryText(originalText)) return;
    const users = await loadWordHistory();
    const updated = users.map((e) =>
      !isLibraryId(e.id) && e.text === originalText
        ? { ...e, enrichedText }
        : e,
    );
    await persistHistory(updated);
  } catch {
    // ignore
  }
}

export async function deleteWordHistory(id: string): Promise<void> {
  if (isLibraryId(id)) return;
  try {
    const users = await loadWordHistory();
    await persistHistory(users.filter((e) => e.id !== id));
    // Drop the favorite too so it doesn't dangle once its source is gone.
    if (_cachedFavorites.includes(id)) {
      await saveFavorites(_cachedFavorites.filter((x) => x !== id));
    }
  } catch {
    // ignore
  }
}

export async function clearWordHistory(): Promise<void> {
  try {
    await persistHistory([]);
    // Keep library favorites; drop favorites pointing at deleted history rows.
    const remaining = _cachedFavorites.filter((id) => isLibraryId(id));
    if (remaining.length !== _cachedFavorites.length) {
      await saveFavorites(remaining);
    }
  } catch {
    // ignore
  }
}

// --- Favorites -------------------------------------------------------------
// Favorites are stable entry ids: `default_<category>_<label>` for built-in
// library items, or the generated timestamp id for user history entries.

let _cachedFavorites: string[] = [];

export function loadFavorites(): string[] {
  return _cachedFavorites;
}

export async function loadPersistedFavorites(): Promise<string[]> {
  try {
    const data = await AsyncStorage.getItem(FAVORITES_KEY);
    if (!data) {
      _cachedFavorites = [];
      return [];
    }
    const parsed = JSON.parse(data) as unknown;
    const ids = Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
    _cachedFavorites = ids;
    return ids;
  } catch {
    _cachedFavorites = [];
    return [];
  }
}

export async function saveFavorites(ids: string[]): Promise<void> {
  _cachedFavorites = ids;
  try {
    await AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(ids));
  } catch {
    // ignore
  }
}

export function isFavorite(id: string): boolean {
  return _cachedFavorites.includes(id);
}

/** Toggle favorite state for an entry id. Returns the new favorited state. */
export async function toggleFavorite(id: string): Promise<boolean> {
  const next = _cachedFavorites.includes(id)
    ? _cachedFavorites.filter((x) => x !== id)
    : [..._cachedFavorites, id];
  await saveFavorites(next);
  return next.includes(id);
}
