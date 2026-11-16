# Third-Party Licenses (`ii-mic-check`)

本アプリケーション（`ii-mic-check`）は、以下のオープンソースソフトウェアを利用しています。各ライブラリのライセンス条件に従い、著作権表示およびライセンス文を保持します。

---

## 1. 配信バンドルに含まれる実行時依存ライブラリ（Runtime Dependencies）

### React / React DOM (`react`, `react-dom`)
- **License**: MIT License
- **Copyright**: `Copyright (c) Meta Platforms, Inc. and affiliates.`

```text
MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

### Lucide React (`lucide-react`)
- **License**: ISC License
- **Copyright**:
  - `Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2023 as part of Feather (MIT).`
  - `All other copyright (c) for Lucide are held by Lucide Contributors 2025.`

```text
ISC License

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

---

### Workbox Window (`workbox-window`) / Service Worker ランタイム
- **License**: MIT License
- **Copyright**: `Copyright 2018 Google LLC`

```text
MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 2. ビルド・開発ツール依存ライブラリ（Build / Dev Dependencies）

以下はビルド・型チェック・CSS生成・テスト実行時に使用される主な開発ツールおよび間接依存のライセンス概要です（配信されるアプリケーション JS バンドルには直接同梱されません）。

| パッケージ | 主な用途 | ライセンス |
|---|---|---|
| `vite` / `@vitejs/plugin-react` / `vite-plugin-pwa` | バンドラー・PWA生成 | MIT |
| `tailwindcss` / `@tailwindcss/vite` / `autoprefixer` | CSS ビルド | MIT |
| `esbuild` / `tsx` | トランスパイル・テスト実行 | MIT |
| `typescript` | 型チェック | Apache-2.0 |
| `lightningcss`（Tailwind CSS 間接依存） | CSS 変換エンジン | MPL-2.0 |
| `caniuse-lite`（Autoprefixer 間接依存） | ブラウザ互換性データ | CC-BY-4.0 |

※ `package.json` テンプレート由来で記載されている未使用パッケージ（`@google/genai` [Apache-2.0], `express` [MIT], `dotenv` [BSD-2-Clause], `motion` [MIT]）は `src/` からインポートされておらず、配信バンドルには含まれません。
