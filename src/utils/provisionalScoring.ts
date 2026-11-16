/**
 * Copyright (c) 2026 八百茄子 (yaonasu)
 * SPDX-License-Identifier: MIT
 */

import {
  HeadsetEvaluation,
  ProvisionalGradeLetter,
  ProvisionalScoreItem,
  ProvisionalScoreNotices,
  ProvisionalScoreResult,
} from '../types/audio';
import { normalizeEvaluationCompatibility } from './audioDsp';

export const PROVISIONAL_SCORE_VERSION = 'phase2c-provisional-v2';

export const PROVISIONAL_SCORE_NOTICES: ProvisionalScoreNotices = {
  provisionalScoreTitle: '暫定スコアについて',
  provisionalScoreNotice:
    'このスコアは録音音声の客観的な測定値に基づく参考評価です。人間が感じる聞き取りやすさや音質を正確に数値化したものではありません。採点基準は限られた話者・機器・環境での検証に基づく暫定版（v2）であり、今後変更される可能性があります。',
  webMeetingDspTitle: 'Web会議での音声について',
  webMeetingDspNotice:
    'Teams、Zoom、Google Meetなどでは、ノイズ抑制、エコーキャンセル、音量自動調整、音声コーデックなどの処理によって、相手に届く音声が変化する場合があります。本ツールの測定結果は、各Web会議サービスでの実際の音声品質を保証するものではありません。',
  browserDspSettingNote:
    'また、ブラウザの echoCancellation、noiseSuppression、autoGainControl を false 指定していても、マイクやOS・ドライバ内部のDSP処理まで無効化できるとは限りません。',
};

export interface PiecewiseKnot {
  x: number;
  y: number;
}

/**
 * Centralized thresholds and weights for Phase 2C-v2 provisional scoring.
 * All tuning parameters are kept here so future calibration remains isolated and auditable.
 */
export const PROVISIONAL_SCORE_CONFIG = {
  version: PROVISIONAL_SCORE_VERSION,
  weights: {
    inputVolume: 20,
    noisePerformance: 35,
    frequencyCharacteristics: 25,
    speechStability: 20,
  },
  minAvailableMaxScoreForTotal: 55, // Requires both core items (inputVolume 20 + noisePerformance 35)
  gradeThresholds: [
    { minScore: 90, grade: 'S' as ProvisionalGradeLetter },
    { minScore: 80, grade: 'A' as ProvisionalGradeLetter },
    { minScore: 65, grade: 'B' as ProvisionalGradeLetter },
    { minScore: 50, grade: 'C' as ProvisionalGradeLetter },
    { minScore: 0, grade: 'D' as ProvisionalGradeLetter },
  ],
  inputVolume: {
    // Maintained from v1: Piecewise-linear curve on speechStats.avgDb (dBFS); peaks in [-24, -14] dBFS
    levelKnots: [
      { x: -55, y: 0 },
      { x: -42, y: 5 },
      { x: -30, y: 14 },
      { x: -24, y: 20 },
      { x: -14, y: 20 },
      { x: -9, y: 12 },
      { x: -3, y: 4 },
      { x: 0, y: 0 },
    ] as PiecewiseKnot[],
    clippingSignBaseDeduction: 8,
    clippingRatioDeductionFactor: 4,
    clippingRatioDeductionMax: 6,
    mildClippedSampleDeduction: 2,
    highPeakThresholdDbFS: -0.3,
    highPeakDeduction: 1,
    quietNoteThresholdDbFS: -28,
    loudNoteThresholdDbFS: -12,
    cleanSnrNormalizationThresholdDb: 20,
  },
  noisePerformance: {
    // Dual-axis split within 35 pts to reflect both 300-4200Hz voice-band SNR and <300Hz broadband load without double-counting
    subWeights: {
      speechBandSnr: 26,
      broadbandSnr: 9,
    },
    speechBandSnrKnots: [
      { x: 0, y: 0 },
      { x: 6, y: 4 },
      { x: 12, y: 9 },
      { x: 18, y: 16 },
      { x: 25, y: 22 },
      { x: 32, y: 26 },
    ] as PiecewiseKnot[],
    broadbandSnrKnots: [
      { x: 0, y: 0 },
      { x: 5, y: 2 },
      { x: 10, y: 4.5 },
      { x: 16, y: 7 },
      { x: 24, y: 9 },
    ] as PiecewiseKnot[],
    // Legacy fallback when 300-4200Hz speechBandSnr is unavailable
    fallbackBroadbandSnrKnots: [
      { x: 0, y: 0 },
      { x: 6, y: 5 },
      { x: 12, y: 12 },
      { x: 18, y: 21 },
      { x: 25, y: 29 },
      { x: 32, y: 35 },
    ] as PiecewiseKnot[],
    // Guard strictly against elevated steady ambient floor (> -42 dBFS) without penalizing quiet environments
    ambientFloorPenaltyStartDbFS: -42,
    ambientFloorPenaltyMaxDbFS: -25,
    ambientFloorPenaltyMaxPts: 5,
    // Noise-gate suspicion thresholds (notice-only, NO score deduction or cap applied)
    gateCautionMinSpeechBandSnrDb: 28,
    gateCautionMaxNoiseDbFS: -55,
    gateCautionMinIqrDb: 14,
    gateCautionMinRangeDb: 35,
    gateCautionMinAvgToMinDropDb: 25,
  },
  frequencyCharacteristics: {
    // Sub-weights summing to 25 (all marked 'provisional') using existing band PSD ratios
    subWeights: {
      lowToCore: 7,
      clarityToCore: 10,
      highToClarity: 8,
    },
    // 120-300Hz vs 300-1000Hz PSD ratio (dB): neutral plateau [-10, +6] dB
    lowToCoreKnots: [
      { x: -24, y: 1.5 },
      { x: -16, y: 4.5 },
      { x: -10, y: 7 },
      { x: 6, y: 7 },
      { x: 12, y: 4.5 },
      { x: 20, y: 1.5 },
    ] as PiecewiseKnot[],
    // 1500-4200Hz vs 300-1000Hz PSD ratio (dB): neutral speech tilt plateau [-22, +2] dB
    clarityToCoreKnots: [
      { x: -38, y: 1 },
      { x: -30, y: 4 },
      { x: -22, y: 10 },
      { x: 2, y: 10 },
      { x: 8, y: 5 },
      { x: 15, y: 1 },
    ] as PiecewiseKnot[],
    // 4200-8000Hz vs 1500-4200Hz PSD ratio (dB): natural wideband rolloff [-14, -3] dB; steep drop (< -16 dB) indicates bandwidth cutoff
    highToClarityKnots: [
      { x: -26, y: 1 },
      { x: -19, y: 3 },
      { x: -14, y: 8 },
      { x: -3, y: 8 },
      { x: 1, y: 5.5 },
      { x: 6, y: 3 },
    ] as PiecewiseKnot[],
    // Low-SNR noise-contamination confidence guard for upper bands (1500-8000 Hz)
    lowSnrContaminationThresholdDb: 20,
    lowSnrMinTrustFactor: 0.75,
    lowSnrBroadbandThresholdDb: 10,
  },
  speechStability: {
    subWeights: {
      iqrStability: 12,
      measurementStability: 8,
    },
    // Conservative slope above 14 dB so large IQR alone does not heavily penalize natural inflection
    iqrKnots: [
      { x: 0.3, y: 5 },
      { x: 1.5, y: 9 },
      { x: 3.0, y: 12 },
      { x: 14.0, y: 12 },
      { x: 18.0, y: 10 },
      { x: 24.0, y: 7 },
      { x: 30.0, y: 4 },
    ] as PiecewiseKnot[],
    minReliableWindowCount: 20,
    lowWindowCountDeduction: 2,
    extremeRangeThresholdDb: 35,
    extremeRangeDeductionMax: 2,
    extremeDropCautionThresholdDb: 25,
    extremeDropAdjustmentDeduction: 1,
    noiseShiftDeduction: 2,
  },
} as const;

export const PROVISIONAL_REFERENCE_ONLY_INDICATORS: string[] = [
  '20–8000 Hz / 300–8000 Hz 95%ロールオフ周波数（300–1000Hz帯の母音エネルギー傾斜に支配され広帯域/狭帯域の弁別力が低いため、v2では配点対象外・参考表示のみ）',
  '300–4200 Hz スペクトル平坦度 (SFM)（有声音/無声音比率や暗騒音の影響が大きく単独の品質スコアには未使用・参考表示）',
  '発声内音量最小〜最大幅 (rangeDb)（突発的な子音・語尾減衰を含むため単独の良否判定には使用せず、極端な変動時の注意補助のみに使用）',
  '5段階聴感評価（主観メモであり客観自動スコア算出には使用しない）',
];

function isFiniteNumber(val: unknown): val is number {
  return typeof val === 'number' && Number.isFinite(val);
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function interpolatePiecewise(x: number, knots: readonly PiecewiseKnot[]): number {
  if (knots.length === 0) return 0;
  if (x <= knots[0].x) return knots[0].y;
  const last = knots[knots.length - 1];
  if (x >= last.x) return last.y;

  for (let i = 0; i < knots.length - 1; i++) {
    const a = knots[i];
    const b = knots[i + 1];
    if (x >= a.x && x <= b.x) {
      const span = b.x - a.x;
      if (span <= 0) return b.y;
      const t = (x - a.x) / span;
      return a.y + t * (b.y - a.y);
    }
  }
  return last.y;
}

function resolveProvisionalGrade(totalScore: number | null): {
  grade: ProvisionalGradeLetter | null;
  label: string;
} {
  if (!isFiniteNumber(totalScore)) {
    return { grade: null, label: '算出不能' };
  }
  for (const row of PROVISIONAL_SCORE_CONFIG.gradeThresholds) {
    if (totalScore >= row.minScore) {
      return { grade: row.grade, label: `暫定 ${row.grade}` };
    }
  }
  return { grade: 'D', label: '暫定 D' };
}

function scoreInputVolume(evalData: HeadsetEvaluation): ProvisionalScoreItem {
  const maxScore = PROVISIONAL_SCORE_CONFIG.weights.inputVolume;
  const cfg = PROVISIONAL_SCORE_CONFIG.inputVolume;
  const speechAvgDb = evalData.speechStats?.avgDb;
  const speechDur = evalData.speechStats?.durationSec;
  const clip = evalData.clippingDetails;
  const speechBandSnr = evalData.extendedMetrics?.speechBandSnr;

  const hasValidLevel =
    evalData.isMeasurable !== false &&
    isFiniteNumber(speechDur) &&
    speechDur > 0 &&
    isFiniteNumber(speechAvgDb);

  if (!hasValidLevel) {
    return {
      key: 'inputVolume',
      label: '入力音量',
      score: null,
      maxScore,
      status: 'unavailable',
      usedMetrics: ['speechStats.avgDb', 'clippingDetails.hasClippingSign'],
      metricValues: {
        speechAvgDbFS: isFiniteNumber(speechAvgDb) ? speechAvgDb : null,
        hasClippingSign: clip?.hasClippingSign ?? null,
      },
      referenceOnlyMetrics: ['speechStats.appropriateRatioPercent'],
      rationale:
        '有効な発声区間が検出されていないか、発声音量値が不正のため入力音量を採点できません。',
      notes: [
        'マイクミュートや発声時間不足により測定不能となった可能性があります。',
      ],
    };
  }

  const boundedDb = clamp(speechAvgDb, -90, 0);
  const baseScore = interpolatePiecewise(boundedDb, cfg.levelKnots);

  let clipDeduction = 0;
  const notes: string[] = [];
  const hasClippingSign = Boolean(clip?.hasClippingSign ?? evalData.clippingDetected);
  const clippedSamples = isFiniteNumber(clip?.clippedSampleCount) ? clip!.clippedSampleCount : 0;
  const clippingRatioPct = isFiniteNumber(clip?.clippingRatioPercent)
    ? clamp(clip!.clippingRatioPercent, 0, 100)
    : 0;
  const peakDbFS = isFiniteNumber(clip?.peakDbFS) ? clip!.peakDbFS : null;

  if (hasClippingSign) {
    clipDeduction =
      cfg.clippingSignBaseDeduction +
      Math.min(cfg.clippingRatioDeductionMax, clippingRatioPct * cfg.clippingRatioDeductionFactor);
    notes.push(
      `デジタルクリッピング兆候を検出しました（飽和サンプル ${clippedSamples} 件 / ${clippingRatioPct.toFixed(2)}%）。マイクゲインを下げてください。`
    );
  } else if (clippedSamples > 0) {
    clipDeduction = cfg.mildClippedSampleDeduction;
    notes.push(
      `単発の0 dBFS到達サンプル（${clippedSamples} 件）が観測されました。ピーク余裕を少し確保することを推奨します。`
    );
  } else if (peakDbFS !== null && peakDbFS >= cfg.highPeakThresholdDbFS) {
    clipDeduction = cfg.highPeakDeduction;
    notes.push(
      `サンプルピーク（${peakDbFS.toFixed(1)} dBFS）が上限付近です。強い発声で音割れしないようご注意ください。`
    );
  }

  const hasCleanSnrForGainUp =
    !hasClippingSign &&
    clippedSamples === 0 &&
    Boolean(speechBandSnr?.isMeasurable) &&
    isFiniteNumber(speechBandSnr?.snrDb) &&
    (speechBandSnr!.snrDb as number) >= cfg.cleanSnrNormalizationThresholdDb;

  if (boundedDb < cfg.quietNoteThresholdDbFS) {
    if (hasCleanSnrForGainUp) {
      notes.push(
        `入力音量が小さめ（${boundedDb.toFixed(1)} dBFS）のため減点していますが、音声帯域内S/N比（${(speechBandSnr!.snrDb as number).toFixed(1)} dB）は確保されており、ゲイン引き上げや音量正規化後は違和感なく聞き取れる可能性が高い状態です。音量不足と音質・明瞭性の不良は別要因として分離しています。`
      );
    } else {
      notes.push(
        `入力音量が小さめ（${boundedDb.toFixed(1)} dBFS）のため減点しています。なお、音量不足と音質・明瞭性の不良は別要因であり、ゲイン引き上げや音量正規化で聞き取りやすくなる場合があります。`
      );
    }
  } else if (boundedDb < -24) {
    notes.push(
      `発声実効音量は推奨目安（-24〜-14 dBFS）よりやや小さめ（${boundedDb.toFixed(1)} dBFS）のため、わずかに減点しています。`
    );
  } else if (boundedDb > cfg.loudNoteThresholdDbFS) {
    notes.push(
      `入力レベルが高め（${boundedDb.toFixed(1)} dBFS）でピーク余裕が小さいため減点しています。`
    );
  } else if (boundedDb > -14) {
    notes.push(
      `発声実効音量は推奨目安（-24〜-14 dBFS）よりやや高め（${boundedDb.toFixed(1)} dBFS）のため、わずかに減点しています。`
    );
  } else if (notes.length === 0) {
    notes.push('発声実効音量は Web 会議向けの目安範囲（-24〜-14 dBFS）に収まっています。');
  }

  const finalScore = clamp(Math.round(baseScore - clipDeduction), 0, maxScore);

  return {
    key: 'inputVolume',
    label: '入力音量',
    score: finalScore,
    maxScore,
    status: 'scored',
    usedMetrics: [
      'speechStats.avgDb',
      'clippingDetails.hasClippingSign',
      'clippingDetails.clippingRatioPercent',
      'clippingDetails.peakDbFS',
    ],
    metricValues: {
      speechAvgDbFS: Number(boundedDb.toFixed(1)),
      hasClippingSign,
      clippedSampleCount: clippedSamples,
      peakDbFS,
    },
    referenceOnlyMetrics: ['speechStats.appropriateRatioPercent'],
    rationale: `発声実効音量 ${boundedDb.toFixed(1)} dBFS（基礎点 ${baseScore.toFixed(1)}/${maxScore}）からクリッピング減点 ${clipDeduction.toFixed(1)} 点を差し引き、${finalScore}/${maxScore} 点と算出しました。`,
    notes,
  };
}

function scoreNoisePerformance(evalData: HeadsetEvaluation): ProvisionalScoreItem {
  const maxScore = PROVISIONAL_SCORE_CONFIG.weights.noisePerformance;
  const cfg = PROVISIONAL_SCORE_CONFIG.noisePerformance;

  const speechBandSnr = evalData.extendedMetrics?.speechBandSnr;
  const broadbandSnr = evalData.estimatedSnr;

  const canUseSpeechBandSnr =
    Boolean(speechBandSnr?.isMeasurable) && isFiniteNumber(speechBandSnr?.snrDb);
  const canUseBroadbandSnr =
    Boolean(broadbandSnr?.isMeasurable) && isFiniteNumber(broadbandSnr?.snrDb);

  if (evalData.isMeasurable === false || (!canUseSpeechBandSnr && !canUseBroadbandSnr)) {
    const reason =
      speechBandSnr?.unmeasurableReason ||
      broadbandSnr?.unmeasurableReason ||
      evalData.unmeasurableReason ||
      '推定S/N比を算出できないため採点不能です。';
    return {
      key: 'noisePerformance',
      label: 'ノイズ性能',
      score: null,
      maxScore,
      status: 'unavailable',
      usedMetrics: ['extendedMetrics.speechBandSnr.snrDb', 'estimatedSnr.snrDb'],
      metricValues: {
        speechBandSnrDb: isFiniteNumber(speechBandSnr?.snrDb) ? speechBandSnr!.snrDb : null,
        broadbandSnrDb: isFiniteNumber(broadbandSnr?.snrDb) ? broadbandSnr!.snrDb! : null,
      },
      referenceOnlyMetrics: [],
      rationale: `S/N比が測定不能のため採点できません（${reason}）。架空の点数補完は行いません。`,
      notes: [
        '発話と暗騒音の分離ができない状態ではノイズ性能を評価できません。',
        'マイクやOS・ドライバ内蔵のノイズ抑制DSPが暗騒音区間に影響する場合もあります。',
      ],
    };
  }

  let baseScore = 0;
  const usedMetrics: string[] = [];
  let snrMode: 'combined_speech_and_broadband' | 'speech_band_only' | 'broadband_fallback';
  let boundedSpeechBandSnr: number | null = null;
  let boundedBroadbandSnr: number | null = null;
  let subSpeechBandPts: number | null = null;
  let subBroadbandPts: number | null = null;

  if (canUseSpeechBandSnr && canUseBroadbandSnr) {
    snrMode = 'combined_speech_and_broadband';
    boundedSpeechBandSnr = clamp(speechBandSnr!.snrDb as number, -20, 80);
    boundedBroadbandSnr = clamp(broadbandSnr!.snrDb as number, -20, 80);
    subSpeechBandPts = interpolatePiecewise(boundedSpeechBandSnr, cfg.speechBandSnrKnots);
    subBroadbandPts = interpolatePiecewise(boundedBroadbandSnr, cfg.broadbandSnrKnots);
    // Split budget (26 + 9 = 35) avoids double-scoring overlapping voice-band SNR
    baseScore = subSpeechBandPts + subBroadbandPts;
    usedMetrics.push('extendedMetrics.speechBandSnr.snrDb', 'estimatedSnr.snrDb');
  } else if (canUseSpeechBandSnr) {
    snrMode = 'speech_band_only';
    boundedSpeechBandSnr = clamp(speechBandSnr!.snrDb as number, -20, 80);
    subSpeechBandPts = interpolatePiecewise(boundedSpeechBandSnr, cfg.speechBandSnrKnots);
    baseScore = (subSpeechBandPts / cfg.subWeights.speechBandSnr) * maxScore;
    usedMetrics.push('extendedMetrics.speechBandSnr.snrDb');
  } else {
    snrMode = 'broadband_fallback';
    boundedBroadbandSnr = clamp(broadbandSnr!.snrDb as number, -20, 80);
    baseScore = interpolatePiecewise(boundedBroadbandSnr, cfg.fallbackBroadbandSnrKnots);
    usedMetrics.push('estimatedSnr.snrDb');
  }

  // Elevated steady ambient floor guard (> -42 dBFS only, avoiding double-penalty in quiet rooms)
  const rawNoiseDb =
    evalData.noiseAnalysis?.representativeNoiseDbFS ?? evalData.noiseStats?.avgDb;
  const validNoiseDb = isFiniteNumber(rawNoiseDb) ? clamp(rawNoiseDb, -120, 0) : null;
  let floorPenalty = 0;
  if (validNoiseDb !== null && validNoiseDb > cfg.ambientFloorPenaltyStartDbFS) {
    const ratio = clamp(
      (validNoiseDb - cfg.ambientFloorPenaltyStartDbFS) /
        (cfg.ambientFloorPenaltyMaxDbFS - cfg.ambientFloorPenaltyStartDbFS),
      0,
      1
    );
    floorPenalty = ratio * cfg.ambientFloorPenaltyMaxPts;
    usedMetrics.push('noiseAnalysis.representativeNoiseDbFS');
  }

  // Noise-gate / aggressive NS suspicion check (caution notice ONLY, no deduction or cap)
  const lvlVar = evalData.extendedMetrics?.speechLevelVariability;
  const iqrDb = lvlVar?.isMeasurable && isFiniteNumber(lvlVar?.iqrDb) ? lvlVar!.iqrDb : null;
  const rangeDb = lvlVar?.isMeasurable && isFiniteNumber(lvlVar?.rangeDb) ? lvlVar!.rangeDb : null;
  const speechAvgDb = isFiniteNumber(evalData.speechStats?.avgDb) ? evalData.speechStats.avgDb : null;
  const minWindowDb = lvlVar?.isMeasurable && isFiniteNumber(lvlVar?.minDbFS) ? lvlVar!.minDbFS : null;
  const avgToMinDropDb =
    speechAvgDb !== null && minWindowDb !== null ? speechAvgDb - minWindowDb : null;

  const hasLargeIntraSpeechSwing =
    (iqrDb !== null && iqrDb >= cfg.gateCautionMinIqrDb) ||
    (rangeDb !== null && rangeDb >= cfg.gateCautionMinRangeDb) ||
    (avgToMinDropDb !== null && avgToMinDropDb >= cfg.gateCautionMinAvgToMinDropDb);

  const noiseGateSuspected =
    boundedSpeechBandSnr !== null &&
    boundedSpeechBandSnr >= cfg.gateCautionMinSpeechBandSnrDb &&
    validNoiseDb !== null &&
    validNoiseDb <= cfg.gateCautionMaxNoiseDbFS &&
    hasLargeIntraSpeechSwing;

  const finalScore = clamp(Math.round(baseScore - floorPenalty), 0, maxScore);
  const notes: string[] = [
    'マイク本体・OS・ドライバ内蔵のノイズ抑制DSPにより無音区間の暗騒音が低減され、見かけのS/N比が高く算出される場合があります。',
  ];

  if (noiseGateSuspected && validNoiseDb !== null && boundedSpeechBandSnr !== null) {
    notes.push(
      `注意（ノイズゲート／抑制DSP疑い）: 極めて低い暗騒音（${validNoiseDb.toFixed(1)} dBFS）および高S/N比（${boundedSpeechBandSnr.toFixed(1)} dB）と、発声区間内の大きな音量落差が同時に観測されました。内蔵ノイズゲート等の影響で見かけのS/N比が高く出ている可能性があります（断定不可のため、この条件のみによる減点・上限キャップは行っていません）。`
    );
  }

  if (snrMode === 'speech_band_only') {
    notes.push(
      '全帯域推定S/N比が利用不可のため、300–4200Hz音声帯域内S/N比を35点満点基準に換算して採点しました。'
    );
  } else if (snrMode === 'broadband_fallback') {
    notes.push(
      '300–4200Hz帯域内S/N比が未解析または利用不可のため、全帯域推定S/N比で代替採点しました（重複加点は行っていません）。'
    );
  }

  if (canUseSpeechBandSnr && speechBandSnr?.status === 'reference_nyquist') {
    notes.push(
      `サンプルレート制約により音声帯域内S/N比の上限は ${speechBandSnr.frequencyRange.effectiveHighHz} Hz までの参考計測です。`
    );
  }

  if (floorPenalty > 0 && validNoiseDb !== null) {
    notes.push(
      `定常暗騒音（${validNoiseDb.toFixed(1)} dBFS）が高騒音警戒ライン（-42 dBFS超）を上回るため、${floorPenalty.toFixed(1)} 点を控えめに調整しています。`
    );
  }

  if (evalData.noiseAnalysis?.hasNoiseLevelShiftWarning) {
    notes.push(
      `録音前後で暗騒音が ${evalData.noiseAnalysis.noiseDifferenceDb.toFixed(1)} dB 変動しているため、推定S/N比の信頼性が低下している可能性があります。`
    );
  }

  let rationale = '';
  if (snrMode === 'combined_speech_and_broadband') {
    rationale = `音声帯域内S/N比(300–4200Hz) ${boundedSpeechBandSnr!.toFixed(1)} dB（${subSpeechBandPts!.toFixed(1)}/${cfg.subWeights.speechBandSnr}）＋全帯域S/N比 ${boundedBroadbandSnr!.toFixed(1)} dB（${subBroadbandPts!.toFixed(1)}/${cfg.subWeights.broadbandSnr}、低域成分反映・重複配点なし）と定常暗騒音補正（-${floorPenalty.toFixed(1)} 点）により ${finalScore}/${maxScore} 点と算出しました。`;
  } else if (snrMode === 'speech_band_only') {
    rationale = `音声帯域内S/N比(300–4200Hz) ${boundedSpeechBandSnr!.toFixed(1)} dB（35点換算 ${baseScore.toFixed(1)}）と定常暗騒音補正（-${floorPenalty.toFixed(1)} 点）により ${finalScore}/${maxScore} 点と算出しました。`;
  } else {
    rationale = `全帯域推定S/N比 ${boundedBroadbandSnr!.toFixed(1)} dB（基礎点 ${baseScore.toFixed(1)}/${maxScore}）と定常暗騒音補正（-${floorPenalty.toFixed(1)} 点）により ${finalScore}/${maxScore} 点と算出しました。`;
  }

  return {
    key: 'noisePerformance',
    label: 'ノイズ性能',
    score: finalScore,
    maxScore,
    status: 'scored',
    usedMetrics: Array.from(new Set(usedMetrics)),
    metricValues: {
      snrSource: snrMode,
      speechBandSnrDb: boundedSpeechBandSnr !== null ? Number(boundedSpeechBandSnr.toFixed(1)) : null,
      broadbandSnrDb: boundedBroadbandSnr !== null ? Number(boundedBroadbandSnr.toFixed(1)) : null,
      representativeNoiseDbFS: validNoiseDb !== null ? Number(validNoiseDb.toFixed(1)) : null,
      noiseGateSuspected,
      noiseShiftWarning: Boolean(evalData.noiseAnalysis?.hasNoiseLevelShiftWarning),
    },
    referenceOnlyMetrics: [],
    rationale,
    notes,
  };
}

function scoreFrequencyCharacteristics(evalData: HeadsetEvaluation): ProvisionalScoreItem {
  const maxScore = PROVISIONAL_SCORE_CONFIG.weights.frequencyCharacteristics;
  const cfg = PROVISIONAL_SCORE_CONFIG.frequencyCharacteristics;
  const ext = evalData.extendedMetrics;

  if (evalData.isMeasurable === false || !ext) {
    return {
      key: 'frequencyCharacteristics',
      label: '周波数特性',
      score: null,
      maxScore,
      status: 'unavailable',
      usedMetrics: [],
      metricValues: {},
      referenceOnlyMetrics: [
        'highFreqRolloff.rolloff95SpeechBandHz',
        'highFreqRolloff.rolloff95Hz',
        'spectralFlatness.median',
      ],
      rationale: !ext
        ? '拡張周波数指標（帯域PSD比3種）が未解析のため、根拠不足として採点対象外にしました。'
        : '録音要件未達のため周波数特性を採点できません。',
      notes: [
        '旧形式の単一帯域比のみでは周波数傾向を適切に点数化できないため、欠損時は満点補完せず採点不能としています。',
      ],
    };
  }

  const cmp = ext.bandEnergyComparison;
  const lowToCore =
    cmp?.isMeasurable && cmp.bands?.low_120_300?.isMeasurable && cmp.bands?.core_300_1000?.isMeasurable
      ? cmp.ratios.lowToCoreDb
      : null;
  const clarityToCore =
    cmp?.isMeasurable && cmp.bands?.clarity_1500_4200?.isMeasurable && cmp.bands?.core_300_1000?.isMeasurable
      ? cmp.ratios.clarityToCoreDb
      : null;
  const highToClarity =
    cmp?.isMeasurable && cmp.bands?.high_4200_8000?.isMeasurable && cmp.bands?.clarity_1500_4200?.isMeasurable
      ? cmp.ratios.highToClarityDb
      : null;

  const hasLowToCore = isFiniteNumber(lowToCore);
  const hasClarityToCore = isFiniteNumber(clarityToCore);
  const hasHighToClarity = isFiniteNumber(highToClarity);

  if (!hasLowToCore && !hasClarityToCore && !hasHighToClarity) {
    return {
      key: 'frequencyCharacteristics',
      label: '周波数特性',
      score: null,
      maxScore,
      status: 'unavailable',
      usedMetrics: [],
      metricValues: {},
      referenceOnlyMetrics: [
        'highFreqRolloff.rolloff95SpeechBandHz',
        'highFreqRolloff.rolloff95Hz',
        'spectralFlatness.median',
      ],
      rationale: '有効な帯域PSD比（低域/芯・明瞭域/芯・高域/明瞭域）が取得できなかったため採点不能です。',
      notes: ['無音または帯域エネルギー不足によりスペクトル特徴量を算出できませんでした。'],
    };
  }

  const sbSnr =
    ext.speechBandSnr?.isMeasurable && isFiniteNumber(ext.speechBandSnr?.snrDb)
      ? (ext.speechBandSnr.snrDb as number)
      : null;
  const bbSnr =
    evalData.estimatedSnr?.isMeasurable && isFiniteNumber(evalData.estimatedSnr?.snrDb)
      ? (evalData.estimatedSnr.snrDb as number)
      : null;
  const repNoise =
    evalData.noiseAnalysis?.representativeNoiseDbFS ?? evalData.noiseStats?.avgDb;
  const validRepNoise = isFiniteNumber(repNoise) ? repNoise : null;

  const highBandNoiseContaminationWarning =
    (sbSnr !== null && sbSnr < cfg.lowSnrContaminationThresholdDb) ||
    (bbSnr !== null &&
      bbSnr < cfg.lowSnrBroadbandThresholdDb &&
      validRepNoise !== null &&
      validRepNoise > -45);

  const snrTrust =
    sbSnr !== null && sbSnr < cfg.lowSnrContaminationThresholdDb
      ? clamp(
          cfg.lowSnrMinTrustFactor +
            (1 - cfg.lowSnrMinTrustFactor) *
              ((sbSnr - 8) / (cfg.lowSnrContaminationThresholdDb - 8)),
          cfg.lowSnrMinTrustFactor,
          1.0
        )
      : 1.0;

  let rawSubScore = 0;
  let availableSubMax = 0;
  const usedMetrics: string[] = [];
  const partsDesc: string[] = [];

  if (hasLowToCore) {
    const subA = interpolatePiecewise(lowToCore, cfg.lowToCoreKnots);
    rawSubScore += subA;
    availableSubMax += cfg.subWeights.lowToCore;
    usedMetrics.push('bandEnergyComparison.ratios.lowToCoreDb');
    partsDesc.push(
      `低域/声の芯 ${lowToCore > 0 ? '+' : ''}${lowToCore.toFixed(1)}dB (${subA.toFixed(1)}/${cfg.subWeights.lowToCore})`
    );
  }

  if (hasClarityToCore) {
    const rawB = interpolatePiecewise(clarityToCore, cfg.clarityToCoreKnots);
    const subB = rawB * snrTrust;
    rawSubScore += subB;
    availableSubMax += cfg.subWeights.clarityToCore;
    usedMetrics.push('bandEnergyComparison.ratios.clarityToCoreDb');
    partsDesc.push(
      `明瞭域/声の芯 ${clarityToCore > 0 ? '+' : ''}${clarityToCore.toFixed(1)}dB (${subB.toFixed(1)}/${cfg.subWeights.clarityToCore})`
    );
  }

  if (hasHighToClarity) {
    const rawC = interpolatePiecewise(highToClarity, cfg.highToClarityKnots);
    const subC = rawC * snrTrust;
    rawSubScore += subC;
    availableSubMax += cfg.subWeights.highToClarity;
    usedMetrics.push('bandEnergyComparison.ratios.highToClarityDb');
    partsDesc.push(
      `高域/明瞭域 ${highToClarity > 0 ? '+' : ''}${highToClarity.toFixed(1)}dB (${subC.toFixed(1)}/${cfg.subWeights.highToClarity})`
    );
  }

  const finalScore =
    availableSubMax > 0
      ? clamp(Math.round((rawSubScore / availableSubMax) * maxScore), 0, maxScore)
      : null;

  const notes: string[] = [
    '周波数特性は話者の声質（基本周波数）、発話内容（母音/子音比）、マイク距離の影響を受けるため暫定基準で採点しています。この値だけで「明瞭」「こもっている」と断定することはできません。',
    'v2では、母音帯域の影響が強く広帯域/狭帯域を弁別しにくい95%ロールオフ周波数を採点対象から外し、4200–8000Hz / 1500–4200Hz PSD比を含む3帯域バランスで評価しています。',
  ];

  if (highBandNoiseContaminationWarning) {
    notes.push(
      `注意（評価の信頼性低下）: S/N比が低め（帯域内 ${sbSnr !== null ? sbSnr.toFixed(1) : '不明'} dB / 全帯域 ${bbSnr !== null ? bbSnr.toFixed(1) : '不明'} dB）のため、1500–8000Hz帯のPSD比に暗騒音（ファン音・ホワイトノイズ等）が混入している可能性が高く、周波数特性評価の信頼性が低下しています（信頼係数 ×${snrTrust.toFixed(2)} を適用）。`
    );
  }

  if (availableSubMax < maxScore) {
    notes.push(
      `サンプルレート制約等により一部の周波数小項目が利用不可のため、取得できた小項目（${availableSubMax}点分）の比率を ${maxScore} 点満点へ換算しています。`
    );
  }

  const trustSuffix = snrTrust < 1.0 ? `（低S/N信頼係数 ×${snrTrust.toFixed(2)} 反映）` : '';

  return {
    key: 'frequencyCharacteristics',
    label: '周波数特性',
    score: finalScore,
    maxScore,
    status: finalScore === null ? 'unavailable' : 'provisional',
    usedMetrics,
    metricValues: {
      lowToCoreDb: hasLowToCore ? Number(lowToCore.toFixed(1)) : null,
      clarityToCoreDb: hasClarityToCore ? Number(clarityToCore.toFixed(1)) : null,
      highToClarityDb: hasHighToClarity ? Number(highToClarity.toFixed(1)) : null,
      snrTrustFactor: Number(snrTrust.toFixed(2)),
      highBandNoiseContaminationWarning,
      rolloff95SpeechBandHz_referenceOnly: isFiniteNumber(ext.highFreqRolloff?.rolloff95SpeechBandHz)
        ? Number(ext.highFreqRolloff.rolloff95SpeechBandHz!.toFixed(1))
        : null,
    },
    referenceOnlyMetrics: [
      'highFreqRolloff.rolloff95SpeechBandHz',
      'highFreqRolloff.rolloff95Hz',
      'spectralFlatness.median',
    ],
    rationale: `${partsDesc.join('、')} を暫定許容幅で評価し${trustSuffix}、${finalScore}/${maxScore} 点と算出しました。`,
    notes,
  };
}

function scoreSpeechStability(evalData: HeadsetEvaluation): ProvisionalScoreItem {
  const maxScore = PROVISIONAL_SCORE_CONFIG.weights.speechStability;
  const cfg = PROVISIONAL_SCORE_CONFIG.speechStability;
  const ext = evalData.extendedMetrics;
  const lvlVar = ext?.speechLevelVariability;

  if (
    evalData.isMeasurable === false ||
    !lvlVar ||
    !lvlVar.isMeasurable ||
    !isFiniteNumber(lvlVar.iqrDb)
  ) {
    return {
      key: 'speechStability',
      label: '音声の安定性',
      score: null,
      maxScore,
      status: 'unavailable',
      usedMetrics: [],
      metricValues: {
        iqrDb: isFiniteNumber(lvlVar?.iqrDb) ? lvlVar!.iqrDb : null,
        speechWindowCount: isFiniteNumber(lvlVar?.speechWindowCount)
          ? lvlVar!.speechWindowCount
          : null,
      },
      referenceOnlyMetrics: ['speechLevelVariability.rangeDb', 'spectralFlatness.median'],
      rationale: !ext
        ? '発声内音量変動(IQR)が未解析のため、根拠なく満点を付与せず採点対象外にしました。'
        : '有効な発声ウィンドウ数が不足しているか、音量変動IQRが測定不能のため採点できません。',
      notes: [
        '採点根拠が不足する項目は欠損扱いとし、他項目の比率集計時にも恣意的な補完は行いません。',
      ],
    };
  }

  const iqrDb = clamp(lvlVar.iqrDb, 0, 60);
  const subIqr = interpolatePiecewise(iqrDb, cfg.iqrKnots);

  const windowCount = isFiniteNumber(lvlVar.speechWindowCount) ? lvlVar.speechWindowCount : 0;
  const rangeDb = isFiniteNumber(lvlVar.rangeDb) ? clamp(lvlVar.rangeDb, 0, 120) : null;
  const speechAvgDb = isFiniteNumber(evalData.speechStats?.avgDb) ? evalData.speechStats.avgDb : null;
  const minWindowDb = isFiniteNumber(lvlVar.minDbFS) ? lvlVar.minDbFS : null;
  const dropFromAvgDb =
    speechAvgDb !== null && minWindowDb !== null ? clamp(speechAvgDb - minWindowDb, 0, 120) : null;
  const hasNoiseShift = Boolean(evalData.noiseAnalysis?.hasNoiseLevelShiftWarning);

  let subStability: number = cfg.subWeights.measurementStability;
  const stabilityPenalties: string[] = [];

  if (windowCount < cfg.minReliableWindowCount) {
    subStability -= cfg.lowWindowCountDeduction;
    stabilityPenalties.push(`発声フレーム数少 (${windowCount}窓: -${cfg.lowWindowCountDeduction}点)`);
  }
  if (rangeDb !== null && rangeDb > cfg.extremeRangeThresholdDb) {
    const rangePenalty = Math.min(
      cfg.extremeRangeDeductionMax,
      ((rangeDb - cfg.extremeRangeThresholdDb) / 15) * cfg.extremeRangeDeductionMax
    );
    subStability -= rangePenalty;
    stabilityPenalties.push(`最大-最小変動幅 ${rangeDb.toFixed(1)} dB > ${cfg.extremeRangeThresholdDb} dB (-${rangePenalty.toFixed(1)}点)`);
  }
  const hasExtremeDropTogetherWithRange =
    rangeDb !== null &&
    rangeDb > cfg.extremeRangeThresholdDb &&
    dropFromAvgDb !== null &&
    dropFromAvgDb >= cfg.extremeDropCautionThresholdDb;
  if (hasExtremeDropTogetherWithRange) {
    subStability -= cfg.extremeDropAdjustmentDeduction;
    stabilityPenalties.push(
      `発声平均との最小値差 ${dropFromAvgDb!.toFixed(1)} dB ≥ ${cfg.extremeDropCautionThresholdDb} dB (-${cfg.extremeDropAdjustmentDeduction.toFixed(1)}点)`
    );
  }
  if (hasNoiseShift) {
    subStability -= cfg.noiseShiftDeduction;
    stabilityPenalties.push(`前後暗騒音変動 >= 6 dB (-${cfg.noiseShiftDeduction}点)`);
  }

  subStability = clamp(subStability, 0, cfg.subWeights.measurementStability);
  const finalScore = clamp(Math.round(subIqr + subStability), 0, maxScore);

  const extremeVariationWarning =
    iqrDb >= 14 ||
    (rangeDb !== null && rangeDb > cfg.extremeRangeThresholdDb) ||
    (dropFromAvgDb !== null && dropFromAvgDb >= cfg.extremeDropCautionThresholdDb);

  const notes: string[] = [
    '発声内音量IQRおよび変動幅は、話者の抑揚・話速・VAD区間境界・内蔵AGCやノイズゲートの影響を受けるため暫定評価です。IQRが大きいことだけで大幅減点や品質不良の断定は行いません。',
    '3〜14 dB を自然な抑揚の満点帯とし、それを超える場合も保守的な緩やか減点に留めています。',
  ];

  if (extremeVariationWarning) {
    notes.push(
      `注意（大きな音量変動）: 発声区間内で大きめの変動（IQR ${iqrDb.toFixed(1)} dB${
        rangeDb !== null ? ` / 変動幅 ${rangeDb.toFixed(1)} dB` : ''
      }${
        dropFromAvgDb !== null ? ` / 平均比最小差 -${dropFromAvgDb.toFixed(1)} dB` : ''
      }）が観測されました。自然な発話抑揚と音声欠落・ゲート動作を客観指標のみで断定できないため、注意表示とともに保守的な調整のみ行っています。`
    );
  }

  if (stabilityPenalties.length > 0) {
    notes.push(`減点根拠: ${stabilityPenalties.join('、')}。`);
  }

  return {
    key: 'speechStability',
    label: '音声の安定性',
    score: finalScore,
    maxScore,
    status: 'provisional',
    usedMetrics: [
      'speechLevelVariability.iqrDb',
      'speechLevelVariability.speechWindowCount',
      ...(rangeDb !== null ? ['speechLevelVariability.rangeDb'] : []),
      ...(dropFromAvgDb !== null ? ['speechLevelVariability.minDbFS'] : []),
      'noiseAnalysis.hasNoiseLevelShiftWarning',
    ],
    metricValues: {
      iqrDb: Number(iqrDb.toFixed(1)),
      speechWindowCount: windowCount,
      rangeDb: rangeDb !== null ? Number(rangeDb.toFixed(1)) : null,
      avgToMinDropDb: dropFromAvgDb !== null ? Number(dropFromAvgDb.toFixed(1)) : null,
      extremeVariationWarning,
      hasNoiseLevelShiftWarning: hasNoiseShift,
    },
    referenceOnlyMetrics: ['spectralFlatness.median'],
    rationale: `発声内30ms窓IQR ${iqrDb.toFixed(1)} dB（${subIqr.toFixed(1)}/${cfg.subWeights.iqrStability}）および測定安定性（${subStability.toFixed(1)}/${cfg.subWeights.measurementStability}${
      stabilityPenalties.length > 0 ? `: ${stabilityPenalties.join(', ')}` : ''
    }）から、保守的に ${finalScore}/${maxScore} 点と算出しました。`,
    notes,
  };
}

/**
 * Compute Phase 2C provisional 100-point score purely from objective DSP evaluation metrics.
 * Deterministic, side-effect-free, and strictly independent of subjective listening ratings.
 */
export function computeProvisionalScore(
  evaluation: HeadsetEvaluation | null | undefined
): ProvisionalScoreResult {
  if (!evaluation || typeof evaluation !== 'object') {
    const emptyItem = (
      key: ProvisionalScoreItem['key'],
      label: string,
      maxScore: number
    ): ProvisionalScoreItem => ({
      key,
      label,
      score: null,
      maxScore,
      status: 'unavailable',
      usedMetrics: [],
      metricValues: {},
      referenceOnlyMetrics: [],
      rationale: '評価データが入力されていないため採点できません。',
      notes: [],
    });
    const inputVolume = emptyItem('inputVolume', '入力音量', PROVISIONAL_SCORE_CONFIG.weights.inputVolume);
    const noisePerformance = emptyItem(
      'noisePerformance',
      'ノイズ性能',
      PROVISIONAL_SCORE_CONFIG.weights.noisePerformance
    );
    const frequencyCharacteristics = emptyItem(
      'frequencyCharacteristics',
      '周波数特性',
      PROVISIONAL_SCORE_CONFIG.weights.frequencyCharacteristics
    );
    const speechStability = emptyItem(
      'speechStability',
      '音声の安定性',
      PROVISIONAL_SCORE_CONFIG.weights.speechStability
    );
    return {
      scoringVersion: PROVISIONAL_SCORE_VERSION,
      isProvisional: true,
      status: 'unavailable',
      totalScore: null,
      maxTotalScore: 100,
      provisionalGrade: null,
      provisionalGradeLabel: '算出不能',
      rawScoreSum: null,
      availableMaxScoreSum: 0,
      isRescaled: false,
      rescalingNote: null,
      summary: '評価データが存在しないため、暫定スコアを算出できません。',
      unavailableItems: ['入力音量', 'ノイズ性能', '周波数特性', '音声の安定性'],
      usedMetricNames: [],
      referenceOnlyIndicators: PROVISIONAL_REFERENCE_ONLY_INDICATORS,
      items: {
        inputVolume,
        noisePerformance,
        frequencyCharacteristics,
        speechStability,
      },
      notices: PROVISIONAL_SCORE_NOTICES,
    };
  }

  const safeEval = normalizeEvaluationCompatibility(evaluation);
  const inputVolume = scoreInputVolume(safeEval);
  const noisePerformance = scoreNoisePerformance(safeEval);
  const frequencyCharacteristics = scoreFrequencyCharacteristics(safeEval);
  const speechStability = scoreSpeechStability(safeEval);

  const allItems: ProvisionalScoreItem[] = [
    inputVolume,
    noisePerformance,
    frequencyCharacteristics,
    speechStability,
  ];

  const availableItems = allItems.filter(
    (item) => item.status !== 'unavailable' && isFiniteNumber(item.score)
  );
  const unavailableItemsList = allItems
    .filter((item) => item.status === 'unavailable' || !isFiniteNumber(item.score))
    .map((item) => `${item.label}（${item.rationale}）`);

  const availableMaxScoreSum = availableItems.reduce((acc, item) => acc + item.maxScore, 0);
  const rawScoreSum =
    availableItems.length > 0
      ? availableItems.reduce((acc, item) => acc + (item.score as number), 0)
      : null;

  const coreReady =
    safeEval.isMeasurable !== false &&
    inputVolume.status !== 'unavailable' &&
    noisePerformance.status !== 'unavailable' &&
    availableMaxScoreSum >= PROVISIONAL_SCORE_CONFIG.minAvailableMaxScoreForTotal &&
    rawScoreSum !== null;

  const usedMetricNames = Array.from(
    new Set(allItems.flatMap((item) => (item.status !== 'unavailable' ? item.usedMetrics : [])))
  );

  if (!coreReady) {
    const unavailableLabels = allItems
      .filter((item) => item.status === 'unavailable')
      .map((item) => item.label);
    return {
      scoringVersion: PROVISIONAL_SCORE_VERSION,
      isProvisional: true,
      status: 'unavailable',
      totalScore: null,
      maxTotalScore: 100,
      provisionalGrade: null,
      provisionalGradeLabel: '算出不能',
      rawScoreSum: null,
      availableMaxScoreSum,
      isRescaled: false,
      rescalingNote: null,
      summary:
        safeEval.isMeasurable === false
          ? `測定要件未達のため暫定総合スコアは算出不能です（${safeEval.unmeasurableReason || '有効発声不足'}）。`
          : `必須採点項目（${unavailableLabels.join('・')}）が測定不能または欠損しているため、暫定総合スコアは算出不能です。`,
      unavailableItems: unavailableItemsList,
      usedMetricNames,
      referenceOnlyIndicators: PROVISIONAL_REFERENCE_ONLY_INDICATORS,
      items: {
        inputVolume,
        noisePerformance,
        frequencyCharacteristics,
        speechStability,
      },
      notices: PROVISIONAL_SCORE_NOTICES,
    };
  }

  const isRescaled = availableMaxScoreSum < 100;
  const totalScore = isRescaled
    ? clamp(Math.round(((rawScoreSum as number) / availableMaxScoreSum) * 100), 0, 100)
    : clamp(Math.round(rawScoreSum as number), 0, 100);

  const missingLabels = allItems
    .filter((item) => item.status === 'unavailable')
    .map((item) => item.label);

  const rescalingNote = isRescaled
    ? `一部項目（${missingLabels.join('・')}）が未解析または測定不能のため、有効項目合計 ${rawScoreSum} / ${availableMaxScoreSum} 点を 100 点満点へ比例換算（round(${rawScoreSum} / ${availableMaxScoreSum} × 100) = ${totalScore}）しています。欠損項目への満点補完は行っていません。`
    : null;

  const gradeInfo = resolveProvisionalGrade(totalScore);
  const summary = isRescaled
    ? `有効な客観指標（配点計 ${availableMaxScoreSum} 点分）に基づく比例換算の暫定スコアです。欠損項目は参考除外されています。`
    : '全4項目（入力音量・ノイズ性能・周波数特性・音声安定性）の客観測定値に基づく暫定スコアです。';

  return {
    scoringVersion: PROVISIONAL_SCORE_VERSION,
    isProvisional: true,
    status: 'provisional',
    totalScore,
    maxTotalScore: 100,
    provisionalGrade: gradeInfo.grade,
    provisionalGradeLabel: gradeInfo.label,
    rawScoreSum,
    availableMaxScoreSum,
    isRescaled,
    rescalingNote,
    summary,
    unavailableItems: unavailableItemsList,
    usedMetricNames,
    referenceOnlyIndicators: PROVISIONAL_REFERENCE_ONLY_INDICATORS,
    items: {
      inputVolume,
      noisePerformance,
      frequencyCharacteristics,
      speechStability,
    },
    notices: PROVISIONAL_SCORE_NOTICES,
  };
}
