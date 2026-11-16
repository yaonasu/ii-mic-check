/**
 * Copyright (c) 2026 八百茄子 (yaonasu)
 * SPDX-License-Identifier: MIT
 */

import React from 'react';
import { HeadsetEvaluation } from '../types/audio';
import { formatDb, normalizeEvaluationCompatibility } from '../utils/audioDsp';
import {
  PROVISIONAL_SCORE_NOTICES,
  computeProvisionalScore,
} from '../utils/provisionalScoring';
import {
  Mic,
  Volume2,
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Zap,
  Radio,
  Sliders,
  ShieldCheck,
  AlertCircle,
  Info,
} from 'lucide-react';

interface EvaluationSummaryProps {
  evaluation: HeadsetEvaluation;
  isDebugMode?: boolean;
}

interface CategorizedNotices {
  actionable: string[];
  reliability: string[];
}

function buildCategorizedNotices(
  provisionalScore: ReturnType<typeof computeProvisionalScore>,
  safeEvaluation: HeadsetEvaluation
): CategorizedNotices {
  const actionable: string[] = [];
  const reliability: string[] = [];

  const iv = provisionalScore.items.inputVolume;
  const np = provisionalScore.items.noisePerformance;
  const fc = provisionalScore.items.frequencyCharacteristics;
  const ss = provisionalScore.items.speechStability;

  // 1. 改善行動につながる注意（入力音量・クリッピング・定常暗騒音）
  if (iv.status === 'unavailable') {
    actionable.push(
      '発声区間が十分に検出されませんでした。マイクミュート解除や録音手順（冒頭3秒の周辺音測定後に3秒以上発話）を確認して再測定してください。'
    );
  } else {
    const ivMetrics = iv.metricValues || {};
    const speechAvgDb =
      typeof ivMetrics.speechAvgDbFS === 'number' ? ivMetrics.speechAvgDbFS : null;
    const hasClip = Boolean(ivMetrics.hasClippingSign);
    const clippedSamples =
      typeof ivMetrics.clippedSampleCount === 'number' ? ivMetrics.clippedSampleCount : 0;
    const peakDb = typeof ivMetrics.peakDbFS === 'number' ? ivMetrics.peakDbFS : null;

    if (hasClip) {
      actionable.push(
        `デジタルクリッピング兆候が検出されています（飽和サンプル ${clippedSamples} 件）。マイクゲインを下げるか口元から少し離してください。`
      );
    } else if (clippedSamples > 0 || (peakDb !== null && peakDb >= -0.3)) {
      actionable.push(
        'サンプルピークが上限（0 dBFS）付近に達しています。強い発声で音割れしないようゲイン余裕を確保することを推奨します。'
      );
    }

    if (speechAvgDb !== null) {
      if (speechAvgDb < -28) {
        const snrDb =
          typeof np.metricValues?.speechBandSnrDb === 'number'
            ? np.metricValues.speechBandSnrDb
            : null;
        if (snrDb !== null && snrDb >= 20 && !hasClip && clippedSamples === 0) {
          actionable.push(
            `入力音量は小さめ（${speechAvgDb.toFixed(1)} dBFS）ですが、音声帯域内S/N比（${snrDb.toFixed(1)} dB）は確保されています。入力ゲインを上げるか正規化再生で確認してください（音量不足と音質不良は別要因です）。`
          );
        } else {
          actionable.push(
            `入力音量が小さめ（${speechAvgDb.toFixed(1)} dBFS）です。OSやデバイスの入力ゲインを引き上げると聞き取りやすくなる場合があります（音量不足と音質不良は分離評価しています）。`
          );
        }
      } else if (speechAvgDb < -24) {
        actionable.push(
          `発声実効音量（${speechAvgDb.toFixed(1)} dBFS）は推奨目安（-24〜-14 dBFS）よりやや小さめです。必要に応じて入力ゲインを微調整してください。`
        );
      } else if (speechAvgDb > -12) {
        actionable.push(
          `入力レベルが高め（${speechAvgDb.toFixed(1)} dBFS）です。口元との距離を調整するかゲインを少し下げると歪み防止に有効です。`
        );
      } else if (speechAvgDb > -14) {
        actionable.push(
          `発声実効音量（${speechAvgDb.toFixed(1)} dBFS）は推奨目安（-24〜-14 dBFS）よりやや高めです。ピーク余裕にご注意ください。`
        );
      }
    }
  }

  const repNoiseDb =
    typeof np.metricValues?.representativeNoiseDbFS === 'number'
      ? np.metricValues.representativeNoiseDbFS
      : null;
  if (repNoiseDb !== null && repNoiseDb > -42) {
    actionable.push(
      `定常暗騒音がやや高め（${repNoiseDb.toFixed(1)} dBFS / -42 dBFS超）です。空調・PCファンの距離調整や指向性マイクの向き見直しが有効な場合があります。`
    );
  }

  // 2. 測定上の信頼性に関する注意（フラグ・算出状態・補完制限から導出）
  if (provisionalScore.totalScore === null && provisionalScore.unavailableItems.length > 0) {
    reliability.push(
      `必須項目が測定不能のため総合スコアを算出していません（${provisionalScore.unavailableItems.join(' ／ ')}）。架空の数値補完は行っていません。`
    );
  } else if (provisionalScore.isRescaled && provisionalScore.rescalingNote) {
    reliability.push(provisionalScore.rescalingNote);
  }

  if (np.metricValues?.noiseGateSuspected === true) {
    const gateNote = np.notes.find((n) => n.includes('ノイズゲート'));
    if (gateNote) reliability.push(gateNote);
  }

  if (fc.metricValues?.highBandNoiseContaminationWarning === true) {
    const contamNote = fc.notes.find((n) => n.includes('評価の信頼性低下'));
    if (contamNote) reliability.push(contamNote);
  }

  if (ss.metricValues?.extremeVariationWarning === true) {
    const varNote = ss.notes.find((n) => n.includes('大きな音量変動'));
    if (varNote) reliability.push(varNote);
  }

  if (safeEvaluation.noiseAnalysis?.hasNoiseLevelShiftWarning) {
    reliability.push(
      `録音前後で暗騒音が ${safeEvaluation.noiseAnalysis.noiseDifferenceDb.toFixed(1)} dB 変動しているため、推定S/N比や安定性の比較精度が低下している可能性があります。`
    );
  }

  // Nyquist制限・代替S/Nモード・周波数サブ項目の部分欠損など既存notesの信頼性注記を重複なく収集
  const supplementalNotes = [
    ...np.notes.filter(
      (n) =>
        n.includes('サンプルレート制約') ||
        n.includes('35点満点基準に換算') ||
        n.includes('代替採点') ||
        n.includes('内蔵のノイズ抑制DSPにより無音区間の暗騒音が低減')
    ),
    ...fc.notes.filter(
      (n) =>
        n.includes('サンプルレート制約') ||
        n.includes('話者の声質')
    ),
    ...ss.notes.filter((n) => n.includes('減点根拠:')),
  ];

  for (const note of supplementalNotes) {
    if (!reliability.includes(note)) {
      reliability.push(note);
    }
  }

  return { actionable, reliability };
}

interface SimpleViewContent {
  issues: string[];
  advices: string[];
}

function getSimpleItemDescription(key: 'inputVolume' | 'noisePerformance' | 'frequencyCharacteristics' | 'speechStability'): string {
  switch (key) {
    case 'inputVolume':
      return 'マイクから入った声の大きさのバランス';
    case 'noisePerformance':
      return '声と周囲の雑音の分離しやすさ';
    case 'frequencyCharacteristics':
      return '低音から高音までの音のバランスの傾向（声質によっても変わります）';
    case 'speechStability':
      return '話している間の声の大きさの安定感';
  }
}

function buildSimpleViewContent(
  provisionalScore: ReturnType<typeof computeProvisionalScore>,
  safeEvaluation: HeadsetEvaluation
): SimpleViewContent {
  const issues: string[] = [];
  const advices: string[] = [];

  const iv = provisionalScore.items.inputVolume;
  const np = provisionalScore.items.noisePerformance;
  const fc = provisionalScore.items.frequencyCharacteristics;
  const ss = provisionalScore.items.speechStability;

  const ivMetrics = iv.metricValues || {};
  const npMetrics = np.metricValues || {};
  const fcMetrics = fc.metricValues || {};
  const ssMetrics = ss.metricValues || {};

  const isUnmeasurable =
    safeEvaluation.isMeasurable === false || provisionalScore.totalScore === null;

  const speechAvgDb =
    typeof ivMetrics.speechAvgDbFS === 'number' ? ivMetrics.speechAvgDbFS : null;
  const hasClip = Boolean(ivMetrics.hasClippingSign);
  const clippedSamples =
    typeof ivMetrics.clippedSampleCount === 'number' ? ivMetrics.clippedSampleCount : 0;
  const peakDb = typeof ivMetrics.peakDbFS === 'number' ? ivMetrics.peakDbFS : null;
  const sbSnr =
    typeof npMetrics.speechBandSnrDb === 'number' ? npMetrics.speechBandSnrDb : null;
  const repNoiseDb =
    typeof npMetrics.representativeNoiseDbFS === 'number'
      ? npMetrics.representativeNoiseDbFS
      : null;

  const isTooLoud = hasClip || clippedSamples > 0 || (peakDb !== null && peakDb >= -0.3) || (speechAvgDb !== null && speechAvgDb > -12);
  const isTooQuiet = speechAvgDb !== null && speechAvgDb < -24;
  const isVeryQuiet = speechAvgDb !== null && speechAvgDb < -28;
  const hasHighNoise = repNoiseDb !== null && repNoiseDb > -42;
  const hasGateCaution = npMetrics.noiseGateSuspected === true;
  const hasHighBandCaution = fcMetrics.highBandNoiseContaminationWarning === true;
  const hasExtremeVar = ssMetrics.extremeVariationWarning === true;
  const hasNoiseShift =
    npMetrics.noiseShiftWarning === true ||
    Boolean(safeEvaluation.noiseAnalysis?.hasNoiseLevelShiftWarning);

  // 主な問題点（重要な順に最大3件・専門用語なし）
  if (isUnmeasurable) {
    issues.push(
      '話し声が十分に検出できなかったため、総合スコアを測定できませんでした。'
    );
  }
  if (hasClip) {
    issues.push(
      '入力音量が大きすぎて、一部で音割れ（歪み）の兆候が出ています。'
    );
  } else if (clippedSamples > 0 || (peakDb !== null && peakDb >= -0.3)) {
    issues.push(
      '大きな声の部分が上限近くに達しており、音割れしやすい状態です。'
    );
  }
  if (isVeryQuiet) {
    if (sbSnr !== null && sbSnr >= 20 && !hasClip && clippedSamples === 0) {
      issues.push(
        'マイクから入る声の音量が小さめです（雑音は少ないため、音量を上げれば聞き取りやすくなる可能性があります）。'
      );
    } else {
      issues.push(
        'マイクから入る声の音量が小さめのため、相手に声が小さく届く可能性があります。'
      );
    }
  } else if (isTooQuiet) {
    issues.push('マイクから入る声の音量がやや小さめです。');
  } else if (speechAvgDb !== null && speechAvgDb > -12) {
    issues.push('マイクから入る声の音量が大きめです。近づきすぎると音割れしやすくなります。');
  }
  if (hasHighNoise) {
    issues.push(
      'エアコンやパソコンのファンなど、周囲の雑音が大きめに録音されています。'
    );
  }
  if (hasHighBandCaution) {
    issues.push(
      '周囲の雑音が混ざっている影響で、高い音域の評価の正確さが下がっている可能性があります。'
    );
  }
  if (hasGateCaution) {
    issues.push(
      '無音時の雑音を抑える機能（ノイズゲート等）が強く働いており、雑音の少なさが高く見積もられている可能性があります。'
    );
  }
  if (hasExtremeVar) {
    issues.push(
      '話している途中で声の大きさが大きく変わる場面がありました（抑揚やマイクの自動調整、音声の途切れの可能性があります）。'
    );
  }
  if (hasNoiseShift) {
    issues.push(
      '録音の前半と後半で周囲の雑音の大きさが大きく変化し、測定の正確さが下がっている可能性があります。'
    );
  }
  if (!isUnmeasurable && provisionalScore.isRescaled) {
    issues.push(
      '一部の項目を測定できなかったため、測定できた項目のみから100点満点に換算しています。'
    );
  }

  // 改善アドバイス（具体的な行動を最大3件・専門用語なし）
  if (isUnmeasurable) {
    advices.push(
      '「録音を開始する」を押してから最初の3秒間は静かに待ち、そのあと3秒以上はっきり話してから停止してください。'
    );
    advices.push(
      'マイクがミュートになっていないか、別の録音機器が選ばれていないか確認してください。'
    );
  }
  if (isTooLoud) {
    advices.push(
      'マイクを口元から指2〜3本分ほど離すか、パソコンや通話アプリのマイク入力音量を少し下げてください。'
    );
  }
  if (isTooQuiet) {
    advices.push(
      'パソコンのサウンド設定や通話アプリでマイク入力音量を上げるか、マイクを口の斜め前（2〜3cm程度）に近づけてください。'
    );
  }
  if (hasHighNoise || hasHighBandCaution) {
    advices.push(
      'エアコンやパソコンのファンから離れる、またはマイクの向きを口元へ合わせるなどして周囲の雑音を減らしてみてください。'
    );
  }
  if (hasGateCaution || hasExtremeVar) {
    advices.push(
      'マイクとの距離と声の大きさを一定に保って話すか、ヘッドセットやパソコンの自動音量調整・雑音抑制の設定を見直してみてください。'
    );
  }
  if (hasNoiseShift) {
    advices.push(
      '周囲の音が大きく変わらない静かな状態で、もう一度録音し直してみてください。'
    );
  }

  // 補助アドバイス（3件未満の場合に具体的な確認行動を補完）
  const generalTips = [
    'マイクは口の正面ではなく唇の斜め下2〜3cmに置くと、息が当たる「ボフッ」という音を防げます。',
    '上の再生欄で「音量正規化」に切り替えると、音量の大小を取り除いた声の聴きやすさを確認できます。',
    '下の5段階聴感評価にメモを残すと、別のヘッドセットと聞き比べやすくなります。',
  ];
  for (const tip of generalTips) {
    if (advices.length >= 3) break;
    if (!advices.includes(tip)) {
      advices.push(tip);
    }
  }

  return {
    issues: issues.slice(0, 3),
    advices: advices.slice(0, 3),
  };
}

export const EvaluationSummary: React.FC<EvaluationSummaryProps> = ({
  evaluation,
  isDebugMode = false,
}) => {
  const safeEvaluation = normalizeEvaluationCompatibility(evaluation);
  const provisionalScore = computeProvisionalScore(safeEvaluation);
  const categorizedNotices = buildCategorizedNotices(provisionalScore, safeEvaluation);
  const simpleContent = buildSimpleViewContent(provisionalScore, safeEvaluation);

  const {
    algoVersion = 'v2.0',
    isMeasurable = true,
    unmeasurableReason,
    speechStats,
    noiseStats,
    noiseAnalysis,
    estimatedSnr,
    frequencyBalance,
    bandRatio,
    spectralCentroidHz,
    extendedMetrics,
    clippingDetails,
    gradeTitle,
    assessmentSummary,
    assessmentItems,
    actionableTips,
  } = safeEvaluation;

  const formatSignedDb = (val: number | null | undefined, digits = 1): string => {
    if (typeof val !== 'number' || !Number.isFinite(val)) return '測定不能';
    return `${val > 0 ? '+' : ''}${val.toFixed(digits)} dB`;
  };

  const formatPlainVal = (
    val: number | null | undefined,
    unit: string,
    digits = 1
  ): string => {
    if (typeof val !== 'number' || !Number.isFinite(val)) return '測定不能';
    return `${val.toFixed(digits)}${unit ? ` ${unit}` : ''}`;
  };

  const getStatusIcon = (status: 'excellent' | 'good' | 'warning' | 'poor') => {
    switch (status) {
      case 'excellent':
        return <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />;
      case 'good':
        return <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />;
      case 'warning':
        return <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />;
      case 'poor':
        return <XCircle className="w-4 h-4 text-rose-400 shrink-0" />;
    }
  };

  const getStatusBadge = (status: 'excellent' | 'good' | 'warning' | 'poor') => {
    switch (status) {
      case 'excellent':
        return (
          <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full whitespace-nowrap shrink-0 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
            極めて良好
          </span>
        );
      case 'good':
        return (
          <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full whitespace-nowrap shrink-0 bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
            良好
          </span>
        );
      case 'warning':
        return (
          <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full whitespace-nowrap shrink-0 bg-amber-500/20 text-amber-300 border border-amber-500/30">
            注意
          </span>
        );
      case 'poor':
        return (
          <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full whitespace-nowrap shrink-0 bg-rose-500/20 text-rose-300 border border-rose-500/30">
            要改善
          </span>
        );
    }
  };

  const scoreItems = [
    provisionalScore.items.inputVolume,
    provisionalScore.items.noisePerformance,
    provisionalScore.items.frequencyCharacteristics,
    provisionalScore.items.speechStability,
  ];
  const maxItemWeight = Math.max(...scoreItems.map((it) => it.maxScore), 35);

  // =========================================================================
  // 通常モード（一般ユーザー向けシンプル表示）
  // =========================================================================
  if (!isDebugMode) {
    const isScoreUnavailable = !isMeasurable || provisionalScore.totalScore === null;

    return (
      <div className="space-y-5">
        {/* 1. 総合スコア（100点満点）と暫定評価 */}
        <div className="rounded-2xl bg-slate-950/80 border border-slate-800 p-5 sm:p-6 space-y-5">
          {isScoreUnavailable ? (
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-6 h-6 text-rose-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base sm:text-lg font-extrabold text-rose-200">
                      測定できませんでした。録音し直してください
                    </span>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30">
                      暫定評価（測定不可）
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    録音開始後の「周辺音測定（3秒）」が終わってから、3秒以上はっきり話して停止してください。十分な発声が記録できない場合、点数は算出されません。
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-5 pb-5 border-b border-slate-800">
              <div className="flex items-center gap-4 bg-slate-900/90 p-4 rounded-xl border border-cyan-500/35 shrink-0">
                <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl bg-slate-950 text-slate-100 flex flex-col items-center justify-center font-black border border-slate-700 px-1.5 text-center shrink-0">
                  <span className="text-base sm:text-lg text-cyan-300 leading-tight">
                    {provisionalScore.provisionalGradeLabel}
                  </span>
                  <span className="text-[9px] uppercase tracking-wider mt-1 font-bold text-slate-400">
                    暫定評価
                  </span>
                </div>

                <div className="space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-slate-300 font-semibold">
                      総合スコア（100点満点）
                    </span>
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                      暫定の参考値
                    </span>
                  </div>
                  <div className="flex items-baseline gap-2 font-mono tabular-nums">
                    <span className="text-3xl sm:text-4xl font-black text-cyan-300 tracking-tight">
                      {provisionalScore.totalScore}
                    </span>
                    <span className="text-sm text-slate-400 font-semibold">/ 100 点</span>
                  </div>
                  {provisionalScore.isRescaled && (
                    <div className="text-[11px] text-amber-300">
                      ※測定できた項目をもとに100点満点へ換算して表示しています
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-2 flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span className="text-xs font-bold text-cyan-400">
                    自動測定の結果まとめ（暫定評価）
                  </span>
                </div>
                <p className="text-xs sm:text-sm text-slate-200 leading-relaxed">
                  録音された声の大きさ・雑音の少なさ・音バランスの傾向・安定感をもとに算出した参考スコアです。
                </p>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  ※この点数は暫定評価であり、人間が感じる音質や聞き取りやすさを保証するものではありません。Teams、Zoom、Google MeetなどのWeb会議アプリでは、アプリ側の雑音除去や音量自動調整によって相手に届く音が変わる場合があります。
                </p>
              </div>
            </div>
          )}

          {/* 2. 4項目の評価（入力音量・ノイズ性能・周波数特性・音声の安定性） */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-cyan-400 shrink-0" />
                <h3 className="font-bold text-sm text-white">4項目の評価</h3>
              </div>
              <span className="text-[11px] text-slate-400">
                ※配点：入力音量20 / ノイズ性能35 / 周波数特性25 / 音声の安定性20
              </span>
            </div>

            <div className="rounded-xl bg-slate-900/70 border border-slate-800 p-4 space-y-3.5">
              {scoreItems.map((item) => {
                const earnedPctOfMax =
                  item.score !== null && item.maxScore > 0
                    ? Math.round((item.score / item.maxScore) * 100)
                    : 0;
                const trackWidthPct = (item.maxScore / maxItemWeight) * 100;

                return (
                  <div
                    key={item.key}
                    className="grid grid-cols-1 sm:grid-cols-[230px_1fr_115px] items-center gap-2 sm:gap-4"
                  >
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-white">{item.label}</span>
                        <span className="text-[10px] font-mono tabular-nums text-slate-400">
                          ({item.maxScore}点満点)
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 leading-snug">
                        {getSimpleItemDescription(item.key)}
                      </p>
                    </div>

                    <div className="w-full flex items-center">
                      <div
                        className="h-3.5 rounded bg-slate-950 border border-slate-700/80 overflow-hidden shrink-0"
                        style={{ width: `${trackWidthPct}%` }}
                        aria-label={`${item.label}: ${
                          item.score !== null
                            ? `${item.score} / ${item.maxScore}点`
                            : '測定できませんでした'
                        }`}
                      >
                        <div
                          className={`h-full transition-all ${
                            item.score === null
                              ? 'bg-slate-700/50'
                              : earnedPctOfMax >= 80
                              ? 'bg-emerald-400'
                              : earnedPctOfMax >= 55
                              ? 'bg-cyan-400'
                              : 'bg-amber-400'
                          }`}
                          style={{ width: `${item.score === null ? 0 : earnedPctOfMax}%` }}
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end font-mono tabular-nums">
                      <span
                        className={`text-xs font-bold ${
                          item.score === null ? 'text-rose-300 font-sans' : 'text-cyan-300'
                        }`}
                      >
                        {item.score !== null
                          ? `${item.score} / ${item.maxScore} 点`
                          : '測定不可'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 3. 主な問題点（最大3件） & 4. 改善アドバイス（最大3件） */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-xl bg-slate-900/70 border border-amber-500/30 p-4 space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-bold text-amber-300">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>主な問題点</span>
              </div>
              {simpleContent.issues.length > 0 ? (
                <ul className="text-xs text-slate-200 space-y-2 list-disc list-inside leading-relaxed">
                  {simpleContent.issues.map((issue, idx) => (
                    <li key={idx}>{issue}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-200 leading-relaxed">
                  大きな問題点は見つかりませんでした。全体的に安定した録音結果です。
                </p>
              )}
            </div>

            <div className="rounded-xl bg-slate-900/70 border border-emerald-500/30 p-4 space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-bold text-emerald-300">
                <Zap className="w-4 h-4 shrink-0" />
                <span>改善アドバイス</span>
              </div>
              <ul className="text-xs text-slate-200 space-y-2 list-disc list-inside leading-relaxed">
                {simpleContent.advices.map((advice, idx) => (
                  <li key={idx}>{advice}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Version & Unmeasurable / Warning Banners */}
      {!isMeasurable && (
        <div className="p-4 rounded-2xl bg-rose-500/15 border border-rose-500/40 text-rose-200 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h4 className="font-bold text-sm text-white">測定要件未達（再測定が必要です）</h4>
            <p className="text-xs leading-relaxed text-rose-200">
              {unmeasurableReason || '有効な発声時間が不足しているため、正確な音響解析を行えませんでした。'}
            </p>
            <p className="text-[11px] text-rose-300/80">
              ※録音開始後の「周辺音測定（3秒）」終了後、左側の「朗読用テキスト」を3秒以上しっかりと発話してください。
            </p>
          </div>
        </div>
      )}

      {noiseAnalysis?.hasNoiseLevelShiftWarning && (
        <div className="p-4 rounded-2xl bg-amber-500/15 border border-amber-500/40 text-amber-200 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h4 className="font-bold text-sm text-white">周辺環境の騒音レベル変動警告</h4>
            <p className="text-xs leading-relaxed text-amber-200">
              測定前半のノイズ（{noiseAnalysis.preNoiseDbFS} dBFS）と後半のノイズ（
              {noiseAnalysis.postNoiseDbFS} dBFS）で {noiseAnalysis.noiseDifferenceDb} dB
              の大きな騒音変動が観測されました。周囲の物音やエアコンの変動によりS/N比の比較精度が低下している可能性があります。
            </p>
          </div>
        </div>
      )}

      {/* 1. TOP HERO: Overall Provisional Score & Diagnosis */}
      <div className="rounded-2xl bg-slate-950/80 border border-slate-800 p-5 sm:p-6">
        {/* Top Row: Total Score & Provisional Grade First */}
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-5 pb-5 border-b border-slate-800">
          {/* Primary Score Readout */}
          <div className="flex items-center gap-4 bg-slate-900/90 p-4 rounded-xl border border-cyan-500/35 shrink-0">
            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl bg-slate-950 text-slate-100 flex flex-col items-center justify-center font-black border border-slate-700 px-1.5 text-center shrink-0">
              <span
                className={`${
                  provisionalScore.totalScore === null
                    ? 'text-xs sm:text-sm text-rose-300'
                    : 'text-base sm:text-lg text-cyan-300'
                } leading-tight`}
              >
                {provisionalScore.provisionalGradeLabel}
              </span>
              <span className="text-[9px] uppercase tracking-wider mt-1 font-bold text-slate-400">
                暫定判定
              </span>
            </div>

            <div className="space-y-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-300 font-semibold">
                  暫定100点スコア（客観測定値ベース）
                </span>
                {provisionalScore.isRescaled && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                    比例換算あり
                  </span>
                )}
                {provisionalScore.totalScore === null && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30">
                    算出不能
                  </span>
                )}
              </div>

              <div className="flex items-baseline gap-2 font-mono tabular-nums">
                {provisionalScore.totalScore !== null ? (
                  <>
                    <span className="text-3xl sm:text-4xl font-black text-cyan-300 tracking-tight">
                      {provisionalScore.totalScore}
                    </span>
                    <span className="text-sm text-slate-400 font-semibold">/ 100 点</span>
                  </>
                ) : (
                  <span className="text-xl sm:text-2xl font-black text-rose-300">算出不能</span>
                )}
              </div>

              <div className="text-[11px] text-slate-400 leading-snug max-w-[320px]">
                {provisionalScore.summary}
              </div>
            </div>
          </div>

          {/* Right Summary Metadata */}
          <div className="space-y-2 flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-cyan-400 shrink-0" />
              <span className="text-xs uppercase tracking-wider font-bold text-cyan-400">
                総合評価サマリー（客観指標・参考値）
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-700">
                DSP {algoVersion}
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-950/60 text-cyan-300 border border-cyan-500/30">
                {provisionalScore.scoringVersion}
              </span>
            </div>
            <h2 className="text-lg sm:text-xl font-extrabold text-white leading-snug">
              {gradeTitle}
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              {assessmentSummary}
            </p>
          </div>
        </div>

        {/* 1B. Provisional 100-Point Breakdown & Organized Notices */}
        <div className="mt-5 pb-6 border-b border-slate-800 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-cyan-400 shrink-0" />
              <h3 className="font-bold text-sm text-white">
                4項目の配点とスコア内訳（主観評価はスコア計算に使用しません）
              </h3>
            </div>
            <span className="text-[11px] font-mono tabular-nums text-slate-300">
              {provisionalScore.isRescaled
                ? `比例換算: 有効項目 ${provisionalScore.rawScoreSum} / ${provisionalScore.availableMaxScoreSum} 点 → ${provisionalScore.totalScore} / 100 点`
                : provisionalScore.totalScore !== null
                ? `合計 ${provisionalScore.rawScoreSum} / 100 点`
                : '算出不能'}
            </span>
          </div>

          {/* Explicit Rescaling / Unavailable Callouts */}
          {(provisionalScore.isRescaled || provisionalScore.unavailableItems.length > 0) && (
            <div className="space-y-2">
              {provisionalScore.rescalingNote && (
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-200 leading-relaxed">
                  <span className="font-bold text-amber-300">比例換算の適用: </span>
                  {provisionalScore.rescalingNote}
                </div>
              )}
              {provisionalScore.unavailableItems.length > 0 && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-[11px] text-rose-200 leading-relaxed">
                  <span className="font-bold text-rose-300">算出不能項目: </span>
                  {provisionalScore.unavailableItems.join(' ／ ')}
                </div>
              )}
            </div>
          )}

          {/* Weight-Proportional Horizontal Bar Chart (20 / 35 / 25 / 20) */}
          <div className="rounded-xl bg-slate-900/70 border border-slate-800 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400 pb-2 border-b border-slate-800/80">
              <span>横棒の長さは各配点の上限（35 / 25 / 20点）を比例表示しています</span>
              <span className="font-mono tabular-nums">配点合計: 20 + 35 + 25 + 20 = 100点</span>
            </div>

            <div className="space-y-3">
              {scoreItems.map((item) => {
                const earnedPctOfMax =
                  item.score !== null && item.maxScore > 0
                    ? Math.round((item.score / item.maxScore) * 100)
                    : 0;
                const trackWidthPct = (item.maxScore / maxItemWeight) * 100;
                const statusLabel =
                  item.status === 'scored'
                    ? '客観採点'
                    : item.status === 'provisional'
                    ? '暫定基準'
                    : '算出不能';
                const statusColor =
                  item.status === 'scored'
                    ? 'text-emerald-300'
                    : item.status === 'provisional'
                    ? 'text-amber-300'
                    : 'text-rose-300';

                return (
                  <div
                    key={item.key}
                    className="grid grid-cols-1 sm:grid-cols-[175px_1fr_135px] items-center gap-2 sm:gap-3"
                  >
                    {/* Label & Weight */}
                    <div className="flex items-center justify-between sm:justify-start gap-2">
                      <span className="text-xs font-bold text-white">{item.label}</span>
                      <span className="text-[10px] font-mono tabular-nums text-slate-400">
                        配点 {item.maxScore}点
                      </span>
                    </div>

                    {/* Weight-Proportional Track + Inner Fill */}
                    <div className="w-full flex items-center gap-2">
                      <div
                        className="h-3.5 rounded bg-slate-950 border border-slate-700/80 overflow-hidden relative shrink-0"
                        style={{ width: `${trackWidthPct}%` }}
                        aria-label={`${item.label}: ${
                          item.score !== null ? `${item.score} / ${item.maxScore}点` : '算出不能'
                        }`}
                      >
                        <div
                          className={`h-full transition-all ${
                            item.score === null
                              ? 'bg-slate-700/50'
                              : earnedPctOfMax >= 80
                              ? 'bg-emerald-400'
                              : earnedPctOfMax >= 55
                              ? 'bg-cyan-400'
                              : 'bg-amber-400'
                          }`}
                          style={{ width: `${item.score === null ? 0 : earnedPctOfMax}%` }}
                        />
                      </div>
                      {item.maxScore < maxItemWeight && (
                        <span className="text-[10px] font-mono tabular-nums text-slate-500 hidden md:inline">
                          (上限 {item.maxScore})
                        </span>
                      )}
                    </div>

                    {/* Earned / Max Readout */}
                    <div className="flex items-center justify-between sm:justify-end gap-2 font-mono tabular-nums">
                      <span
                        className={`text-xs font-bold ${
                          item.score === null ? 'text-rose-300' : 'text-cyan-300'
                        }`}
                      >
                        {item.score !== null
                          ? `${item.score} / ${item.maxScore} 点`
                          : `算出不能 / ${item.maxScore}`}
                      </span>
                      <span className={`text-[10px] font-sans font-semibold ${statusColor}`}>
                        {statusLabel}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 4-Item Calculation Rationale */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {scoreItems.map((item) => (
              <div
                key={item.key}
                className="p-3.5 rounded-xl bg-slate-900/50 border border-slate-800 space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-white">{item.label}の算出根拠</span>
                  <span className="text-xs font-mono tabular-nums font-bold text-slate-200">
                    {item.score !== null ? `${item.score} / ${item.maxScore} 点` : `算出不能 / ${item.maxScore} 点`}
                  </span>
                </div>
                <p className="text-[11px] text-slate-300 leading-relaxed">{item.rationale}</p>
                {item.usedMetrics.length > 0 && (
                  <div className="text-[10px] font-mono text-slate-500 truncate" title={item.usedMetrics.join(', ')}>
                    指標: {item.usedMetrics.join(', ')}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* 3-Category Organized Notices */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {/* Category 1: Actionable Notices */}
            <div className="p-3.5 rounded-xl bg-slate-900/70 border border-emerald-500/30 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-300">
                <Zap className="w-3.5 h-3.5 shrink-0" />
                <span>改善行動につながる注意</span>
              </div>
              {categorizedNotices.actionable.length > 0 ? (
                <ul className="text-[11px] text-slate-200 space-y-1.5 list-disc list-inside leading-relaxed">
                  {categorizedNotices.actionable.map((msg, idx) => (
                    <li key={idx}>{msg}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  入力音量および定常暗騒音について、緊急の改善行動を要する指標低下は検出されていません。
                </p>
              )}
            </div>

            {/* Category 2: Measurement Reliability Notices */}
            <div className="p-3.5 rounded-xl bg-slate-900/70 border border-amber-500/30 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-amber-300">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>測定上の信頼性に関する注意</span>
              </div>
              {categorizedNotices.reliability.length > 0 ? (
                <ul className="text-[11px] text-slate-200 space-y-1.5 list-disc list-inside leading-relaxed">
                  {categorizedNotices.reliability.map((msg, idx) => (
                    <li key={idx}>{msg}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  ゲート疑いや低S/N混入等の特異な信頼性低下警告は出ていませんが、内蔵DSPや声質の影響は残ります。
                </p>
              )}
            </div>

            {/* Category 3: Common Disclaimers */}
            <div className="p-3.5 rounded-xl bg-slate-900/70 border border-cyan-500/30 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-cyan-300">
                <Info className="w-3.5 h-3.5 shrink-0" />
                <span>共通の免責説明（暫定評価・Web会議DSP）</span>
              </div>
              <div className="text-[11px] text-slate-300 space-y-1.5 leading-relaxed">
                <p>{PROVISIONAL_SCORE_NOTICES.provisionalScoreNotice}</p>
                <p>
                  <span className="font-semibold text-cyan-200">Web会議側処理の影響: </span>
                  {PROVISIONAL_SCORE_NOTICES.webMeetingDspNotice}{' '}
                  {PROVISIONAL_SCORE_NOTICES.browserDspSettingNote}
                </p>
              </div>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-900/40 border border-slate-800 text-[11px] text-slate-400 space-y-1">
            <span className="font-bold text-slate-300 block">
              参考表示のみの指標（今回の総合スコア配点には含めない項目）:
            </span>
            <ul className="list-disc list-inside space-y-0.5">
              {provisionalScore.referenceOnlyIndicators.map((ind, idx) => (
                <li key={idx}>{ind}</li>
              ))}
            </ul>
          </div>
        </div>

        {/* 2. CORE REQUIREMENT: Speech vs Noise Volume Stats (Max, Min, Avg) */}
        <div className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2">
              <Radio className="w-4 h-4 text-cyan-400" />
              <h3 className="font-bold text-sm text-white">
                話者の発声 と 周辺音 の音量比較・判定（最大 / 最小 / 平均）
              </h3>
            </div>
            <span className="text-[11px] text-slate-400 font-mono">単位: dBFS（線形電力集計）</span>
          </div>

          <div className="mb-3 text-[11px] text-slate-400 leading-relaxed">
            デジタル音響では「音割れ・歪みが発生する上限」を{' '}
            <span className="text-cyan-300 font-mono font-bold">0 dBFS</span>{' '}
            と定義するため、通常の音声はすべてマイナスで表されます（0dBに近いほど大きく、マイナスが大きいほど静かな音を表します。Web会議では{' '}
            <span className="text-emerald-400 font-mono font-bold">-24dB 〜 -14dB</span> が適正です）。
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Box A: 話者の発声 (Voice Activity) */}
            <div className="rounded-2xl bg-slate-950/80 border border-emerald-500/30 p-4 sm:p-5 relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 to-teal-400"></div>
              <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                    <Mic className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="font-bold text-sm text-white">話者の発声 (Speech)</h4>
                    <span className="text-[10px] text-emerald-400">
                      読み上げ区間内で検出された発声区間（{speechStats.durationSec}秒）
                    </span>
                  </div>
                </div>
              </div>

              {/* 4 Metrics: Max, Min, Avg, Web会議適正値内の割合 */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4 text-center">
                <div className="bg-slate-900/90 p-2.5 rounded-xl border border-slate-800">
                  <span className="text-[11px] text-slate-400 block font-medium">最大 (Max)</span>
                  <span className="text-base sm:text-lg font-black font-mono text-emerald-300">
                    {speechStats.durationSec > 0 ? formatDb(speechStats.maxDb) : '未検出'}
                  </span>
                  <span className="text-[9px] text-slate-500 block mt-0.5">30ms窓最大RMS</span>
                </div>

                <div className="bg-slate-900/90 p-2.5 rounded-xl border border-slate-800">
                  <span className="text-[11px] text-slate-400 block font-medium">最小 (Min)</span>
                  <span className="text-base sm:text-lg font-black font-mono text-emerald-300">
                    {speechStats.durationSec > 0 ? formatDb(speechStats.minDb) : '未検出'}
                  </span>
                  <span className="text-[9px] text-slate-500 block mt-0.5">30ms窓最小RMS</span>
                </div>

                <div className="bg-slate-900/90 p-2.5 rounded-xl border border-slate-800">
                  <span className="text-[11px] text-slate-400 block font-medium">平均 (Avg)</span>
                  <span className="text-base sm:text-lg font-black font-mono text-emerald-400">
                    {speechStats.durationSec > 0 ? formatDb(speechStats.avgDb) : '未検出'}
                  </span>
                  <span className="text-[9px] text-slate-500 block mt-0.5">発声区間RMS</span>
                </div>

                <div className="bg-emerald-950/40 p-2.5 rounded-xl border border-emerald-500/40">
                  <span className="text-[11px] text-emerald-300 block font-bold">適正値内の割合</span>
                  <span className="text-base sm:text-lg font-black font-mono text-emerald-400">
                    {speechStats.appropriateRatioPercent}%
                  </span>
                  <span className="text-[9px] text-emerald-300/80 block mt-0.5">Web会議推奨範囲</span>
                </div>
              </div>

              {/* Web会議適正値説明 */}
              <div className="mt-3 text-[11px] text-slate-300 bg-slate-900/60 p-3 rounded-xl border border-slate-800/80 space-y-1.5">
                <div className="flex items-center justify-between text-slate-400 pb-1.5 border-b border-slate-800">
                  <span className="font-bold text-emerald-400">適正基準: {speechStats.targetRangeText}</span>
                  <span className="font-mono text-emerald-300 font-bold">
                    {speechStats.appropriateRatioPercent}% 適合
                  </span>
                </div>
                {speechStats.durationSec === 0 ? (
                  <p className="text-rose-400 font-medium">
                    ✕ 発声区間が検出されませんでした。マイク接続やミュート設定をご確認の上、再測定してください。
                  </p>
                ) : speechStats.avgDb >= -24 && speechStats.avgDb <= -14 ? (
                  <p className="text-emerald-400 font-medium">
                    ✔ 発声の平均実効レベルが推奨レンジ（-24〜-14 dBFS）内に収まっています。
                  </p>
                ) : speechStats.avgDb < -24 ? (
                  <p className="text-amber-400 font-medium">
                    ⚠ 発声が小さめの傾向があります。マイク感度や入力を引き上げると相手が聞き取りやすくなります。
                  </p>
                ) : (
                  <p className="text-amber-400 font-medium">
                    ⚠ 入力レベルが高めの傾向があります。マイク距離を少し離すかゲインを調整してください。
                  </p>
                )}
              </div>
            </div>

            {/* Box B: 周辺音 (Ambient / Noise) */}
            <div className="rounded-2xl bg-slate-950/80 border border-sky-500/30 p-4 sm:p-5 relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-sky-500 to-blue-400"></div>
              <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-sky-500/20 text-sky-400 flex items-center justify-center">
                    <Volume2 className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="font-bold text-sm text-white">周辺音・暗騒音 (Ambient)</h4>
                    <span className="text-[10px] text-sky-400">
                      発話前3秒＋停止後2秒の定常ノイズ測定
                    </span>
                  </div>
                </div>
              </div>

              {/* 4 Metrics: Max, Min, Avg, 適正値割合 */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4 text-center">
                <div className="bg-slate-900/90 p-2.5 rounded-xl border border-slate-800">
                  <span className="text-[11px] text-slate-400 block font-medium">最大 (Max)</span>
                  <span className="text-base sm:text-lg font-black font-mono text-sky-300">
                    {formatDb(noiseStats.maxDb)}
                  </span>
                  <span className="text-[9px] text-slate-500 block mt-0.5">30ms窓最大RMS</span>
                </div>

                <div className="bg-slate-900/90 p-2.5 rounded-xl border border-slate-800">
                  <span className="text-[11px] text-slate-400 block font-medium">最小 (Min)</span>
                  <span className="text-base sm:text-lg font-black font-mono text-sky-300">
                    {formatDb(noiseStats.minDb)}
                  </span>
                  <span className="text-[9px] text-slate-500 block mt-0.5">30ms窓最小RMS</span>
                </div>

                <div className="bg-slate-900/90 p-2.5 rounded-xl border border-slate-800">
                  <span className="text-[11px] text-slate-400 block font-medium">定常平均</span>
                  <span className="text-base sm:text-lg font-black font-mono text-sky-400">
                    {formatDb(noiseAnalysis?.representativeNoiseDbFS ?? noiseStats.avgDb)}
                  </span>
                  <span className="text-[9px] text-slate-500 block mt-0.5">外れ値除外後</span>
                </div>

                <div className="bg-sky-950/40 p-2.5 rounded-xl border border-sky-500/40">
                  <span className="text-[11px] text-sky-300 block font-bold">静寂判定割合</span>
                  <span className="text-base sm:text-lg font-black font-mono text-sky-400">
                    {noiseStats.appropriateRatioPercent}%
                  </span>
                  <span className="text-[9px] text-sky-300/80 block mt-0.5">-45dBFS以下</span>
                </div>
              </div>

              {/* Noise Detail */}
              <div className="mt-3 text-[11px] text-slate-300 bg-slate-900/60 p-3 rounded-xl border border-slate-800/80 space-y-1.5">
                <div className="flex items-center justify-between text-slate-400 pb-1.5 border-b border-slate-800">
                  <span className="font-bold text-sky-400">静寂基準: {noiseStats.targetRangeText}</span>
                  <span className="font-mono text-sky-300 font-bold">
                    事前 {noiseAnalysis?.preNoiseDbFS ?? noiseStats.avgDb} / 事後{' '}
                    {noiseAnalysis?.postNoiseDbFS ?? noiseStats.avgDb} dBFS
                  </span>
                </div>
                <p className="text-slate-300 text-[11px]">
                  突発的なクリック音を除外し、定常的なファン音や暗騒音の実効レベルを集計しています。
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* 3. Estimated SNR: Pure Voice Power Separation */}
        <div className="mt-4 p-4 rounded-2xl bg-slate-950 border border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-200">推定S/N比（純音声電力分離方式）</span>
              <span className="text-[10px] text-slate-400 font-mono">
                P_voice = P_total - P_noise
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              発話前後の無音区間で測定した背景ノイズ電力が発話中も同等と仮定し、発話全体電力から減算して算出した推定値です（発声中の環境ノイズ変動や動的ノイズ抑制の影響は分離できません）。
            </p>
          </div>

          <div className="text-right shrink-0">
            {estimatedSnr?.isMeasurable ? (
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-black font-mono text-emerald-400">
                  {estimatedSnr.snrDb}
                </span>
                <span className="text-xs text-slate-400 font-mono">dB</span>
              </div>
            ) : (
              <span className="text-xs font-bold text-rose-400 bg-rose-500/10 px-3 py-1 rounded-lg border border-rose-500/30">
                測定不能（{estimatedSnr?.unmeasurableReason || '純音声分離不可'}）
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 3. Frequency Balance & Band Ratio */}
      <div className="rounded-2xl bg-slate-950/70 border border-slate-800/80 p-5 sm:p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Sliders className="w-5 h-5 text-cyan-400" />
            <div>
              <h3 className="font-bold text-sm sm:text-base text-white">
                周波数スペクトル解析（2048点FFT・Hann窓）
              </h3>
              <p className="text-[11px] text-slate-400">
                5帯域の音響エネルギー分布と、低域/中高域パワー比による客観的な傾向観測
              </p>
            </div>
          </div>

          <div className="text-right shrink-0">
            {bandRatio && speechStats.durationSec > 0 && (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-mono font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                低域/中高域比: {bandRatio.ratioDb > 0 ? '+' : ''}
                {bandRatio.ratioDb} dB
              </span>
            )}
          </div>
        </div>

        {/* Meters: Band Ratio Observation & Centroid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Band Ratio Meter */}
          <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold text-slate-300">
                低域(120-500Hz) / 中高域(1.5-4.2kHz) パワー比
              </span>
              <span className="text-base font-black font-mono text-cyan-400">
                {speechStats.durationSec > 0 ? `${bandRatio?.ratioDb ?? 0} dB` : '測定不能'}
              </span>
            </div>
            <p className="text-[11px] text-slate-300 leading-relaxed">
              {bandRatio?.relativeObservationText || '帯域バランスを計測中'}
            </p>
            <p className="text-[10px] text-slate-500">
              ※マイクの周波数応答・口との距離・声質に依存する測定値です。同一条件での相対比較にご利用ください。
            </p>
          </div>

          {/* Spectral Centroid Meter */}
          <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold text-slate-300">音響スペクトル重心 (参考)</span>
              <span className="text-base font-black font-mono text-cyan-400">
                {speechStats.durationSec > 0 ? `${spectralCentroidHz} Hz` : '測定不能'}
              </span>
            </div>
            <div className="h-3 w-full bg-slate-900 rounded-full overflow-hidden p-0.5 border border-slate-800 relative">
              <div
                className="h-full bg-cyan-400 rounded-full"
                style={{ width: `${speechStats.durationSec > 0 ? Math.min(100, (spectralCentroidHz / 3500) * 100) : 0}%` }}
              />
            </div>
            <p className="text-[11px] text-slate-400">
              周波数全体のエネルギー加重平均です。高域成分が多いほど重心が高くなります。
            </p>
          </div>
        </div>

        {/* Frequency Band Breakdown Stack */}
        <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-3">
          <div className="flex items-center justify-between text-xs font-bold text-slate-300">
            <div className="flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-cyan-400" />
              <span>5帯域エネルギー比率（声の成分比率）</span>
            </div>
            <span className="text-[11px] text-slate-500">全帯域合計 100%</span>
          </div>

          {/* Stacked Bar */}
          <div className="h-5 w-full rounded-xl overflow-hidden flex bg-slate-900 border border-slate-800">
            <div
              style={{ width: `${frequencyBalance.subBassRumble}%` }}
              className="bg-slate-700 hover:opacity-90 transition-all"
              title={`超低音(机振動/暗騒音 <120Hz): ${frequencyBalance.subBassRumble}%`}
            />
            <div
              style={{ width: `${frequencyBalance.vocalLowBoom}%` }}
              className="bg-amber-600 hover:opacity-90 transition-all"
              title={`低音(胴鳴り帯域 120-300Hz): ${frequencyBalance.vocalLowBoom}%`}
            />
            <div
              style={{ width: `${frequencyBalance.vocalCore}%` }}
              className="bg-blue-500 hover:opacity-90 transition-all"
              title={`中音(声の芯・母音 300-1500Hz): ${frequencyBalance.vocalCore}%`}
            />
            <div
              style={{ width: `${frequencyBalance.vocalClarity}%` }}
              className="bg-emerald-400 hover:opacity-90 transition-all"
              title={`明瞭度(子音帯域 1500-4200Hz): ${frequencyBalance.vocalClarity}%`}
            />
            <div
              style={{ width: `${frequencyBalance.airAndHiss}%` }}
              className="bg-cyan-300 hover:opacity-90 transition-all"
              title={`超高音(抜け感 4200-10000Hz): ${frequencyBalance.airAndHiss}%`}
            />
          </div>

          {/* Legend */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[11px] text-slate-400 pt-1">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-slate-700"></span>
              <span>
                暗騒音 (&lt;120Hz):{' '}
                <b className="text-slate-300 font-mono">{frequencyBalance.subBassRumble}%</b>
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-amber-600"></span>
              <span>
                胴鳴り (120-300Hz):{' '}
                <b className="text-slate-300 font-mono">{frequencyBalance.vocalLowBoom}%</b>
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-blue-500"></span>
              <span>
                声の芯 (300-1.5kHz):{' '}
                <b className="text-slate-300 font-mono">{frequencyBalance.vocalCore}%</b>
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-emerald-400"></span>
              <span>
                明瞭度 (1.5-4.2kHz):{' '}
                <b className="text-slate-300 font-mono">{frequencyBalance.vocalClarity}%</b>
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-cyan-300"></span>
              <span>
                抜け感 (4.2k-10kHz):{' '}
                <b className="text-slate-300 font-mono">{frequencyBalance.airAndHiss}%</b>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 3B. Phase 2B-2B Objective Reference Metrics (No Pass/Fail Judgments or Scores) */}
      <div className="rounded-2xl bg-slate-950/70 border border-slate-800/80 p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Radio className="w-5 h-5 text-slate-300" />
            <div>
              <h3 className="font-bold text-sm sm:text-base text-white">
                音声品質の参考指標（客観特徴量）
              </h3>
              <p className="text-[11px] text-slate-400">
                同一条件比較用の物理特徴量です。閾値による良否判定やスコア換算は行っていません。
              </p>
            </div>
          </div>
          <span className="text-[10px] font-mono px-2.5 py-1 rounded bg-slate-900 text-slate-300 border border-slate-700">
            {extendedMetrics
              ? `2048pt Hann FFT (hop ${extendedMetrics.fftHopSize}) / SR ${(
                  extendedMetrics.sampleRateHz / 1000
                ).toFixed(1)}kHz`
              : '未解析'}
          </span>
        </div>

        {!extendedMetrics ? (
          <div className="p-4 rounded-2xl bg-slate-900/70 border border-slate-800 text-xs text-slate-300">
            未解析（拡張指標導入前に記録されたデータのため、音声品質の参考指標は算出されていません）
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* A. Speech-Band SNR vs Broadband SNR */}
            <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-200">
                  音声帯域内S/N比 ({extendedMetrics.speechBandSnr.frequencyRange.effectiveLowHz}–
                  {extendedMetrics.speechBandSnr.frequencyRange.effectiveHighHz} Hz)
                </span>
                <span className="text-sm font-black font-mono text-slate-100">
                  {extendedMetrics.speechBandSnr.isMeasurable &&
                  extendedMetrics.speechBandSnr.snrDb !== null
                    ? `${extendedMetrics.speechBandSnr.snrDb.toFixed(1)} dB`
                    : '測定不能'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px] bg-slate-900/70 p-2.5 rounded-xl border border-slate-800/80">
                <div>
                  <span className="text-slate-400 block">全帯域推定S/N比</span>
                  <span className="font-mono font-bold text-slate-200">
                    {estimatedSnr?.isMeasurable && estimatedSnr.snrDb !== undefined
                      ? `${estimatedSnr.snrDb.toFixed(1)} dB`
                      : '測定不能'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block">帯域内 − 全帯域 差</span>
                  <span className="font-mono font-bold text-slate-200">
                    {formatSignedDb(extendedMetrics.speechBandSnr.broadbandDiffDb)}
                  </span>
                </div>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                {extendedMetrics.speechBandSnr.isMeasurable
                  ? `発声帯域電力 ${formatPlainVal(
                      extendedMetrics.speechBandSnr.speechBandPowerDbFS,
                      'dBFS'
                    )} / 定常暗騒音 ${formatPlainVal(
                      extendedMetrics.speechBandSnr.noiseBandPowerDbFS,
                      'dBFS'
                    )}（20〜70%点線形電力推定）。${
                      extendedMetrics.speechBandSnr.status === 'reference_nyquist'
                        ? `※ナイキスト周波数制限により上限${extendedMetrics.speechBandSnr.frequencyRange.effectiveHighHz}Hzまでの参考値です。`
                        : ''
                    }`
                  : extendedMetrics.speechBandSnr.unmeasurableReason ||
                    '帯域内S/N比を測定できませんでした。'}
              </p>
            </div>

            {/* B. High-Frequency Rolloff */}
            <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-200">
                  高域減衰・95%ロールオフ周波数
                </span>
                <span className="text-[10px] font-mono text-slate-400">
                  全帯域(20–8k) / 音声帯域(300–8k)
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px] bg-slate-900/70 p-2.5 rounded-xl border border-slate-800/80">
                <div>
                  <span className="text-slate-400 block">
                    20–{extendedMetrics.highFreqRolloff.rolloffFrequencyRange.effectiveHighHz} Hz
                  </span>
                  <span className="text-sm font-black font-mono text-slate-100">
                    {extendedMetrics.highFreqRolloff.isMeasurable &&
                    extendedMetrics.highFreqRolloff.rolloff95Hz !== null
                      ? `${extendedMetrics.highFreqRolloff.rolloff95Hz.toFixed(1)} Hz`
                      : '測定不能'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block">
                    300–
                    {extendedMetrics.highFreqRolloff.rolloff95SpeechBandRange?.effectiveHighHz ??
                      Math.min(8000, Math.round(extendedMetrics.nyquistHz))}{' '}
                    Hz
                  </span>
                  <span className="text-sm font-black font-mono text-cyan-300">
                    {typeof extendedMetrics.highFreqRolloff.rolloff95SpeechBandHz === 'number' &&
                    Number.isFinite(extendedMetrics.highFreqRolloff.rolloff95SpeechBandHz)
                      ? `${extendedMetrics.highFreqRolloff.rolloff95SpeechBandHz.toFixed(1)} Hz`
                      : '測定不能'}
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-[11px] bg-slate-900/70 p-2.5 rounded-xl border border-slate-800/80">
                <div>
                  <span className="text-slate-400 block">1.5–4.2kHz</span>
                  <span className="font-mono font-bold text-slate-200">
                    {formatPlainVal(
                      extendedMetrics.highFreqRolloff.power1500_4200DbFS,
                      'dBFS'
                    )}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block">4.2–8kHz</span>
                  <span className="font-mono font-bold text-slate-200">
                    {extendedMetrics.highFreqRolloff.isHighBandMeasurable
                      ? formatPlainVal(
                          extendedMetrics.highFreqRolloff.power4200_8000DbFS,
                          'dBFS'
                        )
                      : '測定不能'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block">4.2–8k / 1.5–4.2k比</span>
                  <span className="font-mono font-bold text-slate-200">
                    {extendedMetrics.highFreqRolloff.isHighBandMeasurable
                      ? formatSignedDb(extendedMetrics.highFreqRolloff.highToMidHighRatioDb)
                      : '測定不能'}
                  </span>
                </div>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                {extendedMetrics.highFreqRolloff.constraintNote}
              </p>
            </div>

            {/* C. Band-Energy Comparison Ratios */}
            <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-2.5 lg:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-200">
                  帯域エネルギー比較（帯域幅正規化 PSD比・dB）
                </span>
                <span className="text-[10px] font-mono text-slate-400">
                  正規化方式: W/Hz 密度比（参考: 帯域積分比も同時算出）
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-[11px]">
                <div className="bg-slate-900/70 p-3 rounded-xl border border-slate-800/80 space-y-1">
                  <span className="text-slate-400 block">低域(120–300Hz) / 声の芯(300–1000Hz)</span>
                  <span className="text-base font-black font-mono text-slate-100 block">
                    {formatSignedDb(extendedMetrics.bandEnergyComparison.ratios.lowToCoreDb)}
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono block">
                    積分比:{' '}
                    {formatSignedDb(
                      extendedMetrics.bandEnergyComparison.integratedRatiosDb.lowToCoreDb
                    )}
                  </span>
                </div>
                <div className="bg-slate-900/70 p-3 rounded-xl border border-slate-800/80 space-y-1">
                  <span className="text-slate-400 block">
                    明瞭域(1500–4200Hz) / 声の芯(300–1000Hz)
                  </span>
                  <span className="text-base font-black font-mono text-slate-100 block">
                    {formatSignedDb(extendedMetrics.bandEnergyComparison.ratios.clarityToCoreDb)}
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono block">
                    積分比:{' '}
                    {formatSignedDb(
                      extendedMetrics.bandEnergyComparison.integratedRatiosDb.clarityToCoreDb
                    )}
                  </span>
                </div>
                <div className="bg-slate-900/70 p-3 rounded-xl border border-slate-800/80 space-y-1">
                  <span className="text-slate-400 block">
                    高域(4200–8000Hz) / 明瞭域(1500–4200Hz)
                  </span>
                  <span className="text-base font-black font-mono text-slate-100 block">
                    {extendedMetrics.bandEnergyComparison.bands.high_4200_8000.isMeasurable
                      ? formatSignedDb(extendedMetrics.bandEnergyComparison.ratios.highToClarityDb)
                      : '測定不能'}
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono block">
                    積分比:{' '}
                    {extendedMetrics.bandEnergyComparison.bands.high_4200_8000.isMeasurable
                      ? formatSignedDb(
                          extendedMetrics.bandEnergyComparison.integratedRatiosDb.highToClarityDb
                        )
                      : '測定不能'}
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] font-mono text-slate-400 pt-1">
                <div>
                  低域:{' '}
                  {formatPlainVal(
                    extendedMetrics.bandEnergyComparison.bands.low_120_300.powerDbFS,
                    'dBFS'
                  )}
                </div>
                <div>
                  声の芯:{' '}
                  {formatPlainVal(
                    extendedMetrics.bandEnergyComparison.bands.core_300_1000.powerDbFS,
                    'dBFS'
                  )}
                </div>
                <div>
                  明瞭域:{' '}
                  {formatPlainVal(
                    extendedMetrics.bandEnergyComparison.bands.clarity_1500_4200.powerDbFS,
                    'dBFS'
                  )}
                </div>
                <div>
                  高域:{' '}
                  {extendedMetrics.bandEnergyComparison.bands.high_4200_8000.isMeasurable
                    ? formatPlainVal(
                        extendedMetrics.bandEnergyComparison.bands.high_4200_8000.powerDbFS,
                        'dBFS'
                      )
                    : '測定不能'}
                </div>
              </div>
            </div>

            {/* D. Speech Level Variability */}
            <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-200">
                  発声内音量変動（30ms窓RMS IQR）
                </span>
                <span className="text-sm font-black font-mono text-slate-100">
                  {extendedMetrics.speechLevelVariability.isMeasurable &&
                  extendedMetrics.speechLevelVariability.iqrDb !== null
                    ? `${extendedMetrics.speechLevelVariability.iqrDb.toFixed(1)} dB`
                    : '測定不能'}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-[11px] bg-slate-900/70 p-2.5 rounded-xl border border-slate-800/80">
                <div>
                  <span className="text-slate-400 block">中央値</span>
                  <span className="font-mono font-bold text-slate-200">
                    {formatPlainVal(
                      extendedMetrics.speechLevelVariability.medianDbFS,
                      'dBFS'
                    )}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block">p25 〜 p75</span>
                  <span className="font-mono font-bold text-slate-200">
                    {extendedMetrics.speechLevelVariability.isMeasurable
                      ? `${extendedMetrics.speechLevelVariability.p25DbFS?.toFixed(
                          1
                        )} 〜 ${extendedMetrics.speechLevelVariability.p75DbFS?.toFixed(1)}`
                      : '測定不能'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block">最小〜最大幅</span>
                  <span className="font-mono font-bold text-slate-200">
                    {formatPlainVal(extendedMetrics.speechLevelVariability.rangeDb, 'dB')}
                  </span>
                </div>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                {extendedMetrics.speechLevelVariability.interpretationNote}
              </p>
            </div>

            {/* E. Spectral Flatness */}
            <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-200">
                  スペクトル平坦度 ({extendedMetrics.spectralFlatness.frequencyRange.effectiveLowHz}–
                  {extendedMetrics.spectralFlatness.frequencyRange.effectiveHighHz} Hz)
                </span>
                <span className="text-sm font-black font-mono text-slate-100">
                  {extendedMetrics.spectralFlatness.isMeasurable &&
                  extendedMetrics.spectralFlatness.median !== null
                    ? `${extendedMetrics.spectralFlatness.median.toFixed(3)} (中央値)`
                    : '測定不能'}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-[11px] bg-slate-900/70 p-2.5 rounded-xl border border-slate-800/80">
                <div>
                  <span className="text-slate-400 block">平均</span>
                  <span className="font-mono font-bold text-slate-200">
                    {formatPlainVal(extendedMetrics.spectralFlatness.mean, '', 3)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block">p25 〜 p75</span>
                  <span className="font-mono font-bold text-slate-200">
                    {extendedMetrics.spectralFlatness.isMeasurable
                      ? `${extendedMetrics.spectralFlatness.p25?.toFixed(
                          3
                        )} 〜 ${extendedMetrics.spectralFlatness.p75?.toFixed(3)}`
                      : '測定不能'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block">有効フレーム数</span>
                  <span className="font-mono font-bold text-slate-200">
                    {extendedMetrics.spectralFlatness.validSpeechFrameCount}
                  </span>
                </div>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                {extendedMetrics.spectralFlatness.interpretationNote}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* 4. CLINICAL DIAGNOSTIC ITEMS & ADVICE */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Diagnostic Items Checklist */}
        <div className="rounded-2xl bg-slate-950/70 border border-slate-800/80 p-5 space-y-3">
          <h3 className="font-bold text-sm text-white flex items-center gap-2">
            <Activity className="w-4 h-4 text-cyan-400" />
            <span>通話ストレス要因・項目別診断</span>
          </h3>

          <div className="space-y-2.5 pt-1">
            {assessmentItems.map((item, idx) => (
              <div
                key={idx}
                className="p-3.5 rounded-2xl bg-slate-900/80 border border-slate-800/80 space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="shrink-0">{getStatusIcon(item.status)}</div>
                    <span className="text-xs font-bold text-white whitespace-nowrap">{item.title}</span>
                    <span className="text-[11px] font-mono text-cyan-400 whitespace-nowrap hidden sm:inline">
                      {item.valueText}
                    </span>
                  </div>
                  <div className="shrink-0 whitespace-nowrap ml-auto">
                    {getStatusBadge(item.status)}
                  </div>
                </div>

                <div className="sm:hidden text-[10px] font-mono text-cyan-400 pl-6 -mt-0.5">
                  {item.valueText}
                </div>

                <p className="text-[11px] text-slate-400 pl-6 leading-snug">{item.detail}</p>
                {item.category === 'clipping' && clippingDetails && (
                  <p className="text-[10px] font-mono text-slate-500 pl-6">
                    サンプルピーク: {formatDb(clippingDetails.peakDbFS)} / 上限飽和サンプル:{' '}
                    {clippingDetails.clippedSampleCount} 件
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Actionable Tips & Practical Optimization Advice */}
        <div className="rounded-2xl bg-slate-950/70 border border-slate-800/80 p-5 space-y-3 flex flex-col justify-between">
          <div>
            <h3 className="font-bold text-sm text-white flex items-center gap-2 mb-3">
              <Zap className="w-4 h-4 text-amber-400" />
              <span>ヘッドセット改善アドバイス・推奨セッティング</span>
            </h3>

            {actionableTips.length > 0 ? (
              <div className="space-y-2.5">
                {actionableTips.map((tip, i) => (
                  <div
                    key={i}
                    className="p-3 rounded-2xl bg-cyan-950/20 border border-cyan-800/30 text-xs text-slate-200 flex items-start gap-2.5"
                  >
                    <span className="w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-300 font-bold text-[10px] flex items-center justify-center shrink-0 mt-0.5">
                      {i + 1}
                    </span>
                    <span className="leading-relaxed">{tip}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-4 rounded-2xl bg-emerald-950/20 border border-emerald-800/30 text-xs text-emerald-200">
                おめでとうございます！現在設定されているヘッドセットは、通話音量・S/N比・クリッピング耐性のすべてにおいて安定しています。
              </div>
            )}
          </div>

          <div className="mt-4 p-3 rounded-2xl bg-slate-950 border border-slate-800 text-[11px] text-slate-400 space-y-1">
            <span className="font-bold text-slate-300 block">💡 ヘッドセット測定時のチェックリスト:</span>
            <p>・マイクは口の正面ではなく、唇の斜め下2〜3cmの位置にセット（呼気によるボフ音防止）</p>
            <p>・同一話者・同一音量・同一文章で比較することで、機器本来のハードウェア性能差が正確に現れます</p>
          </div>
        </div>
      </div>
    </div>
  );
};
