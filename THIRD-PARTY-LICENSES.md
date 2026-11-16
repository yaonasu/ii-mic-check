# Third-Party Licenses (`ii-mic-check`)

本アプリケーション（`ii-mic-check`）は、以下のオープンソースソフトウェアを利用しています。各ライブラリのライセンス条件に従い、著作権表示およびライセンス全文を保持します。

---

## 1. 配信バンドルに含まれる実行時・生成出力ライブラリ（Runtime & Distributed Output）

### React / React DOM / Scheduler (`react`, `react-dom`, `scheduler`)
- **Packages**: `react` (`19.3.1`), `react-dom` (`19.3.1`), `scheduler` (`0.28.0` / `react-dom` の間接依存としてバンドル)
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
- **Package**: `lucide-react` (`0.546.0`)
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

### Workbox ランタイム（PWA クライアント / Service Worker）
- **Packages**: `workbox-window` (`7.4.1`), `workbox-core` (`7.4.1`), `workbox-precaching` (`7.4.1`), `workbox-routing` (`7.4.1`), `workbox-strategies` (`7.4.1`), `workbox-build` (`7.4.1`)
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

### Tailwind CSS (`tailwindcss`) — 配信 CSS（Preflight・ユーティリティ出力）
- **Package**: `tailwindcss` (`4.3.3`)（生成された CSS バンドル `dist/assets/*.css` に Preflight ベーススタイルおよびユーティリティスタイルが含まれます）
- **License**: MIT License
- **Copyright**: `Copyright (c) Tailwind Labs, Inc.`

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

### Vite ランタイム補助コード (`vite`)
- **Package**: `vite` (`8.3.5`)（モジュールプリロード補助コードが `dist/assets/*.js` に含まれます）
- **License**: MIT License
- **Copyright**: `Copyright (c) 2019-present, VoidZero Inc. and Vite contributors`

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

以下はビルド・型チェック・CSS生成・テスト実行時に使用される主な開発ツールおよび間接依存のライセンス概要です（JSバンドル本体には原則同梱されません。配信 CSS / ランタイム補助に含まれるものは上記セクション 1 に記載しています）。

| パッケージ | 主な用途 | ライセンス |
|---|---|---|
| `vite` / `@vitejs/plugin-react` / `vite-plugin-pwa` | バンドラー・PWA生成 | MIT |
| `tailwindcss` / `@tailwindcss/vite` | CSS ビルド | MIT |
| `tsx`（間接依存 `esbuild` を含む） | トランスパイル・テスト実行 | MIT |
| `typescript` / `@types/node` / `@types/react` / `@types/react-dom` | 型チェック・型定義 | Apache-2.0 / MIT |
| `lightningcss`（Vite / Tailwind CSS 間接依存） | CSS 変換エンジン | MPL-2.0 |
| `caniuse-lite`（`browserslist` 等間接依存） | ブラウザ互換性データ | CC-BY-4.0 |

---

## 3. プロジェクト内 `Apache-2.0` 適用部分の注記

`src/App.tsx` および `src/utils/wavExport.ts` に付与されている `SPDX-License-Identifier: Apache-2.0` 表示部分およびテンプレート由来コードについては、引き続き **Apache License, Version 2.0**（`https://www.apache.org/licenses/LICENSE-2.0`）が適用されます。
