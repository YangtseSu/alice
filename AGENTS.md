# Repository Guidelines

## Project Overview

**Alice 听写** (`alice-dictation`, package `com.vvenv.alice`) — a cross-platform English-word dictation trainer for Chinese students: paste/OCR a word list → the app speaks words with a countdown → mark wrong words → review. Expo SDK 57 / React Native 0.86.2 / React 19.2.8 / TypeScript. Targets iOS, Android, and Web (web export hosted at `https://alice.edao.plus/app/`). All UI strings are hardcoded Chinese.

## Architecture & Data Flow

- **Entry**: `index.js` → `App.tsx` (loads fonts, hides splash, wraps in `ThemeProvider`) → custom navigation — **not** expo-router; `@react-navigation/native-stack` with 3 screens: `Home`, `Dictation`, `Settings` (param list in `src/navigation/types.ts`).
- **No backend.** Only two outbound call sites: LLM vision OCR (OpenAI-compatible `/chat/completions`, default Zhipu GLM-4V — `src/lib/ocr.ts`, `src/lib/ocrConfig.ts`) and Youdao TTS audio downloads (`src/lib/tts.ts`, cached under `expo-file-system` `Paths.cache/tts`, fallback to `expo-speech`).
- **Vocabulary pipeline** (generated files — never hand-edit):
  - `data/<category>/<label>.txt` (7 Chinese-named textbook dirs, lines `word | pos | meaning`) → `pnpm exec tsx scripts/generate-library.ts` → **`src/lib/library.ts`** (`LIBRARY_ITEMS`, "DO NOT EDIT MANUALLY").
  - ECDICT CSV → `pnpm dict:build` (`scripts/build-ecdict-meta.py`) → **`src/lib/ecdict-meta.json`** → consumed by `src/lib/dictionary.ts` for offline EN→ZH lookup.
- **Persistence**: AsyncStorage only (`src/lib/storage.ts`) — no sqlite, no filesystem for user data. Keys namespaced `alice_*` (new: theme, credits, sound, OCR config) and `dictation_*` (legacy: wrong words, history, favorites, speech rate). Built-in library IDs are prefixed `default_<category>_<label>`.
- **State**: no state library (no redux/zustand). React hooks + module-scope singletons with in-memory caches (`src/lib/tts.ts`, `storage.ts`, `credits.ts`, `ocrConfig.ts`) providing sync getters after async init. Only one context: `ThemeProvider` in `src/lib/theme.tsx`.

## Key Directories

| Path | Purpose |
| --- | --- |
| `src/screens/` | `HomeScreen.tsx` (input hub, OCR, drawers), `DictationScreen.tsx` (playback engine UI, `PanResponder` gestures), `SettingsScreen.tsx` |
| `src/components/` | Reusable UI: `Button`, `BottomSheet`, `CountdownRing`, `Toast`, drawers (`FavoritesDrawer`, `HistoryDrawer`, `LibraryDrawer`), OCR UI |
| `src/hooks/` | `usePlayback.ts` (dictation phase machine: speak1 → 700ms gap → speak2 → interval), `useWrongWords`, `useOcrQuota`, `useToast` |
| `src/lib/` | Domain logic: `dictation.ts` (pure parsing), `tts.ts`, `sound.ts`, `haptics.ts`, `ocr.ts`, `credits.ts`, `theme.tsx`, `designTokens.ts`, `config.ts`; **generated**: `library.ts`, `ecdict-meta.json` |
| `src/navigation/` | `types.ts` (`RootStackParamList`) |
| `website/` | Standalone Vite + React 19 + Tailwind v4 marketing site (workspace member; shares no code with `src/`) |
| `scripts/` | Release (bash), data-pipeline (python3/tsx), `lib/version.sh` |
| `data/` | Source word lists, grouped per textbook |
| `android/`, `ios/` | Committed, hand-maintained CNG output (no prebuild workflow documented) — release scripts edit native version fields directly |
| `plugins/` | Local Expo config plugin `withGradleJvmArgs.js` |

## Development Commands

```bash
pnpm install && cp .env.example .env   # pnpm@11.20.0, Node 22

pnpm start                             # Expo dev server
pnpm ios / pnpm android / pnpm web     # platform runs

pnpm lint                              # tsc --noEmit — THE quality gate for the app
pnpm build                             # web export → dist + scripts/flatten-web-dist.mjs

# data pipeline (outputs are git-tracked; commit after regen)
pnpm exec tsx scripts/generate-library.ts   # data/ → src/lib/library.ts
pnpm dict:build                              # ECDICT → src/lib/ecdict-meta.json

# website (separate tsconfig/eslint, excluded from app typecheck)
pnpm --filter website dev
pnpm --filter website build            # tsc -b && vite build && prerender via Playwright
pnpm --filter website lint             # eslint .
pnpm --filter website check            # tsc -b --noEmit

# releases (require .env deploy/R2 secrets; see .env.example)
pnpm release:android [patch|minor|major|x.y.z]
pnpm release:website [-- --skip-webapp] / pnpm release:webapp
```

Version bumps **must** go through `release.sh`/`scripts/lib/version.sh` — it syncs `package.json`, `app.json` (+ `android.versionCode`), `android/app/build.gradle`, and iOS `project.pbxproj`. Never bump one file alone.

## Code Conventions & Common Patterns

- **Exports**: named exports everywhere; `export default` only in `App.tsx`. No path aliases in the app — relative imports only (`website/` maps `@/*` → `website/src/*`).
- **Naming**: `PascalCase.tsx` for components/screens, `camelCase.ts` for lib/hooks, hooks prefixed `use*`.
- **Styling**: `StyleSheet.create` at the bottom of each component file; colors via `useThemeColors()`, non-color tokens (radii/spacing/fonts) from `src/lib/designTokens.ts`. No NativeWind/Tailwind in the app. Icons: `@expo/vector-icons` Ionicons.
- **Fonts caveat**: `designTokens.ts` loads Playfair Display + Noto Serif SC — do **not** pair these TTFs with `fontWeight`/`fontStyle` on Android.
- **Web compatibility**: every animated component defines `const USE_NATIVE_DRIVER = Platform.OS !== "web"` (RN web rejects native-driver animations).
- **Error handling**: defensive degrade-to-no-op (bare `catch`, `.catch(() => {})`); user-facing errors are Chinese message strings thrown as `new Error(...)`; `InsufficientCreditsError` (`src/lib/ocr.ts`) drives the recharge UI. Credits are spent only after a successful OCR response.
- **Async**: async/await; single-flight maps + `AbortController` in `tts.ts`; debounced (500ms) input persistence in `HomeScreen`.
- **OCR config flow**: built-in key comes from `app.json` `expo.extra` (injected from `.env` by `app.config.js`, **empty in web builds**); web requires user-supplied BYOK config (`ocrConfig.ts` presets). No `EXPO_PUBLIC_*` vars — runtime config is read via `expo-constants` in `src/lib/config.ts`.
- **Word line format**: `word | pos | meaning` (fullwidth `｜` accepted; `you're = you are` expansion speaks only the left side) — see `src/lib/dictation.ts`.

## Important Files

- `app.config.js` — dynamic Expo config; spreads `app.json` and injects `ZHIPU_API_KEY` → `extra.zhipuApiKey` (own minimal `.env` loader, no dotenv dep).
- `app.json` — static config: `expo.extra` (`zhipuBaseUrl`, `visionModel: glm-4v-flash`), `experiments.baseUrl: "/app"`, EAS projectId, updates disabled.
- `eas.json` — profiles `preview` (internal, APK) and `production` (autoIncrement, AAB).
- `metro.config.js` — rewrites `@babel/runtime/regenerator` → `.../helpers/regenerator` (babel 8 quirk); otherwise default Expo config.
- `tsconfig.json` (app: strict, `expo/tsconfig.base`, excludes `scripts/` + `website/`) · `tsconfig.scripts.json` (node16 resolution for `scripts/`).
- `.env.example` — `ZHIPU_API_KEY` (app OCR), `ALICE_WEB_BUILD` (web-build gate), release secrets `DEPLOY_SERVER`, `DEPLOY_REMOTE_DIR`, `R2_BUCKET`, `R2_PUBLIC_BASE`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`.
- `website/src/data/site.ts` — `APK_URL`/`APP_VERSION`/`WEB_APP_URL`; rewritten by `release.sh` (rsync to R2-hosted APK).
- `scripts/flatten-web-dist.mjs` — flattens nested pnpm asset paths after web export (dot-segments get 403'd by nginx).

## Runtime/Tooling Preferences

- **pnpm@11.20.0** (pinned via `packageManager`), Node 22 (CI). No bun, no `engines`. Workspace: `pnpm-workspace.yaml` → `["website"]` only.
- Scripts run in three runtimes: app/tooling in **tsx/Node** (`generate-library.ts` via `pnpm exec tsx`, `flatten-web-dist.mjs` via `node`), **python3** (stdlib only where possible: `build-ecdict-meta.py`; `extract-renai9.py` needs `pdfplumber`, `gen_qrcode.py` needs `qrcode[pil]`), **bash** (release scripts).
- CI (`.github/workflows/ci.yml`) is **workflow_dispatch release-only** (EAS builds); its only quality gate is `pnpm lint`. Custom composite action: `.github/actions/setup-node-pnpm`.
- Formatting: `.editorconfig` (2-space, LF, UTF-8); Prettier 3 is a devDependency with **no config file** — defaults apply. ESLint exists only in `website/`.

## Testing & QA

- **No test suite exists** — no jest/vitest/pytest/e2e anywhere (website's Playwright dependency is used only for build-time prerendering, not tests).
- Verification workflow: `pnpm lint` (typecheck) before committing app/`src` changes; `pnpm --filter website lint && pnpm --filter website check` for `website/`; Python scripts have no automated checks — exercise them manually and inspect generated output (`src/lib/library.ts`, `src/lib/ecdict-meta.json`).
- Data-pipeline changes: regenerate the generated modules and commit them together with `data/` edits.
