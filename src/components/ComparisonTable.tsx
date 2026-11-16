import React from 'react';
import { HeadsetEvaluation, MetricDescriptiveStats, RecordedClip, SubjectiveRating } from '../types/audio';
import { formatDb, normalizeEvaluationCompatibility } from '../utils/audioDsp';
import { generateComparisonHtml, downloadHtmlFile } from '../utils/reportExport';
import {
  DEVICE_COMPARISON_METRIC_DEFS,
  clipsToCsv,
  clipsToJson,
  computeDeviceComparisonGroups,
  deviceComparisonToCsv,
  downloadCsvFile,
  downloadJsonFile,
  formatSubjectiveRatingSummary,
  formatTrackSettingsSummary,
  hasLegacyUnknownSubjectiveRating,
  isValidSubjectiveScore,
} from '../utils/verificationExport';
import {
  PROVISIONAL_SCORE_NOTICES,
  computeProvisionalScore,
} from '../utils/provisionalScoring';
import { BarChart3, Download, Info, AlertTriangle, FileSpreadsheet, FileJson, Layers } from 'lucide-react';

interface ComparisonTableProps {
  clips: RecordedClip[];
  isDebugMode?: boolean;
}

function extractConciseCautions(
  prov: ReturnType<typeof computeProvisionalScore>,
  evalData: HeadsetEvaluation
): Array<{ text: string; tone: 'rose' | 'amber' | 'cyan' }> {
  const cautions: Array<{ text: string; tone: 'rose' | 'amber' | 'cyan' }> = [];

  if (prov.status === 'unavailable' || prov.totalScore === null) {
    cautions.push({ text: '算出不能（必須指標未達/欠損）', tone: 'rose' });
  } else if (prov.isRescaled) {
    cautions.push({ text: '欠損項目あり（比例換算）', tone: 'amber' });
  }

  const ivMetrics = prov.items.inputVolume.metricValues || {};
  const npMetrics = prov.items.noisePerformance.metricValues || {};
  const fcMetrics = prov.items.frequencyCharacteristics.metricValues || {};
  const ssMetrics = prov.items.speechStability.metricValues || {};

  if (ivMetrics.hasClippingSign === true) {
    cautions.push({ text: 'クリッピング兆候', tone: 'rose' });
  } else if (
    typeof ivMetrics.clippedSampleCount === 'number' &&
    ivMetrics.clippedSampleCount > 0
  ) {
    cautions.push({ text: '0dBFS到達サンプル', tone: 'amber' });
  }

  if (typeof ivMetrics.speechAvgDbFS === 'number' && ivMetrics.speechAvgDbFS < -28) {
    cautions.push({ text: '入力音量小（正規化後確認推奨）', tone: 'cyan' });
  }

  if (npMetrics.noiseGateSuspected === true) {
    cautions.push({ text: 'ノイズゲート/抑制疑い', tone: 'amber' });
  }

  if (fcMetrics.highBandNoiseContaminationWarning === true) {
    cautions.push({ text: '低S/Nによる高域信頼性注意', tone: 'amber' });
  }

  if (ssMetrics.extremeVariationWarning === true) {
    cautions.push({ text: '音量変動大（IQR/幅）', tone: 'amber' });
  }

  if (npMetrics.noiseShiftWarning === true || evalData.noiseAnalysis?.hasNoiseLevelShiftWarning) {
    cautions.push({ text: '録音前後の暗騒音変動', tone: 'amber' });
  }

  return cautions;
}

function hasAnySubjectiveEntry(r: SubjectiveRating | undefined): boolean {
  if (!r) return false;
  return (
    isValidSubjectiveScore(r.intelligibilityOriginal) ||
    isValidSubjectiveScore(r.intelligibilityNormalized) ||
    isValidSubjectiveScore(r.lowMuffleness) ||
    isValidSubjectiveScore(r.lowBackgroundNoise) ||
    isValidSubjectiveScore(r.intelligibility) ||
    Boolean(r.notes?.trim())
  );
}

function extractSimpleCautions(
  prov: ReturnType<typeof computeProvisionalScore>,
  evalData: HeadsetEvaluation
): Array<{ text: string; tone: 'rose' | 'amber' | 'cyan' }> {
  const cautions: Array<{ text: string; tone: 'rose' | 'amber' | 'cyan' }> = [];

  if (prov.status === 'unavailable' || prov.totalScore === null || evalData.isMeasurable === false) {
    cautions.push({ text: '測定不可（録音し直し推奨）', tone: 'rose' });
    return cautions;
  }

  if (prov.isRescaled) {
    cautions.push({ text: '一部項目除外（換算あり）', tone: 'amber' });
  }

  const ivMetrics = prov.items.inputVolume.metricValues || {};
  const npMetrics = prov.items.noisePerformance.metricValues || {};
  const fcMetrics = prov.items.frequencyCharacteristics.metricValues || {};
  const ssMetrics = prov.items.speechStability.metricValues || {};

  if (ivMetrics.hasClippingSign === true) {
    cautions.push({ text: '音割れ注意', tone: 'rose' });
  } else if (
    typeof ivMetrics.clippedSampleCount === 'number' &&
    ivMetrics.clippedSampleCount > 0
  ) {
    cautions.push({ text: '音量上限付近', tone: 'amber' });
  }

  if (typeof ivMetrics.speechAvgDbFS === 'number' && ivMetrics.speechAvgDbFS < -28) {
    cautions.push({ text: '声の音量小さめ', tone: 'cyan' });
  }

  if (npMetrics.noiseGateSuspected === true) {
    cautions.push({ text: '雑音抑制機能の影響の可能性', tone: 'amber' });
  }

  if (fcMetrics.highBandNoiseContaminationWarning === true) {
    cautions.push({ text: '雑音による高音域精度注意', tone: 'amber' });
  }

  if (ssMetrics.extremeVariationWarning === true) {
    cautions.push({ text: '声の大きさの変動大きめ', tone: 'amber' });
  }

  if (npMetrics.noiseShiftWarning === true || evalData.noiseAnalysis?.hasNoiseLevelShiftWarning) {
    cautions.push({ text: '録音中に周囲の雑音が変化', tone: 'amber' });
  }

  return cautions;
}

export const ComparisonTable: React.FC<ComparisonTableProps> = ({
  clips,
  isDebugMode = false,
}) => {
  if (clips.length === 0) {
    return null;
  }

  const MAX_COMPARISON_CLIPS = 4;
  const comparedClips = clips.slice(0, MAX_COMPARISON_CLIPS);

  const handleDownloadComparisonReport = () => {
    if (comparedClips.length < 2) return;
    const html = generateComparisonHtml(comparedClips);
    const dateTag = new Date()
      .toISOString()
      .slice(0, 19)
      .replace(/[-:T]/g, '');
    const filename = `ii-mic-check-comparison-report-${dateTag}.html`;
    downloadHtmlFile(filename, html);
  };

  const handleDownloadCsv = () => {
    const csv = clipsToCsv(comparedClips);
    const dateTag = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
    downloadCsvFile(`ii-mic-check-comparison-${dateTag}.csv`, csv);
  };

  const handleDownloadDeviceStatsCsv = () => {
    const csv = deviceComparisonToCsv(comparedClips);
    const dateTag = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
    downloadCsvFile(`ii-mic-check-device-stats-${dateTag}.csv`, csv);
  };

  const handleDownloadJson = () => {
    const json = clipsToJson(comparedClips);
    const dateTag = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
    downloadJsonFile(`ii-mic-check-comparison-${dateTag}.json`, json);
  };

  // Precompute normalized evaluations and provisional scores once per clip
  const comparedEntries = comparedClips.map((clip, idx) => {
    const normalizedEval = normalizeEvaluationCompatibility(clip.evaluation);
    const prov = computeProvisionalScore(normalizedEval);
    const cautions = isDebugMode
      ? extractConciseCautions(prov, normalizedEval)
      : extractSimpleCautions(prov, normalizedEval);
    return {
      clip,
      idx,
      normalizedEval,
      prov,
      cautions,
      hasSubjective: hasAnySubjectiveEntry(clip.subjectiveRating),
    };
  });

  // Check version homogeneity
  const versions = Array.from(
    new Set(comparedEntries.map((e) => e.normalizedEval.algoVersion || 'v1.0'))
  );
  const hasMixedVersions = versions.length > 1;

  // Check legacy reference-mode presence for historical compatibility
  const modes = Array.from(
    new Set(comparedClips.map((c) => c.recordingMode || 'eval_with_voice'))
  );
  const hasMixedModes = modes.length > 1;
  const hasLegacyReferenceMode = comparedClips.some(
    (c) => c.recordingMode === 'eval_with_reference'
  );

  const deviceGroups = computeDeviceComparisonGroups(comparedClips);
  const multiRecordingGroups = deviceGroups.filter((g) => g.clipCount >= 2);

  const fmtStatVal = (stat: MetricDescriptiveStats, val: number | null): string => {
    if (val === null || !Number.isFinite(val)) return 'データなし';
    if (stat.unit === 'Hz') return `${val.toFixed(1)} Hz`;
    if (stat.unit === 'ratio') return val.toFixed(3);
    if (stat.unit === 'score_1_to_5') return val.toFixed(1);
    return `${val.toFixed(1)} ${stat.unit}`;
  };

  const cautionToneClass = (tone: 'rose' | 'amber' | 'cyan'): string => {
    if (tone === 'rose') return 'bg-rose-500/15 text-rose-300 border-rose-500/30';
    if (tone === 'cyan') return 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30';
    return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
  };

  return (
    <div className="rounded-3xl bg-slate-900 border border-slate-800 p-5 sm:p-6 shadow-xl space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-cyan-600/20 text-cyan-400 flex items-center justify-center shrink-0">
            <BarChart3 className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-bold text-sm sm:text-base text-white flex flex-wrap items-center gap-2">
              <span>{isDebugMode ? '記録音声 比較診断（最大4件）' : '録音の簡易比較（最大4件）'}</span>
              <span className="text-xs font-mono tabular-nums font-bold px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                {comparedClips.length} / 4 件
              </span>
            </h3>
            <p className="text-[11px] text-slate-400">
              {isDebugMode
                ? '客観測定値に基づく暫定スコアと、手動記録の5段階聴感評価を区別して並列比較します'
                : '総合スコア・4項目の評価・主な注意点・聴感評価を並べて比較できます'}
            </p>
          </div>
        </div>

        {/* Comparison Export Buttons (Debug mode only) */}
        {isDebugMode && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleDownloadCsv}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition cursor-pointer whitespace-nowrap"
              title="全記録の解析値・診断ログ・聴感評価をExcel対応UTF-8 BOM付きCSVで出力"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
              <span>CSV出力</span>
            </button>
            <button
              onClick={handleDownloadDeviceStatsCsv}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition cursor-pointer whitespace-nowrap"
              title="同一機器ごとの平均・最小・最大・標準偏差をCSVで出力"
            >
              <Layers className="w-3.5 h-3.5 text-cyan-400" />
              <span>機器別統計CSV</span>
            </button>
            <button
              onClick={handleDownloadJson}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition cursor-pointer whitespace-nowrap"
              title="全記録の診断詳細・同一機器統計を含む構造化JSONを出力"
            >
              <FileJson className="w-3.5 h-3.5 text-amber-400" />
              <span>JSON出力</span>
            </button>
            <button
              onClick={handleDownloadComparisonReport}
              disabled={comparedClips.length < 2}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition shadow-md whitespace-nowrap ${
                comparedClips.length >= 2
                  ? 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-cyan-950/40 cursor-pointer'
                  : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700/50'
              }`}
              title={
                comparedClips.length < 2
                  ? '比較には2件以上の記録が必要です'
                  : '全記録を比較したHTMLレポートを出力'
              }
            >
              <Download className="w-3.5 h-3.5" />
              <span>比較レポート出力 (HTML)</span>
            </button>
          </div>
        )}
      </div>

      {/* Version Mismatch Warning (Debug mode only) */}
      {isDebugMode && hasMixedVersions && (
        <div className="p-3.5 rounded-2xl bg-amber-500/15 border border-amber-500/40 text-amber-200 text-xs flex items-center gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <span>
            異なる評価アルゴリズム（{versions.join(' / ')}）の記録が混在しています。最新の測定シーケンス仕様で再測定するとより正確に比較できます。
          </span>
        </div>
      )}

      {/* Legacy / Mixed Mode Warning (Debug mode only) */}
      {isDebugMode && (hasMixedModes || hasLegacyReferenceMode) && (
        <div className="p-3.5 rounded-2xl bg-indigo-500/15 border border-indigo-500/40 text-indigo-200 text-xs flex items-center gap-2.5">
          <AlertTriangle className="w-4 h-4 text-indigo-400 shrink-0" />
          <span>
            過去の基準音源再生モードの記録が含まれています（現在は肉声発声モードに一本化）。発声・収録条件が異なるため比較時はご注意ください。
          </span>
        </div>
      )}

      {/* When only 1 clip exists, show guidance note */}
      {comparedClips.length < 2 ? (
        <div className="p-6 rounded-2xl bg-slate-950/60 border border-slate-800/80 text-center space-y-2">
          <Info className="w-6 h-6 text-cyan-400 mx-auto" />
          <p className="text-sm font-medium text-slate-300">
            2件以上の音声を記録すると、ここに横並びの比較表示が表示されます。
          </p>
          <p className="text-xs text-slate-500">
            別のヘッドセットやマイクに切り替えるか、同じマイクで繰り返し測定して比較できます（最大4件）。
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Non-ranking comparison guardrail */}
          <div className="p-3 rounded-xl bg-slate-950/80 border border-amber-500/30 text-[11px] text-slate-300 flex items-start gap-2.5 leading-relaxed">
            <Info className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
            <span>
              <strong className="text-amber-300">比較の見方に関する注意:</strong>{' '}
              {isDebugMode
                ? '暫定総合スコアや各指標の最大値は、無条件に「最も音質が良い」「おすすめ」であることを示すものではありません。入力音量不足（正規化で改善可）やノイズゲート疑い・環境音変動などの注意事項と、主観の聴感評価（存在する場合）をあわせてご確認ください。'
                : 'スコアが最も高い録音が、必ずしも「最も音質が良い」「おすすめ」とは限りません。音量の大小や雑音抑制機能の働き方、ご自身の聴感評価とあわせて判断してください。'}
            </span>
          </div>

          {!isDebugMode ? (
            <>
              {/* Simple Mode Narrow Cards (< md) */}
              <div className="md:hidden space-y-3">
                {comparedEntries.map(({ clip, idx, normalizedEval, prov, cautions, hasSubjective }) => {
                  const itemsList = [
                    { key: 'inputVolume', label: '入力音量', item: prov.items.inputVolume },
                    { key: 'noisePerformance', label: 'ノイズ性能', item: prov.items.noisePerformance },
                    { key: 'frequencyCharacteristics', label: '周波数特性', item: prov.items.frequencyCharacteristics },
                    { key: 'speechStability', label: '音声の安定性', item: prov.items.speechStability },
                  ];
                  const subj = clip.subjectiveRating;
                  const fmtSubj = (v: unknown) => (isValidSubjectiveScore(v) ? `${v}/5` : '未入力');
                  const isUnavail = normalizedEval.isMeasurable === false || prov.totalScore === null;

                  return (
                    <div
                      key={clip.id}
                      className="rounded-2xl bg-slate-950 border border-slate-800 p-4 space-y-3"
                    >
                      <div className="flex items-start justify-between gap-3 pb-2.5 border-b border-slate-800">
                        <div className="min-w-0 space-y-0.5">
                          <div className="text-sm font-extrabold text-white truncate">
                            {clip.name || `記録 #${idx + 1}`}
                          </div>
                          <div className="text-[11px] text-cyan-400 break-words">
                            {clip.micDeviceLabel}
                          </div>
                          <div className="text-[10px] font-mono tabular-nums text-slate-500">
                            {new Date(clip.recordedAt).toLocaleTimeString('ja-JP')}
                          </div>
                        </div>

                        <div className="text-right shrink-0 bg-slate-900 px-3 py-2 rounded-xl border border-slate-800">
                          <div className="text-[9px] text-slate-400">総合スコア（暫定）</div>
                          {!isUnavail ? (
                            <div className="font-mono tabular-nums text-base font-black text-cyan-300">
                              {prov.totalScore} / 100
                            </div>
                          ) : (
                            <div className="text-xs font-bold text-rose-400">測定不可</div>
                          )}
                          <div className="text-[10px] text-slate-300">
                            {isUnavail ? '録音し直し推奨' : prov.provisionalGradeLabel}
                          </div>
                        </div>
                      </div>

                      {/* 4-Item Breakdown */}
                      <div className="space-y-1.5">
                        <div className="text-[10px] font-bold text-slate-400">4項目の評価</div>
                        {itemsList.map(({ key, label, item }) => {
                          const pct =
                            item.score !== null && item.maxScore > 0
                              ? Math.round((item.score / item.maxScore) * 100)
                              : 0;
                          const trackPct = (item.maxScore / 35) * 100;
                          return (
                            <div
                              key={key}
                              className="grid grid-cols-[88px_1fr_54px] items-center gap-2 text-[11px]"
                            >
                              <span className="text-slate-300 truncate">{label}</span>
                              <div
                                className="h-2 rounded bg-slate-900 border border-slate-800 overflow-hidden"
                                style={{ width: `${trackPct}%` }}
                              >
                                <div
                                  className={`h-full ${
                                    item.score === null
                                      ? 'bg-slate-700'
                                      : pct >= 80
                                      ? 'bg-emerald-400'
                                      : pct >= 55
                                      ? 'bg-cyan-400'
                                      : 'bg-amber-400'
                                  }`}
                                  style={{ width: `${item.score === null ? 0 : pct}%` }}
                                />
                              </div>
                              <span className="font-mono tabular-nums text-right text-slate-200 font-semibold">
                                {item.score !== null ? `${item.score}/${item.maxScore}` : '不可'}
                              </span>
                            </div>
                          );
                        })}
                      </div>

                      {/* Main Cautions */}
                      <div className="space-y-1">
                        <div className="text-[10px] font-bold text-slate-400">主な注意事項</div>
                        {cautions.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {cautions.map((c, cIdx) => (
                              <span
                                key={cIdx}
                                className={`text-[10px] px-2 py-0.5 rounded border ${cautionToneClass(
                                  c.tone
                                )}`}
                              >
                                {c.text}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <div className="text-[11px] text-slate-500">特記事項なし</div>
                        )}
                      </div>

                      {/* Subjective Rating (Strictly Separated) */}
                      <div className="rounded-xl bg-slate-900/70 border border-slate-700/70 p-2.5 space-y-1">
                        <div className="flex items-center justify-between text-[10px]">
                          <span className="font-bold text-amber-300">
                            5段階聴感評価（主観メモ）
                          </span>
                          <span className={hasSubjective ? 'text-amber-200' : 'text-slate-500'}>
                            {hasSubjective ? '記録あり' : '未入力'}
                          </span>
                        </div>
                        {hasSubjective ? (
                          <div className="space-y-1 text-[11px]">
                            <div className="font-mono tabular-nums text-slate-200">
                              原:{fmtSubj(subj?.intelligibilityOriginal)} / 正:
                              {fmtSubj(subj?.intelligibilityNormalized)} / 籠:
                              {fmtSubj(subj?.lowMuffleness)} / 雑:{fmtSubj(subj?.lowBackgroundNoise)}
                            </div>
                            {subj?.notes?.trim() && (
                              <div className="text-[10px] text-slate-300">{subj.notes.trim()}</div>
                            )}
                          </div>
                        ) : (
                          <div className="text-[10px] text-slate-500">
                            聴感評価はまだ入力されていません。
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Simple Mode Desktop Table (md+) */}
              <div className="hidden md:block overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950">
                <table className="w-full text-xs text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-900/95">
                      <th className="p-3.5 font-bold text-slate-300 min-w-[190px] sticky left-0 z-10 bg-slate-900">
                        比較項目
                      </th>
                      {comparedEntries.map(({ clip, idx }) => (
                        <th
                          key={clip.id}
                          className="p-3.5 font-bold text-slate-200 min-w-[185px] text-center border-l border-slate-800/60"
                        >
                          <div className="text-white font-extrabold">
                            {clip.name || `記録 #${idx + 1}`}
                          </div>
                          <div className="text-[10px] text-cyan-400 truncate max-w-[175px] font-normal mt-0.5 mx-auto">
                            {clip.micDeviceLabel}
                          </div>
                          <div className="text-[10px] text-slate-500 font-mono tabular-nums font-normal">
                            {new Date(clip.recordedAt).toLocaleTimeString('ja-JP')}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {/* Total Score */}
                    <tr>
                      <td className="p-3 font-bold text-slate-300 bg-slate-900 sticky left-0 z-10">
                        総合スコア（暫定）
                        <span className="block text-[10px] text-amber-300/90 font-normal">
                          100点満点（参考評価）
                        </span>
                      </td>
                      {comparedEntries.map(({ clip, normalizedEval, prov }) => {
                        const isUnavail =
                          normalizedEval.isMeasurable === false || prov.totalScore === null;
                        return (
                          <td
                            key={clip.id}
                            className="p-3 text-center border-l border-slate-800/60 font-mono tabular-nums"
                          >
                            {!isUnavail ? (
                              <div className="space-y-0.5">
                                <div className="text-base font-black text-cyan-300">
                                  {prov.totalScore} / 100
                                </div>
                                <div className="text-[10px] font-sans font-semibold text-slate-300">
                                  {prov.provisionalGradeLabel}
                                  {prov.isRescaled ? '（換算あり）' : ''}
                                </div>
                              </div>
                            ) : (
                              <div className="space-y-0.5 font-sans">
                                <span className="text-xs text-rose-400 font-bold block">
                                  測定できませんでした
                                </span>
                                <span className="text-[10px] text-slate-400 block">
                                  録音し直してください
                                </span>
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>

                    {/* 4-Item Breakdown */}
                    <tr>
                      <td className="p-3 font-bold text-slate-300 bg-slate-900 sticky left-0 z-10 align-top">
                        4項目の評価
                        <span className="block text-[10px] text-slate-500 font-normal">
                          音量20 / ノイズ35 / 周波数25 / 安定性20
                        </span>
                      </td>
                      {comparedEntries.map(({ clip, prov }) => {
                        const rows = [
                          { label: '入力音量', item: prov.items.inputVolume },
                          { label: 'ノイズ性能', item: prov.items.noisePerformance },
                          { label: '周波数特性', item: prov.items.frequencyCharacteristics },
                          { label: '音声の安定性', item: prov.items.speechStability },
                        ];
                        return (
                          <td
                            key={clip.id}
                            className="p-3 text-left text-[11px] text-slate-200 border-l border-slate-800/60 align-top space-y-1.5"
                          >
                            {rows.map(({ label, item }) => {
                              const pct =
                                item.score !== null && item.maxScore > 0
                                  ? Math.round((item.score / item.maxScore) * 100)
                                  : 0;
                              const trackPct = (item.maxScore / 35) * 100;
                              return (
                                <div
                                  key={item.key}
                                  className="grid grid-cols-[68px_1fr_42px] items-center gap-1.5"
                                >
                                  <span className="text-[10px] text-slate-300 truncate">
                                    {label}
                                  </span>
                                  <div
                                    className="h-2 rounded bg-slate-900 border border-slate-800 overflow-hidden"
                                    style={{ width: `${trackPct}%` }}
                                  >
                                    <div
                                      className={`h-full ${
                                        item.score === null
                                          ? 'bg-slate-700'
                                          : pct >= 80
                                          ? 'bg-emerald-400'
                                          : pct >= 55
                                          ? 'bg-cyan-400'
                                          : 'bg-amber-400'
                                      }`}
                                      style={{ width: `${item.score === null ? 0 : pct}%` }}
                                    />
                                  </div>
                                  <span className="text-right font-mono tabular-nums text-[10px] text-slate-200">
                                    {item.score !== null ? `${item.score}/${item.maxScore}` : '不可'}
                                  </span>
                                </div>
                              );
                            })}
                          </td>
                        );
                      })}
                    </tr>

                    {/* Main Cautions */}
                    <tr>
                      <td className="p-3 font-bold text-slate-300 bg-slate-900 sticky left-0 z-10">
                        主な注意事項
                      </td>
                      {comparedEntries.map(({ clip, cautions }) => (
                        <td
                          key={clip.id}
                          className="p-3 text-center border-l border-slate-800/60"
                        >
                          {cautions.length > 0 ? (
                            <div className="flex flex-wrap justify-center gap-1">
                              {cautions.map((c, idx) => (
                                <span
                                  key={idx}
                                  className={`text-[10px] px-2 py-0.5 rounded border ${cautionToneClass(
                                    c.tone
                                  )}`}
                                >
                                  {c.text}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-[11px] text-slate-500">特記事項なし</span>
                          )}
                        </td>
                      ))}
                    </tr>

                    {/* Subjective Ratings (Strictly Separated) */}
                    <tr className="bg-amber-950/10">
                      <td className="p-3 font-bold text-amber-200 bg-slate-900 sticky left-0 z-10">
                        5段階聴感評価
                        <span className="block text-[10px] text-slate-400 font-normal">
                          主観メモ（スコアには影響しません）
                        </span>
                      </td>
                      {comparedEntries.map(({ clip, hasSubjective }) => {
                        const r = clip.subjectiveRating;
                        const summary = formatSubjectiveRatingSummary(r);
                        const notes = r?.notes?.trim();
                        const fmtScore = (v: unknown) =>
                          isValidSubjectiveScore(v) ? `${v}` : '未';
                        return (
                          <td
                            key={clip.id}
                            className="p-3 text-center text-[11px] text-slate-300 border-l border-slate-800/60 space-y-1"
                            title={notes || undefined}
                          >
                            {hasSubjective ? (
                              <>
                                <div className="font-mono tabular-nums text-slate-200">
                                  原:{fmtScore(r?.intelligibilityOriginal)} / 正:
                                  {fmtScore(r?.intelligibilityNormalized)} / 籠:
                                  {fmtScore(r?.lowMuffleness)} / 雑:
                                  {fmtScore(r?.lowBackgroundNoise)}
                                </div>
                                <div className="text-[10px] text-amber-300/90">{summary}</div>
                                {notes && (
                                  <div className="text-[10px] text-slate-400 truncate max-w-[175px] mx-auto">
                                    {notes}
                                  </div>
                                )}
                              </>
                            ) : (
                              <span className="text-[11px] text-slate-500">未入力</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Short plain-language disclaimer for Simple Mode */}
              <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 text-[11px] text-slate-400 leading-relaxed space-y-1">
                <p>
                  ※総合スコアは自動計測による暫定の参考値であり、実際の聞き取りやすさや音質を保証するものではありません。
                </p>
                <p>
                  ※Teams、Zoom、Google MeetなどのWeb会議アプリでは、アプリ側の雑音除去や音量自動調整によって相手に届く音が変わる場合があります。
                </p>
              </div>
            </>
          ) : (
            <>

          {/* Mobile / Narrow Viewport Card Comparison (< md) */}
          <div className="md:hidden space-y-3">
            {comparedEntries.map(({ clip, idx, normalizedEval, prov, cautions, hasSubjective }) => {
              const itemsList = [
                { key: 'inputVolume', short: '入力音量', item: prov.items.inputVolume },
                { key: 'noisePerformance', short: 'ノイズ性能', item: prov.items.noisePerformance },
                {
                  key: 'frequencyCharacteristics',
                  short: '周波数特性',
                  item: prov.items.frequencyCharacteristics,
                },
                { key: 'speechStability', short: '音声の安定性', item: prov.items.speechStability },
              ];
              const snrBand = normalizedEval.extendedMetrics?.speechBandSnr;
              const ro = normalizedEval.extendedMetrics?.highFreqRolloff;
              const bc = normalizedEval.extendedMetrics?.bandEnergyComparison;
              const lvl = normalizedEval.extendedMetrics?.speechLevelVariability;
              const subj = clip.subjectiveRating;
              const fmtSubj = (v: unknown) => (isValidSubjectiveScore(v) ? `${v}/5` : '未入力');
              const fmtRatio = (ok: boolean | undefined, v: number | null | undefined) =>
                ok && typeof v === 'number' && Number.isFinite(v)
                  ? `${v > 0 ? '+' : ''}${v.toFixed(1)}`
                  : '不能';

              return (
                <div
                  key={clip.id}
                  className="rounded-2xl bg-slate-950 border border-slate-800 p-4 space-y-3"
                >
                  {/* Card Header + Objective Provisional Score */}
                  <div className="flex items-start justify-between gap-3 pb-2.5 border-b border-slate-800">
                    <div className="min-w-0 space-y-0.5">
                      <div className="text-sm font-extrabold text-white truncate">
                        {clip.name || `記録 #${idx + 1}`}
                      </div>
                      <div className="text-[11px] text-cyan-400 break-words">
                        {clip.micDeviceLabel}
                      </div>
                      <div className="text-[10px] font-mono tabular-nums text-slate-500">
                        {new Date(clip.recordedAt).toLocaleTimeString('ja-JP')} ・{' '}
                        {normalizedEval.isMeasurable === false ? '要件未達' : '測定完了'}
                      </div>
                    </div>

                    <div className="text-right shrink-0 bg-slate-900 px-3 py-2 rounded-xl border border-slate-800">
                      <div className="text-[9px] text-slate-400">客観・暫定総合点</div>
                      {prov.totalScore !== null ? (
                        <div className="font-mono tabular-nums text-base font-black text-cyan-300">
                          {prov.totalScore} / 100
                        </div>
                      ) : (
                        <div className="text-xs font-bold text-rose-400">算出不能</div>
                      )}
                      <div className="text-[10px] text-slate-300">
                        {prov.provisionalGradeLabel}
                        {prov.isRescaled ? '（比例換算）' : ''}
                      </div>
                    </div>
                  </div>

                  {/* 4-Item Proportional Mini Bars */}
                  <div className="space-y-1.5">
                    <div className="text-[10px] font-bold text-slate-400">
                      4項目内訳（配点 20 / 35 / 25 / 20）
                    </div>
                    {itemsList.map(({ key, short, item }) => {
                      const pct =
                        item.score !== null && item.maxScore > 0
                          ? Math.round((item.score / item.maxScore) * 100)
                          : 0;
                      const trackPct = (item.maxScore / 35) * 100;
                      return (
                        <div
                          key={key}
                          className="grid grid-cols-[84px_1fr_54px] items-center gap-2 text-[11px]"
                        >
                          <span className="text-slate-300 truncate">{short}</span>
                          <div
                            className="h-2 rounded bg-slate-900 border border-slate-800 overflow-hidden"
                            style={{ width: `${trackPct}%` }}
                          >
                            <div
                              className={`h-full ${
                                item.score === null
                                  ? 'bg-slate-700'
                                  : pct >= 80
                                  ? 'bg-emerald-400'
                                  : pct >= 55
                                  ? 'bg-cyan-400'
                                  : 'bg-amber-400'
                              }`}
                              style={{ width: `${item.score === null ? 0 : pct}%` }}
                            />
                          </div>
                          <span className="font-mono tabular-nums text-right text-slate-200 font-semibold">
                            {item.score !== null ? `${item.score}/${item.maxScore}` : `不能/${item.maxScore}`}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Concise Cautions */}
                  <div className="space-y-1">
                    <div className="text-[10px] font-bold text-slate-400">主な注意事項</div>
                    {cautions.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {cautions.map((c, cIdx) => (
                          <span
                            key={cIdx}
                            className={`text-[10px] px-2 py-0.5 rounded border ${cautionToneClass(c.tone)}`}
                          >
                            {c.text}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="text-[11px] text-slate-500">特記事項なし</div>
                    )}
                  </div>

                  {/* Key Acoustic Metrics Grid */}
                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800/80 text-[11px]">
                    <div>
                      <span className="text-slate-400 block text-[10px]">帯域内 / 全帯域 S/N</span>
                      <span className="font-mono tabular-nums text-slate-200 font-semibold">
                        {snrBand?.isMeasurable && snrBand.snrDb !== null
                          ? `${snrBand.snrDb.toFixed(1)}dB`
                          : '不能'}{' '}
                        /{' '}
                        {normalizedEval.estimatedSnr?.isMeasurable
                          ? `${normalizedEval.estimatedSnr.snrDb}dB`
                          : '不能'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">発声RMS / 定常暗騒音</span>
                      <span className="font-mono tabular-nums text-slate-200 font-semibold">
                        {normalizedEval.speechStats.durationSec > 0
                          ? formatDb(normalizedEval.speechStats.avgDb)
                          : '未検出'}{' '}
                        /{' '}
                        {formatDb(
                          normalizedEval.noiseAnalysis?.representativeNoiseDbFS ??
                            normalizedEval.noiseStats.avgDb
                        )}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">帯域PSD比 (低/明/高)</span>
                      <span className="font-mono tabular-nums text-slate-300">
                        {bc
                          ? `${fmtRatio(bc.bands.low_120_300.isMeasurable && bc.bands.core_300_1000.isMeasurable, bc.ratios.lowToCoreDb)} / ${fmtRatio(bc.bands.clarity_1500_4200.isMeasurable && bc.bands.core_300_1000.isMeasurable, bc.ratios.clarityToCoreDb)} / ${fmtRatio(bc.bands.high_4200_8000.isMeasurable && bc.bands.clarity_1500_4200.isMeasurable, bc.ratios.highToClarityDb)}`
                          : '未解析'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">IQR / 95%ロールオフ</span>
                      <span className="font-mono tabular-nums text-slate-300">
                        {lvl?.isMeasurable && lvl.iqrDb !== null ? `${lvl.iqrDb.toFixed(1)}dB` : '不能'} /{' '}
                        {typeof ro?.rolloff95SpeechBandHz === 'number'
                          ? `${ro.rolloff95SpeechBandHz.toFixed(0)}Hz`
                          : '不能'}
                      </span>
                    </div>
                  </div>

                  {/* Visually Separated Subjective Rating */}
                  <div className="rounded-xl bg-slate-900/70 border border-slate-700/70 p-2.5 space-y-1">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="font-bold text-amber-300">
                        主観・5段階聴感評価（客観スコア対象外）
                      </span>
                      <span className={hasSubjective ? 'text-amber-200' : 'text-slate-500'}>
                        {hasSubjective ? '入力あり' : '未入力'}
                      </span>
                    </div>
                    {hasSubjective ? (
                      <div className="space-y-1 text-[11px]">
                        <div className="font-mono tabular-nums text-slate-200">
                          原:{fmtSubj(subj?.intelligibilityOriginal)} / 正:
                          {fmtSubj(subj?.intelligibilityNormalized)} / 籠:
                          {fmtSubj(subj?.lowMuffleness)} / 雑:{fmtSubj(subj?.lowBackgroundNoise)}
                        </div>
                        {subj?.notes?.trim() && (
                          <div className="text-[10px] text-slate-300">{subj.notes.trim()}</div>
                        )}
                      </div>
                    ) : (
                      <div className="text-[10px] text-slate-500">
                        聴感評価メモはまだ記録されていません。
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop / Tablet Expanded Per-Clip Comparison Table (md+) */}
          <div className="hidden md:block space-y-2">
            <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-900/95">
                    <th className="p-3.5 font-bold text-slate-300 min-w-[195px] sticky left-0 z-10 bg-slate-900">
                      比較項目
                    </th>
                    {comparedEntries.map(({ clip, idx }) => (
                      <th
                        key={clip.id}
                        className="p-3.5 font-bold text-slate-200 min-w-[185px] text-center border-l border-slate-800/60"
                      >
                        <div className="text-white font-extrabold">
                          {clip.name || `記録 #${idx + 1}`}
                        </div>
                        <div className="text-[10px] text-cyan-400 truncate max-w-[175px] font-normal mt-0.5 mx-auto">
                          {clip.micDeviceLabel}
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono tabular-nums font-normal">
                          {new Date(clip.recordedAt).toLocaleTimeString('ja-JP')}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono tabular-nums">
                  {hasLegacyReferenceMode && (
                    <tr>
                      <td className="p-3 font-sans font-bold text-slate-300 bg-slate-900 sticky left-0 z-10">
                        録音方式（履歴互換）
                      </td>
                      {comparedEntries.map(({ clip }) => (
                        <td
                          key={clip.id}
                          className="p-3 text-center border-l border-slate-800/60 font-sans"
                        >
                          {clip.recordingMode === 'eval_with_reference' ? (
                            <span className="inline-block px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                              基準音源再生（旧記録）
                            </span>
                          ) : (
                            <span className="inline-block px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                              肉声発声
                            </span>
                          )}
                        </td>
                      ))}
                    </tr>
                  )}

                  {/* Section Header Row: Objective Provisional Score */}
                  <tr className="bg-slate-900/60">
                    <td
                      colSpan={comparedEntries.length + 1}
                      className="px-3.5 py-2 font-sans text-[11px] font-bold text-cyan-300 tracking-wide"
                    >
                      客観測定・暫定100点スコア（自動算出・主観評価は不介入）
                    </td>
                  </tr>

                  {/* Provisional 100-Point Score */}
                  <tr>
                    <td className="p-3 font-sans font-bold text-slate-300 bg-slate-900 sticky left-0 z-10">
                      暫定総合スコア
                      <span className="block text-[10px] text-amber-300/90 font-normal">
                        100点満点（暫定判定・参考値）
                      </span>
                    </td>
                    {comparedEntries.map(({ clip, prov }) => (
                      <td key={clip.id} className="p-3 text-center border-l border-slate-800/60">
                        {prov.totalScore !== null ? (
                          <div className="space-y-0.5">
                            <div className="text-base font-black text-cyan-300">
                              {prov.totalScore} / 100
                            </div>
                            <div className="text-[10px] font-sans font-semibold text-slate-300">
                              {prov.provisionalGradeLabel}
                              {prov.isRescaled ? '（比例換算）' : ''}
                            </div>
                          </div>
                        ) : (
                          <span className="text-[11px] text-rose-400 font-sans font-bold">
                            算出不能
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>

                  {/* Provisional Score Item Breakdown with Compact Proportional Bars */}
                  <tr>
                    <td className="p-3 font-sans font-bold text-slate-300 bg-slate-900 sticky left-0 z-10 align-top">
                      4項目スコア内訳
                      <span className="block text-[10px] text-slate-500 font-normal">
                        音20 / 雑35 / 周25 / 安20
                      </span>
                    </td>
                    {comparedEntries.map(({ clip, prov }) => {
                      const rows = [
                        { label: '音', item: prov.items.inputVolume },
                        { label: '雑', item: prov.items.noisePerformance },
                        { label: '周', item: prov.items.frequencyCharacteristics },
                        { label: '安', item: prov.items.speechStability },
                      ];
                      return (
                        <td
                          key={clip.id}
                          className="p-3 text-left text-[11px] text-slate-200 border-l border-slate-800/60 align-top space-y-1.5"
                        >
                          {rows.map(({ label, item }) => {
                            const pct =
                              item.score !== null && item.maxScore > 0
                                ? Math.round((item.score / item.maxScore) * 100)
                                : 0;
                            const trackPct = (item.maxScore / 35) * 100;
                            return (
                              <div
                                key={item.key}
                                className="grid grid-cols-[18px_1fr_44px] items-center gap-1.5"
                              >
                                <span className="font-sans text-[10px] text-slate-400">
                                  {label}
                                </span>
                                <div
                                  className="h-2 rounded bg-slate-900 border border-slate-800 overflow-hidden"
                                  style={{ width: `${trackPct}%` }}
                                >
                                  <div
                                    className={`h-full ${
                                      item.score === null
                                        ? 'bg-slate-700'
                                        : pct >= 80
                                        ? 'bg-emerald-400'
                                        : pct >= 55
                                        ? 'bg-cyan-400'
                                        : 'bg-amber-400'
                                    }`}
                                    style={{ width: `${item.score === null ? 0 : pct}%` }}
                                  />
                                </div>
                                <span className="text-right font-mono text-[10px] text-slate-200">
                                  {item.score !== null
                                    ? `${item.score}/${item.maxScore}`
                                    : `不能`}
                                </span>
                              </div>
                            );
                          })}
                          <div className="text-[9px] text-slate-500 pt-0.5 text-center">
                            {prov.scoringVersion}
                          </div>
                        </td>
                      );
                    })}
                  </tr>

                  {/* Concise Main Cautions */}
                  <tr>
                    <td className="p-3 font-sans font-bold text-slate-300 bg-slate-900 sticky left-0 z-10">
                      主な注意事項
                      <span className="block text-[10px] text-slate-500 font-normal">
                        信頼性・入力水準フラグ
                      </span>
                    </td>
                    {comparedEntries.map(({ clip, cautions }) => (
                      <td
                        key={clip.id}
                        className="p-3 text-center border-l border-slate-800/60 font-sans"
                      >
                        {cautions.length > 0 ? (
                          <div className="flex flex-wrap justify-center gap-1">
                            {cautions.map((c, idx) => (
                              <span
                                key={idx}
                                className={`text-[10px] px-2 py-0.5 rounded border ${cautionToneClass(
                                  c.tone
                                )}`}
                              >
                                {c.text}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-500">特記事項なし</span>
                        )}
                      </td>
                    ))}
                  </tr>

                  {/* Status / Measurability */}
                  <tr>
                    <td className="p-3 font-sans font-bold text-slate-300 bg-slate-900 sticky left-0 z-10">
                      測定ステータス
                    </td>
                    {comparedEntries.map(({ clip, normalizedEval }) => (
                      <td
                        key={clip.id}
                        className="p-3 text-center border-l border-slate-800/60 font-sans"
                      >
                        {normalizedEval.isMeasurable === false ? (
                          <span className="inline-block px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                            要件未達（再測定）
                          </span>
                        ) : (
                          <span className="inline-block px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-slate-800 text-slate-300 border border-slate-700">
                            {normalizedEval.overallGradeText || '保留'}
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>

                  {/* Estimated Broadband SNR */}
                  <tr>
                    <td className="p-3 font-sans font-bold text-slate-300 bg-slate-900 sticky left-0 z-10">
                      全帯域推定S/N比
                      <span className="block text-[10px] text-slate-500 font-normal">
                        P_voice / P_noise
                      </span>
                    </td>
                    {comparedEntries.map(({ clip, normalizedEval }) => {
                      const snrVal = normalizedEval.estimatedSnr?.snrDb;
                      const isMeasurable = normalizedEval.estimatedSnr?.isMeasurable;

                      return (
                        <td key={clip.id} className="p-3 text-center border-l border-slate-800/60">
                          {isMeasurable ? (
                            <span className="font-bold text-slate-200">{snrVal} dB</span>
                          ) : (
                            <span className="text-[11px] text-rose-400 font-sans">測定不能</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>

                  {/* Speech-band SNR */}
                  <tr>
                    <td className="p-3 font-sans font-bold text-slate-300 bg-slate-900 sticky left-0 z-10">
                      音声帯域内S/N比
                      <span className="block text-[10px] text-slate-500 font-normal">
                        300–4200Hz
                      </span>
                    </td>
                    {comparedEntries.map(({ clip, normalizedEval }) => {
                      const snrBand = normalizedEval.extendedMetrics?.speechBandSnr;
                      return (
                        <td key={clip.id} className="p-3 text-center border-l border-slate-800/60">
                          {!snrBand ? (
                            <span className="text-slate-500 font-sans">未解析</span>
                          ) : snrBand.isMeasurable && snrBand.snrDb !== null ? (
                            <span className="text-slate-200 font-bold">
                              {snrBand.snrDb.toFixed(1)} dB
                            </span>
                          ) : (
                            <span className="text-rose-400 font-sans">測定不能</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>

                  {/* Speech Avg Volume */}
                  <tr>
                    <td className="p-3 font-sans font-bold text-slate-300 bg-slate-900 sticky left-0 z-10">
                      発声: 実効平均音量 (RMS)
                    </td>
                    {comparedEntries.map(({ clip, normalizedEval }) => (
                      <td
                        key={clip.id}
                        className="p-3 text-center text-slate-200 border-l border-slate-800/60"
                      >
                        {normalizedEval.speechStats.durationSec > 0 ? (
                          formatDb(normalizedEval.speechStats.avgDb)
                        ) : (
                          <span className="text-slate-500 font-sans">未検出</span>
                        )}
                      </td>
                    ))}
                  </tr>

                  {/* Steady Noise Level */}
                  <tr>
                    <td className="p-3 font-sans font-bold text-slate-300 bg-slate-900 sticky left-0 z-10">
                      周辺音: 定常暗騒音
                      <span className="block text-[10px] text-slate-500 font-normal">
                        外れ値除外後RMS
                      </span>
                    </td>
                    {comparedEntries.map(({ clip, normalizedEval }) => (
                      <td
                        key={clip.id}
                        className="p-3 text-center text-slate-200 border-l border-slate-800/60"
                      >
                        {formatDb(
                          normalizedEval.noiseAnalysis?.representativeNoiseDbFS ??
                            normalizedEval.noiseStats.avgDb
                        )}
                      </td>
                    ))}
                  </tr>

                  {/* 95% Rolloff (20-8000 & 300-8000) */}
                  <tr>
                    <td className="p-3 font-sans font-bold text-slate-300 bg-slate-900 sticky left-0 z-10">
                      95%ロールオフ周波数（参考）
                      <span className="block text-[10px] text-slate-500 font-normal">
                        20–8kHz / 300–8kHz
                      </span>
                    </td>
                    {comparedEntries.map(({ clip, normalizedEval }) => {
                      const ro = normalizedEval.extendedMetrics?.highFreqRolloff;
                      if (!ro) {
                        return (
                          <td
                            key={clip.id}
                            className="p-3 text-center text-slate-500 font-sans border-l border-slate-800/60"
                          >
                            未解析
                          </td>
                        );
                      }
                      const rAll =
                        ro.isMeasurable && ro.rolloff95Hz !== null
                          ? `${ro.rolloff95Hz.toFixed(0)} Hz`
                          : '測定不能';
                      const rVoice =
                        typeof ro.rolloff95SpeechBandHz === 'number' &&
                        Number.isFinite(ro.rolloff95SpeechBandHz)
                          ? `${ro.rolloff95SpeechBandHz.toFixed(0)} Hz`
                          : '測定不能';
                      return (
                        <td
                          key={clip.id}
                          className="p-3 text-center text-[11px] text-slate-200 border-l border-slate-800/60"
                        >
                          <div>{rAll}</div>
                          <div className="text-cyan-300">{rVoice} (音声帯域)</div>
                        </td>
                      );
                    })}
                  </tr>

                  {/* PSD Ratios */}
                  <tr>
                    <td className="p-3 font-sans font-bold text-slate-300 bg-slate-900 sticky left-0 z-10">
                      帯域PSD比 (dB)
                      <span className="block text-[10px] text-slate-500 font-normal">
                        低域/芯・明瞭/芯・高域/明瞭
                      </span>
                    </td>
                    {comparedEntries.map(({ clip, normalizedEval }) => {
                      const bc = normalizedEval.extendedMetrics?.bandEnergyComparison;
                      if (!bc) {
                        return (
                          <td
                            key={clip.id}
                            className="p-3 text-center text-slate-500 font-sans border-l border-slate-800/60"
                          >
                            未解析
                          </td>
                        );
                      }
                      const fmtR = (ok: boolean, v: number | null) =>
                        ok && typeof v === 'number' && Number.isFinite(v)
                          ? `${v > 0 ? '+' : ''}${v.toFixed(1)}`
                          : '不能';
                      return (
                        <td
                          key={clip.id}
                          className="p-3 text-center text-[11px] text-slate-300 border-l border-slate-800/60"
                        >
                          {fmtR(
                            bc.bands.low_120_300.isMeasurable && bc.bands.core_300_1000.isMeasurable,
                            bc.ratios.lowToCoreDb
                          )}{' '}
                          /{' '}
                          {fmtR(
                            bc.bands.clarity_1500_4200.isMeasurable &&
                              bc.bands.core_300_1000.isMeasurable,
                            bc.ratios.clarityToCoreDb
                          )}{' '}
                          /{' '}
                          {fmtR(
                            bc.bands.high_4200_8000.isMeasurable &&
                              bc.bands.clarity_1500_4200.isMeasurable,
                            bc.ratios.highToClarityDb
                          )}
                        </td>
                      );
                    })}
                  </tr>

                  {/* Speech IQR & Spectral Flatness */}
                  <tr>
                    <td className="p-3 font-sans font-bold text-slate-300 bg-slate-900 sticky left-0 z-10">
                      音量変動IQR / 平坦度
                      <span className="block text-[10px] text-slate-500 font-normal">
                        30ms RMS IQR / SFM中央値
                      </span>
                    </td>
                    {comparedEntries.map(({ clip, normalizedEval }) => {
                      const ext = normalizedEval.extendedMetrics;
                      if (!ext) {
                        return (
                          <td
                            key={clip.id}
                            className="p-3 text-center text-slate-500 font-sans border-l border-slate-800/60"
                          >
                            未解析
                          </td>
                        );
                      }
                      const iqrStr =
                        ext.speechLevelVariability.isMeasurable &&
                        ext.speechLevelVariability.iqrDb !== null
                          ? `${ext.speechLevelVariability.iqrDb.toFixed(1)} dB`
                          : '測定不能';
                      const sfmStr =
                        ext.spectralFlatness.isMeasurable && ext.spectralFlatness.median !== null
                          ? ext.spectralFlatness.median.toFixed(3)
                          : '測定不能';
                      return (
                        <td
                          key={clip.id}
                          className="p-3 text-center text-[11px] text-slate-200 border-l border-slate-800/60"
                        >
                          {iqrStr} / {sfmStr}
                        </td>
                      );
                    })}
                  </tr>

                  {/* Clipping Sign */}
                  <tr>
                    <td className="p-3 font-sans font-bold text-slate-300 bg-slate-900 sticky left-0 z-10">
                      デジタルクリッピング兆候
                    </td>
                    {comparedEntries.map(({ clip, normalizedEval }) => {
                      const hasClip =
                        normalizedEval.clippingDetails?.hasClippingSign ??
                        normalizedEval.clippingDetected;

                      return (
                        <td
                          key={clip.id}
                          className={`p-3 text-center font-sans font-bold border-l border-slate-800/60 ${
                            hasClip ? 'text-rose-400' : 'text-emerald-400'
                          }`}
                        >
                          {hasClip ? '兆候あり ⚠' : '兆候なし ✔'}
                        </td>
                      );
                    })}
                  </tr>

                  {/* Track Actual Settings (EC / NS / AGC) */}
                  <tr>
                    <td className="p-3 font-sans font-bold text-slate-300 bg-slate-900 sticky left-0 z-10">
                      デバイス実設定
                      <span className="block text-[10px] text-slate-500 font-normal">
                        EC / NS / AGC
                      </span>
                    </td>
                    {comparedEntries.map(({ clip }) => (
                      <td
                        key={clip.id}
                        className="p-3 text-center text-[11px] text-slate-300 border-l border-slate-800/60"
                      >
                        {formatTrackSettingsSummary(clip.trackSettings)}
                      </td>
                    ))}
                  </tr>

                  {/* Section Header Row: Subjective Rating (Strictly Separated from Objective Score) */}
                  <tr className="bg-amber-950/20">
                    <td
                      colSpan={comparedEntries.length + 1}
                      className="px-3.5 py-2 font-sans text-[11px] font-bold text-amber-300 tracking-wide"
                    >
                      主観評価：5段階聴感評価（手動記録・客観スコアには一切含まれません）
                    </td>
                  </tr>

                  {/* Separated Subjective Ratings */}
                  <tr className="bg-amber-950/10">
                    <td className="p-3 font-sans font-bold text-amber-200 bg-slate-900 sticky left-0 z-10">
                      5段階聴感評価
                      <span className="block text-[10px] text-slate-400 font-normal">
                        聞き取り(原音/正規化)・こもり少・ノイズ少
                      </span>
                    </td>
                    {comparedEntries.map(({ clip, hasSubjective }) => {
                      const r = clip.subjectiveRating;
                      const summary = formatSubjectiveRatingSummary(r);
                      const notes = r?.notes?.trim();
                      const fmtScore = (v: unknown) => (isValidSubjectiveScore(v) ? `${v}` : '未');
                      const hasLegacy = hasLegacyUnknownSubjectiveRating(r);
                      return (
                        <td
                          key={clip.id}
                          className="p-3 text-center font-sans text-[11px] text-slate-300 border-l border-slate-800/60 space-y-1"
                          title={notes || undefined}
                        >
                          {hasSubjective ? (
                            <>
                              <div className="font-mono text-slate-200">
                                原:{fmtScore(r?.intelligibilityOriginal)} / 正:
                                {fmtScore(r?.intelligibilityNormalized)} / 籠:
                                {fmtScore(r?.lowMuffleness)} / 雑:
                                {fmtScore(r?.lowBackgroundNoise)}
                              </div>
                              <div className="text-[10px] text-amber-300/90">{summary}</div>
                              {hasLegacy && isValidSubjectiveScore(r?.intelligibility) && (
                                <div className="text-[10px] text-amber-200/80">
                                  旧・聞き取り(種別不明): {r!.intelligibility}/5
                                </div>
                              )}
                              {notes && (
                                <div className="text-[10px] text-slate-400 truncate max-w-[175px] mx-auto">
                                  {notes}
                                </div>
                              )}
                            </>
                          ) : (
                            <span className="text-[11px] text-slate-500">未入力</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 text-[11px] text-slate-400 leading-relaxed space-y-1">
              <p>
                <b className="text-amber-300">{PROVISIONAL_SCORE_NOTICES.provisionalScoreTitle}:</b>{' '}
                {PROVISIONAL_SCORE_NOTICES.provisionalScoreNotice}
              </p>
              <p>
                <b className="text-cyan-300">{PROVISIONAL_SCORE_NOTICES.webMeetingDspTitle}:</b>{' '}
                {PROVISIONAL_SCORE_NOTICES.webMeetingDspNotice}{' '}
                {PROVISIONAL_SCORE_NOTICES.browserDspSettingNote}
              </p>
            </div>
          </div>

          {/* Mobile shared notices (visible < md where table footer above is hidden) */}
          <div className="md:hidden p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 text-[11px] text-slate-400 leading-relaxed space-y-1">
            <p>
              <b className="text-amber-300">{PROVISIONAL_SCORE_NOTICES.provisionalScoreTitle}:</b>{' '}
              {PROVISIONAL_SCORE_NOTICES.provisionalScoreNotice}
            </p>
            <p>
              <b className="text-cyan-300">{PROVISIONAL_SCORE_NOTICES.webMeetingDspTitle}:</b>{' '}
              {PROVISIONAL_SCORE_NOTICES.webMeetingDspNotice}{' '}
              {PROVISIONAL_SCORE_NOTICES.browserDspSettingNote}
            </p>
          </div>

          {/* Multi-Recording Device Comparison Statistics */}
          <div className="pt-4 border-t border-slate-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-cyan-400" />
                <h4 className="font-bold text-sm text-white">
                  同一機器別・複数録音統計比較（既存履歴集約）
                </h4>
              </div>
              <span className="text-[11px] text-slate-400 font-mono">
                識別グループ数: {deviceGroups.length} / 複数録音あり: {multiRecordingGroups.length}
              </span>
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              deviceId と機器名を用いて保守的に同一機器を識別し、複数録音のばらつきを集計します（dB系指標の平均・最小・最大・標準偏差は値のばらつき把握を目的とした記述統計であり、線形電力平均ではありません）。
            </p>

            {multiRecordingGroups.length === 0 && (
              <div className="p-3.5 rounded-2xl bg-slate-950/60 border border-slate-800 text-xs text-slate-300">
                同一機器として識別された複数録音グループはまだありません（未識別デバイスや1件のみの機器は誤統合を防ぐため個別扱いのまま保持されています）。
              </div>
            )}

            <div className="space-y-4">
              {deviceGroups.map((group) => (
                <div
                  key={group.deviceKey}
                  className="rounded-2xl bg-slate-950/80 border border-slate-800 p-4 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800/80">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-sm text-white">{group.deviceLabel}</span>
                        <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                          録音数 n={group.clipCount}
                        </span>
                        <span
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${
                            group.identificationMethod === 'deviceId_and_label'
                              ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                              : group.identificationMethod === 'label_only_no_deviceId'
                              ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                              : 'bg-slate-800 text-slate-400 border-slate-700'
                          }`}
                        >
                          {group.identificationMethod === 'deviceId_and_label'
                            ? 'deviceId+機器名一致'
                            : group.identificationMethod === 'label_only_no_deviceId'
                            ? '機器名一致(ID未取得)'
                            : '未識別(統合なし)'}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1">
                        {group.identificationNote} 対象: {group.clipNames.join(' / ')}
                      </p>
                    </div>
                  </div>

                  {group.clipCount >= 2 ? (
                    <div className="overflow-x-auto rounded-xl border border-slate-800/80">
                      <table className="w-full text-[11px] text-left border-collapse">
                        <thead>
                          <tr className="bg-slate-900/90 text-slate-400 border-b border-slate-800">
                            <th className="p-2.5 font-semibold">測定項目</th>
                            <th className="p-2.5 text-center font-semibold">有効数 n</th>
                            <th className="p-2.5 text-right font-semibold">平均</th>
                            <th className="p-2.5 text-right font-semibold">最小</th>
                            <th className="p-2.5 text-right font-semibold">最大</th>
                            <th className="p-2.5 text-right font-semibold">標準偏差</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60 font-mono">
                          {DEVICE_COMPARISON_METRIC_DEFS.map((def) => {
                            const st = group.stats[def.statKey];
                            return (
                              <tr key={def.statKey}>
                                <td className="p-2 font-sans text-slate-300">
                                  {def.label}
                                  {st.isDbScale && (
                                    <span className="ml-1 text-[10px] text-slate-500">[dB記述]</span>
                                  )}
                                </td>
                                <td className="p-2 text-center text-slate-300">
                                  {st.count}/{group.clipCount}
                                </td>
                                <td className="p-2 text-right text-slate-100 font-bold">
                                  {fmtStatVal(st, st.mean)}
                                </td>
                                <td className="p-2 text-right text-slate-300">
                                  {fmtStatVal(st, st.min)}
                                </td>
                                <td className="p-2 text-right text-slate-300">
                                  {fmtStatVal(st, st.max)}
                                </td>
                                <td className="p-2 text-right text-slate-300">
                                  {fmtStatVal(st, st.stdDev)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="text-[11px] text-slate-500">
                      このグループは記録が1件のため、統計集計（平均・最小・最大・標準偏差）の対象外です。
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
          </>
          )}
        </div>
      )}
    </div>
  );
};
