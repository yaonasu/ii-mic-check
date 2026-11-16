import {
  AudioSegment,
  DeviceComparisonGroup,
  MetricDescriptiveStats,
  RecordedClip,
  SubjectiveRating,
  SubjectiveScoreValue,
} from '../types/audio';
import { normalizeEvaluationCompatibility } from './audioDsp';
import {
  PROVISIONAL_SCORE_NOTICES,
  PROVISIONAL_SCORE_VERSION,
  computeProvisionalScore,
} from './provisionalScoring';

export const SUBJECTIVE_RATING_STORAGE_KEY = 'hcl_subjective_ratings_v1';

export type ActiveSubjectiveCriterionKey =
  | 'intelligibilityOriginal'
  | 'intelligibilityNormalized'
  | 'lowMuffleness'
  | 'lowBackgroundNoise';

export interface SubjectiveCriterionMeta {
  key: ActiveSubjectiveCriterionKey;
  label: string;
  shortLabel: string;
  description: string;
}

export const SUBJECTIVE_CRITERIA: SubjectiveCriterionMeta[] = [
  {
    key: 'intelligibilityOriginal',
    label: '聞き取りやすさ（原音）',
    shortLabel: '聞き取り(原音)',
    description: '原音量で再生した際の言葉の明瞭さ・聞き取りやすさ（5: 非常に明瞭 / 1: 聞き取りにくい）',
  },
  {
    key: 'intelligibilityNormalized',
    label: '聞き取りやすさ（正規化後）',
    shortLabel: '聞き取り(正規化)',
    description: '音量正規化で再生した際の言葉の明瞭さ・聞き取りやすさ（5: 非常に明瞭 / 1: 聞き取りにくい）',
  },
  {
    key: 'lowMuffleness',
    label: 'こもりの少なさ',
    shortLabel: 'こもり少',
    description: '低域の膨らみや鼻づまり感・こもりがないか（5: こもりなし / 1: 強いこもり）',
  },
  {
    key: 'lowBackgroundNoise',
    label: 'ノイズの少なさ',
    shortLabel: 'ノイズ少',
    description: 'サー音やファン音、環境雑音が気にならないか（5: ほぼ無音 / 1: 非常に目立つ）',
  },
];

const GENERIC_DEVICE_IDS = new Set(['', 'default', 'communications']);
const GENERIC_DEVICE_LABELS = new Set([
  '',
  'マイクロホン',
  '標準マイクロホン',
  'Unknown',
  'Default',
]);

function isGenericDeviceLabel(label: string): boolean {
  const trimmed = label.trim();
  if (GENERIC_DEVICE_LABELS.has(trimmed)) return true;
  if (/^マイク\s*\d+$/.test(trimmed)) return true;
  if (/^Microphone(\s*\d+)?$/i.test(trimmed)) return true;
  return false;
}

export function formatTrackBooleanSetting(value: boolean | undefined): string {
  if (value === true) return 'ON (true)';
  if (value === false) return 'OFF (false)';
  return '未記録';
}

export function formatTrackSettingsSummary(
  trackSettings?: RecordedClip['trackSettings']
): string {
  if (!trackSettings) return '未記録';
  const ec =
    trackSettings.echoCancellation === undefined
      ? '未記録'
      : trackSettings.echoCancellation
      ? 'ON'
      : 'OFF';
  const ns =
    trackSettings.noiseSuppression === undefined
      ? '未記録'
      : trackSettings.noiseSuppression
      ? 'ON'
      : 'OFF';
  const agc =
    trackSettings.autoGainControl === undefined
      ? '未記録'
      : trackSettings.autoGainControl
      ? 'ON'
      : 'OFF';
  return `EC:${ec} / NS:${ns} / AGC:${agc}`;
}

export function getSpeechSegments(clip: RecordedClip): AudioSegment[] {
  return (clip.evaluation?.segments || []).filter((s) => s.isSpeech);
}

export function isValidSubjectiveScore(val: unknown): val is SubjectiveScoreValue {
  return typeof val === 'number' && Number.isInteger(val) && val >= 1 && val <= 5;
}

export function hasLegacyUnknownSubjectiveRating(
  rating: SubjectiveRating | undefined
): boolean {
  if (!rating) return false;
  return (
    isValidSubjectiveScore(rating.intelligibility) ||
    isValidSubjectiveScore(rating.naturalness) ||
    isValidSubjectiveScore(rating.noDropoutOrSuppression)
  );
}

/**
 * Normalize a SubjectiveRating object.
 * - Unrated active criteria are explicitly stored as `null` (never undefined when rated object exists).
 * - Legacy fields (`intelligibility`, `naturalness`, `noDropoutOrSuppression`) are preserved read-only
 *   without ever migrating `intelligibility` into `intelligibilityOriginal` or `intelligibilityNormalized`.
 * - Returns `undefined` when all active criteria are `null`, no legacy scores exist, and trimmed notes are empty.
 */
export function normalizeSubjectiveRating(
  rating: SubjectiveRating | undefined
): SubjectiveRating | undefined {
  if (!rating) return undefined;

  const intelligibilityOriginal = isValidSubjectiveScore(rating.intelligibilityOriginal)
    ? rating.intelligibilityOriginal
    : null;
  const intelligibilityNormalized = isValidSubjectiveScore(rating.intelligibilityNormalized)
    ? rating.intelligibilityNormalized
    : null;
  const lowMuffleness = isValidSubjectiveScore(rating.lowMuffleness)
    ? rating.lowMuffleness
    : null;
  const lowBackgroundNoise = isValidSubjectiveScore(rating.lowBackgroundNoise)
    ? rating.lowBackgroundNoise
    : null;

  const rawNotes = typeof rating.notes === 'string' && rating.notes.trim().length > 0 ? rating.notes : null;

  const hasActiveScore =
    intelligibilityOriginal !== null ||
    intelligibilityNormalized !== null ||
    lowMuffleness !== null ||
    lowBackgroundNoise !== null;

  const hasLegacyIntelligibility = isValidSubjectiveScore(rating.intelligibility);
  const hasLegacyNaturalness = isValidSubjectiveScore(rating.naturalness);
  const hasLegacyNoDropout = isValidSubjectiveScore(rating.noDropoutOrSuppression);
  const hasLegacy = hasLegacyIntelligibility || hasLegacyNaturalness || hasLegacyNoDropout;

  if (!hasActiveScore && !hasLegacy && rawNotes === null) {
    return undefined;
  }

  const cleaned: SubjectiveRating = {
    intelligibilityOriginal,
    intelligibilityNormalized,
    lowMuffleness,
    lowBackgroundNoise,
    notes: rawNotes,
    updatedAt: rating.updatedAt || new Date().toISOString(),
  };

  if (hasLegacyIntelligibility) {
    cleaned.intelligibility = rating.intelligibility;
  }
  if (hasLegacyNaturalness) {
    cleaned.naturalness = rating.naturalness;
  }
  if (hasLegacyNoDropout) {
    cleaned.noDropoutOrSuppression = rating.noDropoutOrSuppression;
  }

  return cleaned;
}

export function getSubjectiveRatingStatus(rating: SubjectiveRating | undefined): {
  statusLabel: '未評価' | '一部評価' | '評価済';
  ratedCount: number;
  totalCount: number;
  averageScore?: number;
  hasLegacyUnknown: boolean;
} {
  const totalCount = SUBJECTIVE_CRITERIA.length;
  if (!rating) {
    return { statusLabel: '未評価', ratedCount: 0, totalCount, hasLegacyUnknown: false };
  }

  const values: number[] = [];
  for (const c of SUBJECTIVE_CRITERIA) {
    const v = rating[c.key];
    if (isValidSubjectiveScore(v)) {
      values.push(v);
    }
  }

  const ratedCount = values.length;
  const hasNotes = typeof rating.notes === 'string' && rating.notes.trim().length > 0;
  const hasLegacyUnknown = isValidSubjectiveScore(rating.intelligibility);
  const hasAnyLegacy = hasLegacyUnknownSubjectiveRating(rating);

  if (ratedCount === 0 && !hasNotes && !hasAnyLegacy) {
    return { statusLabel: '未評価', ratedCount: 0, totalCount, hasLegacyUnknown: false };
  }

  const averageScore =
    ratedCount > 0
      ? Number((values.reduce((acc, n) => acc + n, 0) / ratedCount).toFixed(1))
      : undefined;

  if (ratedCount === totalCount) {
    return { statusLabel: '評価済', ratedCount, totalCount, averageScore, hasLegacyUnknown };
  }

  return { statusLabel: '一部評価', ratedCount, totalCount, averageScore, hasLegacyUnknown };
}

export function formatSubjectiveRatingSummary(
  rating: SubjectiveRating | undefined
): string {
  const status = getSubjectiveRatingStatus(rating);
  if (status.statusLabel === '未評価') return '未評価';
  if (status.ratedCount === 0 && status.hasLegacyUnknown) {
    return '一部評価 (旧形式・種別不明あり)';
  }
  const avgText = status.averageScore !== undefined ? `平均 ${status.averageScore}/5` : 'メモのみ';
  const legacySuffix = status.hasLegacyUnknown ? '・旧形式保持' : '';
  return `${status.statusLabel} (${status.ratedCount}/${status.totalCount}項目・${avgText}${legacySuffix})`;
}

function getSafeLocalStorage(customStorage?: Storage): Storage | undefined {
  if (customStorage) return customStorage;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function loadAllSubjectiveRatings(
  customStorage?: Storage
): Record<string, SubjectiveRating> {
  const storage = getSafeLocalStorage(customStorage);
  if (!storage) return {};
  try {
    const raw = storage.getItem(SUBJECTIVE_RATING_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const result: Record<string, SubjectiveRating> = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (value && typeof value === 'object') {
        const normalized = normalizeSubjectiveRating(value as SubjectiveRating);
        if (normalized) {
          result[id] = normalized;
        }
      }
    }
    return result;
  } catch {
    return {};
  }
}

export function saveSubjectiveRatingToStorage(
  clipId: string,
  rating: SubjectiveRating | undefined,
  customStorage?: Storage
): void {
  const storage = getSafeLocalStorage(customStorage);
  if (!storage || !clipId) return;
  try {
    const map = loadAllSubjectiveRatings(storage);
    const normalized = normalizeSubjectiveRating(rating);
    if (normalized) {
      map[clipId] = normalized;
    } else {
      delete map[clipId];
    }
    storage.setItem(SUBJECTIVE_RATING_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignore quota / security errors cleanly
  }
}

export function loadSubjectiveRatingFromStorage(
  clipId: string,
  customStorage?: Storage
): SubjectiveRating | undefined {
  if (!clipId) return undefined;
  const map = loadAllSubjectiveRatings(customStorage);
  return map[clipId];
}

export function removeSubjectiveRatingFromStorage(
  clipId: string,
  customStorage?: Storage
): { ok: boolean; error?: string } {
  const storage = getSafeLocalStorage(customStorage);
  if (!storage || !clipId) {
    return { ok: true };
  }
  try {
    const map = loadAllSubjectiveRatings(storage);
    if (clipId in map) {
      delete map[clipId];
      storage.setItem(SUBJECTIVE_RATING_STORAGE_KEY, JSON.stringify(map));
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'storage_error',
    };
  }
}

export interface ClipDeletionTransitionResult {
  nextClips: RecordedClip[];
  nextSelectedClipId: string | null;
  deletedClip: RecordedClip | null;
  deleted: boolean;
}

export function computeClipDeletionTransition(
  clips: RecordedClip[],
  selectedClipId: string | null,
  targetClipId: string
): ClipDeletionTransitionResult {
  if (!targetClipId) {
    const validSelectedId =
      selectedClipId && clips.some((c) => c.id === selectedClipId)
        ? selectedClipId
        : clips.length > 0
        ? clips[clips.length - 1].id
        : null;
    return {
      nextClips: clips,
      nextSelectedClipId: validSelectedId,
      deletedClip: null,
      deleted: false,
    };
  }

  const targetIndex = clips.findIndex((c) => c.id === targetClipId);
  if (targetIndex === -1) {
    const validSelectedId =
      selectedClipId && clips.some((c) => c.id === selectedClipId)
        ? selectedClipId
        : clips.length > 0
        ? clips[clips.length - 1].id
        : null;
    return {
      nextClips: clips,
      nextSelectedClipId: validSelectedId,
      deletedClip: null,
      deleted: false,
    };
  }

  const deletedClip = clips[targetIndex];
  const nextClips = clips.filter((c) => c.id !== targetClipId);

  let nextSelectedClipId: string | null = null;
  if (nextClips.length > 0) {
    if (
      selectedClipId &&
      selectedClipId !== targetClipId &&
      nextClips.some((c) => c.id === selectedClipId)
    ) {
      nextSelectedClipId = selectedClipId;
    } else {
      const fallbackIdx = Math.min(targetIndex, nextClips.length - 1);
      nextSelectedClipId = nextClips[fallbackIdx].id;
    }
  }

  return {
    nextClips,
    nextSelectedClipId,
    deletedClip,
    deleted: true,
  };
}

/**
 * Resolve conservative device identity from a recorded clip.
 * Never falsely merges clips when deviceId is missing/generic ('default', 'communications')
 * and label is generic ('マイクロホン', '標準マイクロホン', etc.).
 */
export function resolveDeviceIdentity(clip: RecordedClip): {
  deviceKey: string;
  deviceLabel: string;
  deviceId: string | null;
  identificationMethod: 'deviceId_and_label' | 'label_only_no_deviceId' | 'unidentified';
  identificationNote: string;
} {
  const rawId = (clip.micDeviceId || clip.trackSettings?.deviceId || '').trim();
  const rawLabel = (clip.micDeviceLabel || '').trim();
  const isSpecificId = rawId.length > 0 && !GENERIC_DEVICE_IDS.has(rawId);
  const isSpecificLabel = rawLabel.length > 0 && !isGenericDeviceLabel(rawLabel);

  if (isSpecificId) {
    const deviceKey = isSpecificLabel ? `id:${rawId}::label:${rawLabel}` : `id:${rawId}`;
    return {
      deviceKey,
      deviceLabel: rawLabel || `デバイス (${rawId.slice(0, 8)})`,
      deviceId: rawId,
      identificationMethod: 'deviceId_and_label',
      identificationNote: isSpecificLabel
        ? 'deviceId とデバイス名の両方で同一機器として識別しました。'
        : '固有 deviceId で識別しました（機器名は汎用表記）。',
    };
  }

  if (isSpecificLabel) {
    const idKindToken = rawId || 'no_id';
    return {
      deviceKey: `label:${idKindToken}:${rawLabel}`,
      deviceLabel: rawLabel,
      deviceId: rawId || null,
      identificationMethod: 'label_only_no_deviceId',
      identificationNote:
        '固有 deviceId が未取得（または default/communications）のため、機器名と識別子種別の一致で集計しています。',
    };
  }

  return {
    deviceKey: `unidentified:${clip.id}`,
    deviceLabel: rawLabel || '識別不能デバイス',
    deviceId: rawId || null,
    identificationMethod: 'unidentified',
    identificationNote:
      '固有 deviceId・固有機器名の双方が得られないため、他録音と統合せず単独レコードとして扱います。',
  };
}

/**
 * Compute descriptive statistics (`count`, `mean`, `min`, `max`, population `stdDev`)
 * across strictly valid finite numbers only.
 */
export function computeDescriptiveStats(
  values: Array<number | null | undefined>,
  unit: string,
  isDbScale: boolean
): MetricDescriptiveStats {
  const valid = values.filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v)
  );
  const count = valid.length;
  if (count === 0) {
    return {
      count: 0,
      mean: null,
      min: null,
      max: null,
      stdDev: null,
      stdDevMethod: 'population',
      unit,
      isDbScale,
    };
  }

  let sum = 0;
  let min = valid[0];
  let max = valid[0];
  for (const v of valid) {
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const mean = sum / count;

  let sumSqDiff = 0;
  for (const v of valid) {
    const diff = v - mean;
    sumSqDiff += diff * diff;
  }
  const stdDev = count === 1 ? 0 : Math.sqrt(sumSqDiff / count);

  const round3 = (n: number) => Number(n.toFixed(3));
  return {
    count,
    mean: round3(mean),
    min: round3(min),
    max: round3(max),
    stdDev: round3(stdDev),
    stdDevMethod: 'population',
    unit,
    isDbScale,
  };
}

/**
 * Group recordings conservatively by device and calculate descriptive statistics for comparison.
 * NOTE: Descriptive stats on dB metrics represent spread of recorded values, not linear power averages.
 */
export function computeDeviceComparisonGroups(
  clips: RecordedClip[]
): DeviceComparisonGroup[] {
  const bucketMap = new Map<
    string,
    {
      identity: ReturnType<typeof resolveDeviceIdentity>;
      clips: RecordedClip[];
    }
  >();

  for (const clip of clips) {
    const identity = resolveDeviceIdentity(clip);
    const existing = bucketMap.get(identity.deviceKey);
    if (existing) {
      existing.clips.push(clip);
    } else {
      bucketMap.set(identity.deviceKey, { identity, clips: [clip] });
    }
  }

  const groups: DeviceComparisonGroup[] = [];
  for (const { identity, clips: groupClips } of bucketMap.values()) {
    const evals = groupClips.map((c) =>
      c.evaluation ? normalizeEvaluationCompatibility(c.evaluation) : c.evaluation
    );

    const speechRmsValues = evals.map((ev) =>
      ev && ev.speechStats && ev.speechStats.durationSec > 0 ? ev.speechStats.avgDb : null
    );
    const noiseRmsValues = evals.map((ev) =>
      ev && (ev.noiseAnalysis || (ev.noiseStats && ev.noiseStats.durationSec > 0))
        ? ev.noiseAnalysis?.representativeNoiseDbFS ?? ev.noiseStats.avgDb
        : null
    );
    const broadbandSnrValues = evals.map((ev) =>
      ev?.estimatedSnr?.isMeasurable ? ev.estimatedSnr.snrDb ?? null : null
    );
    const speechBandSnrValues = evals.map((ev) =>
      ev?.extendedMetrics?.speechBandSnr?.isMeasurable
        ? ev.extendedMetrics.speechBandSnr.snrDb
        : null
    );
    const psdLowCoreValues = evals.map((ev) => {
      const bc = ev?.extendedMetrics?.bandEnergyComparison;
      return bc && bc.bands.low_120_300.isMeasurable && bc.bands.core_300_1000.isMeasurable
        ? bc.ratios.lowToCoreDb
        : null;
    });
    const psdClarityCoreValues = evals.map((ev) => {
      const bc = ev?.extendedMetrics?.bandEnergyComparison;
      return bc && bc.bands.clarity_1500_4200.isMeasurable && bc.bands.core_300_1000.isMeasurable
        ? bc.ratios.clarityToCoreDb
        : null;
    });
    const psdHighClarityValues = evals.map((ev) => {
      const bc = ev?.extendedMetrics?.bandEnergyComparison;
      return bc && bc.bands.high_4200_8000.isMeasurable && bc.bands.clarity_1500_4200.isMeasurable
        ? bc.ratios.highToClarityDb
        : null;
    });
    const speechIqrValues = evals.map((ev) =>
      ev?.extendedMetrics?.speechLevelVariability?.isMeasurable
        ? ev.extendedMetrics.speechLevelVariability.iqrDb
        : null
    );
    const flatnessValues = evals.map((ev) =>
      ev?.extendedMetrics?.spectralFlatness?.isMeasurable
        ? ev.extendedMetrics.spectralFlatness.median
        : null
    );
    const rolloff20_8000Values = evals.map((ev) =>
      ev?.extendedMetrics?.highFreqRolloff?.isMeasurable
        ? ev.extendedMetrics.highFreqRolloff.rolloff95Hz
        : null
    );
    const rolloff300_8000Values = evals.map((ev) =>
      ev?.extendedMetrics?.highFreqRolloff?.rolloff95SpeechBandHz ?? null
    );

    const subjOrigValues = groupClips.map((c) =>
      isValidSubjectiveScore(c.subjectiveRating?.intelligibilityOriginal)
        ? c.subjectiveRating!.intelligibilityOriginal
        : null
    );
    const subjNormValues = groupClips.map((c) =>
      isValidSubjectiveScore(c.subjectiveRating?.intelligibilityNormalized)
        ? c.subjectiveRating!.intelligibilityNormalized
        : null
    );
    const subjMuffleValues = groupClips.map((c) =>
      isValidSubjectiveScore(c.subjectiveRating?.lowMuffleness)
        ? c.subjectiveRating!.lowMuffleness
        : null
    );
    const subjNoiseValues = groupClips.map((c) =>
      isValidSubjectiveScore(c.subjectiveRating?.lowBackgroundNoise)
        ? c.subjectiveRating!.lowBackgroundNoise
        : null
    );
    const legacyUnknownIntelligibilityCount = groupClips.filter((c) =>
      isValidSubjectiveScore(c.subjectiveRating?.intelligibility)
    ).length;

    groups.push({
      deviceKey: identity.deviceKey,
      deviceLabel: identity.deviceLabel,
      deviceId: identity.deviceId,
      identificationMethod: identity.identificationMethod,
      identificationNote: identity.identificationNote,
      clipCount: groupClips.length,
      clipIds: groupClips.map((c) => c.id),
      clipNames: groupClips.map((c, idx) => c.name || `記録 #${idx + 1}`),
      stats: {
        speechRmsDbFS: computeDescriptiveStats(speechRmsValues, 'dBFS', true),
        noiseRmsDbFS: computeDescriptiveStats(noiseRmsValues, 'dBFS', true),
        broadbandSnrDb: computeDescriptiveStats(broadbandSnrValues, 'dB', true),
        speechBandSnrDb: computeDescriptiveStats(speechBandSnrValues, 'dB', true),
        psdRatioLowToCoreDb: computeDescriptiveStats(psdLowCoreValues, 'dB', true),
        psdRatioClarityToCoreDb: computeDescriptiveStats(psdClarityCoreValues, 'dB', true),
        psdRatioHighToClarityDb: computeDescriptiveStats(psdHighClarityValues, 'dB', true),
        speechLevelIqrDb: computeDescriptiveStats(speechIqrValues, 'dB', true),
        spectralFlatnessMedian: computeDescriptiveStats(flatnessValues, 'ratio', false),
        rolloff95Hz_20_8000: computeDescriptiveStats(rolloff20_8000Values, 'Hz', false),
        rolloff95Hz_300_8000: computeDescriptiveStats(rolloff300_8000Values, 'Hz', false),
        subjectiveIntelligibilityOriginal: computeDescriptiveStats(subjOrigValues, 'score_1_to_5', false),
        subjectiveIntelligibilityNormalized: computeDescriptiveStats(subjNormValues, 'score_1_to_5', false),
        subjectiveLowMuffleness: computeDescriptiveStats(subjMuffleValues, 'score_1_to_5', false),
        subjectiveLowBackgroundNoise: computeDescriptiveStats(subjNoiseValues, 'score_1_to_5', false),
      },
      legacyUnknownIntelligibilityCount,
    });
  }

  return groups;
}

/**
 * Format plain-text diagnostic log for clipboard export and inspection.
 * Missing fields on legacy/partial clips strictly render as "未記録".
 */
export function formatDiagnosticLogText(clip: RecordedClip): string {
  const ev = clip.evaluation;
  const v = ev?.verificationInfo;
  const ts = ev?.timestamps;
  const tsTrack = clip.trackSettings;
  const speechSegments = getSpeechSegments(clip);

  const recordedAtStr = clip.recordedAt
    ? new Date(clip.recordedAt).toLocaleString('ja-JP')
    : '未記録';

  const modeStr =
    clip.recordingMode === 'eval_with_reference'
      ? '基準音源再生（旧記録）'
      : clip.recordingMode === 'eval_with_voice'
      ? '自分の声でマイクを評価'
      : '未記録';

  const stopFlushDiffMs =
    typeof ts?.recorderStopCallTimeMs === 'number' && typeof ts?.recorderOnStopTimeMs === 'number'
      ? `${(ts.recorderOnStopTimeMs - ts.recorderStopCallTimeMs).toFixed(1)} ms`
      : '未記録';

  const formatNumOrUnrecorded = (
    val: number | undefined,
    unit: string,
    digits = 3,
    signed = false
  ): string => {
    if (typeof val !== 'number' || !Number.isFinite(val)) return '未記録';
    const sign = signed && val > 0 ? '+' : '';
    return `${sign}${val.toFixed(digits)} ${unit}`;
  };

  const clockLabelMap: Record<string, string> = {
    audioContext: 'AudioContext (ハードウェアクロック)',
    performanceNow: 'performance.now (経過時間クロック)',
    fallbackDefault: 'デフォルト固定値 (タイムスタンプ未取得)',
  };

  const lines: string[] = [
    '=== ii-mic-check（マイク音質チェッカー）実機検証用診断ログ ===',
    `記録名: ${clip.name || clip.id}`,
    `記録日時: ${recordedAtStr}`,
    `録音機器: ${clip.micDeviceLabel || '未記録'}`,
    `機器deviceId: ${clip.micDeviceId || tsTrack?.deviceId || '未記録'}`,
    `録音モード: ${modeStr}`,
    `解析バージョン: ${ev?.algoVersion || '未記録'}`,
    '',
    '[1. デバイス実設定 (track.getSettings)]',
    `  echoCancellation (EC): ${formatTrackBooleanSetting(tsTrack?.echoCancellation)}`,
    `  noiseSuppression (NS): ${formatTrackBooleanSetting(tsTrack?.noiseSuppression)}`,
    `  autoGainControl (AGC): ${formatTrackBooleanSetting(tsTrack?.autoGainControl)}`,
    `  track.sampleRate: ${
      typeof tsTrack?.sampleRate === 'number' ? `${tsTrack.sampleRate} Hz` : '未記録'
    }`,
    `  track.channelCount: ${
      typeof tsTrack?.channelCount === 'number' ? `${tsTrack.channelCount} ch` : '未記録'
    }`,
    `  Decoded AudioBuffer sampleRate: ${
      typeof clip.sampleRate === 'number' ? `${clip.sampleRate} Hz` : '未記録'
    }`,
    '',
    '[2. 録音時間・クロック時間差]',
    `  AudioBuffer長: ${formatNumOrUnrecorded(v?.bufferDurationSec, '秒', 3)}`,
    `  performance.now経過長: ${formatNumOrUnrecorded(v?.wallDurationSec, '秒', 3)}`,
    `  AudioContext経過長: ${formatNumOrUnrecorded(v?.audioCtxDurationSec, '秒', 3)}`,
    `  時間差 (AudioBuffer - performance.now): ${formatNumOrUnrecorded(
      v?.bufferVsWallDiffMs,
      'ms',
      0,
      true
    )}`,
    `  時間差 (AudioBuffer - AudioContext): ${formatNumOrUnrecorded(
      v?.bufferVsAudioCtxDiffMs,
      'ms',
      0,
      true
    )}`,
    `  MediaRecorder.start() → onstart遅延: ${formatNumOrUnrecorded(
      v?.recorderStartToOnstartMs ?? ts?.recorderStartToOnstartMs,
      'ms',
      1
    )}`,
    `  recorder.stop() → onstop確定遅延: ${stopFlushDiffMs}`,
    '',
    '[3. 解析フェーズ境界位置]',
    `  使用クロック種別: ${v ? clockLabelMap[v.clockSourceUsed] || v.clockSourceUsed : '未記録'}`,
    `  事前暗騒音終了 (preNoiseEnd): ${formatNumOrUnrecorded(v?.preNoiseEndSec, '秒', 3)}`,
    `  発声候補開始 (speechStart): ${formatNumOrUnrecorded(v?.speechStartSec, '秒', 3)}`,
    `  発声候補終了 (speechEnd): ${formatNumOrUnrecorded(v?.speechEndSec, '秒', 3)}`,
    `  事後暗騒音開始 (postNoiseStart, 300ms除外後): ${formatNumOrUnrecorded(
      v?.postNoiseStartSec,
      '秒',
      3
    )}`,
    `  事後暗騒音終了 (postNoiseEnd): ${formatNumOrUnrecorded(v?.postNoiseEndSec, '秒', 3)}`,
    '',
    `[4. VAD検出区間 (${speechSegments.length}区間 / 合計 ${
      typeof ev?.speechStats?.durationSec === 'number' ? `${ev.speechStats.durationSec.toFixed(1)}秒` : '未記録'
    })]`,
  ];

  if (speechSegments.length === 0) {
    lines.push('  検出された発声区間なし');
  } else {
    speechSegments.forEach((seg, idx) => {
      lines.push(
        `  #${idx + 1}: ${seg.startTime.toFixed(2)}s 〜 ${seg.endTime.toFixed(2)}s (長さ ${(
          seg.endTime - seg.startTime
        ).toFixed(2)}s / 平均 ${seg.avgDb.toFixed(1)} dBFS / 30ms窓最大 ${seg.maxDb.toFixed(1)} dBFS)`
      );
    });
  }

  lines.push('');
  lines.push('[5. 発声中ポーズの参考ノイズ値]');
  lines.push(
    `  intraSpeechPauseNoiseDbFS: ${
      typeof ev?.noiseAnalysis?.intraSpeechPauseNoiseDbFS === 'number'
        ? `${ev.noiseAnalysis.intraSpeechPauseNoiseDbFS.toFixed(1)} dBFS`
        : '未記録'
    }`
  );

  return lines.join('\n');
}

/**
 * RFC 4180 compliant CSV cell escaping (preserves internal newlines inside quotes).
 */
export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

const CSV_HEADERS = [
  '記録名',
  '記録日時',
  'マイク機器',
  '録音モード',
  'EC実設定',
  'NS実設定',
  'AGC実設定',
  'トラックSampleRate_Hz',
  'トラックChannelCount',
  'BufferSampleRate_Hz',
  '録音長_秒',
  '解析バージョン',
  '測定ステータス',
  '発声時間_秒',
  '発声音量平均_dBFS',
  '発声音量30ms窓最大RMS_dBFS',
  '適正範囲割合_pct',
  '事前ノイズ_dBFS',
  '事後ノイズ_dBFS',
  '定常暗騒音_dBFS',
  '発声中ポーズ参考ノイズ_dBFS',
  '推定SN比_dB',
  'SN比測定可否',
  '帯域比_dB',
  '帯域_超低域120Hz未満_pct',
  '帯域_低域120_300Hz_pct',
  '帯域_中核300_1500Hz_pct',
  '帯域_明瞭1500_4200Hz_pct',
  '帯域_高域4200_10000Hz_pct',
  'スペクトル重心_Hz',
  'サンプルピーク_dBFS',
  'クリッピング兆候',
  'クリッピング率_pct',
  '境界クロック種別',
  'start_onstart遅延_ms',
  'AudioBuffer長_秒',
  'Wall長_秒',
  'AudioCtx長_秒',
  'Buffer_Wall差_ms',
  'Buffer_AudioCtx差_ms',
  'preNoiseEnd_秒',
  'speechStart_秒',
  'speechEnd_秒',
  'postNoiseStart_秒',
  'postNoiseEnd_秒',
  'VAD検出発声区間',
  '聴感評価ステータス',
  '聴感_声の自然さ',
  '聴感_聞き取りやすさ',
  '聴感_こもりの少なさ',
  '聴感_背景ノイズの少なさ',
  '聴感_音切れ不自然抑制の少なさ',
  '聴感_自由記述メモ',
  // Phase 2B-2B Extended Objective Metrics (indices 53..68, keeping 69 columns intact)
  '音声帯域内SN比_300_4200Hz_dB',
  '全帯域と帯域内SN比差_dB',
  '音声帯域内SN比状態',
  '高域ロールオフ95pct_Hz',
  '高域1500_4200Hz_dBFS',
  '高域4200_8000Hz_dBFS',
  '高域減衰比_4200_8000対1500_4200_dB',
  '帯域PSD比_低域120_300対声の芯300_1000_dB',
  '帯域PSD比_明瞭1500_4200対声の芯300_1000_dB',
  '帯域PSD比_高域4200_8000対明瞭1500_4200_dB',
  '発声内音量変動IQR_dB',
  '発声内音量中央値_dBFS',
  '発声内音量範囲_dB',
  'スペクトル平坦度中央値_300_4200Hz',
  'スペクトル平坦度平均_300_4200Hz',
  'スペクトル平坦度IQR_300_4200Hz',
  // Phase 2B-2D Appended Columns (indices 69..77, total 78 columns)
  'マイクDeviceId',
  '同一機器識別キー',
  '同一機器録音数',
  '聴感_聞き取りやすさ_原音',
  '聴感_聞き取りやすさ_正規化後',
  '高域ロールオフ95pct_300_8000Hz',
  '解析サンプルレート_Hz',
  '解析FFT点数',
  '解析FFTホップ',
  // Phase 2C Provisional 100-Point Score Appended Columns (indices 78..88, total 89 columns)
  '暫定総合スコア_100点満点',
  '暫定区分',
  '採点ステータス',
  '採点バージョン',
  '入力音量スコア_20点',
  'ノイズ性能スコア_35点',
  '周波数特性スコア_25点',
  '音声安定性スコア_20点',
  '採点使用指標',
  '採点不能項目',
  '暫定評価およびWeb会議DSP注意書き',
];

function formatCsvTrackBool(val: boolean | undefined): string {
  if (val === true) return 'true';
  if (val === false) return 'false';
  return '未記録';
}

/**
 * Serialize clips into UTF-8 BOM CSV for cross-comparison in Excel / spreadsheets.
 */
export function clipsToCsv(clips: RecordedClip[]): string {
  const rows: string[] = [CSV_HEADERS.map(escapeCsvCell).join(',')];
  const groups = computeDeviceComparisonGroups(clips);
  const groupByClipId = new Map<string, DeviceComparisonGroup>();
  for (const g of groups) {
    for (const id of g.clipIds) {
      groupByClipId.set(id, g);
    }
  }

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const ev = clip.evaluation ? normalizeEvaluationCompatibility(clip.evaluation) : clip.evaluation;
    const v = ev?.verificationInfo;
    const tsTrack = clip.trackSettings;
    const speechSegs = getSpeechSegments(clip);
    const subj = clip.subjectiveRating;
    const subjStatus = getSubjectiveRatingStatus(subj);
    const devGroup = groupByClipId.get(clip.id);
    const identity = resolveDeviceIdentity(clip);

    const modeStr =
      clip.recordingMode === 'eval_with_reference'
        ? '基準音源再生（旧記録）'
        : clip.recordingMode === 'eval_with_voice'
        ? '自分の声でマイクを評価'
        : '未記録';

    const vadSegText =
      speechSegs.length > 0
        ? speechSegs
            .map((s) => `${s.startTime.toFixed(2)}-${s.endTime.toFixed(2)}s`)
            .join('; ')
        : '検出なし';

    const ext = ev?.extendedMetrics;
    const rolloffSpeechVal = ext?.highFreqRolloff?.rolloff95SpeechBandHz;

    const row = [
      clip.name || `記録 #${i + 1}`,
      clip.recordedAt ? new Date(clip.recordedAt).toISOString() : '',
      clip.micDeviceLabel || '',
      modeStr,
      formatCsvTrackBool(tsTrack?.echoCancellation),
      formatCsvTrackBool(tsTrack?.noiseSuppression),
      formatCsvTrackBool(tsTrack?.autoGainControl),
      tsTrack?.sampleRate ?? '未記録',
      tsTrack?.channelCount ?? '未記録',
      clip.sampleRate ?? '',
      typeof clip.duration === 'number' ? clip.duration.toFixed(3) : '',
      ev?.algoVersion || '',
      ev?.isMeasurable === false ? '要件未達' : ev?.overallGradeText || '保留',
      ev?.speechStats?.durationSec ?? '',
      ev?.speechStats?.avgDb ?? '',
      ev?.speechStats?.maxDb ?? '',
      ev?.speechStats?.appropriateRatioPercent ?? '',
      ev?.noiseAnalysis?.preNoiseDbFS ?? '',
      ev?.noiseAnalysis?.postNoiseDbFS ?? '',
      ev?.noiseAnalysis?.representativeNoiseDbFS ?? ev?.noiseStats?.avgDb ?? '',
      ev?.noiseAnalysis?.intraSpeechPauseNoiseDbFS ?? '未記録',
      ev?.estimatedSnr?.isMeasurable ? ev.estimatedSnr.snrDb ?? '' : '',
      ev?.estimatedSnr?.isMeasurable ? '可' : '不能',
      ev?.bandRatio?.ratioDb ?? '',
      ev?.frequencyBalance?.subBassRumble ?? '',
      ev?.frequencyBalance?.vocalLowBoom ?? '',
      ev?.frequencyBalance?.vocalCore ?? '',
      ev?.frequencyBalance?.vocalClarity ?? '',
      ev?.frequencyBalance?.airAndHiss ?? '',
      ev?.spectralCentroidHz ?? '',
      typeof ev?.clippingDetails?.peakDbFS === 'number'
        ? ev.clippingDetails.peakDbFS.toFixed(1)
        : '',
      (ev?.clippingDetails?.hasClippingSign ?? ev?.clippingDetected) ? 'あり' : 'なし',
      ev?.clippingDetails?.clippingRatioPercent ?? '',
      v?.clockSourceUsed ?? '未記録',
      v?.recorderStartToOnstartMs ?? ev?.timestamps?.recorderStartToOnstartMs ?? '未記録',
      v?.bufferDurationSec ?? '未記録',
      v?.wallDurationSec ?? '未記録',
      v?.audioCtxDurationSec ?? '未記録',
      v?.bufferVsWallDiffMs ?? '未記録',
      v?.bufferVsAudioCtxDiffMs ?? '未記録',
      v?.preNoiseEndSec ?? '未記録',
      v?.speechStartSec ?? '未記録',
      v?.speechEndSec ?? '未記録',
      v?.postNoiseStartSec ?? '未記録',
      v?.postNoiseEndSec ?? '未記録',
      vadSegText,
      subjStatus.statusLabel,
      isValidSubjectiveScore(subj?.naturalness) ? subj!.naturalness : '',
      // Column 48 keeps strictly legacy intelligibility (never mixed with original/normalized)
      isValidSubjectiveScore(subj?.intelligibility) ? subj!.intelligibility : '',
      isValidSubjectiveScore(subj?.lowMuffleness) ? subj!.lowMuffleness : '未評価',
      isValidSubjectiveScore(subj?.lowBackgroundNoise) ? subj!.lowBackgroundNoise : '未評価',
      isValidSubjectiveScore(subj?.noDropoutOrSuppression) ? subj!.noDropoutOrSuppression : '',
      subj?.notes ?? '',
      ...(() => {
        if (!ext) {
          return Array(16).fill('未解析');
        }
        const numOrUnmeasurable = (
          ok: boolean,
          val: number | null | undefined,
          digits = 1
        ): string =>
          ok && typeof val === 'number' && Number.isFinite(val) ? val.toFixed(digits) : '測定不能';

        const snrBand = ext.speechBandSnr;
        const rolloff = ext.highFreqRolloff;
        const bandCmp = ext.bandEnergyComparison;
        const lvlVar = ext.speechLevelVariability;
        const flat = ext.spectralFlatness;

        const snrState =
          snrBand.status === 'measurable'
            ? '測定可'
            : snrBand.status === 'reference_nyquist'
            ? '参考値(帯域制限)'
            : '測定不能';

        const flatIqr =
          flat.isMeasurable && flat.p75 !== null && flat.p25 !== null
            ? Number((flat.p75 - flat.p25).toFixed(3))
            : null;

        return [
          numOrUnmeasurable(snrBand.isMeasurable, snrBand.snrDb, 1),
          numOrUnmeasurable(snrBand.isMeasurable && snrBand.broadbandDiffDb !== null, snrBand.broadbandDiffDb, 1),
          snrState,
          numOrUnmeasurable(rolloff.isMeasurable, rolloff.rolloff95Hz, 1),
          numOrUnmeasurable(rolloff.isMeasurable, rolloff.power1500_4200DbFS, 1),
          numOrUnmeasurable(rolloff.isHighBandMeasurable, rolloff.power4200_8000DbFS, 1),
          numOrUnmeasurable(rolloff.isHighBandMeasurable, rolloff.highToMidHighRatioDb, 1),
          numOrUnmeasurable(
            bandCmp.bands.low_120_300.isMeasurable && bandCmp.bands.core_300_1000.isMeasurable,
            bandCmp.ratios.lowToCoreDb,
            1
          ),
          numOrUnmeasurable(
            bandCmp.bands.clarity_1500_4200.isMeasurable && bandCmp.bands.core_300_1000.isMeasurable,
            bandCmp.ratios.clarityToCoreDb,
            1
          ),
          numOrUnmeasurable(
            bandCmp.bands.high_4200_8000.isMeasurable && bandCmp.bands.clarity_1500_4200.isMeasurable,
            bandCmp.ratios.highToClarityDb,
            1
          ),
          numOrUnmeasurable(lvlVar.isMeasurable, lvlVar.iqrDb, 1),
          numOrUnmeasurable(lvlVar.isMeasurable, lvlVar.medianDbFS, 1),
          numOrUnmeasurable(lvlVar.isMeasurable, lvlVar.rangeDb, 1),
          numOrUnmeasurable(flat.isMeasurable, flat.median, 3),
          numOrUnmeasurable(flat.isMeasurable, flat.mean, 3),
          numOrUnmeasurable(flat.isMeasurable && flatIqr !== null, flatIqr, 3),
        ];
      })(),
      // Phase 2B-2D Columns (indices 69..77)
      identity.deviceId ?? '未記録',
      identity.deviceKey,
      devGroup?.clipCount ?? 1,
      isValidSubjectiveScore(subj?.intelligibilityOriginal) ? subj!.intelligibilityOriginal : '未評価',
      isValidSubjectiveScore(subj?.intelligibilityNormalized) ? subj!.intelligibilityNormalized : '未評価',
      !ext
        ? '未解析'
        : typeof rolloffSpeechVal === 'number' && Number.isFinite(rolloffSpeechVal)
        ? rolloffSpeechVal.toFixed(1)
        : '測定不能',
      ext ? String(ext.sampleRateHz) : clip.sampleRate ? String(clip.sampleRate) : '未記録',
      ext ? String(ext.fftSize) : '未解析',
      ext ? String(ext.fftHopSize) : '未解析',
      // Phase 2C Provisional Score Columns (indices 78..88)
      ...(() => {
        const prov = computeProvisionalScore(ev);
        const fmtItemScore = (val: number | null) => (val !== null ? String(val) : '算出不能');
        const statusLabel =
          prov.status === 'unavailable'
            ? '算出不能'
            : prov.isRescaled
            ? '暫定(比例換算)'
            : '暫定';
        const combinedNotice = `${PROVISIONAL_SCORE_NOTICES.provisionalScoreNotice} / ${PROVISIONAL_SCORE_NOTICES.webMeetingDspNotice} ${PROVISIONAL_SCORE_NOTICES.browserDspSettingNote}`;

        return [
          prov.totalScore !== null ? String(prov.totalScore) : '算出不能',
          prov.provisionalGradeLabel,
          statusLabel,
          prov.scoringVersion,
          fmtItemScore(prov.items.inputVolume.score),
          fmtItemScore(prov.items.noisePerformance.score),
          fmtItemScore(prov.items.frequencyCharacteristics.score),
          fmtItemScore(prov.items.speechStability.score),
          prov.usedMetricNames.length > 0 ? prov.usedMetricNames.join('; ') : 'なし',
          prov.unavailableItems.length > 0 ? prov.unavailableItems.join('; ') : 'なし',
          combinedNotice,
        ];
      })(),
    ];

    rows.push(row.map(escapeCsvCell).join(','));
  }

  return '\uFEFF' + rows.join('\r\n');
}

const DEVICE_STATS_CSV_HEADERS = [
  '同一機器識別キー',
  'マイク機器',
  'マイクDeviceId',
  '識別方式',
  'グループ録音数',
  '指標名',
  '単位',
  'dB統計注記',
  '有効件数_n',
  '平均',
  '最小',
  '最大',
  '標準偏差_母集団',
];

export const DEVICE_COMPARISON_METRIC_DEFS: Array<{
  statKey: keyof DeviceComparisonGroup['stats'];
  label: string;
}> = [
  { statKey: 'speechRmsDbFS', label: '発声RMS' },
  { statKey: 'noiseRmsDbFS', label: '定常暗騒音RMS' },
  { statKey: 'broadbandSnrDb', label: '全帯域S/N比' },
  { statKey: 'speechBandSnrDb', label: '音声帯域内S/N比 (300-4200Hz)' },
  { statKey: 'psdRatioLowToCoreDb', label: '帯域PSD比 (120-300Hz / 300-1000Hz)' },
  { statKey: 'psdRatioClarityToCoreDb', label: '帯域PSD比 (1500-4200Hz / 300-1000Hz)' },
  { statKey: 'psdRatioHighToClarityDb', label: '帯域PSD比 (4200-8000Hz / 1500-4200Hz)' },
  { statKey: 'speechLevelIqrDb', label: '発声内音量変動 IQR' },
  { statKey: 'spectralFlatnessMedian', label: 'スペクトル平坦度 (300-4200Hz 中央値)' },
  { statKey: 'rolloff95Hz_20_8000', label: '95%ロールオフ周波数 (20-8000Hz)' },
  { statKey: 'rolloff95Hz_300_8000', label: '95%ロールオフ周波数 (300-8000Hz)' },
  { statKey: 'subjectiveIntelligibilityOriginal', label: '聴感: 聞き取りやすさ（原音）' },
  { statKey: 'subjectiveIntelligibilityNormalized', label: '聴感: 聞き取りやすさ（正規化後）' },
  { statKey: 'subjectiveLowMuffleness', label: '聴感: こもりの少なさ' },
  { statKey: 'subjectiveLowBackgroundNoise', label: '聴感: ノイズの少なさ' },
];

/**
 * Serialize per-device descriptive statistics into UTF-8 BOM CSV.
 */
export function deviceComparisonToCsv(clips: RecordedClip[]): string {
  const groups = computeDeviceComparisonGroups(clips);
  const rows: string[] = [DEVICE_STATS_CSV_HEADERS.map(escapeCsvCell).join(',')];

  for (const g of groups) {
    for (const def of DEVICE_COMPARISON_METRIC_DEFS) {
      const st = g.stats[def.statKey];
      rows.push(
        [
          g.deviceKey,
          g.deviceLabel,
          g.deviceId ?? '未記録',
          g.identificationMethod,
          g.clipCount,
          def.label,
          st.unit,
          st.isDbScale ? 'dB値のばらつき統計（線形電力平均ではない）' : '物理量・主観評価記述統計',
          st.count,
          st.mean ?? '測定不能/未評価',
          st.min ?? '測定不能/未評価',
          st.max ?? '測定不能/未評価',
          st.stdDev ?? '測定不能/未評価',
        ]
          .map(escapeCsvCell)
          .join(',')
      );
    }
  }

  return '\uFEFF' + rows.join('\r\n');
}

/**
 * Serialize clips into structured JSON with full diagnostics, omitting Blob / AudioBuffer / ObjectURL.
 */
export function clipsToJson(clips: RecordedClip[]): string {
  const deviceComparisonGroups = computeDeviceComparisonGroups(clips);
  const payload = {
    schemaVersion: 'phase2b-2d-verification-v1',
    scoringVersion: PROVISIONAL_SCORE_VERSION,
    scoringNotices: PROVISIONAL_SCORE_NOTICES,
    exportedAt: new Date().toISOString(),
    dBStatsPolicy:
      'dB値の平均・最小・最大・標準偏差は値のばらつき把握を目的とした記述統計であり、線形電力平均ではありません。',
    clipCount: clips.length,
    deviceComparisonGroups,
    clips: clips.map((clip, idx) => {
      const normalizedEvaluation = clip.evaluation
        ? normalizeEvaluationCompatibility(clip.evaluation)
        : clip.evaluation;
      const identity = resolveDeviceIdentity(clip);
      const ext = normalizedEvaluation?.extendedMetrics;
      const normalizedSubjective = clip.subjectiveRating
        ? normalizeSubjectiveRating(clip.subjectiveRating) ?? null
        : null;

      return {
        id: clip.id,
        name: clip.name || `記録 #${idx + 1}`,
        recordedAt: clip.recordedAt ? new Date(clip.recordedAt).toISOString() : null,
        micDeviceId: identity.deviceId,
        micDeviceLabel: clip.micDeviceLabel,
        deviceIdentification: {
          deviceKey: identity.deviceKey,
          identificationMethod: identity.identificationMethod,
          identificationNote: identity.identificationNote,
        },
        outputDeviceLabel: clip.outputDeviceLabel ?? null,
        recordingMode: clip.recordingMode ?? null,
        durationSec: clip.duration,
        sampleRate: clip.sampleRate,
        extendedMetricsStatus: ext ? 'analyzed' : 'unanalyzed',
        analysisConditions: ext
          ? {
              sampleRateHz: ext.sampleRateHz,
              fftSize: ext.fftSize,
              fftHopSize: ext.fftHopSize,
              fftNormalization: ext.fftNormalization,
            }
          : null,
        trackSettings: clip.trackSettings
          ? {
              deviceId: clip.trackSettings.deviceId ?? null,
              echoCancellation:
                clip.trackSettings.echoCancellation !== undefined
                  ? clip.trackSettings.echoCancellation
                  : null,
              noiseSuppression:
                clip.trackSettings.noiseSuppression !== undefined
                  ? clip.trackSettings.noiseSuppression
                  : null,
              autoGainControl:
                clip.trackSettings.autoGainControl !== undefined
                  ? clip.trackSettings.autoGainControl
                  : null,
              sampleRate: clip.trackSettings.sampleRate ?? null,
              channelCount: clip.trackSettings.channelCount ?? null,
            }
          : null,
        vadSpeechSegments: getSpeechSegments(clip),
        provisionalScore: computeProvisionalScore(normalizedEvaluation),
        evaluation: normalizedEvaluation,
        subjectiveRating: normalizedSubjective,
      };
    }),
  };

  return JSON.stringify(payload, null, 2);
}

export function downloadTextFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadCsvFile(filename: string, csvContent: string): void {
  downloadTextFile(filename, csvContent, 'text/csv;charset=utf-8');
}

export function downloadJsonFile(filename: string, jsonContent: string): void {
  downloadTextFile(filename, jsonContent, 'application/json;charset=utf-8');
}
