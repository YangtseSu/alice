import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { testOcrConfig, OCR_DISCLAIMER } from "../lib/ocr";
import {
  BUILTIN_MODELS,
  type BuiltinModel,
  isPremiumModel,
  loadSelectedModelId,
} from "../lib/credits";
import {
  isCustomOcrConfigSet,
  OCR_PROVIDER_PRESETS,
  requiresCustomOcrConfig,
  type OcrProviderConfig,
} from "../lib/ocrConfig";
import { fonts, radii, spacing } from "../lib/designTokens";
import { useThemeColors } from "../lib/theme";

type ViewMode = "free" | "premium" | "custom";

interface OcrSettingsModalProps {
  visible: boolean;
  /** Current saved custom config (null = using built-in on native). */
  value: OcrProviderConfig | null;
  onClose: () => void;
  /** Persist a custom config (null clears it, falling back to built-in). */
  onSave: (cfg: OcrProviderConfig | null) => void;
  /** Select a built-in model tier (clears any custom config so built-in wins). */
  onSelectModel: (modelId: string) => void;
  /** Current credit balance (shown for the premium tier). */
  credits: number;
  /** Open the recharge flow. */
  onRecharge: () => void;
}

type TestState =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "ok" }
  | { kind: "error"; message: string };

const FREE_MODEL = BUILTIN_MODELS.find((m) => m.tier === "free")!;
const PREMIUM_MODEL = BUILTIN_MODELS.find((m) => m.tier === "premium")!;

export function OcrSettingsModal({
  visible,
  value,
  onClose,
  onSave,
  onSelectModel,
  credits,
  onRecharge,
}: OcrSettingsModalProps) {
  const colors = useThemeColors();
  const webRequiresKey = requiresCustomOcrConfig();

  const [view, setView] = useState<ViewMode>("free");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [test, setTest] = useState<TestState>({ kind: "idle" });

  // Sync local form + active view whenever the modal opens.
  useEffect(() => {
    if (!visible) return;
    setBaseUrl(value?.baseUrl ?? "");
    setApiKey(value?.apiKey ?? "");
    setModel(value?.model ?? "");
    setShowKey(false);
    setTest({ kind: "idle" });

    if (webRequiresKey || isCustomOcrConfigSet(value)) {
      setView("custom");
    } else {
      loadSelectedModelId().then((id) => {
        setView(isPremiumModel(id) ? "premium" : "free");
      });
    }
  }, [visible, value, webRequiresKey]);

  const applyPreset = useCallback((presetId: string) => {
    const preset = OCR_PROVIDER_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setBaseUrl(preset.baseUrl);
    setModel(preset.model);
    setTest({ kind: "idle" });
  }, []);

  const canSave =
    baseUrl.trim().length > 0 &&
    model.trim().length > 0 &&
    apiKey.trim().length > 0;

  const handleSave = useCallback(() => {
    if (!canSave) return;
    Keyboard.dismiss();
    onSave({
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim(),
      model: model.trim(),
    });
  }, [baseUrl, apiKey, model, canSave, onSave]);

  const handleClear = useCallback(() => {
    Keyboard.dismiss();
    onSave(null);
  }, [onSave]);

  const handleUseBuiltin = useCallback(
    (modelId: string) => {
      onSelectModel(modelId);
    },
    [onSelectModel],
  );

  const handleTest = useCallback(async () => {
    if (!canSave) return;
    setTest({ kind: "testing" });
    try {
      await testOcrConfig({
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        model: model.trim(),
      });
      setTest({ kind: "ok" });
    } catch (e) {
      setTest({
        kind: "error",
        message: e instanceof Error ? e.message : "测试失败",
      });
    }
  }, [baseUrl, apiKey, model, canSave]);

  const usingCustom = isCustomOcrConfigSet(value);
  const statusLine = usingCustom
    ? "当前使用自定义服务配置"
    : webRequiresKey
      ? "尚未配置 — Web 版需自备 API Key"
      : view === "premium"
        ? `当前使用高级模型 · 余额 ${credits}`
        : "当前使用免费模型";

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
              识别模型
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

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={[styles.statusLine, { color: colors.muted }]}>
              {statusLine}
            </Text>

            {/* Tier picker — free / premium hidden on Web (no built-in key). */}
            {!webRequiresKey ? (
              <View style={styles.tierRow}>
                <TierChip
                  label="免费"
                  active={view === "free"}
                  colors={colors}
                  onPress={() => setView("free")}
                />
                <TierChip
                  label="高级"
                  active={view === "premium"}
                  colors={colors}
                  onPress={() => setView("premium")}
                />
                <TierChip
                  label="自定义"
                  active={view === "custom"}
                  colors={colors}
                  onPress={() => setView("custom")}
                />
              </View>
            ) : null}

            {view === "free" ? (
              <ModelInfoCard
                model={FREE_MODEL}
                badge="免费"
                badgeColor={colors.secondary}
                badgeBg={colors.surface}
                costText="无限次使用"
                colors={colors}
              />
            ) : null}

            {view === "premium" ? (
              <>
                <ModelInfoCard
                  model={PREMIUM_MODEL}
                  badge="高级"
                  badgeColor={colors.gold}
                  badgeBg={colors.goldSoft}
                  costText={`每次识别扣除 ${PREMIUM_MODEL.creditCost} credit`}
                  colors={colors}
                />
                <View
                  style={[
                    styles.balanceRow,
                    {
                      backgroundColor: colors.primarySoft,
                      borderColor: colors.primary,
                    },
                  ]}
                >
                  <Ionicons
                    name="wallet-outline"
                    size={16}
                    color={colors.primary}
                  />
                  <Text
                    style={[styles.balanceText, { color: colors.primary }]}
                  >
                    余额 {credits} credits
                  </Text>
                  <TouchableOpacity
                    onPress={onRecharge}
                    style={[
                      styles.rechargeBtn,
                      { backgroundColor: colors.primary },
                    ]}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.rechargeBtnText,
                        { color: colors.background },
                      ]}
                    >
                      充值
                    </Text>
                  </TouchableOpacity>
                </View>
                {credits < PREMIUM_MODEL.creditCost ? (
                  <Text style={[styles.hint, { color: colors.danger }]}>
                    余额不足，充值后可使用高级识别
                  </Text>
                ) : null}
              </>
            ) : null}

            {view === "custom" ? (
              <>
                {webRequiresKey && !usingCustom ? (
                  <Text style={[styles.hint, { color: colors.subtle }]}>
                    听写与词库不需要 Key；仅拍照识别需要。请选择下方服务商并填写密钥。
                  </Text>
                ) : null}

                <Text style={[styles.sectionLabel, { color: colors.subtle }]}>
                  服务商预设
                </Text>
                <View style={styles.presetRow}>
                  {OCR_PROVIDER_PRESETS.map((preset) => {
                    const active =
                      preset.baseUrl.length > 0 &&
                      preset.baseUrl === baseUrl.trim() &&
                      preset.model === model.trim();
                    return (
                      <TouchableOpacity
                        key={preset.id}
                        style={[
                          styles.presetChip,
                          {
                            borderColor: active
                              ? colors.primary
                              : colors.border,
                            backgroundColor: active
                              ? colors.primarySoft
                              : colors.surface,
                          },
                        ]}
                        onPress={() => applyPreset(preset.id)}
                        activeOpacity={0.7}
                      >
                        <Text
                          style={[
                            styles.presetChipText,
                            {
                              color: active
                                ? colors.primary
                                : colors.foreground,
                            },
                          ]}
                        >
                          {preset.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <FieldLabel label="接口地址 (Base URL)" colors={colors} />
                <TextInput
                  style={[
                    styles.input,
                    {
                      borderColor: colors.border,
                      backgroundColor: colors.surfaceSunken,
                      color: colors.foreground,
                    },
                  ]}
                  value={baseUrl}
                  onChangeText={(t) => {
                    setBaseUrl(t);
                    setTest({ kind: "idle" });
                  }}
                  placeholder="https://api.example.com/v1"
                  placeholderTextColor={colors.subtle}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                />
                <Text style={[styles.hint, { color: colors.subtle }]}>
                  将自动拼接 /chat/completions，也可直接粘贴完整地址
                </Text>

                <FieldLabel label="API Key" colors={colors} />
                <View
                  style={[
                    styles.input,
                    styles.keyRow,
                    {
                      borderColor: colors.border,
                      backgroundColor: colors.surfaceSunken,
                    },
                  ]}
                >
                  <TextInput
                    style={[styles.keyInput, { color: colors.foreground }]}
                    value={apiKey}
                    onChangeText={(t) => {
                      setApiKey(t);
                      setTest({ kind: "idle" });
                    }}
                    placeholder="sk-..."
                    placeholderTextColor={colors.subtle}
                    autoCapitalize="none"
                    autoCorrect={false}
                    secureTextEntry={!showKey}
                  />
                  <TouchableOpacity
                    onPress={() => setShowKey((v) => !v)}
                    hitSlop={8}
                    activeOpacity={0.6}
                    accessibilityLabel={showKey ? "隐藏密钥" : "显示密钥"}
                  >
                    <Ionicons
                      name={showKey ? "eye-off-outline" : "eye-outline"}
                      size={20}
                      color={colors.subtle}
                    />
                  </TouchableOpacity>
                </View>

                <FieldLabel label="模型名称" colors={colors} />
                <TextInput
                  style={[
                    styles.input,
                    {
                      borderColor: colors.border,
                      backgroundColor: colors.surfaceSunken,
                      color: colors.foreground,
                    },
                  ]}
                  value={model}
                  onChangeText={(t) => {
                    setModel(t);
                    setTest({ kind: "idle" });
                  }}
                  placeholder="例如 gpt-4o-mini"
                  placeholderTextColor={colors.subtle}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Text style={[styles.hint, { color: colors.subtle }]}>
                  请填写支持图像识别的视觉模型
                </Text>

                {test.kind === "ok" ? (
                  <View
                    style={[
                      styles.testResult,
                      { backgroundColor: colors.dangerSoft },
                    ]}
                  >
                    <Ionicons
                      name="checkmark-circle"
                      size={16}
                      color={colors.primary}
                    />
                    <Text style={[styles.testText, { color: colors.primary }]}>
                      连接成功，配置可用
                    </Text>
                  </View>
                ) : null}
                {test.kind === "error" ? (
                  <View
                    style={[
                      styles.testResult,
                      { backgroundColor: colors.dangerSoft },
                    ]}
                  >
                    <Ionicons name="alert-circle" size={16} color={colors.danger} />
                    <Text style={[styles.testText, { color: colors.danger }]}>
                      {test.message}
                    </Text>
                  </View>
                ) : null}

                <View style={styles.testRow}>
                  <TouchableOpacity
                    style={[
                      styles.testBtn,
                      {
                        borderColor: colors.border,
                        backgroundColor: colors.surface,
                      },
                      !canSave && styles.btnDisabled,
                    ]}
                    onPress={handleTest}
                    disabled={!canSave || test.kind === "testing"}
                    activeOpacity={0.7}
                  >
                    {test.kind === "testing" ? (
                      <ActivityIndicator size="small" color={colors.foreground} />
                    ) : (
                      <Text
                        style={[styles.testBtnText, { color: colors.foreground }]}
                      >
                        测试连接
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            ) : null}

            <View
              style={[
                styles.disclaimer,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.borderSubtle,
                },
              ]}
            >
              <Ionicons
                name="information-circle-outline"
                size={14}
                color={colors.subtle}
              />
              <Text style={[styles.disclaimerText, { color: colors.subtle }]}>
                {OCR_DISCLAIMER}
              </Text>
            </View>
          </ScrollView>

          <View style={[styles.footer, { borderColor: colors.border }]}>
            {view === "custom" ? (
              <>
                <TouchableOpacity
                  style={[
                    styles.footerBtn,
                    styles.footerBtnOutline,
                    { borderColor: colors.border },
                  ]}
                  onPress={handleClear}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.footerBtnText, { color: colors.muted }]}>
                    {webRequiresKey ? "清除配置" : "恢复默认"}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.footerBtn,
                    { backgroundColor: colors.primary },
                    !canSave && styles.btnDisabled,
                  ]}
                  onPress={handleSave}
                  disabled={!canSave}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[styles.footerBtnText, { color: colors.background }]}
                  >
                    保存
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity
                style={[
                  styles.footerBtn,
                  { backgroundColor: colors.primary },
                ]}
                onPress={() =>
                  handleUseBuiltin(view === "premium" ? PREMIUM_MODEL.id : FREE_MODEL.id)
                }
                activeOpacity={0.7}
              >
                <Text
                  style={[styles.footerBtnText, { color: colors.background }]}
                >
                  使用此模型
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function FieldLabel({
  label,
  colors,
}: {
  label: string;
  colors: ReturnType<typeof useThemeColors>;
}) {
  return (
    <Text style={[styles.sectionLabel, { color: colors.subtle }]}>
      {label}
    </Text>
  );
}

function TierChip({
  label,
  active,
  colors,
  onPress,
}: {
  label: string;
  active: boolean;
  colors: ReturnType<typeof useThemeColors>;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.tierChip,
        {
          borderColor: active ? colors.primary : colors.border,
          backgroundColor: active ? colors.primarySoft : colors.surface,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text
        style={[
          styles.tierChipText,
          { color: active ? colors.primary : colors.foreground },
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function ModelInfoCard({
  model,
  badge,
  badgeColor,
  badgeBg,
  costText,
  colors,
}: {
  model: BuiltinModel;
  badge: string;
  badgeColor: string;
  badgeBg: string;
  costText: string;
  colors: ReturnType<typeof useThemeColors>;
}) {
  return (
    <View
      style={[
        styles.infoCard,
        {
          backgroundColor: colors.surfaceRaised,
          borderColor: colors.borderSubtle,
        },
      ]}
    >
      <View style={styles.infoHeader}>
        <Text style={[styles.infoTitle, { color: colors.foreground }]}>
          {model.label}
        </Text>
        <View style={[styles.infoBadge, { backgroundColor: badgeBg }]}>
          <Text style={[styles.infoBadgeText, { color: badgeColor }]}>
            {badge}
          </Text>
        </View>
      </View>
      <Text style={[styles.infoDesc, { color: colors.muted }]}>
        {model.description}
      </Text>
      <View style={styles.infoCostRow}>
        <Ionicons name="pricetag-outline" size={14} color={colors.subtle} />
        <Text style={[styles.infoCost, { color: colors.subtle }]}>
          {costText}
        </Text>
      </View>
    </View>
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
  body: {
    paddingHorizontal: spacing.lg,
  },
  bodyContent: {
    paddingVertical: spacing.md,
    gap: spacing.xs,
  },
  statusLine: {
    fontSize: 12,
    marginBottom: spacing.xs,
  },
  tierRow: {
    flexDirection: "row",
    gap: spacing.xs,
    marginVertical: spacing.xs,
  },
  tierChip: {
    flex: 1,
    paddingVertical: spacing.sm + 2,
    borderRadius: radii.control,
    borderWidth: 1.5,
    alignItems: "center",
  },
  tierChipText: {
    fontSize: 13,
    fontWeight: "600",
  },
  infoCard: {
    borderRadius: radii.surface,
    borderWidth: 1,
    padding: spacing.md,
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  infoHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  infoTitle: {
    fontFamily: fonts.display,
    fontSize: 17,
  },
  infoBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.full,
  },
  infoBadgeText: {
    fontSize: 11,
    fontWeight: "700",
  },
  infoDesc: {
    fontSize: 13,
  },
  infoCostRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  },
  infoCost: {
    fontSize: 12,
  },
  balanceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: radii.control,
    borderWidth: 1,
  },
  balanceText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
  },
  rechargeBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.full,
  },
  rechargeBtnText: {
    fontSize: 12,
    fontWeight: "700",
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "600",
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  presetRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  presetChip: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 6,
    borderRadius: radii.control,
    borderWidth: 1,
  },
  presetChipText: {
    fontSize: 12,
    fontWeight: "600",
  },
  input: {
    borderWidth: 1,
    borderRadius: radii.control,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 14,
  },
  keyRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 0,
    paddingRight: spacing.md,
  },
  keyInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 10,
  },
  hint: {
    fontSize: 11,
    marginTop: 4,
    marginBottom: spacing.xs,
  },
  testResult: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radii.control,
    marginTop: spacing.sm,
  },
  testText: {
    fontSize: 12,
    flexShrink: 1,
  },
  testRow: {
    marginTop: spacing.sm,
  },
  testBtn: {
    minHeight: 38,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.control,
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  testBtnText: {
    fontSize: 14,
    fontWeight: "600",
  },
  disclaimer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.control,
    borderWidth: StyleSheet.hairlineWidth,
  },
  disclaimerText: {
    fontSize: 11,
    flexShrink: 1,
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
  footerBtnOutline: {
    borderWidth: 1.5,
  },
  footerBtnText: {
    fontSize: 15,
    fontWeight: "600",
  },
  btnDisabled: {
    opacity: 0.4,
  },
});
