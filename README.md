# Alice 听写 🐰

> "Down the rabbit-hole of words."

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Expo](https://img.shields.io/badge/Expo-57-000020?logo=expo&logoColor=white)](https://expo.dev)
[![React Native](https://img.shields.io/badge/React%20Native-0.86-61DAFB?logo=react&logoColor=white)](https://reactnative.dev)
[![Website](https://img.shields.io/badge/官网-alice.edao.plus-E5397B)](https://alice.edao.plus)

英文单词听写应用，基于 Expo (React Native)，支持 iOS / Android / Web。

官网与下载：**<https://alice.edao.plus>**

## 截图

|                          首页                          |                           词库                            |                        听写                         |                         完成                         |
| :----------------------------------------------------: | :-------------------------------------------------------: | :-------------------------------------------------: | :--------------------------------------------------: |
| ![首页：单词列表与拍照识词](docs/screenshots/home.png) | ![词库：内置教材词表与搜索](docs/screenshots/library.png) | ![听写：怀表倒计时](docs/screenshots/dictation.png) | ![完成：成绩单与错词本](docs/screenshots/finish.png) |

## 功能

- 粘贴英文单词列表 / 拍照 OCR 识别（内置智谱 GLM-4V 双档模型；支持自定义 OCR 服务商；Web 版需自备 API Key）
- 识别模型分档：免费档（GLM-4V Flash）无限使用，高级档（GLM-4V Plus）消耗 Credits
- Credits 充值：购买充值包，余额本地持久化，仅成功识别才扣减
- AI 识图可能存在误差，识别入口均有提示
- 内置教材词库：中考 1600、高考 3500、人教 / 外研 / 闽教版单元词表、人教版小学语文识字表，支持搜索
- 可调间隔、自动播放下一个
- 显示 / 隐藏当前单词，词性与释义提示
- 标记错词，本地持久化，历史记录管理
- 支持汉字听写（粘贴中文词表或内置识字表，自动拼音提示、中文朗读）
- 可选「朗读中文释义」：英文播放后附带朗读中文翻译（设置中开启）
- 导出错词到剪贴板
- 亮色 / 暗色主题

## 技术栈

- **Expo / React Native** — 跨平台移动应用
- **系统 en-US TTS** — 英文单词发音（`expo-speech`）
- **智谱 GLM-4V** — 视觉 OCR 识别
- **Vite + React + Tailwind CSS** — 官网（`website/` 子包）

## 快速开始

```bash
git clone https://github.com/vvenv/alice.git
cd alice
pnpm install
cp .env.example .env   # 填入自己的密钥（见下方「配置」）

pnpm start          # Expo dev server
pnpm web            # Web 模式
pnpm ios            # iOS 模拟器
pnpm android        # Android 模拟器
```

官网本地开发：

```bash
pnpm --filter website dev
```

## 配置

所有敏感配置放在 gitignored 的 `.env` 中（模板见 [`.env.example`](.env.example)），由 [`app.config.js`](app.config.js) 在构建时注入：

| 环境变量            | 说明                                                                | 必填                               |
| ------------------- | ------------------------------------------------------------------- | ---------------------------------- |
| `ZHIPU_API_KEY`     | 智谱 API Key（OCR 拍照识词），[申请地址](https://open.bigmodel.cn/) | Android OCR 需要；Web 构建不会注入 |
| `DEPLOY_SERVER`     | 发布脚本的部署目标（`user@host`）                                   | 仅发版需要                         |
| `DEPLOY_REMOTE_DIR` | 服务器上的站点目录                                                  | 仅发版需要                         |

非敏感配置在 `app.json` 的 `expo.extra` 中（`zhipuBaseUrl`、`visionModel` 默认模型）。识别模型分档选择与 Credits 余额在应用内管理（设置 → 识别模型 / 充值），存储于设备本地。

云端 CI 构建（GitHub Actions → EAS）不读取本地 `.env`，需在 [EAS 环境变量](https://docs.expo.dev/eas/environment-variables/) 中配置同名变量。

## 发版

### 一键 Android 发版（本地构建 + 部署官网）

```bash
pnpm release:android           # 保持当前版本发版
pnpm release:android patch     # 0.2.0 → 0.2.1
pnpm release:android minor     # 0.2.0 → 0.3.0
pnpm release:android major     # 0.2.0 → 1.0.0
pnpm release:android 0.3.0     # 指定版本号
```

传入 bump 类型或版本号时，会同步更新 `package.json`、`app.json`（含 `android.versionCode`）、`android/app/build.gradle`、iOS `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION`。

流程：可选升版 → EAS 本地构建 APK → 上传到 Cloudflare R2（免流量费，服务器不再承载 APK）→ 更新下载链接 → 构建官网 → rsync 部署到 `DEPLOY_SERVER`。R2 配置见 `.env.example`。详见 [`scripts/release.sh`](scripts/release.sh)。

### 发布官网 + Web 应用

```bash
pnpm release:website              # 落地页 + /app/（推荐）
pnpm release:website -- --skip-webapp  # 仅落地页
pnpm release:webapp               # 仅更新 /app/
```

官网与 Web 应用**无先后顺序要求**：落地页 rsync 只排除 `app/`，不会互相覆盖。APK 托管在 Cloudflare R2，不经过部署服务器。`release:website` 默认一并发布 Web 应用。入口：<https://alice.edao.plus/app/>。

详见 [`scripts/release-website.sh`](scripts/release-website.sh)、[`scripts/release-webapp.sh`](scripts/release-webapp.sh)。

### GitHub Actions 发版

首次需在本地 `pnpm exec eas login && pnpm exec eas init`，并在 GitHub → Settings → Secrets → Actions 添加 `EXPO_TOKEN`。之后在 **Actions → CI → Run workflow** 选择 platform / profile 触发。

## 项目结构

```
├── App.tsx / index.js      # 应用入口
├── app.json                # Expo 静态配置（不含密钥）
├── app.config.js           # 动态配置：从 .env 注入密钥
├── src/
│   ├── screens/            # 页面（首页、听写）
│   ├── components/         # UI 组件
│   └── lib/                # 配置、OCR、存储等
├── data/                   # 内置词库（教材单元 / 中高考词表）
├── docs/                   # 文档资源（README 截图等）
├── scripts/                # 发版、词典构建脚本
└── website/                # 官网（Vite + React + Tailwind）
```

## 贡献

欢迎 Issue 和 PR！请先阅读 [贡献指南](CONTRIBUTING.md)。

## 许可证

[MIT](LICENSE) © 2026 vvenv
