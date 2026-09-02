import { useCallback, useEffect, useRef, useState } from "react";

import { loadWrongWords, saveWrongWords } from "../lib/storage";

const FLASH_DURATION_MS = 250;

export function useWrongWords(initialWords?: string[]) {
  const [wrongWords, setWrongWords] = useState<string[]>(
    () => initialWords ?? loadWrongWords(),
  );
  const [markedFlash, setMarkedFlash] = useState(false);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      clearTimeout(flashTimerRef.current);
    },
    [],
  );

  // Side effects stay out of the state updater (updaters must be pure —
  // React may invoke them twice); persist from the handler like
  // removeWrongWord below.
  const markWrong = useCallback(
    (word: string) => {
      if (wrongWords.includes(word)) return;
      const next = [...wrongWords, word];
      setWrongWords(next);
      saveWrongWords(next);
      clearTimeout(flashTimerRef.current);
      setMarkedFlash(true);
      flashTimerRef.current = setTimeout(
        () => setMarkedFlash(false),
        FLASH_DURATION_MS,
      );
    },
    [wrongWords],
  );

  const exportWrong = useCallback(async () => {
    if (wrongWords.length === 0) return "";
    const Clipboard = await import("expo-clipboard");
    await Clipboard.setStringAsync(wrongWords.join("\n"));
    return `已复制 ${wrongWords.length} 个错词`;
  }, [wrongWords]);

  const clearWrong = useCallback(() => {
    saveWrongWords([]);
    setWrongWords([]);
    return "已清空错词本";
  }, []);

  const removeWrongWord = useCallback(
    (word: string) => {
      const next = wrongWords.filter((item) => item !== word);
      setWrongWords(next);
      saveWrongWords(next);
    },
    [wrongWords],
  );

  /** Add a word back (undo for removeWrongWord) — no marked flash. */
  const restoreWrongWord = useCallback(
    (word: string) => {
      if (wrongWords.includes(word)) return;
      const next = [...wrongWords, word];
      setWrongWords(next);
      saveWrongWords(next);
    },
    [wrongWords],
  );

  return {
    wrongWords,
    markedFlash,
    markWrong,
    exportWrong,
    clearWrong,
    removeWrongWord,
    restoreWrongWord,
    hasWrongWords: wrongWords.length > 0,
  };
}
