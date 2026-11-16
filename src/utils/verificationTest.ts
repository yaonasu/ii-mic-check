/**
 * Unit tests for Phase 2A hardware verification diagnostics,
 * 5-point subjective listening evaluation, and CSV/JSON exports.
 */
import { analyzeAudioBuffer, normalizeEvaluationCompatibility } from './audioDsp';
import {
  clipsToCsv,
  clipsToJson,
  computeClipDeletionTransition,
  computeDescriptiveStats,
  computeDeviceComparisonGroups,
  deviceComparisonToCsv,
  escapeCsvCell,
  formatDiagnosticLogText,
  formatSubjectiveRatingSummary,
  formatTrackBooleanSetting,
  formatTrackSettingsSummary,
  getSpeechSegments,
  getSubjectiveRatingStatus,
  loadAllSubjectiveRatings,
  loadSubjectiveRatingFromStorage,
  normalizeSubjectiveRating,
  removeSubjectiveRatingFromStorage,
  resolveDeviceIdentity,
  saveSubjectiveRatingToStorage,
} from './verificationExport';
import { RecordedClip, RecordingSequenceTimestamps, SubjectiveRating } from '../types/audio';

function assertTrue(name: string, condition: boolean) {
  if (!condition) {
    throw new Error(`FAIL: ${name} condition was false`);
  }
  console.log(`✓ PASS: ${name}`);
}

function assertEqual<T>(name: string, actual: T, expected: T) {
  if (actual !== expected) {
    throw new Error(`FAIL: ${name} expected ${String(expected)}, got ${String(actual)}`);
  }
  console.log(`✓ PASS: ${name} = ${String(actual)}`);
}

/**
 * Minimal RFC 4180 CSV parser to verify multi-line & quoted cell integrity.
 */
function parseRfc4180Csv(rawWithBom: string): string[][] {
  const input = rawWithBom.startsWith('\uFEFF') ? rawWithBom.slice(1) : rawWithBom;
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
  return rows;
}

function makeMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? (map.get(key) as string) : null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
  };
}

function createSyntheticBuffer(sampleRate = 48000, durationSec = 9): AudioBuffer {
  const totalSamples = sampleRate * durationSec;
  const data = new Float32Array(totalSamples);
  for (let i = 0; i < totalSamples; i++) {
    data[i] = ((i % 97) / 97 - 0.5) * 0.004; // low background noise
  }
  // Speech from 3.2s to 6.8s
  for (let i = Math.floor(3.2 * sampleRate); i < Math.floor(6.8 * sampleRate); i++) {
    const t = i / sampleRate;
    data[i] += 0.22 * Math.sin(2 * Math.PI * 440 * t);
  }
  return {
    sampleRate,
    length: totalSamples,
    duration: durationSec,
    numberOfChannels: 1,
    getChannelData: () => data,
  } as unknown as AudioBuffer;
}

export function runVerificationFeatureTests() {
  console.log('=== Starting Phase 2A Hardware Verification Feature Tests ===\n');

  const buf = createSyntheticBuffer(48000, 9);

  // 1. VerificationDiagnostics clockSourceUsed & timestamp delta tracking
  const ctxTimestamps: RecordingSequenceTimestamps = {
    recordStartTimeMs: 1000,
    promptSpeechTimeMs: 4000,
    requestStopTimeMs: 8000,
    recordEndTimeMs: 10050, // 9.05s wall
    audioCtxStartTimeSec: 12.0,
    audioCtxPromptTimeSec: 15.0,
    audioCtxStopRequestTimeSec: 19.0,
    audioCtxEndTimeSec: 21.02, // 9.02s audioCtx
    recorderStartCallTimeMs: 985,
    recorderStartToOnstartMs: 15.2,
    recorderStopCallTimeMs: 10050,
    recorderOnStopTimeMs: 10092,
  };
  const evalCtx = analyzeAudioBuffer(buf, ctxTimestamps);
  assertTrue('verificationInfo populated', !!evalCtx.verificationInfo);
  assertEqual('clockSourceUsed is audioContext', evalCtx.verificationInfo?.clockSourceUsed, 'audioContext');
  assertEqual('recorderStartToOnstartMs preserved', evalCtx.verificationInfo?.recorderStartToOnstartMs, 15.2);
  assertEqual('bufferVsWallDiffMs calculated correctly', evalCtx.verificationInfo?.bufferVsWallDiffMs, -50);
  assertEqual('bufferVsAudioCtxDiffMs calculated correctly', evalCtx.verificationInfo?.bufferVsAudioCtxDiffMs, -20);
  assertTrue(
    'Phase boundaries match AudioContext ratios',
    (evalCtx.verificationInfo?.preNoiseEndSec ?? 0) > 2.9 &&
      (evalCtx.verificationInfo?.speechEndSec ?? 0) > 6.9 &&
      (evalCtx.verificationInfo?.postNoiseStartSec ?? 0) > (evalCtx.verificationInfo?.speechEndSec ?? 0)
  );

  const evalPerf = analyzeAudioBuffer(buf, {
    recordStartTimeMs: 1000,
    promptSpeechTimeMs: 4000,
    requestStopTimeMs: 7000,
    recordEndTimeMs: 10000,
  });
  assertEqual('clockSourceUsed is performanceNow when AudioContext absent', evalPerf.verificationInfo?.clockSourceUsed, 'performanceNow');

  const evalFallback = analyzeAudioBuffer(buf);
  assertEqual('clockSourceUsed is fallbackDefault when timestamps omitted', evalFallback.verificationInfo?.clockSourceUsed, 'fallbackDefault');

  // 2. trackSettings false vs undefined distinction
  assertEqual('false formatted as OFF (false)', formatTrackBooleanSetting(false), 'OFF (false)');
  assertEqual('undefined formatted as 未記録', formatTrackBooleanSetting(undefined), '未記録');
  assertEqual('true formatted as ON (true)', formatTrackBooleanSetting(true), 'ON (true)');
  assertEqual(
    'summary distinguishes false and undefined',
    formatTrackSettingsSummary({
      echoCancellation: false,
      noiseSuppression: undefined,
      autoGainControl: false,
    }),
    'EC:OFF / NS:未記録 / AGC:OFF'
  );

  // 3. Subjective 5-point rating: unrated(null), independent original/normalized, legacy preservation & clearing
  const storage = makeMemoryStorage();
  assertEqual('Unrated status', getSubjectiveRatingStatus(undefined).statusLabel, '未評価');
  assertEqual(
    'Whitespace-only notes normalizes to undefined',
    normalizeSubjectiveRating({ notes: '   \n  ' }),
    undefined
  );

  const partialRating: SubjectiveRating = {
    intelligibilityOriginal: 2,
    intelligibilityNormalized: 5,
    notes: '1行目、カンマ, と"クォート"\n2行目も正常保存',
  };
  saveSubjectiveRatingToStorage('clip-a', partialRating, storage);
  const reloadedPartial = loadSubjectiveRatingFromStorage('clip-a', storage);
  assertTrue('Partial rating saved & reloaded', !!reloadedPartial);
  assertEqual('Partial rating intelligibilityOriginal', reloadedPartial?.intelligibilityOriginal, 2);
  assertEqual('Partial rating intelligibilityNormalized', reloadedPartial?.intelligibilityNormalized, 5);
  assertEqual('Partial rating unrated item explicitly null', reloadedPartial?.lowMuffleness, null);
  assertEqual('Partial rating unrated noise explicitly null', reloadedPartial?.lowBackgroundNoise, null);
  assertEqual('Partial rating status label', getSubjectiveRatingStatus(reloadedPartial).statusLabel, '一部評価');
  assertEqual('Partial rating ratedCount', getSubjectiveRatingStatus(reloadedPartial).ratedCount, 2);

  // Legacy rating with intelligibility MUST keep intelligibility intact & NOT auto-migrate into intelligibilityOriginal
  const legacySubjRating: SubjectiveRating = {
    intelligibility: 4,
    naturalness: 5,
    noDropoutOrSuppression: 4,
    notes: '旧評価メモ',
  };
  saveSubjectiveRatingToStorage('clip-legacy-subj', legacySubjRating, storage);
  const reloadedLegacySubj = loadSubjectiveRatingFromStorage('clip-legacy-subj', storage);
  assertEqual('Legacy intelligibility kept unchanged', reloadedLegacySubj?.intelligibility, 4);
  assertEqual('Legacy naturalness kept unchanged', reloadedLegacySubj?.naturalness, 5);
  assertEqual('Legacy does NOT auto-migrate into intelligibilityOriginal', reloadedLegacySubj?.intelligibilityOriginal, null);
  assertEqual('Legacy does NOT auto-migrate into intelligibilityNormalized', reloadedLegacySubj?.intelligibilityNormalized, null);
  assertTrue('Legacy status flags hasLegacyUnknown', getSubjectiveRatingStatus(reloadedLegacySubj).hasLegacyUnknown);
  assertEqual('Legacy status label is 一部評価', getSubjectiveRatingStatus(reloadedLegacySubj).statusLabel, '一部評価');

  const fullRating: SubjectiveRating = {
    intelligibilityOriginal: 3,
    intelligibilityNormalized: 5,
    lowMuffleness: 4,
    lowBackgroundNoise: 5,
    notes: 'USBヘッドセットA：明瞭',
  };
  saveSubjectiveRatingToStorage('clip-b', fullRating, storage);
  const reloadedFull = loadSubjectiveRatingFromStorage('clip-b', storage);
  assertEqual('Full rating status label', getSubjectiveRatingStatus(reloadedFull).statusLabel, '評価済');
  assertEqual('Full rating average (3+5+4+5)/4', getSubjectiveRatingStatus(reloadedFull).averageScore, 4.3);
  assertTrue(
    'Summary includes 4/4 count',
    formatSubjectiveRatingSummary(reloadedFull).includes('4/4項目')
  );

  // Clearing & removal
  saveSubjectiveRatingToStorage('clip-a', undefined, storage);
  assertEqual('Cleared rating removed from storage', loadSubjectiveRatingFromStorage('clip-a', storage), undefined);
  removeSubjectiveRatingFromStorage('clip-legacy-subj', storage);
  removeSubjectiveRatingFromStorage('clip-b', storage);
  assertEqual('Removed rating map empty', Object.keys(loadAllSubjectiveRatings(storage)).length, 0);

  // 4. Diagnostic Log Text & Legacy Clip Fallback ("未記録")
  const activeClip: RecordedClip = {
    id: 'clip-1',
    name: 'USBヘッドセットA, "実験1"',
    blob: {} as Blob,
    audioUrl: 'blob:dummy',
    duration: buf.duration,
    sampleRate: buf.sampleRate,
    buffer: buf,
    evaluation: evalCtx,
    recordedAt: new Date('2026-11-12T10:15:30Z'),
    micDeviceLabel: 'USB Headset Mic\n(Channel 1)',
    outputDeviceLabel: 'USB Headset Ear',
    recordingMode: 'eval_with_voice',
    trackSettings: {
      echoCancellation: false,
      noiseSuppression: undefined,
      autoGainControl: false,
      sampleRate: 48000,
      channelCount: 1,
    },
    subjectiveRating: reloadedPartial,
  };

  const diagLog = formatDiagnosticLogText(activeClip);
  assertTrue('Diagnostic log includes EC OFF (false)', diagLog.includes('echoCancellation (EC): OFF (false)'));
  assertTrue('Diagnostic log includes NS 未記録', diagLog.includes('noiseSuppression (NS): 未記録'));
  assertTrue('Diagnostic log includes sampleRate 48000 Hz', diagLog.includes('48000 Hz'));
  assertTrue('Diagnostic log includes start->onstart latency', diagLog.includes('15.2 ms'));
  assertTrue('Diagnostic log includes stop->onstop latency', diagLog.includes('42.0 ms'));
  assertTrue('Diagnostic log includes VAD speech segments', getSpeechSegments(activeClip).length >= 1);

  // Legacy clip without trackSettings, timestamps, verificationInfo, pause noise, or subjectiveRating
  const legacyEval = {
    ...evalFallback,
    noiseAnalysis: {
      ...evalFallback.noiseAnalysis,
      intraSpeechPauseNoiseDbFS: undefined,
    },
  };
  delete legacyEval.verificationInfo;
  delete legacyEval.timestamps;
  const legacyClip: RecordedClip = {
    id: 'clip-legacy',
    name: '旧履歴記録',
    blob: {} as Blob,
    audioUrl: 'blob:legacy',
    duration: buf.duration,
    sampleRate: buf.sampleRate,
    buffer: buf,
    evaluation: legacyEval,
    recordedAt: new Date('2026-01-01T00:00:00Z'),
    micDeviceLabel: 'Legacy Mic',
  };

  const legacyDiagLog = formatDiagnosticLogText(legacyClip);
  assertTrue('Legacy clip renders 未記録 for missing EC', legacyDiagLog.includes('echoCancellation (EC): 未記録'));
  assertTrue('Legacy clip renders 未記録 for AudioBuffer長', legacyDiagLog.includes('AudioBuffer長: 未記録'));
  assertTrue('Legacy clip renders 未記録 for preNoiseEnd', legacyDiagLog.includes('事前暗騒音終了 (preNoiseEnd): 未記録'));
  assertTrue('Legacy clip renders 未記録 for pause noise', legacyDiagLog.includes('intraSpeechPauseNoiseDbFS: 未記録'));

  // 5. CSV Export: UTF-8 BOM, RFC 4180 multi-line/quote escaping & column alignment
  assertEqual('escapeCsvCell handles quotes & newlines', escapeCsvCell('a,"b"\nc'), '"a,""b""\nc"');
  const csv = clipsToCsv([activeClip, legacyClip]);
  assertTrue('CSV starts with UTF-8 BOM', csv.startsWith('\uFEFF'));
  const parsedRows = parseRfc4180Csv(csv);
  assertEqual('CSV has header + 2 data rows despite internal newlines', parsedRows.length, 3);
  assertEqual('Row 1 column count equals header', parsedRows[1].length, parsedRows[0].length);
  assertEqual('Row 2 column count equals header', parsedRows[2].length, parsedRows[0].length);

  const nameIdx = parsedRows[0].indexOf('記録名');
  const nsIdx = parsedRows[0].indexOf('NS実設定');
  const ecIdx = parsedRows[0].indexOf('EC実設定');
  const notesIdx = parsedRows[0].indexOf('聴感_自由記述メモ');
  const subjStatusIdx = parsedRows[0].indexOf('聴感評価ステータス');

  assertEqual('CSV row 1 roundtrips name with comma/quote', parsedRows[1][nameIdx], 'USBヘッドセットA, "実験1"');
  assertEqual('CSV row 1 EC false preserved', parsedRows[1][ecIdx], 'false');
  assertEqual('CSV row 1 NS undefined marked 未記録', parsedRows[1][nsIdx], '未記録');
  assertEqual('CSV row 1 multi-line notes roundtripped', parsedRows[1][notesIdx], '1行目、カンマ, と"クォート"\n2行目も正常保存');
  assertEqual('CSV row 2 legacy subjective status 未評価', parsedRows[2][subjStatusIdx], '未評価');

  // 6. JSON Export: valid structured JSON omitting Blob/AudioBuffer/audioUrl
  const jsonStr = clipsToJson([activeClip, legacyClip]);
  const jsonParsed = JSON.parse(jsonStr);
  assertEqual('JSON clipCount is 2', jsonParsed.clipCount, 2);
  assertEqual('JSON clip 1 EC is false', jsonParsed.clips[0].trackSettings.echoCancellation, false);
  assertEqual('JSON clip 1 NS is null (was undefined)', jsonParsed.clips[0].trackSettings.noiseSuppression, null);
  assertEqual('JSON clip 1 subjectiveRating intelligibilityOriginal', jsonParsed.clips[0].subjectiveRating.intelligibilityOriginal, 2);
  assertEqual('JSON clip 1 subjectiveRating intelligibilityNormalized', jsonParsed.clips[0].subjectiveRating.intelligibilityNormalized, 5);
  assertEqual('JSON clip 1 unrated subjective lowMuffleness is null', jsonParsed.clips[0].subjectiveRating.lowMuffleness, null);
  assertTrue('JSON clip 1 omits blob/buffer/audioUrl', !('blob' in jsonParsed.clips[0]) && !('buffer' in jsonParsed.clips[0]) && !('audioUrl' in jsonParsed.clips[0]));
  assertEqual('JSON clip 2 legacy trackSettings is null', jsonParsed.clips[1].trackSettings, null);
  assertEqual('JSON clip 2 legacy subjectiveRating is null', jsonParsed.clips[1].subjectiveRating, null);

  // 7. Phase 2B-2A: Legacy dummy evaluation values must be neutralized in exports & display helpers
  const legacyWithDummiesClip: RecordedClip = {
    ...legacyClip,
    evaluation: {
      ...legacyClip.evaluation,
      mufflenessLevel: 'heavy_muffle',
      mufflenessScore: 80,
      clarityScore: 80,
      overallGrade: 'B',
      overallGradeText: '保留',
      stressScore: 30,
      overallScoreStatus: 'pending',
      bandRatio: {
        lowFreqPowerLinear: 10,
        midHighFreqPowerLinear: 0.1,
        ratioDb: 20.0,
        relativeObservationText:
          '低域（120〜500Hz）のエネルギー比率が高く、温かみまたは近接効果（マイク距離が近い傾向）が観測されます。',
      },
    },
  };
  const sanitized = normalizeEvaluationCompatibility(legacyWithDummiesClip.evaluation);
  assertEqual('Sanitized legacy mufflenessScore is null', sanitized.mufflenessScore, null);
  assertEqual('Sanitized legacy clarityScore is null', sanitized.clarityScore, null);
  assertEqual('Sanitized legacy overallGrade is null', sanitized.overallGrade, null);
  assertEqual('Sanitized legacy stressScore is null', sanitized.stressScore, null);
  assertEqual('Sanitized legacy mufflenessLevel is null', sanitized.mufflenessLevel, null);
  assertEqual('Sanitized legacy bandRatio.ratioDb preserved', sanitized.bandRatio.ratioDb, 20.0);
  assertTrue(
    'Sanitized legacy bandRatio text removes 近接効果',
    !sanitized.bandRatio.relativeObservationText.includes('近接効果')
  );

  const legacyDummyJson = JSON.parse(clipsToJson([legacyWithDummiesClip]));
  const exportedEval = legacyDummyJson.clips[0].evaluation;
  assertEqual('JSON export nulls legacy mufflenessScore', exportedEval.mufflenessScore, null);
  assertEqual('JSON export nulls legacy clarityScore', exportedEval.clarityScore, null);
  assertEqual('JSON export nulls legacy overallGrade', exportedEval.overallGrade, null);
  assertEqual('JSON export nulls legacy stressScore', exportedEval.stressScore, null);
  assertEqual('JSON export nulls legacy mufflenessLevel', exportedEval.mufflenessLevel, null);
  assertTrue(
    'JSON export removes legacy 近接効果 assertion',
    !exportedEval.bandRatio.relativeObservationText.includes('近接効果')
  );

  const legacyCsvRows = parseRfc4180Csv(clipsToCsv([activeClip, legacyWithDummiesClip]));
  assertTrue(
    'CSV header distinguishes 30ms max RMS and sample peak',
    legacyCsvRows[0].includes('発声音量30ms窓最大RMS_dBFS') &&
      legacyCsvRows[0].includes('サンプルピーク_dBFS')
  );

  // 8. Phase 2B-2B: CSV & JSON export verification (analyzed vs legacy 未解析 vs unmeasurable 測定不能)
  const legacyNoExtendedClip: RecordedClip = {
    ...legacyWithDummiesClip,
    evaluation: {
      ...legacyWithDummiesClip.evaluation,
      extendedMetrics: undefined,
    },
  };
  const sr8k = 8000;
  const buf8k = createSyntheticBuffer(sr8k, 9);
  const eval8k = analyzeAudioBuffer(buf8k, {
    recordStartTimeMs: 0,
    promptSpeechTimeMs: 3000,
    requestStopTimeMs: 7000,
    recordEndTimeMs: 9000,
  });
  const clip8k: RecordedClip = {
    ...activeClip,
    id: 'clip-8k',
    name: '8kHz制限テスト',
    duration: 9,
    sampleRate: sr8k,
    buffer: buf8k,
    evaluation: eval8k,
  };

  const p2bCsvRows = parseRfc4180Csv(clipsToCsv([activeClip, legacyNoExtendedClip, clip8k]));
  assertEqual('CSV total columns is 78 + 11 Phase 2C = 89', p2bCsvRows[0].length, 89);
  assertEqual('CSV preserves first existing header 記録名', p2bCsvRows[0][0], '記録名');
  assertEqual('CSV preserves 53rd existing header 聴感_自由記述メモ', p2bCsvRows[0][52], '聴感_自由記述メモ');
  assertEqual('CSV preserves 78th existing header 解析FFTホップ', p2bCsvRows[0][77], '解析FFTホップ');
  assertEqual('CSV appends Phase 2C header at index 78', p2bCsvRows[0][78], '暫定総合スコア_100点満点');

  const bandSnrIdx = p2bCsvRows[0].indexOf('音声帯域内SN比_300_4200Hz_dB');
  const rolloffIdx = p2bCsvRows[0].indexOf('高域ロールオフ95pct_Hz');
  const rolloff300Idx = p2bCsvRows[0].indexOf('高域ロールオフ95pct_300_8000Hz');
  const origSubjIdx = p2bCsvRows[0].indexOf('聴感_聞き取りやすさ_原音');
  const normSubjIdx = p2bCsvRows[0].indexOf('聴感_聞き取りやすさ_正規化後');
  const legacySubjIdx = p2bCsvRows[0].indexOf('聴感_聞き取りやすさ');
  const highRatioIdx = p2bCsvRows[0].indexOf('高域減衰比_4200_8000対1500_4200_dB');
  const psdLowCoreIdx = p2bCsvRows[0].indexOf('帯域PSD比_低域120_300対声の芯300_1000_dB');
  const flatMedIdx = p2bCsvRows[0].indexOf('スペクトル平坦度中央値_300_4200Hz');

  assertTrue('CSV analyzed row has numeric speech-band SNR', Number.isFinite(Number(p2bCsvRows[1][bandSnrIdx])));
  assertTrue('CSV analyzed row has numeric rolloff95', Number.isFinite(Number(p2bCsvRows[1][rolloffIdx])));
  assertTrue('CSV analyzed row has numeric 300-8000Hz rolloff95', Number.isFinite(Number(p2bCsvRows[1][rolloff300Idx])));
  assertEqual('CSV separated original subjective rating exported', p2bCsvRows[1][origSubjIdx], '2');
  assertEqual('CSV separated normalized subjective rating exported', p2bCsvRows[1][normSubjIdx], '5');
  assertEqual('CSV legacy intelligibility column stays empty when only new scores set', p2bCsvRows[1][legacySubjIdx], '');
  assertEqual('CSV legacy clip without extendedMetrics renders 未解析', p2bCsvRows[2][bandSnrIdx], '未解析');
  assertEqual('CSV legacy clip 300-8000Hz rolloff renders 未解析', p2bCsvRows[2][rolloff300Idx], '未解析');
  assertEqual('CSV legacy clip flatness renders 未解析', p2bCsvRows[2][flatMedIdx], '未解析');
  assertEqual('CSV 8kHz clip unmeasurable high-band ratio renders 測定不能 (not 0)', p2bCsvRows[3][highRatioIdx], '測定不能');
  assertTrue('CSV 8kHz clip still computes measurable lowToCore PSD ratio', Number.isFinite(Number(p2bCsvRows[3][psdLowCoreIdx])));

  const p2bJson = JSON.parse(clipsToJson([activeClip, legacyNoExtendedClip, clip8k]));
  assertEqual('JSON schemaVersion updated to phase2b-2d-verification-v1', p2bJson.schemaVersion, 'phase2b-2d-verification-v1');
  assertTrue('JSON includes Phase 2C scoringVersion', typeof p2bJson.scoringVersion === 'string' && p2bJson.scoringVersion.length > 0);
  assertTrue('JSON clip 0 includes provisionalScore object', !!p2bJson.clips[0].provisionalScore);
  assertEqual('JSON analyzed clip status is analyzed', p2bJson.clips[0].extendedMetricsStatus, 'analyzed');
  assertEqual('JSON analyzed clip analysisConditions has fftSize 2048', p2bJson.clips[0].analysisConditions.fftSize, 2048);
  assertEqual('JSON legacy clip status is unanalyzed', p2bJson.clips[1].extendedMetricsStatus, 'unanalyzed');
  assertEqual('JSON 8kHz clip highToMidHighRatioDb is null', p2bJson.clips[2].evaluation.extendedMetrics.highFreqRolloff.highToMidHighRatioDb, null);
  assertEqual('JSON speechBandSnr preserves unit dB', p2bJson.clips[0].evaluation.extendedMetrics.speechBandSnr.unit, 'dB');

  // 9. Phase 2B-2D: Conservative device grouping, descriptive stats (excluding NaN/Infinity/null), and exports
  {
    const baseClip = (id: string, overrides: Partial<RecordedClip>): RecordedClip => ({
      ...activeClip,
      id,
      subjectiveRating: undefined,
      ...overrides,
    });

    const devA1 = baseClip('a1', {
      name: 'USB-A-1',
      micDeviceId: 'usb-id-aaa',
      micDeviceLabel: 'Headset USB-A',
      evaluation: {
        ...evalCtx,
        speechStats: { ...evalCtx.speechStats, avgDb: -20, durationSec: 3.5 },
        estimatedSnr: { isMeasurable: true, snrDb: 30 },
      },
      subjectiveRating: { intelligibilityOriginal: 3, intelligibilityNormalized: 5 },
    });
    const devA2 = baseClip('a2', {
      name: 'USB-A-2',
      micDeviceId: 'usb-id-aaa',
      micDeviceLabel: 'Headset USB-A',
      evaluation: {
        ...evalCtx,
        speechStats: { ...evalCtx.speechStats, avgDb: -24, durationSec: 3.5 },
        estimatedSnr: { isMeasurable: true, snrDb: 34 },
      },
      subjectiveRating: { intelligibilityOriginal: null, intelligibilityNormalized: 4 },
    });
    // Third recording of same hardware but unmeasurable SNR -> SNR valid count n=2 while speechRms n=3!
    const devA3UnmeasurableSnr = baseClip('a3', {
      name: 'USB-A-3-unmeasurable',
      micDeviceId: 'usb-id-aaa',
      micDeviceLabel: 'Headset USB-A',
      evaluation: {
        ...evalCtx,
        speechStats: { ...evalCtx.speechStats, avgDb: -22, durationSec: 3.5 },
        estimatedSnr: { isMeasurable: false, unmeasurableReason: 'noise >= voice' },
      },
      subjectiveRating: { intelligibility: 4 }, // legacy unknown origin only!
    });
    // Same label as Headset USB-A, but DIFFERENT deviceId -> MUST NOT merge!
    const devB_diffId = baseClip('b1', {
      name: 'USB-B',
      micDeviceId: 'usb-id-bbb',
      micDeviceLabel: 'Headset USB-A',
    });
    // Generic ID ('default') + generic label ('マイクロホン') x2 -> MUST stay unidentified & separate!
    const generic1 = baseClip('g1', {
      name: 'Generic-1',
      micDeviceId: 'default',
      micDeviceLabel: 'マイクロホン',
      trackSettings: undefined,
    });
    const generic2 = baseClip('g2', {
      name: 'Generic-2',
      micDeviceId: 'default',
      micDeviceLabel: '標準マイクロホン',
      trackSettings: undefined,
    });

    assertEqual('Unidentified generic clip 1 is unidentified', resolveDeviceIdentity(generic1).identificationMethod, 'unidentified');
    assertTrue(
      'Two generic clips do not share deviceKey',
      resolveDeviceIdentity(generic1).deviceKey !== resolveDeviceIdentity(generic2).deviceKey
    );

    const groups = computeDeviceComparisonGroups([
      devA1,
      devA2,
      devA3UnmeasurableSnr,
      devB_diffId,
      generic1,
      generic2,
    ]);
    // Groups expected: 1 (devA x3) + 1 (devB x1) + 1 (g1 x1) + 1 (g2 x1) = 4 groups
    assertEqual('Conservative grouping creates 4 distinct groups (never merges diff IDs or generics)', groups.length, 4);
    assertEqual('Group 0 has clipCount 3', groups[0].clipCount, 3);
    assertEqual('Group 0 identificationMethod is deviceId_and_label', groups[0].identificationMethod, 'deviceId_and_label');

    // Descriptive stats check on devA group:
    // speechRms = [-20, -24, -22] -> count=3, mean=-22, min=-24, max=-20, stdDev=sqrt((4+4+0)/3)=1.633
    assertEqual('devA speechRms count = 3', groups[0].stats.speechRmsDbFS.count, 3);
    assertEqual('devA speechRms mean = -22', groups[0].stats.speechRmsDbFS.mean, -22);
    assertEqual('devA speechRms min = -24', groups[0].stats.speechRmsDbFS.min, -24);
    assertEqual('devA speechRms max = -20', groups[0].stats.speechRmsDbFS.max, -20);
    assertTrue('devA speechRms stdDev ~ 1.633', Math.abs((groups[0].stats.speechRmsDbFS.stdDev ?? 0) - 1.633) < 0.01);

    // broadbandSnr = [30, 34, unmeasurable] -> count=2, mean=32, min=30, max=34, stdDev=2
    assertEqual('devA broadbandSnr count = 2 (unmeasurable excluded)', groups[0].stats.broadbandSnrDb.count, 2);
    assertEqual('devA broadbandSnr mean = 32', groups[0].stats.broadbandSnrDb.mean, 32);
    assertEqual('devA broadbandSnr stdDev = 2', groups[0].stats.broadbandSnrDb.stdDev, 2);

    // subjectiveIntelligibilityOriginal: [3, null, (legacy 4 ignored)] -> count=1, mean=3, stdDev=0
    assertEqual('devA intelligibilityOriginal excludes null and legacy -> count=1', groups[0].stats.subjectiveIntelligibilityOriginal.count, 1);
    assertEqual('devA intelligibilityOriginal mean = 3', groups[0].stats.subjectiveIntelligibilityOriginal.mean, 3);
    assertEqual('devA intelligibilityNormalized count = 2 (5 and 4)', groups[0].stats.subjectiveIntelligibilityNormalized.count, 2);
    assertEqual('devA intelligibilityNormalized mean = 4.5', groups[0].stats.subjectiveIntelligibilityNormalized.mean, 4.5);
    assertEqual('devA legacyUnknownIntelligibilityCount = 1', groups[0].legacyUnknownIntelligibilityCount, 1);

    // NaN / Infinity / null direct filtering check in computeDescriptiveStats
    const weirdStats = computeDescriptiveStats([10, null, undefined, NaN, Infinity, -Infinity, 20], 'Hz', false);
    assertEqual('computeDescriptiveStats excludes null/undefined/NaN/Infinity', weirdStats.count, 2);
    assertEqual('computeDescriptiveStats mean on [10,20] = 15', weirdStats.mean, 15);
    const emptyStats = computeDescriptiveStats([null, NaN, Infinity], 'dB', true);
    assertEqual('All-invalid descriptive stats count = 0', emptyStats.count, 0);
    assertEqual('All-invalid descriptive stats mean = null', emptyStats.mean, null);

    // deviceComparisonToCsv and clipsToJson verify
    const devCsvRows = parseRfc4180Csv(deviceComparisonToCsv([devA1, devA2]));
    assertTrue('deviceComparisonToCsv produces header + 15 metric rows for 1 group', devCsvRows.length === 16);
    const jsonMulti = JSON.parse(clipsToJson([devA1, devA2, devA3UnmeasurableSnr]));
    assertEqual('JSON embeds 1 deviceComparisonGroup', jsonMulti.deviceComparisonGroups.length, 1);
    assertEqual('JSON legacy clip keeps intelligibility=4 without migrating original', jsonMulti.clips[2].subjectiveRating.intelligibility, 4);
    assertEqual('JSON legacy clip keeps intelligibilityOriginal=null', jsonMulti.clips[2].subjectiveRating.intelligibilityOriginal, null);

    // =========================================================================
    // 10. Clip Deletion Transition, Persistence Cleanup & Stats Recomputation
    // =========================================================================
    // 10a. Single-clip deletion -> list becomes empty, selectedClipId becomes null, storage cleared
    const delMemStorage = makeMemoryStorage();
    saveSubjectiveRatingToStorage(
      devA1.id,
      { intelligibilityOriginal: 4, intelligibilityNormalized: 5, notes: 'to delete' },
      delMemStorage
    );
    saveSubjectiveRatingToStorage(
      devA2.id,
      { intelligibilityOriginal: 3, notes: 'keep me' },
      delMemStorage
    );

    const singleDel = computeClipDeletionTransition([devA1], devA1.id, devA1.id);
    assertEqual('Single clip delete: deleted flag true', singleDel.deleted, true);
    assertEqual('Single clip delete: nextClips empty', singleDel.nextClips.length, 0);
    assertEqual('Single clip delete: nextSelectedClipId null', singleDel.nextSelectedClipId, null);

    const storageDelRes = removeSubjectiveRatingFromStorage(devA1.id, delMemStorage);
    assertEqual('Single clip delete: storage cleanup ok', storageDelRes.ok, true);
    // Simulate reload from storage
    const reloadedRatings = loadAllSubjectiveRatings(delMemStorage);
    assertEqual('Reload after delete: deleted clip rating absent', reloadedRatings[devA1.id], undefined);
    assertEqual('Reload after delete: unrelated clip rating preserved', reloadedRatings[devA2.id]?.intelligibilityOriginal, 3);

    // 10b. Multi-clip deletion (selected middle clip deleted -> remaining clips preserved, valid selection, stats updated)
    const multiInitial = [devA1, devA2, devA3UnmeasurableSnr];
    const multiDelSelected = computeClipDeletionTransition(multiInitial, devA2.id, devA2.id);
    assertEqual('Multi clip delete: remaining length = 2', multiDelSelected.nextClips.length, 2);
    assertEqual('Multi clip delete: remaining IDs intact [0]', multiDelSelected.nextClips[0].id, devA1.id);
    assertEqual('Multi clip delete: remaining IDs intact [1]', multiDelSelected.nextClips[1].id, devA3UnmeasurableSnr.id);
    assertTrue(
      'Multi clip delete: nextSelectedClipId points to a valid remaining clip',
      multiDelSelected.nextSelectedClipId !== null &&
        multiDelSelected.nextClips.some((c) => c.id === multiDelSelected.nextSelectedClipId)
    );

    // Device stats updated after deleting devA2 (speechRms was [-20, -24, -22] -> now [-20, -22], mean -21)
    const groupsAfterDelete = computeDeviceComparisonGroups(multiDelSelected.nextClips);
    assertEqual('Post-delete device group count = 1', groupsAfterDelete.length, 1);
    assertEqual('Post-delete device group clipCount = 2', groupsAfterDelete[0].clipCount, 2);
    assertEqual('Post-delete speechRms mean = -21', groupsAfterDelete[0].stats.speechRmsDbFS.mean, -21);

    // 10c. Deleting non-selected clip keeps currently selected clip unchanged
    const multiDelOther = computeClipDeletionTransition(multiInitial, devA3UnmeasurableSnr.id, devA1.id);
    assertEqual('Delete non-selected clip keeps selectedClipId', multiDelOther.nextSelectedClipId, devA3UnmeasurableSnr.id);
    assertEqual('Delete non-selected clip leaves 2 clips', multiDelOther.nextClips.length, 2);

    // 10d. Deleting nonexistent clipId safely no-ops without corrupting clips
    const missingDel = computeClipDeletionTransition(multiInitial, devA1.id, 'nonexistent-clip-id');
    assertEqual('Delete nonexistent clipId returns deleted=false', missingDel.deleted, false);
    assertEqual('Delete nonexistent clipId keeps clips length=3', missingDel.nextClips.length, 3);
    assertEqual('Delete nonexistent clipId keeps selectedClipId', missingDel.nextSelectedClipId, devA1.id);

    // 10e. Storage failure during delete returns ok=false cleanly without throwing
    const throwingStorage: Storage = {
      ...delMemStorage,
      get length() {
        return delMemStorage.length;
      },
      clear: () => delMemStorage.clear(),
      key: (i: number) => delMemStorage.key(i),
      getItem: (k: string) => delMemStorage.getItem(k),
      removeItem: (k: string) => delMemStorage.removeItem(k),
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    const failedStorageRes = removeSubjectiveRatingFromStorage(devA2.id, throwingStorage);
    assertEqual('Storage failure reports ok=false cleanly', failedStorageRes.ok, false);
    assertTrue('Storage failure reports error message', typeof failedStorageRes.error === 'string' && failedStorageRes.error.length > 0);
  }

  console.log('\n=== All Phase 2A, 2B-2A, 2B-2B & 2B-2D Verification Tests Passed! ===');
}

runVerificationFeatureTests();
