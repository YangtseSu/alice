import AsyncStorage from "@react-native-async-storage/async-storage";

import { config } from "./config";
import {
  isCustomOcrConfigSet,
  loadOcrProviderConfig,
  requiresCustomOcrConfig,
} from "./ocrConfig";

/**
 * Built-in vision models served by the app's embedded key.
 *
 * - `free` models are unlimited for everyone.
 * - `premium` models consume `creditCost` credits per successful recognition.
 *   Users with no credits cannot use premium models.
 *
 * The `creditCost` field is the per-use deduction — adjustable here to tune
 * the plan economy. Adding a new tier is just a new entry in this list.
 */
export type ModelTier = "free" | "premium";

export interface BuiltinModel {
  id: string;
  label: string;
  /** API model name passed to the chat/completions endpoint. */
  model: string;
  tier: ModelTier;
  /** Credits deducted per successful recognition. 0 for free models. */
  creditCost: number;
  description: string;
}

export const BUILTIN_MODELS: BuiltinModel[] = [
  {
    id: "glm-4v-flash",
    label: "GLM-4V Flash",
    model: "glm-4v-flash",
    tier: "free",
    creditCost: 0,
    description: "快速识别，日常单词列表够用",
  },
  {
    id: "glm-4v-plus",
    label: "GLM-4V Plus",
    model: "glm-4v-plus",
    tier: "premium",
    creditCost: 1,
    description: "更高精度，适合复杂或模糊图片",
  },
];

export const DEFAULT_MODEL_ID = "glm-4v-flash";

export function getBuiltinModel(id: string): BuiltinModel {
  return BUILTIN_MODELS.find((m) => m.id === id) ?? BUILTIN_MODELS[0]!;
}

export function isPremiumModel(id: string): boolean {
  return getBuiltinModel(id).tier === "premium";
}

// --- Recharge packs --------------------------------------------------------
// Mock purchase packs. Each pack maps a price to a credit amount (+ optional
// bonus). This is the seam where a real IAP integration (StoreKit / Google
// Play / RevenueCat) will later plug in: replace `purchasePack` with the
// platform flow and call `addCredits` only after a verified transaction.

export interface CreditPack {
  id: string;
  label: string;
  credits: number;
  bonus: number;
  price: string;
  highlight?: boolean;
}

export const CREDIT_PACKS: CreditPack[] = [
  { id: "pack_20", label: "20 Credits", credits: 20, bonus: 0, price: "¥6" },
  {
    id: "pack_60",
    label: "60 Credits",
    credits: 60,
    bonus: 6,
    price: "¥15",
    highlight: true,
  },
  {
    id: "pack_200",
    label: "200 Credits",
    credits: 200,
    bonus: 30,
    price: "¥45",
  },
];

// --- Credit balance persistence -------------------------------------------

const CREDITS_KEY = "alice_ocr_credits";
const SELECTED_MODEL_KEY = "alice_ocr_selected_model";

let _cachedCredits: number | null = null;

export async function loadCreditBalance(): Promise<number> {
  try {
    const data = await AsyncStorage.getItem(CREDITS_KEY);
    const n = data ? Number(JSON.parse(data)) : 0;
    _cachedCredits = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    return _cachedCredits;
  } catch {
    _cachedCredits = 0;
    return 0;
  }
}

/** Ensure the cache is populated, then return it. */
export async function ensureCreditsLoaded(): Promise<number> {
  if (_cachedCredits === null) return loadCreditBalance();
  return _cachedCredits;
}

export function getCachedCredits(): number {
  return _cachedCredits ?? 0;
}

export async function addCredits(amount: number): Promise<number> {
  const next = getCachedCredits() + Math.max(0, Math.floor(amount));
  _cachedCredits = next;
  try {
    await AsyncStorage.setItem(CREDITS_KEY, String(next));
  } catch {
    // ignore — balance is also kept in-memory for the running session
  }
  return next;
}

/**
 * Deduct credits. Returns true on success, false if the balance is insufficient.
 * Called only after a successful premium recognition so failed API calls don't
 * charge the user.
 */
export async function trySpendCredits(cost: number): Promise<boolean> {
  if (cost <= 0) return true;
  const balance = await ensureCreditsLoaded();
  if (balance < cost) return false;
  _cachedCredits = balance - cost;
  try {
    await AsyncStorage.setItem(CREDITS_KEY, String(_cachedCredits));
  } catch {
    // ignore
  }
  return true;
}

/** Mock purchase: instantly grants the pack's credits. Replace with real IAP. */
export async function purchasePack(pack: CreditPack): Promise<number> {
  return addCredits(pack.credits + pack.bonus);
}

// --- Selected built-in model ----------------------------------------------

export async function loadSelectedModelId(): Promise<string> {
  try {
    const id = await AsyncStorage.getItem(SELECTED_MODEL_KEY);
    if (id && BUILTIN_MODELS.some((m) => m.id === id)) return id;
  } catch {
    // ignore
  }
  return DEFAULT_MODEL_ID;
}

export async function saveSelectedModelId(id: string): Promise<void> {
  try {
    await AsyncStorage.setItem(SELECTED_MODEL_KEY, id);
  } catch {
    // ignore
  }
}

// --- OCR run gate ----------------------------------------------------------

export type OcrGateResult =
  | { ok: true }
  | {
      ok: false;
      reason: "insufficient_credits";
      cost: number;
      balance: number;
      model: BuiltinModel;
    };

/**
 * Pre-flight check before opening the camera / album picker.
 *
 * - BYOK (custom config) and Web (no built-in key) are always allowed — the
 *   actual config error surfaces later from the OCR call.
 * - Premium built-in models require enough credits; otherwise the caller
 *   should prompt the user to recharge instead of taking a photo.
 */
export async function canRunOcrNow(): Promise<OcrGateResult> {
  const custom = await loadOcrProviderConfig();
  if (isCustomOcrConfigSet(custom)) return { ok: true };
  if (requiresCustomOcrConfig()) return { ok: true };
  if (!config.zhipuApiKey.trim()) return { ok: true };

  const selectedId = await loadSelectedModelId();
  const selected = getBuiltinModel(selectedId);
  if (selected.tier === "premium") {
    const balance = await ensureCreditsLoaded();
    if (balance < selected.creditCost) {
      return {
        ok: false,
        reason: "insufficient_credits",
        cost: selected.creditCost,
        balance,
        model: selected,
      };
    }
  }
  return { ok: true };
}
