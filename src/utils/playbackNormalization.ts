import { AudioSegment, RecordedClip } from '../types/audio';

export type PlaybackNormalizationMode = 'original' | 'normalized';
export type PlaybackFilterMode = 'all' | 'speech_only' | 'noise_only';
export type NormalizationStatus = 'applied' | 'limited' | 'unmeasurable';

export const NORMALIZATION_TARGET_RMS_DB = -23.0;
export const NORMALIZATION_MAX_BOOST_DB = 18.0;
export const NORMALIZATION_PEAK_CEILING_DB = -1.0;

export interface PlaybackNormalizationResult {
  status: NormalizationStatus;
  statusLabel: '適用済' | 'ゲイン制限' | '測定不能';
  targetRmsDbFS: number;
  measuredSpeechRmsDbFS?: number;
  desiredGainDb?: number;
  appliedGainDb: number;
  appliedGainLinear: number;
  truePeakDbFS?: number;
  resultingSpeechRmsDbFS?: number;
  limitedByMaxBoost: boolean;
  limitedByPeak: boolean;
  isTargetUnreached: boolean;
  reason?: string;
}

export interface EffectivePlaybackGain {
  gainLinear: number;
  gainDb: number;
  isNormalizationActive: boolean;
  bypassReason?: string;
}

export interface PlaybackSegmentStep {
  action: 'play_here' | 'jump' | 'ended';
  nextTimeSec: number;
  segmentEndTime?: number;
}

/**
 * Aggregate true linear-power RMS directly from PCM samples inside VAD-detected speech intervals.
 * Deduplicates overlapping/adjacent intervals so no sample is counted more than once.
 */
export function computeSpeechLinearRmsFromSegments(
  samples: Float32Array,
  sampleRate: number,
  segments: AudioSegment[]
): { sampleCount: number; rms: number; dbFS: number } {
  if (!samples || samples.length === 0 || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    return { sampleCount: 0, rms: 0, dbFS: -Infinity };
  }

  const totalSamples = samples.length;
  const rawIntervals: Array<{ start: number; end: number }> = [];

  for (const seg of segments) {
    if (!seg.isSpeech) continue;
    if (!Number.isFinite(seg.startTime) || !Number.isFinite(seg.endTime)) continue;
    const start = Math.max(0, Math.min(totalSamples, Math.floor(seg.startTime * sampleRate)));
    const end = Math.max(start, Math.min(totalSamples, Math.ceil(seg.endTime * sampleRate)));
    if (end > start) {
      rawIntervals.push({ start, end });
    }
  }

  if (rawIntervals.length === 0) {
    return { sampleCount: 0, rms: 0, dbFS: -Infinity };
  }

  rawIntervals.sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const iv of rawIntervals) {
    const prev = merged[merged.length - 1];
    if (prev && iv.start <= prev.end) {
      prev.end = Math.max(prev.end, iv.end);
    } else {
      merged.push({ ...iv });
    }
  }

  let sumSq = 0;
  let validCount = 0;
  for (const iv of merged) {
    for (let i = iv.start; i < iv.end; i++) {
      const s = samples[i];
      if (!Number.isFinite(s)) continue;
      sumSq += s * s;
      validCount++;
    }
  }

  if (validCount === 0 || !Number.isFinite(sumSq) || sumSq <= 0) {
    return { sampleCount: validCount, rms: 0, dbFS: -Infinity };
  }

  const rms = Math.sqrt(sumSq / validCount);
  if (!Number.isFinite(rms) || rms <= 1e-6) {
    // Treat <= -120 dBFS digital silence as unmeasurable for amplification
    return { sampleCount: validCount, rms: 0, dbFS: -Infinity };
  }

  return {
    sampleCount: validCount,
    rms,
    dbFS: 20 * Math.log10(rms),
  };
}

/**
 * Scan the entire recording buffer for true maximum finite sample peak.
 */
export function computeTrueSamplePeak(samples: Float32Array): {
  peakLinear: number;
  peakDbFS: number;
} {
  if (!samples || samples.length === 0) {
    return { peakLinear: 0, peakDbFS: -Infinity };
  }

  let peakLinear = 0;
  for (let i = 0; i < samples.length; i++) {
    const raw = samples[i];
    if (!Number.isFinite(raw)) continue;
    const absVal = Math.abs(raw);
    if (absVal > peakLinear) {
      peakLinear = absVal;
    }
  }

  if (peakLinear <= 0 || !Number.isFinite(peakLinear)) {
    return { peakLinear: 0, peakDbFS: -Infinity };
  }

  return {
    peakLinear,
    peakDbFS: 20 * Math.log10(peakLinear),
  };
}

/**
 * Compute per-clip playback normalization gain strictly for playback (non-destructive).
 * - Target RMS: -23 dBFS
 * - Max boost: +18 dB (attenuation applied as needed)
 * - Output peak ceiling: -1 dBFS across the full recording
 */
export function computeClipPlaybackNormalization(
  clip: Pick<RecordedClip, 'buffer' | 'evaluation'>
): PlaybackNormalizationResult {
  const baseFail = (reason: string): PlaybackNormalizationResult => ({
    status: 'unmeasurable',
    statusLabel: '測定不能',
    targetRmsDbFS: NORMALIZATION_TARGET_RMS_DB,
    appliedGainDb: 0,
    appliedGainLinear: 1,
    limitedByMaxBoost: false,
    limitedByPeak: false,
    isTargetUnreached: false,
    reason,
  });

  if (!clip.buffer || clip.buffer.length === 0 || clip.buffer.sampleRate <= 0) {
    return baseFail('音声データが存在しないため正規化を適用できません');
  }

  if (clip.evaluation?.isMeasurable === false) {
    return baseFail(
      clip.evaluation.unmeasurableReason || '発声時間不足等のため正規化対象外（原音量を維持）'
    );
  }

  const segments = clip.evaluation?.segments || [];
  const hasSpeechSegment = segments.some((s) => s.isSpeech);
  if (!hasSpeechSegment) {
    return baseFail('発声区間が検出されていないため正規化を適用できません');
  }

  const rawData = clip.buffer.getChannelData(0);
  const speechStats = computeSpeechLinearRmsFromSegments(
    rawData,
    clip.buffer.sampleRate,
    segments
  );

  if (
    speechStats.sampleCount === 0 ||
    speechStats.rms <= 0 ||
    !Number.isFinite(speechStats.dbFS)
  ) {
    return baseFail('発声区間が無音または不正な値のため正規化を適用できません');
  }

  const measuredSpeechRmsDbFS = speechStats.dbFS;
  const desiredGainDb = NORMALIZATION_TARGET_RMS_DB - measuredSpeechRmsDbFS;

  if (!Number.isFinite(desiredGainDb)) {
    return baseFail('目標ゲインを算出できないため原音量を維持します');
  }

  const boostCappedGainDb = Math.min(desiredGainDb, NORMALIZATION_MAX_BOOST_DB);
  const limitedByMaxBoost = desiredGainDb > NORMALIZATION_MAX_BOOST_DB + 1e-6;

  const peakInfo = computeTrueSamplePeak(rawData);
  const peakAllowedGainDb =
    peakInfo.peakLinear > 0 && Number.isFinite(peakInfo.peakDbFS)
      ? NORMALIZATION_PEAK_CEILING_DB - peakInfo.peakDbFS
      : Infinity;

  const appliedGainDb = Math.min(boostCappedGainDb, peakAllowedGainDb);
  const limitedByPeak = peakAllowedGainDb < boostCappedGainDb - 1e-6;
  const isTargetUnreached = appliedGainDb < desiredGainDb - 0.05;

  if (!Number.isFinite(appliedGainDb)) {
    return baseFail('ゲイン算出値が不正なため原音量を維持します');
  }

  const appliedGainLinear = Math.pow(10, appliedGainDb / 20);
  const resultingSpeechRmsDbFS = measuredSpeechRmsDbFS + appliedGainDb;

  let status: NormalizationStatus = 'applied';
  let statusLabel: PlaybackNormalizationResult['statusLabel'] = '適用済';
  let reason: string | undefined;

  if (limitedByMaxBoost || limitedByPeak) {
    status = 'limited';
    statusLabel = 'ゲイン制限';
    if (limitedByPeak && limitedByMaxBoost) {
      reason = `最大増幅 (+${NORMALIZATION_MAX_BOOST_DB} dB) およびピーク上限 (${NORMALIZATION_PEAK_CEILING_DB} dBFS) 保護により目標音量未達`;
    } else if (limitedByPeak) {
      reason = `ピーク上限 (${NORMALIZATION_PEAK_CEILING_DB} dBFS) 保護によりクリッピング防止のため制限（目標音量未達）`;
    } else {
      reason = `最大増幅上限 (+${NORMALIZATION_MAX_BOOST_DB} dB) により目標音量未達`;
    }
  }

  return {
    status,
    statusLabel,
    targetRmsDbFS: NORMALIZATION_TARGET_RMS_DB,
    measuredSpeechRmsDbFS: Number(measuredSpeechRmsDbFS.toFixed(1)),
    desiredGainDb: Number(desiredGainDb.toFixed(1)),
    appliedGainDb: Number(appliedGainDb.toFixed(1)),
    appliedGainLinear,
    truePeakDbFS: Number.isFinite(peakInfo.peakDbFS)
      ? Number(peakInfo.peakDbFS.toFixed(1))
      : undefined,
    resultingSpeechRmsDbFS: Number(resultingSpeechRmsDbFS.toFixed(1)),
    limitedByMaxBoost,
    limitedByPeak,
    isTargetUnreached,
    reason,
  };
}

/**
 * Resolve effective playback gain considering playback filter mode.
 * "noise_only" strictly maintains 0 dB (gain 1.0) so background noise loudness stays comparable.
 */
export function resolveEffectivePlaybackGain(
  normMode: PlaybackNormalizationMode,
  playMode: PlaybackFilterMode,
  normResult: PlaybackNormalizationResult
): EffectivePlaybackGain {
  if (normMode !== 'normalized') {
    return { gainLinear: 1, gainDb: 0, isNormalizationActive: false };
  }

  if (playMode === 'noise_only') {
    return {
      gainLinear: 1,
      gainDb: 0,
      isNormalizationActive: false,
      bypassReason: '周辺音のみ再生では暗騒音の実音量を比較するため原音量を維持',
    };
  }

  if (normResult.status === 'unmeasurable') {
    return {
      gainLinear: 1,
      gainDb: 0,
      isNormalizationActive: false,
      bypassReason: normResult.reason,
    };
  }

  return {
    gainLinear: normResult.appliedGainLinear,
    gainDb: normResult.appliedGainDb,
    isNormalizationActive: true,
  };
}

/**
 * Determine playback step/jump position for all / speech_only / noise_only filtering.
 */
export function findNextPlaybackOffset(
  currentTimeSec: number,
  segments: AudioSegment[],
  playMode: PlaybackFilterMode,
  durationSec: number
): PlaybackSegmentStep {
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    return { action: 'ended', nextTimeSec: 0 };
  }

  const clampedTime = Math.max(0, Number.isFinite(currentTimeSec) ? currentTimeSec : 0);

  if (playMode === 'all' || segments.length === 0) {
    if (clampedTime >= durationSec - 0.005) {
      return { action: 'ended', nextTimeSec: 0 };
    }
    return { action: 'play_here', nextTimeSec: clampedTime, segmentEndTime: durationSec };
  }

  const isMatching = (seg: AudioSegment) =>
    playMode === 'speech_only' ? seg.isSpeech : !seg.isSpeech;

  const currentSeg = segments.find(
    (s) => isMatching(s) && clampedTime >= s.startTime && clampedTime < s.endTime - 0.005
  );
  if (currentSeg) {
    return {
      action: 'play_here',
      nextTimeSec: clampedTime,
      segmentEndTime: currentSeg.endTime,
    };
  }

  const nextSeg = segments.find(
    (s) => isMatching(s) && s.endTime > clampedTime + 0.005
  );
  if (nextSeg) {
    return {
      action: 'jump',
      nextTimeSec: Math.max(clampedTime, nextSeg.startTime),
      segmentEndTime: nextSeg.endTime,
    };
  }

  return { action: 'ended', nextTimeSec: 0 };
}
