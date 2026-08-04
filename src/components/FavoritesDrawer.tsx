import { Ionicons } from "@expo/vector-icons";
import { useMemo } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import type { WordHistoryEntry } from "../lib/storage";
import { getLibraryItemById, isLibraryId } from "../lib/storage";
import { parseWords } from "../lib/dictation";
import { radii, spacing } from "../lib/designTokens";
import { useThemeColors } from "../lib/theme";
import { BottomSheet } from "./BottomSheet";

interface FavoriteItem {
  entry: WordHistoryEntry;
  source: "library" | "history";
  label: string;
}

interface FavoritesDrawerProps {
  visible: boolean;
  favorites: string[];
  history: WordHistoryEntry[];
  onClose: () => void;
  onApply: (entry: WordHistoryEntry) => void;
  onToggleFavorite: (id: string) => void;
}

function wordCount(text: string): number {
  return parseWords(text).length;
}

/** Resolve favorite ids into displayable items, skipping orphaned ids whose
 *  source entry has been removed. */
function resolveFavorites(
  favorites: string[],
  history: WordHistoryEntry[],
): FavoriteItem[] {
  const result: FavoriteItem[] = [];
  for (const id of favorites) {
    if (isLibraryId(id)) {
      const libItem = getLibraryItemById(id);
      if (libItem) {
        result.push({
          entry: libItem.entry,
          source: "library",
          label: `${libItem.category} · ${libItem.label}`,
        });
      }
    } else {
      const histEntry = history.find((e) => e.id === id);
      if (histEntry) {
        result.push({
          entry: histEntry,
          source: "history",
          label: histEntry.text.replace(/\n/g, " "),
        });
      }
    }
  }
  return result;
}

export function FavoritesDrawer({
  visible,
  favorites,
  history,
  onClose,
  onApply,
  onToggleFavorite,
}: FavoritesDrawerProps) {
  const colors = useThemeColors();

  const items = useMemo(
    () => resolveFavorites(favorites, history),
    [favorites, history],
  );

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={`收藏 (${items.length})`}
    >
      {(bodyMaxHeight) => (
        <ScrollView
          style={{ maxHeight: bodyMaxHeight }}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          bounces={false}
          nestedScrollEnabled
        >
          {items.length === 0 ? (
            <Text
              style={[
                styles.empty,
                { color: colors.subtle, backgroundColor: colors.surface },
              ]}
            >
              尚无收藏
            </Text>
          ) : (
            items.map((item) => (
              <View
                key={item.entry.id}
                style={[
                  styles.item,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.borderSubtle,
                  },
                ]}
              >
                <TouchableOpacity
                  style={styles.itemContent}
                  onPress={() => {
                    onApply(item.entry);
                    onClose();
                  }}
                  activeOpacity={0.6}
                  accessibilityRole="button"
                  accessibilityLabel={`载入收藏 ${item.label}`}
                >
                  <Text
                    style={[styles.itemText, { color: colors.foreground }]}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {item.label}
                  </Text>
                </TouchableOpacity>
                <View style={styles.itemTrailing}>
                  <Text style={[styles.itemMeta, { color: colors.subtle }]}>
                    {wordCount(item.entry.text)}
                  </Text>
                  <View
                    style={[
                      styles.sourceBadge,
                      {
                        backgroundColor: colors.surfaceSunken,
                        borderColor: colors.borderSubtle,
                      },
                    ]}
                  >
                    <Text
                      style={[styles.sourceBadgeText, { color: colors.subtle }]}
                    >
                      {item.source === "library" ? "词库" : "历史"}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => onToggleFavorite(item.entry.id)}
                    activeOpacity={0.6}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel="取消收藏"
                  >
                    <Ionicons name="star" size={18} color={colors.gold} />
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  listContent: {
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  empty: {
    textAlign: "center",
    fontSize: 13,
    paddingVertical: spacing.lg,
    borderRadius: radii.surface,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radii.control,
    borderWidth: 1,
    overflow: "hidden",
  },
  itemContent: {
    flex: 1,
    paddingVertical: spacing.sm + 2,
    paddingLeft: spacing.sm + 2,
    paddingRight: spacing.sm,
  },
  itemText: {
    fontSize: 14,
    fontWeight: "500",
  },
  itemTrailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm + 2,
    paddingRight: spacing.sm + 2,
  },
  itemMeta: {
    fontSize: 11,
  },
  sourceBadge: {
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 2,
    borderRadius: radii.xs,
    borderWidth: 1,
  },
  sourceBadgeText: {
    fontSize: 10,
    fontWeight: "500",
  },
});
