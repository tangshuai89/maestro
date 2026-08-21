# Maestro

[English](./README.md) · [简体中文](./README.zh-CN.md) · **日本語**

> あなたのためのクロスプラットフォーム「音楽脳」。NetEase Cloud Music、
> QQ Music、Spotify、Deezer にログインし、**各プラットフォームでいいね
> （♥）した曲**をすべて集約。大規模言語モデル（**DeepSeek**、あなた
> **自身**の API キーを使用）が次に好きになりそうな曲を提案します。そして
> ♥ を押したら、**権利のあるすべてのプラットフォームに一括で ♥ を付与**。
> 「お住まいの地域では利用できません／権利がありません」で音楽が止まること
> は、もうありません。

**Electron + React + NestJS** によるデスクトップファーストのクライアント。

> 🟢 **ステータス：Phase 0–6 完了、Phase 7（AETHER シアター + 本番パッケージング）
> を出荷中。** 4 つのプラットフォームアダプター、統合検索、クロスプラット
> フォーム照合エンジン、インポート可能な統合ライブラリ、DeepSeek レコメンド、
> ♥ ファンアウト、**AETHER シアター视图**（酸性サイバーユバース風 —
> 1440×900 ホログラムオービットカバー + 歌詞ストリーム + エナジーコア +
> ネビュラ背景、公式 `figma-remote` MCP 経由の Figma 駆動）、Spotify OAuth
> PKCE + ♥ 書き戻し、Premium フル尺再生（Web Playback SDK + Widevine、
> castLabs Electron fork で動作）が dev でエンドツーエンドに通っています。
> **Premium フル尺は現状 `POST /v1/widevine-license/v1/audio/license 500`
> でブロックされています** —— castLabs fork は dev VMP 署名であり、Spotify
> の本番 license サーバーがこれを拒否します。修正 = **Apple Developer Account
>（$99/年）+ castLabs EVS（無料）VMP 署名**（[next-iteration plan](./NEXT-ITERATION.md)
> 第 0 セクション「Apple Dev + EVS」参照）。残作業（本番パッケージング、
> Settings / Lite モード UX、デスクトップ細部）も同プランに記載。

---

## コンセプト

各ストリーミングサービスは、あなたの好みの一部と、世界のカタログの一部しか
持っておらず、そのどちらも完全ではありません。QQ Music で大好きな曲が
NetEase には無い。Spotify のおすすめがあなたの地域では権利を持たない。
Maestro は、この 4 つのプラットフォームを**あなた自身が所有する 1 つの
ライブラリ**として扱います。

```
   ┌── 接続 ────────────────────────────────────────────────┐
   │  NetEase · QQ Music · Spotify · Deezer                  │
   └───────────────┬────────────────────────────────────────┘
                   │  各プラットフォームから「いいね（♥）」曲を取得
                   ▼
   ┌── 集約 ────────────────────────────────────────────────┐
   │  統合・重複排除した「好きな曲」ライブラリを 1 つに      │
   └───────────────┬────────────────────────────────────────┘
                   │  DeepSeek に送信（あなたの API キー）
                   ▼
   ┌── レコメンド ──────────────────────────────────────────┐
   │  LLM が次に好きになりそうな曲を提案                     │
   └───────────────┬────────────────────────────────────────┘
                   │  あなたが ♥ を押す
                   ▼
   ┌── どこでも ♥ ──────────────────────────────────────────┐
   │  権利のあるすべてのプラットフォームに ♥ を付与         │
   └───────────────┬────────────────────────────────────────┘
                   │  再生
                   ▼
   ┌── 行き止まりなし ──────────────────────────────────────┐
   │  全プラットフォームを同時に検索し、実際に権利を持つ    │
   │  ものから再生 → 「利用不可」の断絶が起きない           │
   └────────────────────────────────────────────────────────┘
```

### 設計方針

- **デスクトップクライアント優先。** すべての認証情報と DeepSeek API キーは
  **ローカル**に保存され、Maestro のサーバー（そもそも存在しません）に送信
  されることはありません。
- **集約データはあなたのもの。** 各プラットフォームのいいね曲が、あなただけ
  が持つ単一のライブラリになります。
- **AI キーは持ち込み式。** レコメンドはあなたが用意した DeepSeek キーで実行。
  コストとデータはあなたが管理します。
- **常に著作権を考慮。** ♥ は権利のあるプラットフォームにのみ展開され、再生と
  検索は実際にその曲を提供できるプラットフォームへ自動でフォールバックします。

---

## ステータスと進捗

凡例：✅ 完了 · 🚧 一部／進行中 · 📋 予定 · ⚠️ 制約あり

### プラットフォーム別の機能

| 機能                         | NetEase | QQ Music | Spotify | Deezer |
| ---------------------------- | :-----: | :------: | :-----: | :----: |
| ログイン                     | ✅ QR スキャン | ✅ cookie（埋め込みウィンドウ） | ✅ OAuth PKCE | ✅ 匿名（ログイン不要） |
| フル尺再生                   | ✅ | ✅（標準 / 320 / ロスレス） | ✅ Premium · 🚧 Free = 30 秒プレビュー | 🚧 30 秒プレビューのみ |
| ラジオ／レコメンド配信       | ✅ パーソナル FM | 🚧 キーワード擬似ラジオ | 🚧 短いプレビュー | ✅ 編集チャート |
| 検索                         | ✅ | ✅ | 🚧 制限あり | ✅ |
| ローカルいいね／興味なし     | ✅ | ✅ | ✅ | ✅ |
| ♥ をプラットフォームへ反映   | ✅ | ✅ | ✅ | ✅ |
| 既存のいいね曲をインポート   | ✅ | ✅ | ✅ | ✅ |

### 横断的なプロダクト機能

| 機能                                            | 状態 |
| ----------------------------------------------- | :--: |
| マルチソースプレーヤー基盤（Electron / React / Nest） | ✅ |
| プラットフォーム別ログインとセッション永続化    | ✅ |
| サーバーサイド音声プロキシ（実 URL は UI に出さない） | ✅ |
| **AETHER シアター视图**（1440×900 ホログラムオービットカバー + 歌詞ストリーム + エナジーコア + ネビュラ背景、Figma 駆動） | ✅ (PR #56) |
| ライト / ダーク / システムテーマ                | ✅ |
| **統合マルチソース検索と再生フォールバック**    | ✅ |
| **クロスプラットフォーム曲照合**（ISRC + タイトル/アーティスト/尺 あいまい；アーティスト別名は `@maestro/common` 経由でブリッジ） | ✅ |
| **統合いいね曲ライブラリ**（インポート + 重複排除；バッジ数は共有 normalizer でエンドツーエンド一致） | ✅ |
| **DeepSeek BYO キー AI レコメンド**             | ✅ |
| **権利のある全プラットフォームへの ♥ 一括付与** | ✅ |
| **Spotify アダプター**（OAuth PKCE + 読み取り + ♥ 書き戻し + WPS フル尺 Premium） | ⚠️ dev 完了 · **license 500** が本番を阻害 |
| フロントエンド構成：CSS/tsx 分離 + SCSS 7-1 + 巨石分割 | ✅ (PR #13) |
| **castLabs Electron fork**（Widevine CDM + dev VMP —— **本番 VMP は EVS 必須**） | ✅ (PR #39) / v31→v43 アップグレード (PR #52) |
| **Figma 駆動デザインパイプライン**（`.superdesign/` ブリーフ → `scripts/figma-aether-v4-*.mjs` ビルド → `figma-remote` MCP 監査 → PR #56） | ✅ (PR #56) |
| **本番パッケージング**（NestJS サイドカー + prod API ベース + **Apple Dev + castLabs EVS VMP 署名**） | 🚧 作業中 |

**おおよその完成度：約 85%。** 本プロダクトを定義づける中核機能（統合検索、
照合エンジン、ライブラリ、DeepSeek レコメンド、♥ 一括付与）はエンドツーエンド
で動作します。残りは本番パッケージングと少数のプラットフォーム対等項目
—— [NEXT-ITERATION.md](./NEXT-ITERATION.md) を参照。

---

## アーキテクチャ

```
┌──────────────────────────────────────────────────────────────┐
│  レンダラー (React + Vite, :5173)                             │
│   - Vite-dev が /api/*, /music/*, /auth/*, /reco/* を :3200  │
│     にプロキシ                                                │
│   - <audio> src = /music/stream/{provider}/{id}              │
│   - ジャケット配色抽出、テーマ、ソース切替                    │
│                                                               │
│   src/                                                        │
│     App.tsx        シンな合成レイヤー                          │
│     hooks/         8 つの集中フック（player がオーディオコア）│
│     components/    6 グループにわたる 19 コンポーネント         │
│     lib/           format · storage · coverColor              │
│     styles/        SCSS 7-1（abstracts / base / components）  │
│                    —— main.scss 単一、tsx にはスタイル import なし│
└───────────────────────────────┬──────────────────────────────┘
                                │ HTTP（cookie セッション）
┌───────────────────────────────▼──────────────────────────────┐
│  NestJS サーバー (:3200)                                      │
│   common/   ConfigService · StorageService · SessionService  │
│   auth/     QQ cookie · NetEase QR · Spotify OAuth-PKCE       │
│   music/    プロバイダー別ストラテジー + 音声プロキシ         │
│             + カバープロキシ                                  │
│   library/  インポート + 統合ライブラリ（読み / 書き）         │
│   match/    クロスプラットフォーム曲解析（ISRC + あいまい）   │
│   reco/     DeepSeek BYO キー レコメンド                      │
│   like/     ♥ ファンアウト                                    │
│                                                               │
│   全プロバイダーが共通の MusicProvider インターフェースを実装  │
│   （common/provider.ts）、music/<name>.provider.ts に配置    │
└───────────────────────────────┬──────────────────────────────┘
                                │ HTTPS（各プラットフォーム認証情報付き）
       ┌──────────────┬─────────┴──────────┬──────────────┐
       ▼              ▼                     ▼              ▼
  music.163.com   y.qq.com            Spotify Web API  api.deezer.com
  （weapi AES/RSA） （検索 + GetVkey）  （OAuth PKCE）   （公開 API）
```

**Electron メインプロセス**はさらに、埋め込みログインウィンドウ（実際の
Chromium セッションで QQ Music のログイン cookie を取得）と、埋め込み
NetEase ログインウィンドウ（NetEase のリスク制御がサーバーサイド QR ポーリング
を拒否するため）、そしてパッケージビルドのサイドカー管理（WIP）をホストします。
セッションといいね／興味なしの状態は `packages/server/.storage/state.json`
（git 管理外）に永続化されます。

---

## プロジェクト構成

```
packages/
  electron/   Electron メインプロセス
              src/main.ts, src/preload.ts, src/recorder.ts
              + castLabs fork（v43.2.0+wvcus）が Widevine CDM + VMP 署名を担当
  renderer/   React フロントエンド
              src/
                App.tsx                  合成レイヤー（<TheaterView/> をマウント）
                main.tsx                 エントリ
                api.ts                   データ層
                hooks/                   8 つのフック（usePlayer がオーディオコア、
                                          useSpotifyWpsPlayer が Premium 全曲）
                components/
                  common/     Modal · ErrorPanel
                  layout/     Titlebar · SourceMenu · QualityMenu · DeezerPresetSelect
                  player/     CoverCard · NowPlayingCard · LyricsCard · LyricsPanel
                              ProgressBar · VolumeControl · VolumeIcon · TransportBar
                  search/     SearchPanel · SourceChip
                  modals/     NeteaseCookieModal · RecoKeyModal
                              LikedLibraryModal · SettingsModal
                  source-select/SourceSelect
                  views/      TheaterView       ← AETHER シアター主画面（PR #56）
                lib/         format · storage · coverColor · lyrics cache
                              · likedCache · spotify-wps · debug (wpsLog/Error)
                styles/      main.scss + SCSS 7-1 partials
                              components/_theater.scss（シアター样式、約 900 行）
                              components/_app-shell.scss（.theater-mode 切替含む）
  server/     NestJS バックエンド
              src/
                common/   config · storage · session · provider レジストリ
                          · timeout（withTimeout、5s 単一プラットフォーム）
                          · lyrics · normalizer（fuzzyKey / stripFeatTags /
                            cjkUnify、renderer groupLibraryItems と共有）
                auth/     auth コントローラ + QQ / NetEase / Spotify ストラテジー
                music/    music コントローラ + 4 プロバイダー + 音声/カバー プロキシ
                          + netease-crypto（weapi AES/RSA）+ キュレーション別名表
                          + library-import + lyrics aggregate + WPS source picker
                library/  いいねインポート + 統合ライブラリ（読み / 書き）
                match/    クロスプラットフォーム曲解析（ISRC + あいまい）
                reco/     DeepSeek レコメンドエンジン
                like/     ♥ ファンアウト
  common/     @maestro/common —— 跨パッケージ型 / normalizer / artistAlias / インターフェース
specs/        Phase 別 spec ファイル（P0–P6 + packaging + 横断関心ごと）、
              それぞれに tasks.md

# ツールとデザインパイプライン
.mcp.json          figma-remote MCP（AI が Figma を読み / 書き）
.codex/            Codex CLI 設定 (config.toml)
.opencode/         OpenCode コマンドテンプレート + node_modules
.superdesign/      デザインブリーフ + デザイン稿（A/B ドラフト HTML + PNG）— AETHER ビジュアルソース
docs/              段階的長文書：aether-theater-v4-spec.md · figma-driven-frontend.md
                   · audit-2026-07-30.md · ISSUES.md · interview-questions-2026.md
scripts/           test.sh · lint.sh · figma-aether-v4-{foundations,components,
                   screens,motion,icons,cleanup,audit,snapshot,smoke,typecheck}.mjs
                   · final-merge · export-qq-artists · audit-liked など

.env.example       開発環境変数（すべて任意、妥当なデフォルトあり）
```

---

## セットアップ

```bash
# Node 18+ が必要（Node 22 推奨）。npm workspaces を使用。
npm install

cp .env.example .env    # 任意 —— 各変数に妥当な開発デフォルトあり
```

## 開発

```bash
npm run dev
# 並行実行：
#   nest start --watch   → サーバー :3200
#   vite                 → レンダラー :5173
#   electron             → 3 秒後にウィンドウを開く
```

Vite 開発サーバーは `/api/*`（`/api` プレフィックスを除去）、`/music/*`、
`/auth/*`、`/reco/*` を `:3200` の NestJS にプロキシします。そのため開発時は
アプリ全体が同一オリジンとなり、1 つのセッション cookie を共有します。

## 環境変数

開発時はすべて任意で、サーバーは妥当なデフォルトにフォールバックします。

| 変数 | デフォルト | 備考 |
| --- | --- | --- |
| `PORT` | `3200` | NestJS ポート |
| `RENDERER_BASE` | `http://localhost:5173` | ログイン後のリダイレクト基点 |
| `RENDERER_ORIGINS` | `http://localhost:5173,http://localhost:3000` | CORS 許可リスト |
| `SESSION_SECRET` | 開発用プレースホルダ | Cookie 署名鍵 —— **本番では設定必須** |
| `SESSION_TTL_MS` | 30 日 | セッション有効期間 |
| `STORAGE_DIR` | `.storage` | `state.json` の保存先 |
| `NETEASE_MUSIC_U` | – | 開発専用：NetEase `MUSIC_U` cookie を注入 |
| `NETEASE_QR_POLL_MS` | `1500` | QR ポーリング間隔 |
| `DEEPSEEK_API_KEY` | – | **実行時にあなたが提供**（BYO キー）—— サーバーは session から読み取る |

---

## 各ソースへのログイン

- **NetEase Cloud Music** —— 「登录」をクリックし、NetEase のスマホアプリで
  QR コードをスキャンして確認。サーバーが NetEase の `/api/login/qrcode/*`
  エンドポイントを直接叩き、成功時に `Set-Cookie` から `MUSIC_U` を取得します。
  「`MUSIC_U` を手動貼り付け」のフォールバックもあり。cookie は約 30 日有効で、
  `301` が返り始めたら再スキャンしてください。
- **QQ Music** —— 「登录」をクリック（デスクトップアプリのみ）。Maestro が
  埋め込みの QQ Music ログインウィンドウを開き、実際のログイン cookie
  （`qm_keyst` / `qqmusic_key` / `uin`）を取得します。QQ Connect OAuth は
  **不使用**、AppID/シークレット不要。以降、検索とフル尺再生（標準 / 320 kbps
  / ロスレス）が可能。ロスレスには QQ Music の会員が必要です。
- **Deezer** —— ログイン不要。匿名の公開編集チャートで 30 秒プレビューを再生。
- **Spotify** —— 「登录」をクリック、OAuth PKCE フロー。v1 実装済み：いいね
  読み取り + ♥ 書き戻し（`PUT /v1/me/tracks`）。フル尺再生は Spotify Premium
  が必要（現状 license 500 でブロック、上述）。

---

## 本番ビルド

```bash
npm run build   # tsc server + vite renderer + tsc electron
```

成果物：

- `packages/server/dist/` —— コンパイル済み NestJS（単体実行可：`node packages/server/dist/main.js` で :3200 を起動）
- `packages/renderer/dist/` —— Vite の静的バンドル
- `packages/electron/dist/` —— コンパイル済み Electron main + preload

### macOS `.dmg` パッケージング

```bash
# アプリアイコン + トレイ glyph（build/icon.icns, build/trayTemplate*.png）。
# 既にコミット済み。scripts/gen-icons.cjs を変更したときだけ再実行。
cd packages/electron && npm run gen-icons

# まず全部ビルド、それからパッケージ。dev 中はコード署名を無効化
# （electron-builder は Developer ID 証明書を探してストールするため）。
npm run build
cd packages/electron && CSC_IDENTITY_AUTO_DISCOVERY=false npm run pack
# → packages/electron/release/*.dmg
```

パッケージ後の動作：

- **サイドカー**：Electron main が `resources/server/main.js` を NestJS サイド
  カーとして子プロセス起動し、`:3200/music/deezer/editorials` を準備完了まで
  ポーリングしてからウィンドウを開きます。終了時（Cmd+Q / トレイ「退出」）に
  サイドカーを kill します。
- **API ベース**：preload が `window.electronAPI.apiBase` を公開し、renderer
  の `api.ts` が dev の `localhost:3200` フォールバックより優先します。
- **extraResources**：`renderer/`、`server/`（コンパイル済み dist）、`build/`
  （アイコン）を `.app/Contents/Resources/` にコピー。
- **トレイ**：メニューバーのトレイアイコンに 再生/一時停止、前/次の曲、
  ウィンドウ表示、終了。メインウィンドウを閉じるとトレイに隠れる（再生は続く）。
  App を終了するには Cmd+Q またはトレイの「退出」項目を使う必要があります。

> **既知の制限** —— サイドカーにはサーバーのランタイム `node_modules` が
> 必要です。npm workspaces はこれらをリポジトリルートにホイストするため、
> 完全な自己完結 `.dmg` には依然としてサーバー依存を同梱する必要があります
> （あるいは NestJS のデコレータメタデータを保つ esbuild バンドル）。
> `specs/packaging/spec.md` → 「既知の制限」参照。dev（`npm run dev`）が
> 完全にサポートされた実行方法です。

---

## 次のイテレーション

[各項目ごとの意図と受入基準は [NEXT-ITERATION.md](./NEXT-ITERATION.md) を参照。
概観：

1. **本番パッケージング** —— NestJS サイドカー + 正しい prod API ベースで
   `electron-builder` が実用的な App を出せるようにする。
2. **Spotify 対等** —— Premium フル尺再生 + ♥ 書き戻し。
3. **ローカル永続化の強化** —— 統合ライブラリとセッション cookie のバックアップ /
   リストア。再インストールで状態を失わない。
4. **歌詞品質** —— 既存の歌詞取得をもっと目立たせ、「タップでコピー」「タップで
   共有」のアフォーダンスを追加。
5. **Settings とオンボーディングの仕上げ** —— 初回起動時の Key フロー、ライブラリ
   バックアップ場所、ソース接続ヘルス。

---

## プライバシーとセキュリティ

これは**ローカルファーストの個人用ツール**です。プラットフォームの cookie
（`MUSIC_U`、QQ ログイン cookie、Spotify リフレッシュトークン）、セッション、
DeepSeek API キー、統合ライブラリは、あなた自身のマシン上の
`packages/server/.storage/` に**平文**で保存され、**git 管理外**です。
Maestro が運営するサービス（存在しません）へアップロードされるものは一切
ありません。`.storage/` はパスワードファイルと同様に扱ってください。

## ライセンス

MIT
