/**
 * Unit & regression tests for Phase 2C provisional 100-point scoring.
 * Verifies all 10 required behavior cases, UI/export score parity,
 * strict independence from subjective ratings, and modeled hardware profiles.
 */
import { HeadsetEvaluation, RecordedClip } from '../types/audio';
import {
  PROVISIONAL_SCORE_NOTICES,
  PROVISIONAL_SCORE_VERSION,
  computeProvisionalScore,
} from './provisionalScoring';
import { clipsToCsv, clipsToJson } from './verificationExport';
import { generateComparisonHtml, generateSingleClipHtml } from './reportExport';

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

function parseCsvFirstDataRow(csvWithBom: string): { headers: string[]; rows: string[][] } {
  const input = csvWithBom.startsWith('\uFEFF') ? csvWithBom.slice(1) : csvWithBom;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(cell);
        cell = '';
      } else if (ch === '\r' && input[i + 1] === '\n') {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
        i++;
      } else if (ch === '\n') {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
      } else {
        cell += ch;
      }
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return { headers: rows[0], rows: rows.slice(1) };
}

function makeBaseEvaluation(overrides?: {
  speechAvgDb?: number;
  noiseDb?: number;
  speechBandSnrDb?: number | null;
  broadbandSnrDb?: number | null;
  snrMeasurable?: boolean;
  hasClippingSign?: boolean;
  clippedSampleCount?: number;
  clippingRatioPercent?: number;
  peakDbFS?: number;
  lowToCoreDb?: number | null;
  clarityToCoreDb?: number | null;
  highToClarityDb?: number | null;
  rolloffSpeechHz?: number | null;
  iqrDb?: number | null;
  rangeDb?: number | null;
  minWindowDb?: number | null;
  speechWindowCount?: number;
  hasNoiseShift?: boolean;
  isMeasurable?: boolean;
  omitExtendedMetrics?: boolean;
  omitVariability?: boolean;
}): HeadsetEvaluation {
  const o = {
    speechAvgDb: -19.0,
    noiseDb: -52.0,
    speechBandSnrDb: 33.0,
    broadbandSnrDb: 31.0,
    snrMeasurable: true,
    hasClippingSign: false,
    clippedSampleCount: 0,
    clippingRatioPercent: 0,
    peakDbFS: -4.5,
    lowToCoreDb: -1.5,
    clarityToCoreDb: -9.5,
    highToClarityDb: -11.5,
    rolloffSpeechHz: 4600,
    iqrDb: 7.2,
    rangeDb: 21.0,
    minWindowDb: null as number | null,
    speechWindowCount: 95,
    hasNoiseShift: false,
    isMeasurable: true,
    omitExtendedMetrics: false,
    omitVariability: false,
    ...overrides,
  };

  const extendedMetrics: HeadsetEvaluation['extendedMetrics'] = o.omitExtendedMetrics
    ? undefined
    : {
        fftNormalization: 'parseval_one_sided_hann',
        fftSize: 2048,
        fftHopSize: 1024,
        sampleRateHz: 48000,
        nyquistHz: 24000,
        speechBandSnr: {
          isMeasurable: Boolean(o.snrMeasurable && o.speechBandSnrDb !== null),
          status: o.snrMeasurable && o.speechBandSnrDb !== null ? 'measurable' : 'unmeasurable',
          unit: 'dB',
          frequencyRange: {
            nominalLowHz: 300,
            nominalHighHz: 4200,
            effectiveLowHz: 300,
            effectiveHighHz: 4200,
            truncatedByNyquist: false,
          },
          snrDb: o.snrMeasurable ? o.speechBandSnrDb : null,
          broadbandDiffDb:
            o.snrMeasurable && o.speechBandSnrDb !== null && o.broadbandSnrDb !== null
              ? Number((o.speechBandSnrDb - o.broadbandSnrDb).toFixed(1))
              : null,
          speechBandPowerDbFS: -20.0,
          noiseBandPowerDbFS: -53.0,
          noiseEstimationMethod: 'percentile_20_70_linear_power',
          unmeasurableReason:
            o.snrMeasurable && o.speechBandSnrDb !== null ? undefined : '帯域内SNR算出不能',
        },
        highFreqRolloff: {
          isMeasurable: o.rolloffSpeechHz !== null,
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
          rolloff95Hz: 4900,
          rolloff95SpeechBandHz: o.rolloffSpeechHz,
          constraintNote: 'OK',
        },
        bandEnergyComparison: {
          isMeasurable: o.lowToCoreDb !== null || o.clarityToCoreDb !== null,
          unitRatio: 'dB',
          ratioMethod: 'bandwidth_normalized_psd',
          fftWindow: 'hann',
          fftSize: 2048,
          bands: {
            low_120_300: {
              label: '低域 (120-300Hz)',
              rangeHz: [120, 300],
              effectiveRangeHz: [120, 300],
              isMeasurable: o.lowToCoreDb !== null,
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
              isMeasurable: true,
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
              isMeasurable: o.clarityToCoreDb !== null,
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
              isMeasurable: true,
              powerLinear: 0.00012,
              powerDbFS: -39.0,
              psdLinearPerHz: 0.000000033,
              psdDbPerHz: -74.8,
              actualBandwidthHz: 3800,
            },
          },
          ratios: {
            lowToCoreDb: o.lowToCoreDb,
            clarityToCoreDb: o.clarityToCoreDb,
            highToClarityDb: o.highToClarityDb,
          },
          integratedRatiosDb: {
            lowToCoreDb: o.lowToCoreDb,
            clarityToCoreDb: o.clarityToCoreDb,
            highToClarityDb: o.highToClarityDb,
          },
        },
        speechLevelVariability: {
          isMeasurable: !o.omitVariability && o.iqrDb !== null,
          unit: 'dB',
          windowDurationMs: 30,
          hopDurationMs: 15,
          speechWindowCount: o.omitVariability ? 0 : o.speechWindowCount,
          medianDbFS: o.speechAvgDb,
          p25DbFS: o.speechAvgDb - 3.6,
          p75DbFS: o.speechAvgDb + 3.6,
          iqrDb: o.omitVariability ? null : o.iqrDb,
          minDbFS: o.minWindowDb !== null ? o.minWindowDb : o.speechAvgDb - 11.0,
          maxDbFS: o.speechAvgDb + 4.5,
          rangeDb: o.omitVariability ? null : o.rangeDb,
          interpretationNote: 'OK',
        },
        spectralFlatness: {
          isMeasurable: true,
          unit: 'ratio_0_to_1',
          frequencyRange: {
            nominalLowHz: 300,
            nominalHighHz: 4200,
            effectiveLowHz: 300,
            effectiveHighHz: 4200,
            truncatedByNyquist: false,
          },
          aggregationMethod: 'per_frame_median_and_quartiles',
          validSpeechFrameCount: 160,
          median: 0.062,
          mean: 0.085,
          p25: 0.031,
          p75: 0.109,
          interpretationNote: '参考指標',
        },
      };

  return {
    algoVersion: 'v2.0',
    isMeasurable: o.isMeasurable,
    unmeasurableReason: o.isMeasurable ? undefined : '有効発声時間不足',
    speechStats: {
      maxDb: o.speechAvgDb + 4.5,
      minDb: o.speechAvgDb - 11.0,
      avgDb: o.speechAvgDb,
      durationSec: o.isMeasurable ? 4.2 : 0.4,
      ratioPercent: 55,
      appropriateRatioPercent: o.speechAvgDb >= -24 && o.speechAvgDb <= -14 ? 88 : 12,
      targetRangeText: '-24〜-14dBFS',
      appropriateDescription: 'test',
    },
    noiseStats: {
      maxDb: o.noiseDb + 4,
      minDb: o.noiseDb - 4,
      avgDb: o.noiseDb,
      durationSec: 4.5,
      ratioPercent: 45,
      appropriateRatioPercent: o.noiseDb <= -45 ? 100 : 10,
      targetRangeText: '-45dBFS以下',
      appropriateDescription: 'test',
    },
    noiseAnalysis: {
      preNoiseDbFS: o.noiseDb,
      postNoiseDbFS: o.hasNoiseShift ? o.noiseDb + 7.5 : o.noiseDb + 0.3,
      noiseDifferenceDb: o.hasNoiseShift ? 7.5 : 0.3,
      hasNoiseLevelShiftWarning: o.hasNoiseShift,
      representativeNoiseDbFS: o.noiseDb,
      noisePowerLinear: Math.pow(10, o.noiseDb / 10),
    },
    estimatedSnr: {
      isMeasurable: o.snrMeasurable && o.broadbandSnrDb !== null,
      snrDb: o.snrMeasurable && o.broadbandSnrDb !== null ? o.broadbandSnrDb : undefined,
      voicePowerLinear: 0.01,
      noisePowerLinear: 0.00001,
      unmeasurableReason: o.snrMeasurable ? undefined : '暗騒音分離不可',
    },
    snrDb: o.broadbandSnrDb ?? 0,
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
      relativeObservationText: '参考値',
    },
    spectralCentroidHz: 1450,
    extendedMetrics,
    mufflenessLevel: null,
    mufflenessScore: null,
    clarityScore: null,
    clippingDetails: {
      peakValue: Math.pow(10, o.peakDbFS / 20),
      peakDbFS: o.peakDbFS,
      clippedSampleCount: o.clippedSampleCount,
      clippingRatioPercent: o.clippingRatioPercent,
      maxConsecutiveClipSamples: o.hasClippingSign ? 5 : 0,
      hasClippingSign: o.hasClippingSign,
      statusText: o.hasClippingSign ? 'クリッピング歪み兆候あり' : 'デジタルクリッピングの兆候なし',
    },
    clippingDetected: o.hasClippingSign,
    clippingRatio: o.clippingRatioPercent / 100,
    overallScoreStatus: 'pending',
    overallScoreText: '算出保留（明瞭性検証中）',
    overallGradeText: '保留',
    overallGrade: null,
    stressScore: null,
    gradeTitle: '測定完了',
    assessmentSummary: '客観測定値',
    assessmentItems: [],
    actionableTips: [],
    segments: [
      { startTime: 0, endTime: 3.0, isSpeech: false, avgDb: o.noiseDb, maxDb: o.noiseDb + 3 },
      { startTime: 3.0, endTime: 7.2, isSpeech: true, avgDb: o.speechAvgDb, maxDb: o.speechAvgDb + 4 },
      { startTime: 7.2, endTime: 9.0, isSpeech: false, avgDb: o.noiseDb, maxDb: o.noiseDb + 3 },
    ],
  };
}

function makeClip(id: string, name: string, evaluation: HeadsetEvaluation): RecordedClip {
  return {
    id,
    name,
    blob: {} as Blob,
    audioUrl: 'blob:test',
    duration: 9,
    sampleRate: 48000,
    buffer: undefined as unknown as AudioBuffer,
    evaluation,
    recordedAt: new Date('2026-11-12T12:00:00Z'),
    micDeviceLabel: name,
    micDeviceId: `id-${id}`,
    recordingMode: 'eval_with_voice',
  };
}

export function runProvisionalScoringTests() {
  console.log('=== Starting Phase 2C Provisional 100-Point Scoring Tests ===\n');

  // Case 1: Normal good headset metrics
  const normalEval = makeBaseEvaluation();
  const normalScore = computeProvisionalScore(normalEval);
  assertEqual('Case 1: version matches', normalScore.scoringVersion, PROVISIONAL_SCORE_VERSION);
  assertEqual('Case 1: status is provisional', normalScore.status, 'provisional');
  assertTrue(
    'Case 1: normal metrics produce high integer score (90..100)',
    Number.isInteger(normalScore.totalScore) &&
      (normalScore.totalScore as number) >= 90 &&
      (normalScore.totalScore as number) <= 100
  );
  assertEqual('Case 1: inputVolume = 20/20', normalScore.items.inputVolume.score, 20);
  assertEqual('Case 1: noisePerformance = 35/35', normalScore.items.noisePerformance.score, 35);
  assertEqual('Case 1: frequencyCharacteristics = 25/25', normalScore.items.frequencyCharacteristics.score, 25);
  assertEqual('Case 1: speechStability = 20/20', normalScore.items.speechStability.score, 20);
  assertEqual('Case 1: unavailableItems empty', normalScore.unavailableItems.length, 0);

  // Case 2: Quiet USB mic (-37.9 dBFS) vs PC (-21.7 dBFS) vs Bluetooth K2 (-26.8 dBFS)
  // Verifies quiet USB mic is penalized ONLY in inputVolume, NOT in noise/freq/stability
  const pcEval = makeBaseEvaluation({
    speechAvgDb: -21.7,
    noiseDb: -51.5,
    speechBandSnrDb: 30.0,
    broadbandSnrDb: 28.5,
    lowToCoreDb: -1.0,
    clarityToCoreDb: -9.0,
    rolloffSpeechHz: 4500,
    iqrDb: 7.0,
  });
  const k2BtEval = makeBaseEvaluation({
    speechAvgDb: -26.8,
    noiseDb: -55.0,
    speechBandSnrDb: 28.0,
    broadbandSnrDb: 27.0,
    lowToCoreDb: -3.5,
    clarityToCoreDb: -12.0,
    rolloffSpeechHz: 3500,
    iqrDb: 8.5,
  });
  const usbQuietEval = makeBaseEvaluation({
    speechAvgDb: -37.9,
    noiseDb: -68.0,
    speechBandSnrDb: 30.0,
    broadbandSnrDb: 29.0,
    lowToCoreDb: -1.0,
    clarityToCoreDb: -9.0,
    rolloffSpeechHz: 4500,
    iqrDb: 7.0,
  });

  const pcScore = computeProvisionalScore(pcEval);
  const k2Score = computeProvisionalScore(k2BtEval);
  const usbQuietScore = computeProvisionalScore(usbQuietEval);

  console.log(
    `  [Modeled Hardware Profiles] PC(-21.7dBFS)=${pcScore.totalScore}, K2(-26.8dBFS)=${k2Score.totalScore}, USB(-37.9dBFS)=${usbQuietScore.totalScore}`
  );
  assertTrue(
    'Case 2: USB quiet (-37.9 dBFS) inputVolume strictly below PC (-21.7 dBFS)',
    (usbQuietScore.items.inputVolume.score as number) < (pcScore.items.inputVolume.score as number)
  );
  assertEqual(
    'Case 2: USB quiet noisePerformance identical to PC with equal 30dB SNR (no loudness double-penalty)',
    usbQuietScore.items.noisePerformance.score,
    pcScore.items.noisePerformance.score
  );
  assertEqual(
    'Case 2: USB quiet frequencyCharacteristics identical to PC (no loudness double-penalty)',
    usbQuietScore.items.frequencyCharacteristics.score,
    pcScore.items.frequencyCharacteristics.score
  );
  assertEqual(
    'Case 2: USB quiet speechStability identical to PC (no loudness double-penalty)',
    usbQuietScore.items.speechStability.score,
    pcScore.items.speechStability.score
  );
  assertTrue(
    'Case 2: USB quiet receives gain/normalization caveat in inputVolume notes',
    usbQuietScore.items.inputVolume.notes.some((n) => n.includes('音量不足と音質・明瞭性の不良は別要因'))
  );

  // Case 3: Digital clipping
  const clippedEval = makeBaseEvaluation({
    speechAvgDb: -15.0,
    hasClippingSign: true,
    clippedSampleCount: 120,
    clippingRatioPercent: 1.5,
    peakDbFS: 0.0,
  });
  const clippedScore = computeProvisionalScore(clippedEval);
  assertTrue(
    'Case 3: clipping sharply reduces inputVolume score (<= 8)',
    (clippedScore.items.inputVolume.score as number) <= 8
  );
  assertTrue(
    'Case 3: clipping note generated',
    clippedScore.items.inputVolume.notes.some((n) => n.includes('クリッピング'))
  );

  // Case 4: Heavy background noise
  const noisyEval = makeBaseEvaluation({
    speechAvgDb: -18.0,
    noiseDb: -28.0,
    speechBandSnrDb: 6.0,
    broadbandSnrDb: 5.0,
  });
  const noisyScore = computeProvisionalScore(noisyEval);
  assertTrue(
    'Case 4: heavy noise severely reduces noisePerformance (<= 6/35)',
    (noisyScore.items.noisePerformance.score as number) <= 6
  );

  // Case 5: Unmeasurable SNR -> total score MUST be null ('unavailable'), no fake padding
  const unmeasurableSnrEval = makeBaseEvaluation({
    snrMeasurable: false,
    speechBandSnrDb: null,
    broadbandSnrDb: null,
  });
  const unmeasurableSnrScore = computeProvisionalScore(unmeasurableSnrEval);
  assertEqual('Case 5: noisePerformance status unavailable', unmeasurableSnrScore.items.noisePerformance.status, 'unavailable');
  assertEqual('Case 5: noisePerformance score null', unmeasurableSnrScore.items.noisePerformance.score, null);
  assertEqual('Case 5: totalScore null when SNR unmeasurable', unmeasurableSnrScore.totalScore, null);
  assertEqual('Case 5: overall status unavailable', unmeasurableSnrScore.status, 'unavailable');
  assertEqual('Case 5: provisionalGrade null', unmeasurableSnrScore.provisionalGrade, null);

  // Case 6: Partial missing metrics (legacy clip without extendedMetrics -> rescaled over 55 pts, NOT padded with 100%)
  const legacyPartialEval = makeBaseEvaluation({
    speechAvgDb: -20.0,
    broadbandSnrDb: 25.0,
    omitExtendedMetrics: true,
  });
  const legacyPartialScore = computeProvisionalScore(legacyPartialEval);
  assertEqual('Case 6a: legacy without extendedMetrics is rescaled', legacyPartialScore.isRescaled, true);
  assertEqual('Case 6a: availableMaxScoreSum = 55', legacyPartialScore.availableMaxScoreSum, 55);
  assertEqual('Case 6a: frequencyCharacteristics unavailable', legacyPartialScore.items.frequencyCharacteristics.status, 'unavailable');
  assertEqual('Case 6a: speechStability unavailable', legacyPartialScore.items.speechStability.status, 'unavailable');
  assertTrue('Case 6a: rescalingNote explains missing items', Boolean(legacyPartialScore.rescalingNote?.includes('比例換算')));

  // Missing only variability (availableMax = 80)
  const missingVarEval = makeBaseEvaluation({ omitVariability: true });
  const missingVarScore = computeProvisionalScore(missingVarEval);
  assertEqual('Case 6b: missing variability rescaled over 80', missingVarScore.availableMaxScoreSum, 80);
  assertEqual('Case 6b: speechStability null', missingVarScore.items.speechStability.score, null);

  // Case 7: NaN / Infinity safety
  const nanEval = makeBaseEvaluation({
    speechAvgDb: NaN,
    speechBandSnrDb: Infinity,
    broadbandSnrDb: -Infinity,
    lowToCoreDb: NaN,
    clarityToCoreDb: NaN,
    rolloffSpeechHz: Infinity,
    iqrDb: NaN,
  });
  const nanScore = computeProvisionalScore(nanEval);
  assertEqual('Case 7: NaN inputs never crash & produce unavailable totalScore', nanScore.totalScore, null);
  assertEqual('Case 7: NaN inputVolume score is null', nanScore.items.inputVolume.score, null);
  assertEqual('Case 7: Infinity SNR noisePerformance score is null', nanScore.items.noisePerformance.score, null);

  // Case 8: Strict 0..100 integer clamping across extreme values
  const extremeLow = computeProvisionalScore(
    makeBaseEvaluation({
      speechAvgDb: -95,
      noiseDb: -10,
      speechBandSnrDb: -40,
      broadbandSnrDb: -40,
      hasClippingSign: true,
      clippingRatioPercent: 90,
      lowToCoreDb: -80,
      clarityToCoreDb: -80,
      rolloffSpeechHz: 300,
      iqrDb: 0,
      rangeDb: 90,
      hasNoiseShift: true,
    })
  );
  const extremeHigh = computeProvisionalScore(
    makeBaseEvaluation({
      speechAvgDb: -19,
      noiseDb: -85,
      speechBandSnrDb: 75,
      broadbandSnrDb: 75,
      lowToCoreDb: 0,
      clarityToCoreDb: -5,
      rolloffSpeechHz: 7800,
      iqrDb: 8,
    })
  );
  assertTrue(
    'Case 8a: extreme low stays integer >= 0',
    Number.isInteger(extremeLow.totalScore) && (extremeLow.totalScore as number) >= 0
  );
  assertTrue(
    'Case 8b: extreme high stays integer <= 100',
    Number.isInteger(extremeHigh.totalScore) && (extremeHigh.totalScore as number) <= 100
  );

  // Case 9: Determinism & strict independence from subjective ratings
  const repeatA = computeProvisionalScore(k2BtEval);
  const repeatB = computeProvisionalScore(k2BtEval);
  assertEqual('Case 9: deterministic identical JSON output', JSON.stringify(repeatA), JSON.stringify(repeatB));

  const clipNoSubj = makeClip('c1', '同じ機器', k2BtEval);
  const clipWorstSubj: RecordedClip = {
    ...clipNoSubj,
    id: 'c2',
    subjectiveRating: {
      intelligibilityOriginal: 1,
      intelligibilityNormalized: 1,
      lowMuffleness: 1,
      lowBackgroundNoise: 1,
      notes: '主観最悪テスト',
    },
  };
  const clipBestSubj: RecordedClip = {
    ...clipNoSubj,
    id: 'c3',
    subjectiveRating: {
      intelligibilityOriginal: 5,
      intelligibilityNormalized: 5,
      lowMuffleness: 5,
      lowBackgroundNoise: 5,
      notes: '主観最高テスト',
    },
  };
  const parityJson = JSON.parse(clipsToJson([clipNoSubj, clipWorstSubj, clipBestSubj]));
  assertEqual(
    'Case 9: subjectiveRating=1 does NOT alter provisionalScore',
    parityJson.clips[1].provisionalScore.totalScore,
    parityJson.clips[0].provisionalScore.totalScore
  );
  assertEqual(
    'Case 9: subjectiveRating=5 does NOT alter provisionalScore',
    parityJson.clips[2].provisionalScore.totalScore,
    parityJson.clips[0].provisionalScore.totalScore
  );

  // Case 10: Cross-surface parity (computeProvisionalScore == JSON == CSV == Single HTML == Comparison HTML)
  const pcClip = makeClip('pc-1', 'PC内蔵(-21.7dBFS)', pcEval);
  const usbClip = makeClip('usb-1', 'USB(-37.9dBFS)', usbQuietEval);
  const jsonExport = JSON.parse(clipsToJson([pcClip, usbClip]));
  const csvParsed = parseCsvFirstDataRow(clipsToCsv([pcClip, usbClip]));
  const singleHtmlPc = generateSingleClipHtml(pcClip);
  const compHtml = generateComparisonHtml([pcClip, usbClip]);

  const totalIdx = csvParsed.headers.indexOf('暫定総合スコア_100点満点');
  const gradeIdx = csvParsed.headers.indexOf('暫定区分');
  const verIdx = csvParsed.headers.indexOf('採点バージョン');
  const inVolIdx = csvParsed.headers.indexOf('入力音量スコア_20点');
  const noiseIdx = csvParsed.headers.indexOf('ノイズ性能スコア_35点');
  const freqIdx = csvParsed.headers.indexOf('周波数特性スコア_25点');
  const stabIdx = csvParsed.headers.indexOf('音声安定性スコア_20点');

  assertEqual(
    'Case 10: JSON totalScore == computeProvisionalScore',
    jsonExport.clips[0].provisionalScore.totalScore,
    pcScore.totalScore
  );
  assertEqual(
    'Case 10: CSV totalScore == computeProvisionalScore',
    csvParsed.rows[0][totalIdx],
    String(pcScore.totalScore)
  );
  assertEqual(
    'Case 10: CSV USB totalScore == computeProvisionalScore',
    csvParsed.rows[1][totalIdx],
    String(usbQuietScore.totalScore)
  );
  assertEqual('Case 10: CSV grade == computeProvisionalScore', csvParsed.rows[0][gradeIdx], pcScore.provisionalGradeLabel);
  assertEqual('Case 10: CSV version matches', csvParsed.rows[0][verIdx], PROVISIONAL_SCORE_VERSION);
  assertEqual('Case 10: CSV inputVolume matches', csvParsed.rows[0][inVolIdx], String(pcScore.items.inputVolume.score));
  assertEqual('Case 10: CSV noisePerformance matches', csvParsed.rows[0][noiseIdx], String(pcScore.items.noisePerformance.score));
  assertEqual('Case 10: CSV frequencyCharacteristics matches', csvParsed.rows[0][freqIdx], String(pcScore.items.frequencyCharacteristics.score));
  assertEqual('Case 10: CSV speechStability matches', csvParsed.rows[0][stabIdx], String(pcScore.items.speechStability.score));

  assertTrue(
    'Case 10: Single HTML displays exact totalScore & 暫定評価',
    singleHtmlPc.includes(`総合音声品質スコア：${pcScore.totalScore} / 100`) &&
      singleHtmlPc.includes('暫定評価') &&
      singleHtmlPc.includes(PROVISIONAL_SCORE_NOTICES.provisionalScoreNotice) &&
      singleHtmlPc.includes(PROVISIONAL_SCORE_NOTICES.browserDspSettingNote) &&
      !singleHtmlPc.includes('http://') &&
      !singleHtmlPc.includes('https://')
  );
  assertTrue(
    'Case 10: Comparison HTML displays both scores & notices offline',
    compHtml.includes(`${pcScore.totalScore} / 100`) &&
      compHtml.includes(`${usbQuietScore.totalScore} / 100`) &&
      compHtml.includes(PROVISIONAL_SCORE_NOTICES.provisionalScoreNotice) &&
      compHtml.includes(PROVISIONAL_SCORE_NOTICES.webMeetingDspNotice) &&
      !compHtml.includes('http://') &&
      !compHtml.includes('https://')
  );

  // Case 10b: Unmeasurable clip CSV/JSON/HTML parity
  const badClip = makeClip('bad-1', '測定不能クリップ', unmeasurableSnrEval);
  const badCsv = parseCsvFirstDataRow(clipsToCsv([badClip]));
  const badHtml = generateSingleClipHtml(badClip);
  assertEqual('Case 10b: unmeasurable clip CSV renders 算出不能', badCsv.rows[0][totalIdx], '算出不能');
  assertTrue('Case 10b: unmeasurable clip HTML renders 算出不能', badHtml.includes('総合音声品質スコア：算出不能'));

  // Case 11: v2 version & noise-gate suspicion (caution ONLY, NO penalty/cap on noisePerformance)
  assertEqual('Case 11: scoringVersion is phase2c-provisional-v2', PROVISIONAL_SCORE_VERSION, 'phase2c-provisional-v2');
  const gateLikeEval = makeBaseEvaluation({
    speechAvgDb: -28.0,
    noiseDb: -60.5,
    speechBandSnrDb: 36.0,
    broadbandSnrDb: 32.5,
    iqrDb: 16.0,
    rangeDb: 40.0,
    minWindowDb: -58.5,
    highToClarityDb: -24.0,
  });
  const gateLikeScore = computeProvisionalScore(gateLikeEval);
  assertEqual(
    'Case 11a: noiseGateSuspected flag is true',
    gateLikeScore.items.noisePerformance.metricValues.noiseGateSuspected,
    true
  );
  assertEqual(
    'Case 11b: noisePerformance is NOT capped or penalized solely for noiseGateSuspected (35/35)',
    gateLikeScore.items.noisePerformance.score,
    35
  );
  assertTrue(
    'Case 11c: noisePerformance notes contain non-assertive noise-gate caution',
    gateLikeScore.items.noisePerformance.notes.some((n) => n.includes('注意（ノイズゲート／抑制DSP疑い）'))
  );

  // Case 12: v2 conservative IQR behavior (high IQR alone does NOT heavily penalize speechStability)
  const highIqrOnlyEval = makeBaseEvaluation({
    iqrDb: 16.0,
    rangeDb: 28.0,
    minWindowDb: -32.0,
  });
  const highIqrOnlyScore = computeProvisionalScore(highIqrOnlyEval);
  assertTrue(
    'Case 12a: high IQR (16dB) without extreme range/drop stays conservative (>= 18/20)',
    (highIqrOnlyScore.items.speechStability.score as number) >= 18
  );
  assertEqual(
    'Case 12b: extremeVariationWarning flag set for IQR >= 14dB',
    highIqrOnlyScore.items.speechStability.metricValues.extremeVariationWarning,
    true
  );
  assertTrue(
    'Case 12c: speechStability notes warn without asserting dropout',
    highIqrOnlyScore.items.speechStability.notes.some((n) => n.includes('注意（大きな音量変動）'))
  );

  // Case 13: v2 frequencyCharacteristics uses highToClarityDb & flags low-SNR noise contamination
  const narrowbandEval = makeBaseEvaluation({
    highToClarityDb: -24.0,
    clarityToCoreDb: -28.0,
    lowToCoreDb: 6.0,
    rolloffSpeechHz: 950,
  });
  const widebandLowRollEval = makeBaseEvaluation({
    highToClarityDb: -8.0,
    clarityToCoreDb: -21.0,
    lowToCoreDb: 8.5,
    rolloffSpeechHz: 1000, // Even with low 300-8kHz rolloff, wideband highToClarityDb scores higher!
  });
  const narrowScore = computeProvisionalScore(narrowbandEval);
  const wideScore = computeProvisionalScore(widebandLowRollEval);
  assertTrue(
    'Case 13a: v2 frequencyCharacteristics separates wideband (-8dB) from narrowband (-24dB) despite similar rolloff',
    (wideScore.items.frequencyCharacteristics.score as number) >
      (narrowScore.items.frequencyCharacteristics.score as number)
  );
  const lowSnrFreqEval = makeBaseEvaluation({
    speechBandSnrDb: 13.8,
    broadbandSnrDb: 4.9,
    noiseDb: -32.8,
    highToClarityDb: -1.0,
  });
  const lowSnrFreqScore = computeProvisionalScore(lowSnrFreqEval);
  assertEqual(
    'Case 13b: low-SNR clip flags highBandNoiseContaminationWarning',
    lowSnrFreqScore.items.frequencyCharacteristics.metricValues.highBandNoiseContaminationWarning,
    true
  );
  assertTrue(
    'Case 13c: low-SNR clip notes warn about lower reliability of high-band PSD evaluation',
    lowSnrFreqScore.items.frequencyCharacteristics.notes.some((n) => n.includes('評価の信頼性が低下'))
  );

  // Case 14: Comparison HTML displays v2 caution tags & scoringVersion consistently
  const gateClip = makeClip('gate-1', 'K2ゲート疑い', gateLikeEval);
  const v2CompHtml = generateComparisonHtml([gateClip, makeClip('noisy-1', 'PC低SNR', lowSnrFreqEval)]);
  assertTrue(
    'Case 14: Comparison HTML includes phase2c-provisional-v2 and caution tags',
    v2CompHtml.includes('phase2c-provisional-v2') &&
      v2CompHtml.includes('ゲート疑い注意') &&
      v2CompHtml.includes('高域信頼性注意') &&
      v2CompHtml.includes('音量変動大注意')
  );

  console.log('\n=== All Phase 2C-v2 Provisional 100-Point Scoring Tests Passed! ===');
}

runProvisionalScoringTests();
