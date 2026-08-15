import { Ionicons } from "@expo/vector-icons";
import { useCallback, useMemo, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import {
  parseWords,
  parseWordLine,
  parseWordEntries,
  entryToLine,
} from "../lib/dictation";
import { firstSense, splitSenses } from "../lib/dictionary";
import { fonts, radii, spacing } from "../lib/designTokens";
import { useThemeColors } from "../lib/theme";
import { Button } from "./Button";

interface WordInputSectionProps {
  value: string;
  onChange: (value: string) => void;
  onSetSample: () => void;
  onClear: () => void;
  startIndex: number;
  onStartIndexChange: (index: number) => void;
  isDisplayMode: boolean;
}

export function WordInputSection({
  value,
  onChange,
  onSetSample,
  onClear,
  startIndex,
  onStartIndexChange,
  isDisplayMode,
}: WordInputSectionProps) {
  const colors = useThemeColors();
  const parsedWords = useMemo(() => parseWords(value), [value]);
  const wordCount = parsedWords.length;
  const effectiveDisplayMode = isDisplayMode && wordCount > 0;
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const toggleExpand = useCallback((idx: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const handleDeleteWord = useCallback(
    (index: number) => {
      const entries = parseWordEntries(value);
      if (index < 0 || index >= entries.length) return;
      entries.splice(index, 1);
      const nextValue = entries.map(entryToLine).join("\n");
      onChange(nextValue);
      // 删除后平移展开态索引，避免串到相邻词条
      setExpanded((prev) => {
        const next = new Set<number>();
        prev.forEach((i) => {
          if (i < index) next.add(i);
          else if (i > index) next.add(i - 1);
        });
        return next;
      });

      if (index < startIndex) {
        onStartIndexChange(startIndex - 1);
      } else if (index === startIndex) {
        const nextStart = Math.min(startIndex, Math.max(0, entries.length - 1));
        onStartIndexChange(nextStart);
      }
    },
    [value, startIndex, onChange, onStartIndexChange],
  );

  return (
    <View style={styles.container}>
      {effectiveDisplayMode ? (
        <View
          style={[
            styles.displayContainer,
            {
              borderColor: colors.borderSubtle,
              backgroundColor: colors.surfaceRaised,
            },
          ]}
        >
          <ScrollView
            style={styles.displayScroll}
            showsVerticalScrollIndicator={false}
            nestedScrollEnabled
          >
            {parsedWords.map((line, idx) => {
              const isCursor = idx === startIndex;
              const entry = parseWordLine(line);
              const hasMeta = Boolean(entry.pos || entry.meaning);
              return (
                <TouchableOpacity
                  key={`display-${line}-${idx}`}
                  style={[
                    styles.displayRow,
                    isCursor && {
                      backgroundColor: colors.primarySoft,
                      borderLeftColor: colors.primary,
                    },
                    { borderBottomColor: colors.borderMuted },
                  ]}
                  onPress={() => {
                    onStartIndexChange(idx);
                    if (hasMeta && /[；;]/.test(entry.meaning ?? "")) {
                      toggleExpand(idx);
                    }
                  }}
                  activeOpacity={0.6}
                >
                  <Text
                    style={[
                      styles.displayIndex,
                      { color: isCursor ? colors.primary : colors.subtle },
                    ]}
                  >
                    {String(idx + 1).padStart(2, "0")}
                  </Text>
                  <View style={styles.displayWordCol}>
                    <Text
                      style={[
                        styles.displayWord,
                        { color: isCursor ? colors.primary : colors.foreground },
                      ]}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                    >
                      {entry.word}
                    </Text>
                    {hasMeta && (() => {
                      const fullMeaning = entry.meaning ?? "";
                      const isExpanded = expanded.has(idx);
                      const senses = isExpanded ? splitSenses(fullMeaning) : null;
                      return isExpanded && senses ? (
                        <View style={styles.displayMetaBlock}>
                          {senses.map((s, i) => (
                            <Text
                              key={i}
                              style={[
                                styles.displayMeta,
                                { color: colors.subtle },
                              ]}
                              numberOfLines={1}
                              ellipsizeMode="tail"
                            >
                              {i === 0 && entry.pos ? `${entry.pos} ${s}` : s}
                            </Text>
                          ))}
                        </View>
                      ) : (
                        <Text
                          style={[
                            styles.displayMeta,
                            { color: colors.subtle },
                          ]}
                          numberOfLines={1}
                          ellipsizeMode="tail"
                        >
                          {entry.pos ? `${entry.pos} ` : ""}
                          {firstSense(fullMeaning)}
                        </Text>
                      );
                    })()}
                  </View>
                  <TouchableOpacity
                    style={styles.deleteBtn}
                    onPress={() => handleDeleteWord(idx)}
                    hitSlop={8}
                    activeOpacity={0.6}
                    accessibilityRole="button"
                    accessibilityLabel={`删除 ${entry.word}`}
                  >
                    <Ionicons
                      name="close-circle"
                      size={20}
                      color={colors.subtle}
                    />
                  </TouchableOpacity>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      ) : (
        <TextInput
          style={[
            styles.textArea,
            {
              borderColor: colors.border,
              backgroundColor: colors.surfaceSunken,
              color: colors.foreground,
            },
          ]}
          multiline
          placeholder="每行一个单词或词组\n例：apple\nactor / actress"
          placeholderTextColor={colors.subtle}
          value={value}
          onChangeText={onChange}
          editable
          textAlignVertical="top"
        />
      )}

      {!effectiveDisplayMode && (
        <View style={styles.footer}>
          <Text style={[styles.count, { color: colors.muted }]}>
            共 {wordCount} 个单词
          </Text>
          <View style={styles.actions}>
            <Button label="示例" variant="outline" size="sm" onPress={onSetSample} />
            <Button label="清空" variant="outline" size="sm" onPress={onClear} />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: 0,
    gap: spacing.xs,
  },
  textArea: {
    flex: 1,
    minHeight: 0,
    borderWidth: 1,
    borderRadius: radii.card,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: 16,
    lineHeight: 22,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  count: {
    fontSize: 12,
  },
  actions: {
    flexDirection: "row",
    gap: 8,
  },
  displayContainer: {
    flex: 1,
    minHeight: 0,
    borderWidth: 1,
    borderRadius: radii.card,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  displayScroll: {
    flex: 1,
    minHeight: 0,
    paddingVertical: spacing.sm,
  },
  displayRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: 3,
    borderLeftColor: "transparent",
    gap: spacing.md,
  },
  displayIndex: {
    fontFamily: fonts.serif,
    fontSize: 13,
    fontVariant: ["tabular-nums"],
    minWidth: 24,
  },
  displayWord: {
    fontSize: 16,
    fontWeight: "500",
    flexShrink: 1,
  },
  displayWordCol: {
    flex: 1,
    flexDirection: "column",
    gap: 2,
    minWidth: 0,
  },
  displayMetaBlock: {
    flexDirection: "column",
    gap: 1,
    width: "100%",
  },
  displayMeta: {
    fontSize: 12,
    lineHeight: 17,
    flexShrink: 1,
  },
  deleteBtn: {
    padding: spacing.xs,
    marginLeft: spacing.xs,
  },
});
