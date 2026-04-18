# スタイリング・デザインシステム設計書

## 関連ドキュメント
- [設計概要](./overview.md)
- [フロントエンド設計](./frontend-design.md)
- [アプリ構成](./app-architecture.md)

---

## 1. 基本方針

- **Tailwind CSS 禁止**（`.claude/rules/no-tailwind.md`）
- **CSS Modules + CSS Custom Properties** で実装
- グローバルはデザイントークンとリセットのみ。要素スタイルは必ず `*.module.css` に閉じる
- 命名は **BEM風**（`.block`, `.block__element`, `.block--modifier`）
- ダークモード: Phase 1 はライトモードのみ。CSS Custom Properties 構造はダーク切替しやすく設計

---

## 2. ディレクトリ構成

```
src/styles/
├── tokens.css          ← CSS Custom Properties（色・タイポ・spacing）
├── reset.css           ← 最小リセット
├── breakpoints.css     ← メディアクエリ変数（コメントで共有）
└── typography.css      ← フォントフェース設定

src/app/globals.css     ← 上記を @import
src/components/*/*.module.css  ← コンポーネント個別スタイル
```

---

## 3. デザイントークン（`tokens.css`）

### 3.1 カラー

地域メディアの落ち着いたブランドカラーを基調とする。彩度は抑えめ、可読性重視。

```css
:root {
  /* Brand */
  --color-brand-primary:   #2c6e8f;   /* 高津の青みを想起 */
  --color-brand-secondary: #e4a853;   /* アクセント（金茶） */

  /* Neutrals */
  --color-bg:              #fafafa;   /* アプリ背景 */
  --color-surface:         #ffffff;   /* カード・バブル */
  --color-surface-alt:     #f2f3f5;   /* 専門家バブル背景 */
  --color-border:          #e3e5e8;
  --color-border-strong:   #c9cdd3;

  --color-text:            #1e2125;   /* 本文 */
  --color-text-muted:      #5c636b;   /* セカンダリ */
  --color-text-disabled:   #9aa0a6;

  /* Semantic */
  --color-success:         #2e8b57;
  --color-warning:         #c17f00;
  --color-error:           #c1362c;
  --color-info:            #2e6fbf;

  /* Chat roles */
  --color-bubble-user-bg:      #2c6e8f;
  --color-bubble-user-text:    #ffffff;
  --color-bubble-assistant-bg: #ffffff;
  --color-bubble-assistant-text: #1e2125;
  --color-bubble-assistant-border: #e3e5e8;

  /* Focus */
  --color-focus-ring: #3a8bc0;
}
```

### 3.2 コントラスト確認
- `--color-text` (#1e2125) on `--color-bg` (#fafafa): コントラスト 15:1（AAA）
- `--color-bubble-user-text` (#fff) on `--color-bubble-user-bg` (#2c6e8f): 約 5.6:1（AA）
- `--color-text-muted` on `--color-bg`: 約 6.2:1（AA）

### 3.3 タイポグラフィ

```css
:root {
  --font-sans:
    -apple-system, BlinkMacSystemFont,
    "Helvetica Neue", "Hiragino Sans", "Hiragino Kaku Gothic ProN",
    "Noto Sans JP", "Yu Gothic Medium", "Meiryo", sans-serif;
  --font-mono:
    "SFMono-Regular", "Menlo", "Consolas", "Hiragino Kaku Gothic ProN", monospace;

  --font-size-xs:   0.75rem;   /* 12px */
  --font-size-sm:   0.875rem;  /* 14px */
  --font-size-base: 1rem;      /* 16px */
  --font-size-md:   1.0625rem; /* 17px, モバイル読みやすさ */
  --font-size-lg:   1.25rem;   /* 20px */
  --font-size-xl:   1.5rem;    /* 24px */

  --line-height-tight:  1.25;
  --line-height-normal: 1.55;
  --line-height-relaxed: 1.75;

  --font-weight-regular: 400;
  --font-weight-medium: 500;
  --font-weight-bold:   700;
}
```

- 本文基準サイズ: モバイル 17px、PC 16px（メディアクエリで切替）
- 和文は line-height 1.55〜1.75 で可読性を確保
- 英文 `code` のみ `--font-mono`

### 3.4 スペーシング

```css
:root {
  --space-0: 0;
  --space-1: 0.25rem;  /* 4px */
  --space-2: 0.5rem;   /* 8px */
  --space-3: 0.75rem;  /* 12px */
  --space-4: 1rem;     /* 16px */
  --space-5: 1.5rem;   /* 24px */
  --space-6: 2rem;     /* 32px */
  --space-7: 3rem;     /* 48px */
  --space-8: 4rem;     /* 64px */
}
```

### 3.5 半径・影・アニメーション

```css
:root {
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 16px;
  --radius-pill: 9999px;

  --shadow-xs: 0 1px 2px rgba(0,0,0,0.06);
  --shadow-sm: 0 2px 6px rgba(0,0,0,0.08);
  --shadow-md: 0 6px 16px rgba(0,0,0,0.10);

  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --duration-fast: 120ms;
  --duration-base: 200ms;
  --duration-slow: 320ms;
}
```

### 3.6 Z-index

```css
:root {
  --z-base:    0;
  --z-content: 10;
  --z-header:  20;
  --z-input:   30;
  --z-toast:   50;
  --z-modal:   100;
}
```

---

## 4. ブレークポイント (`breakpoints.css`)

CSS Custom Properties ではメディアクエリを値に使えないため、**プロジェクト共通のコメントブロック**として定義し、各 `*.module.css` で同じ値をハードコードする。

```css
/* src/styles/breakpoints.css (共有ドキュメント)

  --bp-mobile:  〜 640px
  --bp-tablet:  641px 〜 1024px
  --bp-desktop: 1025px 〜

  メディアクエリ (min-width ベース)
  @media (min-width: 641px)  → tablet 以上
  @media (min-width: 1025px) → desktop 以上
*/
```

補助として **PostCSS の custom-media** を導入してもよい（Phase 1 は省略）。

### 4.1 推奨パターン（モバイルファースト）

```css
.container {
  padding: var(--space-3);
}
@media (min-width: 641px) {
  .container { padding: var(--space-5); }
}
@media (min-width: 1025px) {
  .container { padding: var(--space-6); max-width: 960px; margin-inline: auto; }
}
```

---

## 5. グローバルリセット (`reset.css`)

```css
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
html { -webkit-text-size-adjust: 100%; }
body {
  font-family: var(--font-sans);
  font-size: var(--font-size-md);
  line-height: var(--line-height-normal);
  color: var(--color-text);
  background: var(--color-bg);
  min-height: 100dvh;
  font-feature-settings: "palt" 1; /* 和文の詰め */
}
button { font: inherit; cursor: pointer; background: none; border: 0; padding: 0; }
a { color: var(--color-brand-primary); text-decoration: underline; }
a:hover { opacity: 0.8; }
img, svg { display: block; max-width: 100%; }
input, textarea { font: inherit; color: inherit; }
textarea { resize: vertical; }
:focus { outline: none; }
:focus-visible { outline: 2px solid var(--color-focus-ring); outline-offset: 2px; }

@media (min-width: 1025px) {
  body { font-size: var(--font-size-base); }
}
```

---

## 6. コンポーネント別スタイル指針

### 6.1 ChatWindow
```css
.chatWindow {
  display: flex; flex-direction: column;
  height: 100dvh;
  max-width: 100%;
}
@media (min-width: 1025px) {
  .chatWindow { max-width: 960px; margin-inline: auto; }
}
```

### 6.2 MessageBubble
```css
.bubble {
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  line-height: var(--line-height-normal);
  word-break: break-word;
  overflow-wrap: anywhere;
  max-width: 88%;
}
.bubble--user {
  align-self: flex-end;
  background: var(--color-bubble-user-bg);
  color: var(--color-bubble-user-text);
  border-radius: var(--radius-md) var(--radius-md) var(--radius-sm) var(--radius-md);
}
.bubble--assistant {
  align-self: flex-start;
  background: var(--color-bubble-assistant-bg);
  color: var(--color-bubble-assistant-text);
  border: 1px solid var(--color-bubble-assistant-border);
  border-radius: var(--radius-md) var(--radius-md) var(--radius-md) var(--radius-sm);
}
@media (min-width: 641px) { .bubble { max-width: 72%; } }
```

### 6.3 MessageInput
```css
.form {
  display: flex; gap: var(--space-2);
  padding: var(--space-3);
  padding-bottom: calc(var(--space-3) + env(safe-area-inset-bottom));
  border-top: 1px solid var(--color-border);
  background: var(--color-surface);
  position: sticky; bottom: 0;
  z-index: var(--z-input);
}
.textarea {
  flex: 1;
  min-height: 44px;
  max-height: 180px;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  font-size: var(--font-size-md);
}
.submit {
  min-width: 64px; min-height: 44px;
  padding: 0 var(--space-4);
  background: var(--color-brand-primary);
  color: #fff;
  border-radius: var(--radius-md);
  font-weight: var(--font-weight-medium);
}
.submit:disabled { opacity: 0.5; cursor: not-allowed; }
```

### 6.4 ContextProgressBar

要件 3.5.3「ごく簡単」:
```css
.progress {
  height: 2px; width: 100%;
  background: var(--color-border);
  overflow: hidden;
}
.progressFill {
  height: 100%;
  background: var(--color-brand-primary);
  transition: width var(--duration-base) var(--ease-out);
}
```

### 6.5 SpecialistTrace
```css
.trace {
  margin-top: var(--space-2);
  font-size: var(--font-size-sm);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface-alt);
}
.trace summary {
  cursor: pointer;
  padding: var(--space-2) var(--space-3);
  color: var(--color-text-muted);
}
.trace[open] summary { border-bottom: 1px solid var(--color-border); }
```

---

## 7. アイコン

- Phase 1 は **インライン SVG**（ライブラリ不使用）
- 必要最低限: 送信（✈）、ログアウト、警告、展開矢印
- `aria-label` か `<title>` を必ず付与
- 24×24 or 20×20 viewBox を基本

---

## 8. モーション

- 過剰なアニメーションは避け、**onload は無し**
- 使うのは:
  - メッセージ追加のフェードイン（opacity 0→1, 150ms）
  - プログレスバーの幅トランジション
  - トーストのスライドイン
- `prefers-reduced-motion: reduce` に対応し、上記を抑制

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
```

---

## 9. フォーム・状態の一貫性

| 状態 | 見た目 |
|---|---|
| `:hover`（PC） | 背景を微暗化 or opacity 0.9 |
| `:focus-visible` | `--color-focus-ring` の 2px ring |
| `:disabled` | opacity 0.5, `cursor: not-allowed` |
| `aria-invalid="true"` | border: `--color-error`, 下にエラー文 |

---

## 10. ダークモードへの拡張余地

`:root` に対して `@media (prefers-color-scheme: dark)` または `[data-theme="dark"]` で上書き可能な構造を維持。
Phase 1 では実装しないが、**全色を CSS 変数経由で参照する規約**は必ず守る（`.bubble { background: #2c6e8f; }` のような直値禁止）。

---

## 11. 未決定事項

- ブランドカラー最終決定（#2c6e8f は仮、デザイナー確認待ち）
- ロゴ・ファビコン
- 見出し用ディスプレイフォントの導入要否
- `react-markdown` 内の要素（コードブロック等）のテーマ
