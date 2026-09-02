import { Ionicons } from "@expo/vector-icons";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { CREDIT_PACKS, type CreditPack } from "../lib/credits";
import { fonts, radii, spacing } from "../lib/designTokens";
import { useThemeColors } from "../lib/theme";

interface RechargeModalProps {
  visible: boolean;
  /** Current credit balance (display only). */
  credits: number;
  onClose: () => void;
  /** Purchase a pack. Resolves once credits are granted. */
  onPurchase: (pack: CreditPack) => Promise<void> | void;
}

export function RechargeModal({
  visible,
  credits,
  onClose,
  onPurchase,
}: RechargeModalProps) {
  const colors = useThemeColors();
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [error, setError] = useState("");

  const handlePurchase = useCallback(
    async (pack: CreditPack) => {
      setPurchasing(pack.id);
      setError("");
      try {
        await onPurchase(pack);
      } catch (err) {
        // Surface the failure inline — without this catch the rejection is
        // unhandled: the spinner resets but the user gets zero feedback.
        setError(err instanceof Error ? err.message : "充值失败，请重试");
      } finally {
        setPurchasing(null);
      }
    },
    [onPurchase],
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        style={[styles.backdrop, { backgroundColor: colors.overlay }]}
        onPress={onClose}
      >
        <Pressable
          style={[
            styles.sheet,
            {
              backgroundColor: colors.background,
              borderColor: colors.border,
            },
          ]}
          onPress={() => {}}
        >
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.foreground }]}>
              充值 Credits
            </Text>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={8}
              activeOpacity={0.6}
              accessibilityLabel="关闭"
            >
              <Ionicons name="close" size={22} color={colors.muted} />
            </TouchableOpacity>
          </View>

          <View
            style={[
              styles.balanceBar,
              {
                backgroundColor: colors.primarySoft,
                borderColor: colors.primary,
              },
            ]}
          >
            <Ionicons name="wallet-outline" size={18} color={colors.primary} />
            <Text style={[styles.balanceLabel, { color: colors.primary }]}>
              当前余额
            </Text>
            <Text
              style={[styles.balanceValue, { color: colors.primary }]}
              accessibilityLabel={`当前余额 ${credits} credits`}
            >
              {credits}
            </Text>
          </View>

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}
          >
            {CREDIT_PACKS.map((pack) => {
              const total = pack.credits + pack.bonus;
              const buying = purchasing === pack.id;
              return (
                <TouchableOpacity
                  key={pack.id}
                  style={[
                    styles.packCard,
                    {
                      backgroundColor: colors.surfaceRaised,
                      borderColor: pack.highlight
                        ? colors.gold
                        : colors.borderSubtle,
                    },
                  ]}
                  onPress={() => handlePurchase(pack)}
                  disabled={buying}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`${pack.label} ${pack.price}`}
                >
                  <View style={styles.packInfo}>
                    <View style={styles.packTitleRow}>
                      <Text
                        style={[
                          styles.packTitle,
                          { color: colors.foreground },
                        ]}
                      >
                        {pack.label}
                      </Text>
                      {pack.bonus > 0 ? (
                        <View
                          style={[
                            styles.bonusChip,
                            { backgroundColor: colors.goldSoft },
                          ]}
                        >
                          <Text
                            style={[
                              styles.bonusChipText,
                              { color: colors.gold },
                            ]}
                          >
                            +{pack.bonus}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={[styles.packSub, { color: colors.muted }]}>
                      共 {total} credits
                    </Text>
                  </View>
                  <View style={styles.packRight}>
                    {buying ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : (
                      <>
                        <Text
                          style={[
                            styles.packPrice,
                            { color: colors.foreground },
                          ]}
                        >
                          {pack.price}
                        </Text>
                        {pack.highlight ? (
                          <View
                            style={[
                              styles.dealChip,
                              { backgroundColor: colors.gold },
                            ]}
                          >
                            <Text
                              style={[
                                styles.dealChipText,
                                { color: colors.background },
                              ]}
                            >
                              超值
                            </Text>
                          </View>
                        ) : null}
                      </>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
            {error ? (
              <Text style={[styles.note, { color: colors.danger }]}>
                {error}
              </Text>
            ) : null}

            <Text style={[styles.note, { color: colors.subtle }]}>
              高级识别每次扣除 1 credit（可配置）。充值后立即到账，永久有效。
            </Text>
            <Text style={[styles.iapNote, { color: colors.subtle }]}>
              演示版充值无需付费；正式版将接入应用内购买。
            </Text>
          </ScrollView>

          <View style={[styles.footer, { borderColor: colors.border }]}>
            <TouchableOpacity
              style={[
                styles.footerBtn,
                { backgroundColor: colors.primary },
              ]}
              onPress={onClose}
              activeOpacity={0.7}
            >
              <Text
                style={[styles.footerBtnText, { color: colors.background }]}
              >
                完成
              </Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.lg,
  },
  sheet: {
    width: "100%",
    maxWidth: 380,
    maxHeight: "88%",
    borderRadius: radii.card,
    borderWidth: 1,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: {
    fontFamily: fonts.displayZh,
    fontSize: 17,
  },
  balanceBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    margin: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radii.control,
    borderWidth: 1,
  },
  balanceLabel: {
    fontSize: 13,
    fontWeight: "600",
    flex: 1,
  },
  balanceValue: {
    fontFamily: fonts.display,
    fontSize: 22,
    fontVariant: ["tabular-nums"],
  },
  body: {
    paddingHorizontal: spacing.lg,
  },
  bodyContent: {
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  packCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md + 2,
    borderRadius: radii.surface,
    borderWidth: 1.5,
  },
  packInfo: {
    flex: 1,
    gap: 2,
  },
  packTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  packTitle: {
    fontFamily: fonts.display,
    fontSize: 16,
  },
  bonusChip: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radii.full,
  },
  bonusChipText: {
    fontSize: 11,
    fontWeight: "700",
  },
  packSub: {
    fontSize: 12,
  },
  packRight: {
    alignItems: "flex-end",
    gap: 4,
  },
  packPrice: {
    fontFamily: fonts.display,
    fontSize: 18,
    fontWeight: "700",
  },
  dealChip: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radii.full,
  },
  dealChipText: {
    fontSize: 10,
    fontWeight: "700",
  },
  note: {
    fontSize: 12,
    marginTop: spacing.xs,
  },
  iapNote: {
    fontSize: 11,
    marginTop: 2,
  },
  footer: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerBtn: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radii.button,
    justifyContent: "center",
    alignItems: "center",
  },
  footerBtnText: {
    fontSize: 15,
    fontWeight: "600",
  },
});
