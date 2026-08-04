import { useCallback, useEffect, useState } from "react";

import {
  addCredits,
  BUILTIN_MODELS,
  type BuiltinModel,
  DEFAULT_MODEL_ID,
  getCachedCredits,
  loadCreditBalance,
  loadSelectedModelId,
  purchasePack,
  type CreditPack,
  saveSelectedModelId,
} from "../lib/credits";
import {
  isCustomOcrConfigSet,
  loadOcrProviderConfig,
} from "../lib/ocrConfig";

/**
 * OCR quota state: credit balance, the selected built-in model, and whether a
 * BYOK custom config overrides the built-in service. Screens that touch OCR
 * (Home, Settings) use this to render balances, switch models and recharge.
 */
export function useOcrQuota() {
  const [credits, setCredits] = useState(0);
  const [modelId, setModelId] = useState(DEFAULT_MODEL_ID);
  const [hasCustomConfig, setHasCustomConfig] = useState(false);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    const [balance, selectedId, custom] = await Promise.all([
      loadCreditBalance(),
      loadSelectedModelId(),
      loadOcrProviderConfig(),
    ]);
    setCredits(balance);
    setModelId(selectedId);
    setHasCustomConfig(isCustomOcrConfigSet(custom));
    setReady(true);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const model: BuiltinModel =
    BUILTIN_MODELS.find((m) => m.id === modelId) ?? BUILTIN_MODELS[0]!;

  const selectModel = useCallback(async (id: string) => {
    setModelId(id);
    await saveSelectedModelId(id);
  }, []);

  const recharge = useCallback(async (pack: CreditPack) => {
    const next = await purchasePack(pack);
    setCredits(next);
    return next;
  }, []);

  const grantCredits = useCallback(async (amount: number) => {
    const next = await addCredits(amount);
    setCredits(next);
    return next;
  }, []);

  /** Sync local balance with the in-memory cache after an OCR run. */
  const syncFromCache = useCallback(() => {
    setCredits(getCachedCredits());
  }, []);

  return {
    ready,
    credits,
    modelId,
    model,
    hasCustomConfig,
    refresh,
    selectModel,
    recharge,
    grantCredits,
    syncFromCache,
  };
}
