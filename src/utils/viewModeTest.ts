/**
 * Copyright (c) 2026 八百茄子 (yaonasu)
 * SPDX-License-Identifier: MIT
 */

/**
 * Phase 3B verification tests:
 * 1) URL query parameter parsing (default simple, ?debug=1 debug, ?debug=0, ?debug=true, ?foo=bar&debug=1)
 * 2) UI separation between general-user simple mode and ?debug=1 detail mode
 * 3) No technical jargon leaks in simple mode evaluation & comparison views
 * 4) Unmeasurable / legacy clip handling without fabricated scores
 * 5) 4-clip comparison support and identical provisional scoring across modes
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  parseDebugModeFromSearch,
  resolveDisplayModeFromSearch,
  getCurrentDisplayMode,
} from './viewMode';
import { HeadsetEvaluation, RecordedClip } from '../types/audio';
import { computeProvisionalScore } from './provisionalScoring';
import { EvaluationSummary } from '../components/EvaluationSummary';
import { RecordedClipView } from '../components/RecordedClipView';
import { ComparisonTable } from '../components/ComparisonTable';

function assertTrue(name: string, condition: boolean) {
  if (!condition) {
    throw new Error(`FAIL: ${name}`);
  }
  console.log(`✓ PASS: ${name}`);
}

function assertEqual<T>(name: string, actual: T, expected: T) {
  if (actual !== expected) {
    throw new Error(`FAIL: ${name} (expected=${String(expected)}, actual=${String(actual)})`);
  }
  console.log(`✓ PASS: ${name} = ${String(actual)}`);
}

function makeClip(
  id: string,
  name: string,
  overrides?: {
    algoVersion?: 'v1.0' | 'v2.0';
    isMeasurable?: boolean;
    speechAvgDb?: number;
    noiseDb?: number;
    speechBandSnrDb?: number | null;
    broadbandSnrDb?: number | null;
    iqrDb?: number;
    rangeDb?: number;
    noiseGate?: boolean;
    omitExtendedMetrics?: boolean;
  }
): RecordedClip {
  const o = {
    algoVersion: 'v2.0' as const,
    isMeasurable: true,
    speechAvgDb: -19.5,
    noiseDb: -52.0,
    speechBandSnrDb: 26.5 as number | null,
    broadbandSnrDb: 25.0 as number | null,
    iqrDb: 8.2,
    rangeDb: 16.0,
    noiseGate: false,
    omitExtendedMetrics: false,
    ...overrides,
  };

  if (o.noiseGate) {
    o.noiseDb = -74.0;
    o.speechBandSnrDb = 50.0;
    o.broadbandSnrDb = 48.0;
    o.iqrDb = 16.5;
  }

  const extendedMetrics: HeadsetEvaluation['extendedMetrics'] = o.omitExtendedMetrics
    ? undefined
    : {
        fftNormalization: 'parseval_one_sided_hann',
        fftSize: 2048,
        fftHopSize: 1024,
        sampleRateHz: 48000,
        nyquistHz: 24000,
        speechBandSnr: {
          isMeasurable: o.isMeasurable && o.speechBandSnrDb !== null,
          status: o.isMeasurable && o.speechBandSnrDb !== null ? 'measurable' : 'unmeasurable',
          unit: 'dB',
          frequencyRange: {
            nominalLowHz: 300,
            nominalHighHz: 4200,
            effectiveLowHz: 300,
            effectiveHighHz: 4200,
            truncatedByNyquist: false,
          },
          snrDb: o.isMeasurable ? o.speechBandSnrDb : null,
          broadbandDiffDb:
            o.isMeasurable && o.speechBandSnrDb !== null && o.broadbandSnrDb !== null
              ? Number((o.speechBandSnrDb - o.broadbandSnrDb).toFixed(1))
              : null,
          speechBandPowerDbFS: -20.0,
          noiseBandPowerDbFS: o.noiseDb - 1.0,
          noiseEstimationMethod: 'percentile_20_70_linear_power',
          unmeasurableReason: o.isMeasurable ? undefined : '発声区間不足',
        },
        highFreqRolloff: {
          isMeasurable: o.isMeasurable,
          isHighBandMeasurable: true,
          unitHz: 'Hz',
          unitRatio: 'dB',
          unitPower: 'dBFS',
          sampleRateHz: 48000,
          nyquistHz: 24000,
          fftSize: 2048,
          fftResolutionHz: 48000 / 2048,
          rolloffThresholdPercent: 95,
          rolloffFrequencyRange: {
            nominalLowHz: 20,
            nominalHighHz: 8000,
            effectiveLowHz: 20,
            effectiveHighHz: 8000,
            truncatedByNyquist: false,
          },
          rolloff95SpeechBandRange: {
            nominalLowHz: 300,
            nominalHighHz: 8000,
            effectiveLowHz: 300,
            effectiveHighHz: 8000,
            truncatedByNyquist: false,
          },
          midHighBandRangeHz: [1500, 4200],
          highBandRangeHz: [4200, 8000],
          power1500_4200Linear: 0.0018,
          power1500_4200DbFS: -27.5,
          power4200_8000Linear: 0.00012,
          power4200_8000DbFS: -39.0,
          highToMidHighRatioDb: -11.5,
          rolloff95Hz: o.isMeasurable ? 4900 : null,
          rolloff95SpeechBandHz: o.isMeasurable ? 4600 : null,
          constraintNote: 'OK',
        },
        bandEnergyComparison: {
          isMeasurable: o.isMeasurable,
          unitRatio: 'dB',
          ratioMethod: 'bandwidth_normalized_psd',
          fftWindow: 'hann',
          fftSize: 2048,
          bands: {
            low_120_300: {
              label: '低域 (120-300Hz)',
              rangeHz: [120, 300],
              effectiveRangeHz: [120, 300],
              isMeasurable: o.isMeasurable,
              powerLinear: 0.004,
              powerDbFS: -24.0,
              psdLinearPerHz: 0.000022,
              psdDbPerHz: -46.5,
              actualBandwidthHz: 180,
            },
            core_300_1000: {
              label: '声の芯 (300-1000Hz)',
              rangeHz: [300, 1000],
              effectiveRangeHz: [300, 1000],
              isMeasurable: o.isMeasurable,
              powerLinear: 0.01,
              powerDbFS: -20.0,
              psdLinearPerHz: 0.000014,
              psdDbPerHz: -48.5,
              actualBandwidthHz: 700,
            },
            clarity_1500_4200: {
              label: '明瞭域 (1500-4200Hz)',
              rangeHz: [1500, 4200],
              effectiveRangeHz: [1500, 4200],
              isMeasurable: o.isMeasurable,
              powerLinear: 0.0018,
              powerDbFS: -27.5,
              psdLinearPerHz: 0.00000066,
              psdDbPerHz: -61.8,
              actualBandwidthHz: 2700,
            },
            high_4200_8000: {
              label: '高域 (4200-8000Hz)',
              rangeHz: [4200, 8000],
              effectiveRangeHz: [4200, 8000],
              isMeasurable: o.isMeasurable,
              powerLinear: 0.00012,
              powerDbFS: -39.0,
              psdLinearPerHz: 0.000000033,
              psdDbPerHz: -74.8,
              actualBandwidthHz: 3800,
            },
          },
          ratios: {
            lowToCoreDb: o.isMeasurable ? -2.0 : null,
            clarityToCoreDb: o.isMeasurable ? -9.5 : null,
            highToClarityDb: o.isMeasurable ? -11.5 : null,
          },
          integratedRatiosDb: {
            lowToCoreDb: o.isMeasurable ? -2.0 : null,
            clarityToCoreDb: o.isMeasurable ? -9.5 : null,
            highToClarityDb: o.isMeasurable ? -11.5 : null,
          },
        },
        speechLevelVariability: {
          isMeasurable: o.isMeasurable,
          unit: 'dB',
          windowDurationMs: 30,
          hopDurationMs: 15,
          speechWindowCount: o.isMeasurable ? 40 : 0,
          medianDbFS: o.isMeasurable ? o.speechAvgDb : null,
          p25DbFS: o.isMeasurable ? o.speechAvgDb - o.iqrDb / 2 : null,
          p75DbFS: o.isMeasurable ? o.speechAvgDb + o.iqrDb / 2 : null,
          iqrDb: o.isMeasurable ? o.iqrDb : null,
          minDbFS: o.isMeasurable ? o.speechAvgDb - o.rangeDb * 0.65 : null,
          maxDbFS: o.isMeasurable ? o.speechAvgDb + o.rangeDb * 0.35 : null,
          rangeDb: o.isMeasurable ? o.rangeDb : null,
          interpretationNote: 'OK',
        },
        spectralFlatness: {
          isMeasurable: o.isMeasurable,
          unit: 'ratio_0_to_1',
          frequencyRange: {
            nominalLowHz: 300,
            nominalHighHz: 4200,
            effectiveLowHz: 300,
            effectiveHighHz: 4200,
            truncatedByNyquist: false,
          },
          aggregationMethod: 'per_frame_median_and_quartiles',
          validSpeechFrameCount: o.isMeasurable ? 160 : 0,
          median: o.isMeasurable ? 0.062 : null,
          mean: o.isMeasurable ? 0.085 : null,
          p25: o.isMeasurable ? 0.031 : null,
          p75: o.isMeasurable ? 0.109 : null,
          interpretationNote: '参考指標',
        },
      };

  const evaluation: HeadsetEvaluation = {
    algoVersion: o.algoVersion,
    isMeasurable: o.isMeasurable,
    unmeasurableReason: o.isMeasurable ? undefined : '発声区間が不足しています',
    noiseStats: {
      avgDb: o.noiseDb,
      minDb: o.noiseDb - 3,
      maxDb: o.noiseDb + 3,
      durationSec: 3.0,
      ratioPercent: 45,
      appropriateRatioPercent: o.noiseDb <= -45 ? 100 : 10,
      targetRangeText: '-45dBFS以下',
      appropriateDescription: 'test',
    },
    speechStats: {
      avgDb: o.isMeasurable ? o.speechAvgDb : -80,
      minDb: o.speechAvgDb - 8,
      maxDb: o.speechAvgDb + 4,
      durationSec: o.isMeasurable ? 4.2 : 0.4,
      ratioPercent: 55,
      appropriateRatioPercent: o.speechAvgDb >= -24 && o.speechAvgDb <= -14 ? 85 : 15,
      targetRangeText: '-24〜-14dBFS',
      appropriateDescription: 'test',
    },
    noiseAnalysis: {
      preNoiseDbFS: o.noiseDb,
      postNoiseDbFS: o.noiseDb + 0.5,
      representativeNoiseDbFS: o.noiseDb,
      noiseDifferenceDb: 0.5,
      hasNoiseLevelShiftWarning: false,
      noisePowerLinear: Math.pow(10, o.noiseDb / 10),
    },
    estimatedSnr: {
      snrDb: o.isMeasurable && o.broadbandSnrDb !== null ? o.broadbandSnrDb : undefined,
      isMeasurable: o.isMeasurable && o.broadbandSnrDb !== null,
      voicePowerLinear: 0.01,
      noisePowerLinear: Math.pow(10, o.noiseDb / 10),
    },
    snrDb: o.isMeasurable && o.broadbandSnrDb !== null ? o.broadbandSnrDb : 0,
    frequencyBalance: {
      subBassRumble: 4,
      vocalLowBoom: 18,
      vocalCore: 46,
      vocalClarity: 24,
      airAndHiss: 8,
    },
    bandRatio: {
      lowFreqPowerLinear: 0.004,
      midHighFreqPowerLinear: 0.003,
      ratioDb: 1.2,
      relativeObservationText: '標準的バランス',
    },
    spectralCentroidHz: 1150,
    extendedMetrics,
    mufflenessLevel: null,
    mufflenessScore: null,
    clarityScore: null,
    clippingDetails: {
      peakValue: Math.pow(10, -4.2 / 20),
      peakDbFS: -4.2,
      clippedSampleCount: 0,
      clippingRatioPercent: 0,
      maxConsecutiveClipSamples: 0,
      hasClippingSign: false,
      statusText: 'デジタルクリッピングの兆候なし',
    },
    clippingDetected: false,
    clippingRatio: 0,
    overallScoreStatus: 'pending',
    overallScoreText: '算出保留',
    overallGradeText: '保留',
    overallGrade: null,
    stressScore: null,
    gradeTitle: 'テスト機器良好',
    assessmentSummary: 'テスト用サマリー',
    assessmentItems: [],
    actionableTips: [],
    segments: o.isMeasurable
      ? [
          { startTime: 0, endTime: 3, isSpeech: false, avgDb: o.noiseDb, maxDb: o.noiseDb + 2 },
          {
            startTime: 3,
            endTime: 7.2,
            isSpeech: true,
            avgDb: o.speechAvgDb,
            maxDb: o.speechAvgDb + 4,
          },
          { startTime: 7.2, endTime: 8.5, isSpeech: false, avgDb: o.noiseDb, maxDb: o.noiseDb + 2 },
        ]
      : [{ startTime: 0, endTime: 3, isSpeech: false, avgDb: o.noiseDb, maxDb: o.noiseDb + 2 }],
  };

  return {
    id,
    name,
    blob: new Blob([]),
    recordedAt: new Date('2026-11-15T12:00:00.000Z'),
    duration: 8.5,
    sampleRate: 48000,
    audioUrl: 'blob:test',
    buffer: null as unknown as AudioBuffer,
    micDeviceLabel: name,
    micDeviceId: `dev-${id}`,
    evaluation,
    recordingMode: 'eval_with_voice',
    subjectiveRating: {
      intelligibilityOriginal: 4,
      intelligibilityNormalized: 5,
      lowMuffleness: 4,
      lowBackgroundNoise: 5,
      notes: '聴感テストメモ',
    },
  };
}

function run() {
  // 1. URL query parsing tests
  assertEqual('No query string -> simple', resolveDisplayModeFromSearch(''), 'simple');
  assertEqual('Null query -> simple', resolveDisplayModeFromSearch(null), 'simple');
  assertEqual('Undefined query -> simple', resolveDisplayModeFromSearch(undefined), 'simple');
  assertEqual('?debug=1 -> debug', resolveDisplayModeFromSearch('?debug=1'), 'debug');
  assertEqual('?debug=0 -> simple', resolveDisplayModeFromSearch('?debug=0'), 'simple');
  assertEqual('?debug=true -> simple', resolveDisplayModeFromSearch('?debug=true'), 'simple');
  assertEqual('?foo=bar&debug=1 -> debug', resolveDisplayModeFromSearch('?foo=bar&debug=1'), 'debug');
  assertEqual('?debug=1&foo=bar -> debug', resolveDisplayModeFromSearch('?debug=1&foo=bar'), 'debug');
  assertEqual('?DEBUG=1 -> simple (case-sensitive)', parseDebugModeFromSearch('?DEBUG=1'), false);
  assertEqual('Node fallback getCurrentDisplayMode -> simple', getCurrentDisplayMode(), 'simple');

  // 2. Sample clips (including quiet USB, gated BT, and legacy unmeasurable)
  const clipGood = makeClip('c1', '有線ヘッドセット');
  const clipQuiet = makeClip('c2', 'USB卓上マイク', {
    speechAvgDb: -32.0,
    speechBandSnrDb: 25.0,
    broadbandSnrDb: 23.0,
  });
  const clipGated = makeClip('c3', 'Bluetoothイヤホン', { noiseGate: true });
  const clipUnmeasurable = makeClip('c4', '旧・測定不可録音', {
    algoVersion: 'v1.0',
    isMeasurable: false,
    omitExtendedMetrics: true,
  });

  const fourClips = [clipGood, clipQuiet, clipGated, clipUnmeasurable];

  // Ensure computeProvisionalScore produces identical values independently of display mode
  const scoreGood = computeProvisionalScore(clipGood.evaluation);
  const scoreQuiet = computeProvisionalScore(clipQuiet.evaluation);
  const scoreGated = computeProvisionalScore(clipGated.evaluation);
  const scoreUnmeas = computeProvisionalScore(clipUnmeasurable.evaluation);

  assertTrue('Good clip has integer totalScore', typeof scoreGood.totalScore === 'number');
  assertTrue('Quiet clip has integer totalScore', typeof scoreQuiet.totalScore === 'number');
  assertTrue(
    'Gated clip flags noiseGateSuspected',
    scoreGated.items.noisePerformance.metricValues?.noiseGateSuspected === true
  );
  assertEqual('Unmeasurable clip totalScore is null', scoreUnmeas.totalScore, null);

  // 3. Render EvaluationSummary in simple vs debug mode
  const evalSimpleHtml = renderToStaticMarkup(
    React.createElement(EvaluationSummary, { evaluation: clipGated.evaluation, isDebugMode: false })
  );
  const evalDebugHtml = renderToStaticMarkup(
    React.createElement(EvaluationSummary, { evaluation: clipGated.evaluation, isDebugMode: true })
  );

  assertTrue(
    'Simple EvaluationSummary shows 総合スコア（100点満点）',
    evalSimpleHtml.includes('総合スコア（100点満点）')
  );
  assertTrue('Simple EvaluationSummary shows 主な問題点', evalSimpleHtml.includes('主な問題点'));
  assertTrue('Simple EvaluationSummary shows 改善アドバイス', evalSimpleHtml.includes('改善アドバイス'));
  assertTrue(
    'Simple EvaluationSummary shows provisional + Web meeting notice',
    evalSimpleHtml.includes('Web会議アプリ')
  );
  assertTrue(
    'Simple EvaluationSummary hides phase2c-provisional-v2 tag',
    !evalSimpleHtml.includes('phase2c-provisional-v2')
  );
  assertTrue(
    'Debug EvaluationSummary shows phase2c-provisional-v2',
    evalDebugHtml.includes('phase2c-provisional-v2')
  );
  assertTrue('Debug EvaluationSummary shows 算出根拠', evalDebugHtml.includes('の算出根拠'));

  const forbiddenTerms = ['dBFS', 'PSD', 'FFT', 'IQR', 'SNR', 'Nyquist', 'rolloff', 'VAD'];
  for (const term of forbiddenTerms) {
    assertTrue(`Simple EvaluationSummary avoids jargon "${term}"`, !evalSimpleHtml.includes(term));
  }
  assertTrue(
    'Simple EvaluationSummary does not equate 周波数特性 with 聞き取りやすさ',
    !evalSimpleHtml.includes('周波数特性（聞き取りやすさ') &&
      !evalSimpleHtml.includes('声の聞き取りやすさのバランス')
  );

  // 4. Unmeasurable legacy clip in simple mode
  const unmeasSimpleHtml = renderToStaticMarkup(
    React.createElement(EvaluationSummary, {
      evaluation: clipUnmeasurable.evaluation,
      isDebugMode: false,
    })
  );
  assertTrue(
    'Unmeasurable simple EvaluationSummary shows clear re-record message',
    unmeasSimpleHtml.includes('測定できませんでした。録音し直してください')
  );
  assertTrue(
    'Unmeasurable simple EvaluationSummary includes re-record advice',
    unmeasSimpleHtml.includes('最初の3秒間は静かに待ち')
  );

  // 5. RecordedClipView in simple vs debug mode
  const clipViewSimpleHtml = renderToStaticMarkup(
    React.createElement(RecordedClipView, {
      clips: fourClips,
      selectedClipId: clipGood.id,
      outputDeviceId: '',
      isDebugMode: false,
      onSelectClip: () => {},
      onDeleteClip: () => {},
      onUpdateClipName: () => {},
      onUpdateSubjectiveRating: () => {},
    })
  );
  const clipViewDebugHtml = renderToStaticMarkup(
    React.createElement(RecordedClipView, {
      clips: fourClips,
      selectedClipId: clipGood.id,
      outputDeviceId: '',
      isDebugMode: true,
      onSelectClip: () => {},
      onDeleteClip: () => {},
      onUpdateClipName: () => {},
      onUpdateSubjectiveRating: () => {},
    })
  );

  assertTrue(
    'Simple RecordedClipView keeps 音声をダウンロード',
    clipViewSimpleHtml.includes('音声をダウンロード')
  );
  assertTrue(
    'Simple RecordedClipView keeps 音量正規化 toggle',
    clipViewSimpleHtml.includes('音量正規化')
  );
  assertTrue(
    'Simple RecordedClipView keeps 5段階聴感評価',
    clipViewSimpleHtml.includes('5段階聴感評価')
  );
  assertTrue(
    'Simple RecordedClipView hides レポート出力',
    !clipViewSimpleHtml.includes('レポート出力')
  );
  assertTrue(
    'Simple RecordedClipView hides 実機検証用診断ログ',
    !clipViewSimpleHtml.includes('実機検証用診断ログ')
  );
  assertTrue('Simple RecordedClipView avoids dBFS tooltip', !clipViewSimpleHtml.includes('dBFS'));
  assertTrue(
    'Simple RecordedClipView does NOT contain any debug switch button',
    !clipViewSimpleHtml.includes('デバッグモード')
  );

  assertTrue('Debug RecordedClipView shows レポート出力', clipViewDebugHtml.includes('レポート出力'));
  assertTrue(
    'Debug RecordedClipView shows 実機検証用診断ログ',
    clipViewDebugHtml.includes('実機検証用診断ログ')
  );
  assertTrue('Debug RecordedClipView keeps SNR option in selector', clipViewDebugHtml.includes('SNR'));

  // 6. ComparisonTable (4 clips) in simple vs debug mode
  const cmpSimpleHtml = renderToStaticMarkup(
    React.createElement(ComparisonTable, { clips: fourClips, isDebugMode: false })
  );
  const cmpDebugHtml = renderToStaticMarkup(
    React.createElement(ComparisonTable, { clips: fourClips, isDebugMode: true })
  );

  assertTrue('Simple ComparisonTable renders 4 / 4 件', cmpSimpleHtml.includes('4 / 4 件'));
  assertTrue(
    'Simple ComparisonTable shows all 4 clip names',
    fourClips.every((c) => cmpSimpleHtml.includes(c.name ?? ''))
  );
  assertTrue(
    'Simple ComparisonTable shows unmeasurable label cleanly',
    cmpSimpleHtml.includes('測定できませんでした')
  );
  assertTrue(
    'Simple ComparisonTable hides CSV/JSON/HTML exports',
    !cmpSimpleHtml.includes('CSV出力') && !cmpSimpleHtml.includes('JSON出力')
  );
  assertTrue(
    'Simple ComparisonTable hides 同一機器別・複数録音統計比較',
    !cmpSimpleHtml.includes('同一機器別・複数録音統計比較')
  );
  for (const term of forbiddenTerms) {
    assertTrue(`Simple ComparisonTable avoids jargon "${term}"`, !cmpSimpleHtml.includes(term));
  }

  assertTrue('Debug ComparisonTable renders 4 / 4 件', cmpDebugHtml.includes('4 / 4 件'));
  assertTrue(
    'Debug ComparisonTable shows CSV出力 & 機器別統計CSV & JSON出力',
    cmpDebugHtml.includes('CSV出力') &&
      cmpDebugHtml.includes('機器別統計CSV') &&
      cmpDebugHtml.includes('JSON出力')
  );
  assertTrue(
    'Debug ComparisonTable shows 同一機器別・複数録音統計比較',
    cmpDebugHtml.includes('同一機器別・複数録音統計比較')
  );

  // Identical score in simple & debug views for clipGood
  const expectedScoreStr = `${scoreGood.totalScore}`;
  assertTrue(
    'Simple ComparisonTable displays exact provisional score',
    cmpSimpleHtml.includes(`${expectedScoreStr} / 100`)
  );
  assertTrue(
    'Debug ComparisonTable displays identical provisional score',
    cmpDebugHtml.includes(`${expectedScoreStr} / 100`)
  );

  console.log('\nAll Phase 3B viewMode & separation tests passed!');
}

run();
