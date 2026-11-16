# ii-mic-check（マイク音質チェッカー）

マイクやヘッドセットの入力音声をブラウザ内だけで録音・確認・比較できる、完全ローカル動作の音響チェックツール（PWA）です。

- **公開URL**: https://yaonasu.github.io/ii-mic-check/
- **詳細デバッグ表示**: https://yaonasu.github.io/ii-mic-check/?debug=1

---

## 主な特徴

- **ガイド付き測定**: 事前周辺音（3秒）→ 発声 → 事後周辺音（2秒）の順で記録し、声と環境雑音を分離して確認できます。
- **リアルタイム音量モニター & 波形再生**: 録音中の音量バー、録音後のカラー分け波形（発声区間／周辺音区間）、原音量・音量正規化後の聞き比べ、WAVダウンロードに対応しています。
- **暫定100点スコアと4項目評価**: 入力音量（20）・ノイズ性能（35）・周波数特性（25）・音声の安定性（20）の参考スコアと改善アドバイスを表示します。
- **最大4件の並列比較**: 異なるマイクや同じマイクの複数回録音を最大4件まで並べて比較し、5段階の主観聴感評価メモを残せます。
- **通常モード / `?debug=1` モード分離**: デフォルトは専門用語を抑えた一般ユーザー向け表示で、`?debug=1` を付けた場合のみ詳細DSP指標・診断ログ・CSV/JSON/HTMLエクスポートを表示します。

---

## プライバシーとデータの取り扱い（重要）

1. **完全ローカル処理（外部送信なし）**
   - 録音した音声データ、音響解析結果、マイク機器情報はすべてブラウザ内の Web Audio API とローカル JavaScript 演算のみで処理されます。
   - 外部サーバー・クラウド・AI API への音声や測定データの送信は一切行いません。
   - 本リポジトリには API キーや認証情報は含まれていません。
2. **録音データの保持と再読み込み時の動作**
   - 録音音声と測定結果（最大4件、FIFO方式）はブラウザのメモリ上にのみ保持されます。
   - **ページの再読み込みやタブを閉じると、録音一覧と音声データはすべて消去されます。**
   - ご自身で入力した「5段階聴感評価（主観メモ）」のみ、利便性のため端末内の `localStorage` に保存されます。
3. **エクスポートデータの注意**
   - `?debug=1` モードで出力できる HTML レポートには、オフライン再生用の録音音声（16bit PCM WAV の Base64 データ）が埋め込まれます。外部へ共有する際は音声内容の機密性にご注意ください。

---

## 暫定スコアの限界とご利用上の注意

- 表示される 100 点スコア（`phase2c-provisional-v2`）は客観測定値に基づく**暫定の参考評価**であり、人間が感じる音質や聞き取りやすさを保証・完全に予測するものではありません。
- Teams、Zoom、Google Meet などの Web 会議アプリでは、アプリ側・OS側のノイズ抑制、エコーキャンセラー、音量自動調整、音声コーデック等によって相手に届く音声が大きく変化する場合があります。
- マイク利用には HTTPS 環境（または `localhost`）とブラウザのマイク許可が必要です。また、再生出力先の切り替え機能（`setSinkId`）は未対応のブラウザ（Safari / iOS 等）では OS 既定のデバイスから再生されます。

---

## ローカル開発・ビルド手順

### 前提環境
- Node.js v18 以上（v20 以上推奨）
- npm

### インストール・起動・ビルド

```bash
npm install
npm run dev       # ローカル開発サーバー起動 (http://localhost:3000/ii-mic-check/)
npm run lint      # TypeScript 型チェック (tsc --noEmit)
npm run build     # 本番ビルド (dist/ 出力, base=/ii-mic-check/)
```

---

## 主なファイル構成

- `src/App.tsx`: メイン画面・録音シーケンス制御・機器選択・注意表記
- `src/components/AudioVisualizer.tsx`: リアルタイム音量モニター・スペクトル表示
- `src/components/RecordedClipView.tsx`: 録音再生（原音/音量正規化・区間抽出）・波形・WAVダウンロード・5段階聴感評価
- `src/components/EvaluationSummary.tsx`: 通常モード / デバッグモード別の評価表示
- `src/components/ComparisonTable.tsx`: 最大4件の録音比較ビュー
- `src/utils/audioDsp.ts`: Web Audio / FFT / VAD ローカル DSP 解析エンジン
- `src/utils/provisionalScoring.ts`: 暫定100点採点ロジック（`phase2c-provisional-v2`）
- `src/utils/playbackNormalization.ts`: 再生時音量正規化ロジック
- `src/utils/wavExport.ts`: 16bit PCM WAV エンコード・ダウンロード
- `src/utils/reportExport.ts`: スタンドアロン HTML レポート出力
- `src/utils/verificationExport.ts`: CSV / JSON / 診断ログ出力・`localStorage` 永続化
- `src/utils/viewMode.ts`: URL クエリ `?debug=1` 判定
- `vite.config.ts`: Vite (`base: '/ii-mic-check/'`) および PWA 設定

---

## サードパーティライセンス

本アプリが依存するオープンソースソフトウェアの著作権表示およびライセンス条件については、[THIRD-PARTY-LICENSES.md](./THIRD-PARTY-LICENSES.md) をご参照ください。
