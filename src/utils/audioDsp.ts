/**
 * Copyright (c) 2026 八百茄子 (yaonasu)
 * SPDX-License-Identifier: MIT
 */

import {
  HeadsetEvaluation,
  VolumeStats,
  FrequencyBalance,
  AudioSegment,
  AssessmentItem,
  RecordingSequenceTimestamps,
  ClippingDetails,
  AmbientNoiseAnalysis,
  EstimatedSnrResult,
  BandRatioAnalysis,
  VerificationDiagnostics,
  MetricFrequencyRange,
  SpeechBandSnrMetric,
  HighFreqRolloffMetric,
  BandEnergyValue,
  BandEnergyComparisonMetric,
  SpeechLevelVariabilityMetric,
  SpectralFlatnessMetric,
  Phase2bExtendedMetrics,
} from '../types/audio';

/**
 * Decibel conversion utilities
 */
export function rmsToDb(rms: number): number {
  if (!Number.isFinite(rms) || rms <= 0.000001) return -90;
  const db = 20 * Math.log10(rms);
  return Math.max(-90, Math.min(0, db));
}

export function dbToRms(db: number): number {
  return Math.pow(10, db / 20);
}

/**
 * Format dB value for UI display
 */
export function formatDb(db: number): string {
  if (!Number.isFinite(db) || db <= -85) return '-∞ dBFS';
  return `${db >= 0 ? '+' : ''}${db.toFixed(1)} dBFS`;
}

/**
 * Radix-2 Cooley-Tukey Fast Fourier Transform (in-place)
 * N must be a power of 2.
 */
export function fftRadix2(real: Float64Array, imag: Float64Array, n: number): void {
  // Bit-reversal permutation
  let j = 0;
  for (let i = 0; i < n - 1; i++) {
    if (i < j) {
      const tempR = real[i];
      const tempI = imag[i];
      real[i] = real[j];
      imag[i] = imag[j];
      real[j] = tempR;
      imag[j] = tempI;
    }
    let k = n >> 1;
    while (k <= j) {
      j -= k;
      k >>= 1;
    }
    j += k;
  }

  // Butterfly updates
  for (let len = 2; len <= n; len <<= 1) {
    const halfLen = len >> 1;
    const angleStep = (-2 * Math.PI) / len;
    const wStepR = Math.cos(angleStep);
    const wStepI = Math.sin(angleStep);

    for (let i = 0; i < n; i += len) {
      let wR = 1.0;
      let wI = 0.0;
      for (let k = 0; k < halfLen; k++) {
        const posEven = i + k;
        const posOdd = i + k + halfLen;

        const oddR = real[posOdd] * wR - imag[posOdd] * wI;
        const oddI = real[posOdd] * wI + imag[posOdd] * wR;

        real[posOdd] = real[posEven] - oddR;
        imag[posOdd] = imag[posEven] - oddI;
        real[posEven] += oddR;
        imag[posEven] += oddI;

        const nextWR = wR * wStepR - wI * wStepI;
        wI = wR * wStepI + wI * wStepR;
        wR = nextWR;
      }
    }
  }
}

/**
 * Detect digital clipping symptoms
 */
export function detectClipping(samples: Float32Array): ClippingDetails {
  let peakValue = 0;
  let clippedSampleCount = 0;
  let maxConsecutiveClipSamples = 0;
  let currentConsecutive = 0;

  const threshold = 0.999;
  const total = samples.length;

  for (let i = 0; i < total; i++) {
    const raw = samples[i];
    if (!Number.isFinite(raw)) {
      currentConsecutive = 0;
      continue;
    }
    const absVal = Math.abs(raw);
    if (absVal > peakValue) {
      peakValue = absVal;
    }

    if (absVal >= threshold) {
      clippedSampleCount++;
      currentConsecutive++;
      if (currentConsecutive > maxConsecutiveClipSamples) {
        maxConsecutiveClipSamples = currentConsecutive;
      }
    } else {
      currentConsecutive = 0;
    }
  }

  const peakDbFS = rmsToDb(peakValue);
  const clippingRatioPercent = total > 0 ? (clippedSampleCount / total) * 100 : 0;
  const hasClippingSign = clippedSampleCount > 0 && maxConsecutiveClipSamples >= 3;

  let statusText = 'デジタルクリッピングの兆候なし';
  if (hasClippingSign) {
    statusText = `波形頭打ち（クリッピング歪み）の兆候あり（連続 ${maxConsecutiveClipSamples} サンプル、発生率: ${clippingRatioPercent.toFixed(3)}%、サンプルピーク: ${peakDbFS.toFixed(1)} dBFS）`;
  } else if (clippedSampleCount > 0) {
    statusText = `サンプルピーク上限到達あり（連続波形頭打ちは未検出、サンプルピーク: ${peakDbFS.toFixed(1)} dBFS）`;
  } else {
    statusText = `デジタルクリッピングの兆候なし（サンプルピーク: ${peakDbFS.toFixed(1)} dBFS、ヘッドルーム良好）`;
  }

  return {
    peakValue,
    peakDbFS,
    clippedSampleCount,
    clippingRatioPercent,
    maxConsecutiveClipSamples,
    hasClippingSign,
    statusText,
  };
}

/**
 * Compute next power of 2 >= n
 */
function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

export const NEUTRAL_BAND_RATIO_OBSERVATION_TEXT =
  '低域（120〜500Hz）と中高域（1500〜4200Hz）のパワー比の参考測定値です。こもり等の絶対判定は保留しており、同一話者・同一文章での相対比較にご利用ください。';

function isLegacyAssertiveBandRatioText(text: string | undefined): boolean {
  if (!text) return false;
  return (
    text.includes('近接効果') ||
    text.includes('低域過多') ||
    text.includes('標準的な帯域分布') ||
    text.includes('子音成分が前面に出やすい')
  );
}

/**
 * Sanitize legacy or current HeadsetEvaluation objects so disabled dummy scores
 * (80 / B / D / 30 / 80 / mufflenessLevel) and invalidated ratioDb > 10 assertions
 * are never treated or exported as valid evaluation results while overallScoreStatus !== 'calculated'.
 */
export function normalizeEvaluationCompatibility(
  evaluation: HeadsetEvaluation
): HeadsetEvaluation {
  const isCalculated = evaluation.overallScoreStatus === 'calculated';
  const hasSpeech = (evaluation.speechStats?.durationSec ?? 0) > 0;

  const normalizedBandRatio = evaluation.bandRatio
    ? {
        ...evaluation.bandRatio,
        relativeObservationText:
          hasSpeech && isLegacyAssertiveBandRatioText(evaluation.bandRatio.relativeObservationText)
            ? NEUTRAL_BAND_RATIO_OBSERVATION_TEXT
            : evaluation.bandRatio.relativeObservationText,
      }
    : evaluation.bandRatio;

  const normalizedItems = Array.isArray(evaluation.assessmentItems)
    ? evaluation.assessmentItems.map((item) => {
        if (item.category === 'clarity' && isLegacyAssertiveBandRatioText(item.detail)) {
          return {
            ...item,
            detail: `${NEUTRAL_BAND_RATIO_OBSERVATION_TEXT}（※マイク特性や距離に依存する測定値です）`,
          };
        }
        return item;
      })
    : evaluation.assessmentItems;

  if (isCalculated) {
    return {
      ...evaluation,
      bandRatio: normalizedBandRatio,
      assessmentItems: normalizedItems,
    };
  }

  return {
    ...evaluation,
    bandRatio: normalizedBandRatio,
    assessmentItems: normalizedItems,
    mufflenessLevel: null,
    mufflenessScore: null,
    clarityScore: null,
    overallScoreStatus: 'pending',
    overallGradeText: evaluation.isMeasurable === false ? '測定不能' : '保留',
    overallGrade: null,
    stressScore: null,
  };
}

/**
 * Perform comprehensive DSP analysis on recorded audio buffer
 */
export function analyzeAudioBuffer(
  buffer: AudioBuffer,
  timestamps?: RecordingSequenceTimestamps
): HeadsetEvaluation {
  const sampleRate = buffer.sampleRate > 0 ? buffer.sampleRate : 48000;
  const channelData = buffer.getChannelData(0);
  const totalSamples = channelData.length;

  // Sanitize input samples (guard NaN / Infinity without mutating caller buffer)
  const rawData = new Float32Array(totalSamples);
  for (let i = 0; i < totalSamples; i++) {
    const v = channelData[i];
    rawData[i] = Number.isFinite(v) ? v : 0;
  }

  // Windowing parameters: 30ms window, 15ms hop
  const windowSize = Math.max(1, Math.floor(sampleRate * 0.03)); // e.g. 1440 samples at 48kHz
  const hopSize = Math.max(1, Math.floor(sampleRate * 0.015));   // e.g. 720 samples

  // Determine physical sample boundaries for recording sequence
  let preNoiseEndSample = Math.min(totalSamples, Math.floor(sampleRate * 3.0));
  let speechStartSample = preNoiseEndSample;
  let speechEndSample = totalSamples;
  let postNoiseStartSample = totalSamples;
  let postNoiseEndSample = totalSamples;

  let clockSourceUsed: VerificationDiagnostics['clockSourceUsed'] = 'fallbackDefault';
  let wallDurationSec: number | undefined;
  let audioCtxDurationSec: number | undefined;

  if (timestamps) {
    const hasValidCtxClock =
      typeof timestamps.audioCtxStartTimeSec === 'number' &&
      typeof timestamps.audioCtxPromptTimeSec === 'number' &&
      typeof timestamps.audioCtxStopRequestTimeSec === 'number' &&
      typeof timestamps.audioCtxEndTimeSec === 'number' &&
      timestamps.audioCtxEndTimeSec > timestamps.audioCtxStartTimeSec &&
      timestamps.audioCtxStopRequestTimeSec >= timestamps.audioCtxPromptTimeSec;

    if (
      typeof timestamps.audioCtxStartTimeSec === 'number' &&
      typeof timestamps.audioCtxEndTimeSec === 'number' &&
      timestamps.audioCtxEndTimeSec > timestamps.audioCtxStartTimeSec
    ) {
      audioCtxDurationSec = timestamps.audioCtxEndTimeSec - timestamps.audioCtxStartTimeSec;
    }

    if (
      typeof timestamps.recordStartTimeMs === 'number' &&
      typeof timestamps.recordEndTimeMs === 'number' &&
      timestamps.recordEndTimeMs > timestamps.recordStartTimeMs
    ) {
      wallDurationSec = (timestamps.recordEndTimeMs - timestamps.recordStartTimeMs) / 1000;
    }

    let totalClockSpan = 0;
    let promptOffset = 0;
    let stopOffset = 0;

    if (hasValidCtxClock) {
      clockSourceUsed = 'audioContext';
      totalClockSpan =
        (timestamps.audioCtxEndTimeSec as number) - (timestamps.audioCtxStartTimeSec as number);
      promptOffset = Math.max(
        0,
        (timestamps.audioCtxPromptTimeSec as number) - (timestamps.audioCtxStartTimeSec as number)
      );
      stopOffset = Math.max(
        promptOffset,
        (timestamps.audioCtxStopRequestTimeSec as number) -
          (timestamps.audioCtxStartTimeSec as number)
      );
    } else if (timestamps.recordEndTimeMs > timestamps.recordStartTimeMs) {
      clockSourceUsed = 'performanceNow';
      totalClockSpan = timestamps.recordEndTimeMs - timestamps.recordStartTimeMs;
      promptOffset = Math.max(0, timestamps.promptSpeechTimeMs - timestamps.recordStartTimeMs);
      stopOffset = Math.max(
        promptOffset,
        timestamps.requestStopTimeMs - timestamps.recordStartTimeMs
      );
    }

    if (totalClockSpan > 0) {
      preNoiseEndSample = Math.max(
        0,
        Math.min(totalSamples, Math.floor((promptOffset / totalClockSpan) * totalSamples))
      );
      speechStartSample = preNoiseEndSample;
      speechEndSample = Math.max(
        speechStartSample,
        Math.min(totalSamples, Math.floor((stopOffset / totalClockSpan) * totalSamples))
      );

      // Exclude button-click transient: skip 300ms immediately following stop button press
      const clickSkipSamples = Math.floor(sampleRate * 0.3);
      postNoiseStartSample = Math.min(totalSamples, speechEndSample + clickSkipSamples);
      postNoiseEndSample = totalSamples;
    }
  }

  const bufferDurationSec = totalSamples / sampleRate;
  const verificationInfo: VerificationDiagnostics = {
    bufferDurationSec: Number(bufferDurationSec.toFixed(3)),
    ...(wallDurationSec !== undefined
      ? {
          wallDurationSec: Number(wallDurationSec.toFixed(3)),
          bufferVsWallDiffMs: Math.round((bufferDurationSec - wallDurationSec) * 1000),
        }
      : {}),
    ...(audioCtxDurationSec !== undefined
      ? {
          audioCtxDurationSec: Number(audioCtxDurationSec.toFixed(3)),
          bufferVsAudioCtxDiffMs: Math.round((bufferDurationSec - audioCtxDurationSec) * 1000),
        }
      : {}),
    clockSourceUsed,
    ...(typeof timestamps?.recorderStartToOnstartMs === 'number'
      ? { recorderStartToOnstartMs: Number(timestamps.recorderStartToOnstartMs.toFixed(1)) }
      : {}),
    preNoiseEndSec: Number((preNoiseEndSample / sampleRate).toFixed(3)),
    speechStartSec: Number((speechStartSample / sampleRate).toFixed(3)),
    speechEndSec: Number((speechEndSample / sampleRate).toFixed(3)),
    postNoiseStartSec: Number((postNoiseStartSample / sampleRate).toFixed(3)),
    postNoiseEndSec: Number((postNoiseEndSample / sampleRate).toFixed(3)),
  };

  interface WindowInfo {
    index: number;
    startSample: number;
    endSample: number;
    effectiveLen: number;
    startTime: number;
    endTime: number;
    sumSq: number;
    rms: number;
    power: number;
    dbFS: number;
    zcr: number;
    zcrHz: number;
    subBassPower: number;
    voiceBandPower: number;
    consonantBandPower: number;
    totalFftPower: number;
    voiceBandDbFS: number;
    consonantBandDbFS: number;
    isSpeech: boolean;
  }

  const windows: WindowInfo[] = [];

  if (totalSamples > 0) {
    const effectiveWinSize = Math.min(windowSize, totalSamples);
    const numWindows =
      totalSamples <= effectiveWinSize
        ? 1
        : Math.floor((totalSamples - effectiveWinSize) / hopSize) + 1;

    // Pre-calculate Hann window and FFT buffers for band-aware VAD
    const vadHann = new Float32Array(effectiveWinSize);
    let sumVadHannSq = 0;
    for (let i = 0; i < effectiveWinSize; i++) {
      const h =
        effectiveWinSize > 1
          ? 0.5 * (1 - Math.cos((2 * Math.PI * i) / (effectiveWinSize - 1)))
          : 1.0;
      vadHann[i] = h;
      sumVadHannSq += h * h;
    }
    const vadFftSize = nextPow2(Math.max(1024, effectiveWinSize));
    const vadHalfFft = vadFftSize / 2;
    const vadBinWidth = sampleRate / vadFftSize;
    const vadReal = new Float64Array(vadFftSize);
    const vadImag = new Float64Array(vadFftSize);
    // Parseval calibration factor: recovers mean-square signal power per band in dBFS scale
    const parsevalScale = sumVadHannSq > 0 ? 2.0 / (vadFftSize * sumVadHannSq) : 0;

    for (let w = 0; w < numWindows; w++) {
      const offset = w * hopSize;
      const winLen = Math.min(effectiveWinSize, totalSamples - offset);
      if (winLen <= 0) break;

      let sumSq = 0;
      let zeroCrossings = 0;

      vadReal.fill(0);
      vadImag.fill(0);

      for (let i = 0; i < winLen; i++) {
        const sample = rawData[offset + i];
        sumSq += sample * sample;
        vadReal[i] = sample * vadHann[i];
        if (i > 0) {
          const prev = rawData[offset + i - 1];
          if ((sample >= 0 && prev < 0) || (sample < 0 && prev >= 0)) {
            zeroCrossings++;
          }
        }
      }

      const power = sumSq / winLen;
      const rms = Math.sqrt(power);
      const dbFS = rmsToDb(rms);
      const zcr = zeroCrossings / winLen;
      const zcrHz = zcr * (sampleRate / 2);

      // Compute calibrated band powers via FFT
      fftRadix2(vadReal, vadImag, vadFftSize);
      let subBassPower = 0;
      let voiceBandPower = 0;
      let consonantBandPower = 0;
      let totalFftPower = 0;

      for (let k = 1; k < vadHalfFft; k++) {
        const freq = k * vadBinWidth;
        const p = (vadReal[k] * vadReal[k] + vadImag[k] * vadImag[k]) * parsevalScale;
        if (freq >= 20) totalFftPower += p;
        if (freq < 120) subBassPower += p;
        if (freq >= 150 && freq <= 4200) voiceBandPower += p;
        if (freq >= 2000 && freq <= 8500) consonantBandPower += p;
      }

      windows.push({
        index: w,
        startSample: offset,
        endSample: offset + winLen,
        effectiveLen: winLen,
        startTime: offset / sampleRate,
        endTime: (offset + winLen) / sampleRate,
        sumSq,
        rms,
        power,
        dbFS,
        zcr,
        zcrHz,
        subBassPower,
        voiceBandPower,
        consonantBandPower,
        totalFftPower,
        voiceBandDbFS: rmsToDb(Math.sqrt(voiceBandPower)),
        consonantBandDbFS: rmsToDb(Math.sqrt(consonantBandPower)),
        isSpeech: false,
      });
    }
  }

  // 1. Ambient Noise Analysis (strictly within pre-noise and post-noise boundaries)
  const preNoiseWindows = windows.filter((w) => w.endSample <= preNoiseEndSample);
  const postNoiseWindows = windows.filter(
    (w) => w.startSample >= postNoiseStartSample && w.endSample <= postNoiseEndSample
  );

  // Compute steady-state power using 20th-70th percentile to reject impact/bump transients
  const getSteadyPower = (wins: WindowInfo[], selector: (w: WindowInfo) => number): number => {
    if (wins.length === 0) return 0.000001; // -60 dBFS fallback when interval absent
    const sortedPowers = wins.map(selector).sort((a, b) => a - b);
    const startIdx = Math.floor(sortedPowers.length * 0.2);
    const endIdx = Math.max(startIdx + 1, Math.floor(sortedPowers.length * 0.7));
    let sum = 0;
    let count = 0;
    for (let i = startIdx; i < endIdx; i++) {
      sum += sortedPowers[i];
      count++;
    }
    return count > 0 ? sum / count : sortedPowers[0];
  };

  const preNoisePower = getSteadyPower(preNoiseWindows, (w) => w.power);
  const postNoisePower = getSteadyPower(postNoiseWindows, (w) => w.power);

  const preNoiseDbFS = Number(rmsToDb(Math.sqrt(preNoisePower)).toFixed(1));
  const postNoiseDbFS = Number(rmsToDb(Math.sqrt(postNoisePower)).toFixed(1));
  const noiseDifferenceDb = Math.abs(postNoiseDbFS - preNoiseDbFS);
  const hasNoiseLevelShiftWarning = postNoiseWindows.length > 0 && noiseDifferenceDb >= 6.0;

  // Representative ambient noise power (linear average of pre and post steady noise)
  const representativeNoisePower =
    postNoiseWindows.length > 0 ? (preNoisePower + postNoisePower) / 2 : preNoisePower;
  const representativeNoiseDbFS = Number(
    rmsToDb(Math.sqrt(representativeNoisePower)).toFixed(1)
  );

  // Per-band noise floors for band-aware VAD
  const ambientGuideWindows =
    postNoiseWindows.length > 0 ? [...preNoiseWindows, ...postNoiseWindows] : preNoiseWindows;
  const noiseSubBassPower = getSteadyPower(ambientGuideWindows, (w) => w.subBassPower);
  const noiseVoiceBandPower = getSteadyPower(ambientGuideWindows, (w) => w.voiceBandPower);
  const noiseConsonantBandPower = getSteadyPower(ambientGuideWindows, (w) => w.consonantBandPower);

  const noiseVoiceFloorDb = rmsToDb(Math.sqrt(noiseVoiceBandPower));
  const noiseConsonantFloorDb = rmsToDb(Math.sqrt(noiseConsonantBandPower));

  // 2. Improved 4-Stage Band-Aware VAD within speech candidate region
  const speechCandidateWindows = windows.filter(
    (w) => w.startSample >= speechStartSample && w.endSample <= speechEndSample
  );

  const hopDurationSec = hopSize / sampleRate;
  const voiceOnThreshDb = Math.max(noiseVoiceFloorDb + 6.5, -52.0);
  const consonantOnThreshDb = Math.max(noiseConsonantFloorDb + 8.0, -50.0);
  const voiceOffThreshDb = Math.max(noiseVoiceFloorDb + 3.5, -55.0);
  const consonantOffThreshDb = Math.max(noiseConsonantFloorDb + 4.5, -53.0);

  const passesSubBassGuard = (w: WindowInfo): boolean => {
    const excessSubBass = Math.max(0, w.subBassPower - noiseSubBassPower * 1.5);
    const excessVoice = Math.max(0, w.voiceBandPower - noiseVoiceBandPower);
    const excessConsonant = Math.max(0, w.consonantBandPower - noiseConsonantBandPower);
    // Reject pure low-frequency impacts/thumps while remaining immune to stationary low-freq rumble
    return excessVoice + excessConsonant >= excessSubBass * 0.4;
  };

  // Stage 1: Core speech frame identification (voiced formants + unvoiced fricatives/plosives)
  const coreFlags = speechCandidateWindows.map((w) => {
    const guardOk = passesSubBassGuard(w);
    const isVoicedCore =
      w.voiceBandDbFS >= voiceOnThreshDb && guardOk && w.zcrHz >= 40 && w.zcrHz <= 8000;
    const isUnvoicedCore =
      w.consonantBandDbFS >= consonantOnThreshDb &&
      guardOk &&
      w.zcrHz >= 1200 &&
      w.zcrHz <= 14000;
    return isVoicedCore || isUnvoicedCore;
  });

  // Stage 2: Bridge very brief intra-word stop/closure gaps (<= 75ms) flanked by core speech
  const bridgedFlags = [...coreFlags];
  const maxBridgeFrames = Math.max(1, Math.round(0.075 / hopDurationSec));
  {
    let idx = 0;
    while (idx < bridgedFlags.length) {
      if (!bridgedFlags[idx]) {
        const gapStart = idx;
        while (idx < bridgedFlags.length && !bridgedFlags[idx]) idx++;
        const gapEnd = idx;
        const gapLen = gapEnd - gapStart;
        if (
          gapStart > 0 &&
          gapEnd < bridgedFlags.length &&
          bridgedFlags[gapStart - 1] &&
          bridgedFlags[gapEnd] &&
          gapLen <= maxBridgeFrames
        ) {
          for (let g = gapStart; g < gapEnd; g++) {
            bridgedFlags[g] = true;
          }
        }
      } else {
        idx++;
      }
    }
  }

  // Stage 3: Prune isolated short transient bursts (< 90ms) such as keyboard clicks / desk taps
  const islandFlags = [...bridgedFlags];
  const minIslandFrames = Math.max(4, Math.round(0.09 / hopDurationSec));
  {
    let idx = 0;
    while (idx < islandFlags.length) {
      if (islandFlags[idx]) {
        const runStart = idx;
        while (idx < islandFlags.length && islandFlags[idx]) idx++;
        const runEnd = idx;
        if (runEnd - runStart < minIslandFrames) {
          for (let r = runStart; r < runEnd; r++) {
            islandFlags[r] = false;
          }
        }
      } else {
        idx++;
      }
    }
  }

  // Stage 4: Soft edge expansion from confirmed speech islands (onset unvoiced consonants & tails)
  const finalFlags = [...islandFlags];
  const maxPreExpandFrames = Math.max(1, Math.round(0.06 / hopDurationSec)); // ~60ms
  const maxPostExpandFrames = Math.max(1, Math.round(0.12 / hopDurationSec)); // ~120ms

  const isSoftSpeechFrame = (w: WindowInfo): boolean => {
    if (!passesSubBassGuard(w)) return false;
    return (
      w.voiceBandDbFS >= voiceOffThreshDb ||
      (w.consonantBandDbFS >= consonantOffThreshDb && w.zcrHz >= 1000 && w.zcrHz <= 14000)
    );
  };

  for (let i = 0; i < islandFlags.length; i++) {
    if (!islandFlags[i]) continue;
    const isIslandStart = i === 0 || !islandFlags[i - 1];
    const isIslandEnd = i === islandFlags.length - 1 || !islandFlags[i + 1];

    if (isIslandStart) {
      for (let step = 1; step <= maxPreExpandFrames && i - step >= 0; step++) {
        if (finalFlags[i - step]) break;
        if (isSoftSpeechFrame(speechCandidateWindows[i - step])) {
          finalFlags[i - step] = true;
        } else {
          break;
        }
      }
    }
    if (isIslandEnd) {
      for (
        let step = 1;
        step <= maxPostExpandFrames && i + step < speechCandidateWindows.length;
        step++
      ) {
        if (finalFlags[i + step]) break;
        if (isSoftSpeechFrame(speechCandidateWindows[i + step])) {
          finalFlags[i + step] = true;
        } else {
          break;
        }
      }
    }
  }

  for (let i = 0; i < speechCandidateWindows.length; i++) {
    speechCandidateWindows[i].isSpeech = finalFlags[i];
  }

  const detectedSpeechWindows = speechCandidateWindows.filter((w) => w.isSpeech);
  const validSpeechDurationSec = detectedSpeechWindows.length * hopDurationSec;

  // Check steady noise inside non-speech pauses during speaking phase (diagnostic only)
  const intraSpeechPauseWindows = speechCandidateWindows.filter((w) => !w.isSpeech);
  const intraSpeechPauseNoiseDbFS =
    intraSpeechPauseWindows.length >= 10
      ? Number(
          rmsToDb(Math.sqrt(getSteadyPower(intraSpeechPauseWindows, (w) => w.power))).toFixed(1)
        )
      : undefined;

  const noiseAnalysis: AmbientNoiseAnalysis = {
    preNoiseDbFS,
    postNoiseDbFS,
    noiseDifferenceDb: Number(noiseDifferenceDb.toFixed(1)),
    hasNoiseLevelShiftWarning,
    representativeNoiseDbFS,
    noisePowerLinear: representativeNoisePower,
    ...(intraSpeechPauseNoiseDbFS !== undefined ? { intraSpeechPauseNoiseDbFS } : {}),
  };

  // Verification requirement: at least 3.0s valid speech
  let isMeasurable = true;
  let unmeasurableReason: string | undefined;

  if (totalSamples < windowSize || validSpeechDurationSec < 3.0) {
    isMeasurable = false;
    unmeasurableReason = `有効な発声時間が不足しています（検出: ${validSpeechDurationSec.toFixed(1)}秒 / 必要: 3.0秒以上）。朗読用テキストを発話してください。`;
  }

  // Build merged non-overlapping PCM sample intervals from overlapping VAD/ambient windows
  const mergeSampleIntervals = (
    wins: WindowInfo[],
    clampMin = 0,
    clampMax = totalSamples
  ): Array<{ startSample: number; endSample: number }> => {
    const merged: Array<{ startSample: number; endSample: number }> = [];
    for (const win of wins) {
      const s = Math.max(clampMin, win.startSample);
      const e = Math.min(clampMax, win.endSample);
      if (e <= s) continue;
      const prev = merged[merged.length - 1];
      if (prev && s <= prev.endSample) {
        prev.endSample = Math.max(prev.endSample, e);
      } else {
        merged.push({ startSample: s, endSample: e });
      }
    }
    return merged;
  };

  const computeUniqueIntervalRmsPower = (
    intervals: Array<{ startSample: number; endSample: number }>
  ): { sumSq: number; sampleCount: number; meanSquarePower: number; rms: number; dbFS: number } => {
    let sumSq = 0;
    let sampleCount = 0;
    for (const iv of intervals) {
      for (let i = iv.startSample; i < iv.endSample; i++) {
        const s = rawData[i];
        if (!Number.isFinite(s)) continue;
        sumSq += s * s;
        sampleCount++;
      }
    }
    if (sampleCount === 0 || !Number.isFinite(sumSq)) {
      return { sumSq: 0, sampleCount: 0, meanSquarePower: 0, rms: 0, dbFS: -90 };
    }
    const meanSquarePower = sumSq / sampleCount;
    const rms = Math.sqrt(meanSquarePower);
    return {
      sumSq,
      sampleCount,
      meanSquarePower,
      rms,
      dbFS: rmsToDb(rms),
    };
  };

  // 3. Audio Segments for Visualizer (linear PCM power RMS without window-overlap double counting)
  const segments: AudioSegment[] = [];
  if (windows.length > 0) {
    let segStartTime = windows[0].startTime;
    let segEndTime = windows[0].endTime;
    let segStartSample = windows[0].startSample;
    let segEndSample = windows[0].endSample;
    let segIsSpeech = windows[0].isSpeech;
    let segMaxDb = windows[0].dbFS;

    const pushSegment = () => {
      const segStats = computeUniqueIntervalRmsPower([
        {
          startSample: Math.max(0, segStartSample),
          endSample: Math.min(totalSamples, segEndSample),
        },
      ]);
      segments.push({
        startTime: segStartTime,
        endTime: segEndTime,
        isSpeech: segIsSpeech,
        avgDb: segStats.dbFS,
        maxDb: segMaxDb,
      });
    };

    for (let w = 1; w < windows.length; w++) {
      const win = windows[w];
      if (win.isSpeech === segIsSpeech) {
        segEndTime = win.endTime;
        segEndSample = Math.max(segEndSample, win.endSample);
        segMaxDb = Math.max(segMaxDb, win.dbFS);
      } else {
        pushSegment();
        segStartTime = win.startTime;
        segEndTime = win.endTime;
        segStartSample = win.startSample;
        segEndSample = win.endSample;
        segIsSpeech = win.isSpeech;
        segMaxDb = win.dbFS;
      }
    }
    pushSegment();
  }

  // Contiguous non-overlapping PCM sample intervals for detected speech & ambient reference regions
  const speechIntervals = mergeSampleIntervals(
    detectedSpeechWindows,
    speechStartSample,
    speechEndSample
  );
  const ambientIntervals = mergeSampleIntervals(ambientGuideWindows, 0, totalSamples);

  // 4. Speech Volume Stats (Non-overlapping PCM linear power aggregation for avgDb; 30ms window stats for min/max/ratio)
  const hasDetectedSpeech = detectedSpeechWindows.length > 0;
  let speechMaxDb = -90;
  let speechMinDb = hasDetectedSpeech ? 0 : -90;
  let speechAppropriateCount = 0;

  for (const win of detectedSpeechWindows) {
    if (win.dbFS > speechMaxDb) speechMaxDb = win.dbFS;
    if (win.dbFS < speechMinDb) speechMinDb = win.dbFS;

    if (win.dbFS >= -24 && win.dbFS <= -14) {
      speechAppropriateCount++;
    }
  }

  const speechUniqueStats = computeUniqueIntervalRmsPower(speechIntervals);
  const speechAvgDb = speechUniqueStats.dbFS;
  const speechTotalDuration = buffer.duration;
  const speechAppropriatePercent = hasDetectedSpeech
    ? Math.round((speechAppropriateCount / detectedSpeechWindows.length) * 100)
    : 0;

  const speechStats: VolumeStats = {
    maxDb: Number(speechMaxDb.toFixed(1)),
    minDb: Number(speechMinDb.toFixed(1)),
    avgDb: Number(speechAvgDb.toFixed(1)),
    durationSec: Number(validSpeechDurationSec.toFixed(1)),
    ratioPercent:
      speechTotalDuration > 0
        ? Math.min(100, Math.round((validSpeechDurationSec / speechTotalDuration) * 100))
        : 0,
    appropriateRatioPercent: speechAppropriatePercent,
    targetRangeText: '-24 〜 -14 dBFS',
    appropriateDescription: 'Web会議（Zoom/Teams/Meet）で相手が聞き取りやすい推奨音量',
  };

  // Ambient Noise Volume Stats (Non-overlapping PCM aggregation for noiseStats.avgDb; steady noise keeps 20-70th percentile)
  const hasAmbientGuideWindows = ambientGuideWindows.length > 0;
  let noiseMaxDb = -90;
  let noiseMinDb = hasAmbientGuideWindows ? 0 : -90;
  let noiseAppropriateCount = 0;

  for (const win of ambientGuideWindows) {
    if (win.dbFS > noiseMaxDb) noiseMaxDb = win.dbFS;
    if (win.dbFS < noiseMinDb) noiseMinDb = win.dbFS;

    if (win.dbFS <= -45) {
      noiseAppropriateCount++;
    }
  }

  const ambientUniqueStats = computeUniqueIntervalRmsPower(ambientIntervals);
  const noiseAvgRms =
    ambientUniqueStats.sampleCount > 0
      ? ambientUniqueStats.rms
      : Math.sqrt(representativeNoisePower);
  const noiseAvgDb = rmsToDb(noiseAvgRms);
  const noiseDurationSec = ambientGuideWindows.length * hopDurationSec;
  const noiseAppropriatePercent = hasAmbientGuideWindows
    ? Math.round((noiseAppropriateCount / ambientGuideWindows.length) * 100)
    : representativeNoiseDbFS <= -45
    ? 100
    : 0;

  const noiseStats: VolumeStats = {
    maxDb: Number(noiseMaxDb.toFixed(1)),
    minDb: Number(noiseMinDb.toFixed(1)),
    avgDb: Number(noiseAvgDb.toFixed(1)),
    durationSec: Number(noiseDurationSec.toFixed(1)),
    ratioPercent:
      speechTotalDuration > 0
        ? Math.min(100, Math.round((noiseDurationSec / speechTotalDuration) * 100))
        : 0,
    appropriateRatioPercent: noiseAppropriatePercent,
    targetRangeText: '-45 dBFS 以下',
    appropriateDescription: 'エアコン・PCファン等の暗騒音の静寂性基準',
  };

  // 5. Estimated SNR: Pure Voice Power = Non-overlapping Speech PCM Power - Steady 20-70th Percentile Noise Power
  const totalSpeechPowerLinear = speechUniqueStats.meanSquarePower;
  const pureVoicePowerLinear = totalSpeechPowerLinear - representativeNoisePower;
  // Floor denominator at -90 dBFS (1e-9) to avoid division-by-zero / Infinity on pure digital silence noise
  const effectiveNoisePowerForSnr = Math.max(representativeNoisePower, 1e-9);

  let estimatedSnr: EstimatedSnrResult;
  let snrDbValue = 0;

  if (speechUniqueStats.sampleCount === 0 || !isMeasurable) {
    estimatedSnr = {
      isMeasurable: false,
      unmeasurableReason: unmeasurableReason || '発声区間が検出されなかったため測定不能です',
    };
  } else if (pureVoicePowerLinear <= 0) {
    estimatedSnr = {
      isMeasurable: false,
      unmeasurableReason:
        '発話音声レベルが周辺ノイズと同等または下回っているため、純音声のS/N比を分離推定できませんでした',
      voicePowerLinear: Math.max(0, pureVoicePowerLinear),
      noisePowerLinear: representativeNoisePower,
    };
  } else {
    snrDbValue = 10 * Math.log10(pureVoicePowerLinear / effectiveNoisePowerForSnr);
    snrDbValue = Number(snrDbValue.toFixed(1));
    estimatedSnr = {
      isMeasurable: true,
      snrDb: snrDbValue,
      voicePowerLinear: pureVoicePowerLinear,
      noisePowerLinear: representativeNoisePower,
    };
  }

  // 6. 2048-point FFT Analysis strictly aligned within contiguous detected speech intervals
  const fftSize = 2048;
  const halfFft = fftSize / 2;
  const binWidth = sampleRate / fftSize;

  let totalSubBass = 0;
  let totalLowBoom = 0;
  let totalCore = 0;
  let totalClarity = 0;
  let totalAir = 0;
  let lowBand120_500 = 0;
  let midHighBand1500_4200 = 0;
  let spectralCentroidNumerator = 0;
  let spectralCentroidDenominator = 0;

  // Generate FFT frame slices strictly inside speechIntervals (no boundary overrun into silence/noise)
  interface FftSlice {
    startSample: number;
    length: number;
  }
  const candidateSlices: FftSlice[] = [];
  const fftHop = fftSize / 2; // 50% overlap

  for (const interval of speechIntervals) {
    const segLen = interval.endSample - interval.startSample;
    if (segLen >= fftSize) {
      let lastPos = -1;
      for (let pos = interval.startSample; pos + fftSize <= interval.endSample; pos += fftHop) {
        candidateSlices.push({ startSample: pos, length: fftSize });
        lastPos = pos;
      }
      // Cover trailing speech tail inside the interval if >= half frame remains
      const trailingStart = interval.endSample - fftSize;
      if (lastPos >= 0 && trailingStart - lastPos >= fftHop / 2) {
        candidateSlices.push({ startSample: trailingStart, length: fftSize });
      }
    } else if (segLen > 0) {
      // Short speech burst (< 2048 samples): analyze strictly within [startSample, endSample) with zero-padding
      candidateSlices.push({ startSample: interval.startSample, length: segLen });
    }
  }

  // Subsample evenly if more than 200 slices (no discontinuity)
  const maxFftFrames = 200;
  const selectedSlices: FftSlice[] = [];
  if (candidateSlices.length <= maxFftFrames) {
    selectedSlices.push(...candidateSlices);
  } else {
    for (let i = 0; i < maxFftFrames; i++) {
      const idx = Math.floor((i * candidateSlices.length) / maxFftFrames);
      selectedSlices.push(candidateSlices[idx]);
    }
  }

  const fftReal = new Float64Array(fftSize);
  const fftImag = new Float64Array(fftSize);
  const hann2048 = new Float64Array(fftSize);
  let hann2048Energy = 0;
  for (let i = 0; i < fftSize; i++) {
    const h = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
    hann2048[i] = h;
    hann2048Energy += h * h;
  }

  let analyzedFrameCount = 0;

  for (const slice of selectedSlices) {
    fftReal.fill(0);
    fftImag.fill(0);

    let frameScale = 1.0;
    if (slice.length === fftSize) {
      for (let i = 0; i < fftSize; i++) {
        fftReal[i] = rawData[slice.startSample + i] * hann2048[i];
      }
    } else {
      let subHannEnergy = 0;
      for (let i = 0; i < slice.length; i++) {
        const h =
          slice.length > 1
            ? 0.5 * (1 - Math.cos((2 * Math.PI * i) / (slice.length - 1)))
            : 1.0;
        fftReal[i] = rawData[slice.startSample + i] * h;
        subHannEnergy += h * h;
      }
      frameScale = subHannEnergy > 0 ? hann2048Energy / subHannEnergy : 1.0;
    }

    fftRadix2(fftReal, fftImag, fftSize);

    for (let k = 1; k < halfFft; k++) {
      const freq = k * binWidth;
      const power = (fftReal[k] * fftReal[k] + fftImag[k] * fftImag[k]) * frameScale;

      if (freq < 120) totalSubBass += power;
      else if (freq >= 120 && freq < 300) totalLowBoom += power;
      else if (freq >= 300 && freq < 1500) totalCore += power;
      else if (freq >= 1500 && freq < 4200) totalClarity += power;
      else if (freq >= 4200 && freq < 10000) totalAir += power;

      if (freq >= 120 && freq < 500) lowBand120_500 += power;
      if (freq >= 1500 && freq < 4200) midHighBand1500_4200 += power;

      spectralCentroidNumerator += freq * power;
      spectralCentroidDenominator += power;
    }
    analyzedFrameCount++;
  }

  const rawTotalBandPower = totalSubBass + totalLowBoom + totalCore + totalClarity + totalAir;
  const hasSpectralData = analyzedFrameCount > 0 && rawTotalBandPower > 0;
  const totalBandPower = rawTotalBandPower || 1;

  const frequencyBalance: FrequencyBalance = hasSpectralData
    ? {
        subBassRumble: Math.round((totalSubBass / totalBandPower) * 100),
        vocalLowBoom: Math.round((totalLowBoom / totalBandPower) * 100),
        vocalCore: Math.round((totalCore / totalBandPower) * 100),
        vocalClarity: Math.round((totalClarity / totalBandPower) * 100),
        airAndHiss: Math.round((totalAir / totalBandPower) * 100),
      }
    : {
        subBassRumble: 0,
        vocalLowBoom: 0,
        vocalCore: 0,
        vocalClarity: 0,
        airAndHiss: 0,
      };

  const spectralCentroidHz =
    hasSpectralData && spectralCentroidDenominator > 0
      ? Math.round(spectralCentroidNumerator / spectralCentroidDenominator)
      : 0;

  // Band ratio: 10 * log10(Power[120-500Hz] / Power[1500-4200Hz])
  // Scale-invariant relative floor avoids discontinuities on quiet or extreme-ratio signals.
  let ratioDb = 0;
  let relativeObservationText = '';
  const totalSpectralReferencePower = Math.max(rawTotalBandPower, spectralCentroidDenominator);
  const hasAnySpectralEnergy = analyzedFrameCount > 0 && totalSpectralReferencePower > 0;
  if (!hasAnySpectralEnergy) {
    ratioDb = 0;
    relativeObservationText =
      '有効な発声区間が検出されなかったため、周波数帯域比を計測できませんでした。';
  } else {
    const bandPowerFloor = Math.max(1e-30, totalSpectralReferencePower * 1e-12);
    const safeLowBand = Math.max(lowBand120_500, bandPowerFloor);
    const safeMidHighBand = Math.max(midHighBand1500_4200, bandPowerFloor);
    const lowToMidHighPowerRatio = 10 * Math.log10(safeLowBand / safeMidHighBand);
    ratioDb = Number.isFinite(lowToMidHighPowerRatio)
      ? Number(lowToMidHighPowerRatio.toFixed(1))
      : 0;
    relativeObservationText = NEUTRAL_BAND_RATIO_OBSERVATION_TEXT;
  }

  const bandRatio: BandRatioAnalysis = {
    lowFreqPowerLinear: lowBand120_500,
    midHighFreqPowerLinear: midHighBand1500_4200,
    ratioDb,
    relativeObservationText,
  };

  // 7. Clipping analysis
  const clippingDetails = detectClipping(rawData);

  // 8. Overall Quality Score Policy: Pending status (dummy scores/grades disabled)
  const overallScoreStatus: 'pending' | 'calculated' = 'pending';
  const overallScoreText = isMeasurable
    ? '算出保留（明瞭性指標の検証中）'
    : '測定不能（要件未達）';
  const overallGradeText = isMeasurable ? '保留' : '測定不能';

  // Grade Title and Assessment items
  const gradeTitle = isMeasurable
    ? '音響測定完了（客観指標・相対比較モード）'
    : '測定要件未達（再測定が必要です）';

  const assessmentSummary = isMeasurable
    ? hasNoiseLevelShiftWarning
      ? '測定が完了しました。ただし、測定の前後で周辺環境の騒音レベルが大きく変動したため（変動幅: ' +
        noiseDifferenceDb.toFixed(1) +
        ' dB）、推定S/N比の比較精度が低下している可能性があります。同一条件での再測定を推奨します。'
      : '客観的な物理測定値（推定S/N比・音量実効値・周波数帯域比・クリッピング兆候）の抽出が完了しました。同一話者・同一文章でのヘッドセット比較や設定変更前後の比較にご活用ください。'
    : unmeasurableReason || '測定要件を満たしていないため解析を保留しました。';

  const assessmentItems: AssessmentItem[] = [
    {
      category: 'noise',
      title: '周辺音抑制・推定S/N比',
      status: !estimatedSnr.isMeasurable
        ? 'poor'
        : (estimatedSnr.snrDb || 0) >= 20
        ? 'excellent'
        : (estimatedSnr.snrDb || 0) >= 12
        ? 'good'
        : 'warning',
      valueText: estimatedSnr.isMeasurable
        ? `推定S/N比 ${estimatedSnr.snrDb} dB（定常暗騒音 ${representativeNoiseDbFS} dBFS）`
        : '測定不能',
      detail: estimatedSnr.isMeasurable
        ? hasNoiseLevelShiftWarning
          ? `事前ノイズ(${preNoiseDbFS} dBFS)と事後ノイズ(${postNoiseDbFS} dBFS)で6dB以上の騒音変動が観測されました。`
          : '発話前後の無音区間で測定した定常ノイズ電力が発話中も同等と仮定し、発話全体電力から減算して推定した参考S/N比です。'
        : estimatedSnr.unmeasurableReason || '純音声を分離できませんでした。',
    },
    {
      category: 'volume',
      title: '発声音量・適正度',
      status: !hasDetectedSpeech
        ? 'poor'
        : speechStats.avgDb >= -24 && speechStats.avgDb <= -14
        ? 'excellent'
        : speechStats.avgDb >= -30 && speechStats.avgDb <= -10
        ? 'good'
        : 'warning',
      valueText: hasDetectedSpeech ? formatDb(speechStats.avgDb) : '測定不能（発声未検出）',
      detail: !hasDetectedSpeech
        ? '有効な発声区間が検出されなかったため、発声音量を計測できませんでした。'
        : speechStats.avgDb >= -24 && speechStats.avgDb <= -14
        ? 'Web会議の推奨基準（-24 〜 -14 dBFS）内に綺麗に収まっています。'
        : speechStats.avgDb < -24
        ? '発声音量が小さめです。マイク感度または入力音量の引き上げを検討してください。'
        : '入力レベルが高めです。音割れを防ぐためマイクゲインの引き下げを検討してください。',
    },
    {
      category: 'clarity',
      title: '周波数帯域比（120-500Hz / 1.5-4.2kHz）',
      status: hasAnySpectralEnergy ? 'good' : 'warning',
      valueText: hasAnySpectralEnergy
        ? `参考帯域比 ${bandRatio.ratioDb > 0 ? '+' : ''}${bandRatio.ratioDb} dB`
        : '測定不能',
      detail: hasAnySpectralEnergy
        ? `${bandRatio.relativeObservationText}（※マイク特性や距離に依存する参考測定値です）`
        : bandRatio.relativeObservationText,
    },
    {
      category: 'clipping',
      title: 'デジタルクリッピング兆候',
      status: clippingDetails.hasClippingSign
        ? 'poor'
        : clippingDetails.clippedSampleCount > 0
        ? 'warning'
        : 'excellent',
      valueText: clippingDetails.statusText,
      detail: clippingDetails.hasClippingSign
        ? 'デジタル上限（0 dBFS）への波形連続張り付きが検出されました。マイク入力を下げてください。'
        : '耳障りなデジタル頭打ち（波形クリップ）の兆候は観測されませんでした。',
    },
  ];

  const actionableTips: string[] = [];
  if (hasNoiseLevelShiftWarning) {
    actionableTips.push(
      '測定の前半と後半で騒音環境が変化しました。正確な比較を行うため、周囲の環境音（エアコン風や物音）が一定の状態で再測定してください。'
    );
  }
  if (clippingDetails.hasClippingSign) {
    actionableTips.push(
      'マイク入力ゲインが高すぎて波形が頭打ちになっています。OSまたはアプリの入力ボリュームを下げてください。'
    );
  }
  if (hasDetectedSpeech && speechStats.avgDb < -26) {
    actionableTips.push(
      '発声音量が控えめです。マイクを口元（約3〜4cm斜め下）に近づけるか、入力ゲインを上げると相手に伝わりやすくなります。'
    );
  }
  if (actionableTips.length === 0) {
    actionableTips.push(
      '同一条件で別のヘッドセットを測定し、下の比較表でS/N比や周波数帯域比の傾向を比較してください。'
    );
  }

  // 9. Phase 2B-2B Extended Objective Acoustic Metrics (no scoring/grades/judgments)
  const preNoiseIntervals = mergeSampleIntervals(preNoiseWindows, 0, preNoiseEndSample);
  const postNoiseIntervals = mergeSampleIntervals(
    postNoiseWindows,
    postNoiseStartSample,
    postNoiseEndSample
  );

  const extendedMetrics = computePhase2bExtendedMetrics({
    rawData,
    sampleRate,
    speechIntervals,
    preNoiseIntervals,
    postNoiseIntervals,
    detectedSpeechWindowDbValues: detectedSpeechWindows.map((w) => w.dbFS),
    isOverallMeasurable: isMeasurable,
    overallUnmeasurableReason: unmeasurableReason,
    broadbandSnrDb: estimatedSnr.isMeasurable ? (estimatedSnr.snrDb ?? null) : null,
  });

  return {
    algoVersion: 'v2.0',
    isMeasurable,
    unmeasurableReason,
    timestamps,
    verificationInfo,
    speechStats,
    noiseStats,
    noiseAnalysis,
    estimatedSnr,
    snrDb: estimatedSnr.isMeasurable ? estimatedSnr.snrDb ?? 0 : 0,
    frequencyBalance,
    bandRatio,
    spectralCentroidHz,
    mufflenessLevel: null,
    mufflenessScore: null,
    clarityScore: null,
    extendedMetrics,
    clippingDetails,
    clippingDetected: clippingDetails.hasClippingSign,
    clippingRatio: clippingDetails.clippingRatioPercent / 100,
    overallScoreStatus,
    overallScoreText,
    overallGradeText,
    overallGrade: null,
    stressScore: null,
    gradeTitle,
    assessmentSummary,
    assessmentItems,
    actionableTips,
    segments,
  };
}

interface Phase2bSampleInterval {
  startSample: number;
  endSample: number;
}

interface Phase2bExtendedMetricsInput {
  rawData: Float32Array;
  sampleRate: number;
  speechIntervals: Phase2bSampleInterval[];
  preNoiseIntervals: Phase2bSampleInterval[];
  postNoiseIntervals: Phase2bSampleInterval[];
  detectedSpeechWindowDbValues: number[];
  isOverallMeasurable: boolean;
  overallUnmeasurableReason?: string;
  broadbandSnrDb: number | null;
}

function linearPercentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const clampedP = Math.max(0, Math.min(1, p));
  const pos = clampedP * (sortedAsc.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const frac = pos - lo;
  return sortedAsc[lo] * (1 - frac) + sortedAsc[hi] * frac;
}

function getSteadyPercentileMean(values: number[], lowPct = 0.2, highPct = 0.7): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const startIdx = Math.floor(sorted.length * lowPct);
  const endIdx = Math.max(startIdx + 1, Math.floor(sorted.length * highPct));
  let sum = 0;
  let count = 0;
  for (let i = startIdx; i < endIdx; i++) {
    sum += sorted[i];
    count++;
  }
  return count > 0 ? sum / count : sorted[0];
}

function powerToDbFS(powerLinear: number, minDb = -120): number {
  if (!Number.isFinite(powerLinear) || powerLinear <= 0) return minDb;
  const db = 10 * Math.log10(powerLinear);
  return Number(Math.max(minDb, Math.min(0, db)).toFixed(1));
}

function psdToDbPerHz(psdLinearPerHz: number, minDb = -150): number {
  if (!Number.isFinite(psdLinearPerHz) || psdLinearPerHz <= 0) return minDb;
  const db = 10 * Math.log10(psdLinearPerHz);
  return Number(Math.max(minDb, db).toFixed(1));
}

function buildRangeMeta(
  nominalLowHz: number,
  nominalHighHz: number,
  nyquistHz: number
): MetricFrequencyRange {
  const effectiveHighHz = Math.min(nominalHighHz, nyquistHz);
  return {
    nominalLowHz,
    nominalHighHz,
    effectiveLowHz: nominalLowHz,
    effectiveHighHz: Number(effectiveHighHz.toFixed(1)),
    truncatedByNyquist: nyquistHz < nominalHighHz,
  };
}

interface IntervalFftSlice {
  startSample: number;
  length: number;
}

function collectIntervalFftSlices(
  intervals: Phase2bSampleInterval[],
  fftSize: number,
  hopSize: number
): IntervalFftSlice[] {
  const slices: IntervalFftSlice[] = [];
  for (const iv of intervals) {
    const segLen = iv.endSample - iv.startSample;
    if (segLen <= 0) continue;
    if (segLen >= fftSize) {
      let lastPos = -1;
      for (let pos = iv.startSample; pos + fftSize <= iv.endSample; pos += hopSize) {
        slices.push({ startSample: pos, length: fftSize });
        lastPos = pos;
      }
      const trailingStart = iv.endSample - fftSize;
      if (lastPos >= 0 && trailingStart - lastPos >= Math.floor(hopSize / 2)) {
        slices.push({ startSample: trailingStart, length: fftSize });
      }
    } else {
      slices.push({ startSample: iv.startSample, length: segLen });
    }
  }
  return slices;
}

/**
 * Compute unified Phase 2B-2B objective acoustic features using a single
 * Parseval-calibrated 2048-pt periodic Hann FFT pipeline (75% overlap / hop 512).
 */
function computePhase2bExtendedMetrics(
  input: Phase2bExtendedMetricsInput
): Phase2bExtendedMetrics {
  const {
    rawData,
    sampleRate,
    speechIntervals,
    preNoiseIntervals,
    postNoiseIntervals,
    detectedSpeechWindowDbValues,
    isOverallMeasurable,
    overallUnmeasurableReason,
    broadbandSnrDb,
  } = input;

  const fftSize = 2048;
  const fftHopSize = 512;
  const halfFft = fftSize / 2;
  const nyquistHz = sampleRate / 2;
  const binWidth = sampleRate / fftSize;

  // Precompute periodic Hann window for full 2048-sample frames (exact squared-COLA at hop 512)
  const periodicHann2048 = new Float64Array(fftSize);
  let periodicHann2048Energy = 0;
  for (let i = 0; i < fftSize; i++) {
    const h = 0.5 * (1 - Math.cos((2 * Math.PI * i) / fftSize));
    periodicHann2048[i] = h;
    periodicHann2048Energy += h * h;
  }

  const fftReal = new Float64Array(fftSize);
  const fftImag = new Float64Array(fftSize);
  const frameSpectrum = new Float64Array(halfFft + 1);

  /**
   * Populate `frameSpectrum[0..halfFft]` with exact Parseval one-sided power
   * so that sum_{k=0..halfFft} frameSpectrum[k] equals frame mean-square power.
   */
  const computeCalibratedFrameSpectrum = (startSample: number, length: number): void => {
    fftReal.fill(0);
    fftImag.fill(0);

    let winEnergy = 0;
    if (length === fftSize) {
      winEnergy = periodicHann2048Energy;
      for (let i = 0; i < fftSize; i++) {
        fftReal[i] = rawData[startSample + i] * periodicHann2048[i];
      }
    } else {
      for (let i = 0; i < length; i++) {
        const h = length > 1 ? 0.5 * (1 - Math.cos((2 * Math.PI * i) / length)) : 1.0;
        fftReal[i] = rawData[startSample + i] * h;
        winEnergy += h * h;
      }
    }

    if (winEnergy <= 0) {
      frameSpectrum.fill(0);
      return;
    }

    fftRadix2(fftReal, fftImag, fftSize);

    const dcScale = 1.0 / (fftSize * winEnergy);
    const interiorScale = 2.0 / (fftSize * winEnergy);

    frameSpectrum[0] = (fftReal[0] * fftReal[0] + fftImag[0] * fftImag[0]) * dcScale;
    for (let k = 1; k < halfFft; k++) {
      frameSpectrum[k] = (fftReal[k] * fftReal[k] + fftImag[k] * fftImag[k]) * interiorScale;
    }
    frameSpectrum[halfFft] =
      (fftReal[halfFft] * fftReal[halfFft] + fftImag[halfFft] * fftImag[halfFft]) * dcScale;
  };

  // Precompute speech-band bins for Metric A & Metric E: [300, min(4200, nyquistHz)]
  const speechBandRange = buildRangeMeta(300, 4200, nyquistHz);
  const speechBandBinIndices: number[] = [];
  if (nyquistHz > 300) {
    for (let k = 1; k <= halfFft; k++) {
      const f = k * binWidth;
      if (f >= speechBandRange.effectiveLowHz && f <= speechBandRange.effectiveHighHz) {
        speechBandBinIndices.push(k);
      }
    }
  }

  // Analyze speech intervals in one unified pass:
  // - Length-weighted average one-sided power spectrum (Metrics A, B, C)
  // - Per-frame 300-4200Hz spectral flatness values (Metric E)
  const speechSlices = isOverallMeasurable
    ? collectIntervalFftSlices(speechIntervals, fftSize, fftHopSize)
    : [];
  const avgSpeechSpectrum = new Float64Array(halfFft + 1);
  let totalSpeechWeight = 0;
  let totalSpeechSpectrumPower = 0;
  const frameFlatnessValues: number[] = [];

  for (const slice of speechSlices) {
    computeCalibratedFrameSpectrum(slice.startSample, slice.length);
    const weight = slice.length / fftSize;
    totalSpeechWeight += weight;

    for (let k = 0; k <= halfFft; k++) {
      avgSpeechSpectrum[k] += frameSpectrum[k] * weight;
      totalSpeechSpectrumPower += frameSpectrum[k] * weight;
    }

    // Per-frame spectral flatness in [300, min(4200, nyquistHz)]
    if (speechBandBinIndices.length >= 2) {
      let inBandSum = 0;
      for (let i = 0; i < speechBandBinIndices.length; i++) {
        inBandSum += frameSpectrum[speechBandBinIndices[i]];
      }
      // Exclude brief silent frames (< -90 dBFS) to avoid noise-floor blowup
      if (inBandSum > 1e-9) {
        const arithMean = inBandSum / speechBandBinIndices.length;
        const logFloor = Math.max(1e-30, arithMean * 1e-12);
        let logSum = 0;
        for (let i = 0; i < speechBandBinIndices.length; i++) {
          logSum += Math.log(Math.max(frameSpectrum[speechBandBinIndices[i]], logFloor));
        }
        const geomMean = Math.exp(logSum / speechBandBinIndices.length);
        const sfm = Math.max(0, Math.min(1, geomMean / arithMean));
        if (Number.isFinite(sfm)) {
          frameFlatnessValues.push(sfm);
        }
      }
    }
  }

  if (totalSpeechWeight > 0) {
    for (let k = 0; k <= halfFft; k++) {
      avgSpeechSpectrum[k] /= totalSpeechWeight;
    }
    totalSpeechSpectrumPower /= totalSpeechWeight;
  }

  const hasValidSpeechSpectrum =
    isOverallMeasurable &&
    speechSlices.length > 0 &&
    totalSpeechWeight > 0 &&
    totalSpeechSpectrumPower > 1e-9;

  // Helper to sum average speech spectrum power & bin count in [lowHz, highHz) (or inclusive upper if requested)
  const measureBandPower = (lowHz: number, highHz: number, inclusiveHigh = false) => {
    let power = 0;
    let binCount = 0;
    for (let k = 1; k <= halfFft; k++) {
      const freq = k * binWidth;
      const inHigh = inclusiveHigh ? freq <= highHz + 1e-6 : freq < highHz;
      if (freq >= lowHz && inHigh) {
        power += avgSpeechSpectrum[k];
        binCount++;
      }
    }
    return {
      power,
      binCount,
      actualBandwidthHz: binCount * binWidth,
    };
  };

  // -------------------------------------------------------------------------
  // A. Speech-Band SNR (300 - 4200 Hz)
  // -------------------------------------------------------------------------
  const computeIntervalSteadyBandPower = (intervals: Phase2bSampleInterval[]): number | null => {
    if (intervals.length === 0 || speechBandBinIndices.length === 0) return null;
    const slices = collectIntervalFftSlices(intervals, fftSize, fftHopSize);
    if (slices.length === 0) return null;
    const perFrameBandPowers: number[] = [];
    for (const slice of slices) {
      computeCalibratedFrameSpectrum(slice.startSample, slice.length);
      let bandP = 0;
      for (let i = 0; i < speechBandBinIndices.length; i++) {
        bandP += frameSpectrum[speechBandBinIndices[i]];
      }
      perFrameBandPowers.push(bandP);
    }
    return getSteadyPercentileMean(perFrameBandPowers, 0.2, 0.7);
  };

  const preNoiseBandPower = computeIntervalSteadyBandPower(preNoiseIntervals);
  const postNoiseBandPower = computeIntervalSteadyBandPower(postNoiseIntervals);

  let speechBandSnr: SpeechBandSnrMetric;
  if (!isOverallMeasurable || !hasValidSpeechSpectrum) {
    speechBandSnr = {
      isMeasurable: false,
      status: 'unmeasurable',
      unit: 'dB',
      frequencyRange: speechBandRange,
      snrDb: null,
      broadbandDiffDb: null,
      speechBandPowerDbFS: null,
      noiseBandPowerDbFS: null,
      noiseEstimationMethod: 'percentile_20_70_linear_power',
      unmeasurableReason:
        overallUnmeasurableReason || '有効な発声区間が不足しているため、帯域内S/N比を測定できません',
    };
  } else if (speechBandBinIndices.length === 0 || nyquistHz <= 300) {
    speechBandSnr = {
      isMeasurable: false,
      status: 'unmeasurable',
      unit: 'dB',
      frequencyRange: speechBandRange,
      snrDb: null,
      broadbandDiffDb: null,
      speechBandPowerDbFS: null,
      noiseBandPowerDbFS: null,
      noiseEstimationMethod: 'percentile_20_70_linear_power',
      unmeasurableReason: 'サンプリング周波数が低すぎて300〜4200Hz帯域を測定できません',
    };
  } else if (preNoiseBandPower === null && postNoiseBandPower === null) {
    speechBandSnr = {
      isMeasurable: false,
      status: 'unmeasurable',
      unit: 'dB',
      frequencyRange: speechBandRange,
      snrDb: null,
      broadbandDiffDb: null,
      speechBandPowerDbFS: null,
      noiseBandPowerDbFS: null,
      noiseEstimationMethod: 'percentile_20_70_linear_power',
      unmeasurableReason: '発話前後の暗騒音区間が存在しないため測定不能です',
    };
  } else {
    const noiseBandPowerLinear =
      preNoiseBandPower !== null && postNoiseBandPower !== null
        ? (preNoiseBandPower + postNoiseBandPower) / 2
        : preNoiseBandPower !== null
        ? preNoiseBandPower
        : (postNoiseBandPower as number);

    let speechBandPowerLinear = 0;
    for (let i = 0; i < speechBandBinIndices.length; i++) {
      speechBandPowerLinear += avgSpeechSpectrum[speechBandBinIndices[i]];
    }

    const pureBandVoicePower = Math.max(0, speechBandPowerLinear - noiseBandPowerLinear);
    if (pureBandVoicePower <= 0 || speechBandPowerLinear <= 1e-9) {
      speechBandSnr = {
        isMeasurable: false,
        status: 'unmeasurable',
        unit: 'dB',
        frequencyRange: speechBandRange,
        snrDb: null,
        broadbandDiffDb: null,
        speechBandPowerDbFS: powerToDbFS(speechBandPowerLinear),
        noiseBandPowerDbFS: powerToDbFS(noiseBandPowerLinear),
        noiseEstimationMethod: 'percentile_20_70_linear_power',
        unmeasurableReason:
          '300〜4200Hz帯域の発声電力が定常暗騒音電力を上回っていないため、純音声を分離推定できません',
      };
    } else {
      const effectiveBandNoise = Math.max(noiseBandPowerLinear, 1e-9);
      const snrDb = Number((10 * Math.log10(pureBandVoicePower / effectiveBandNoise)).toFixed(1));
      const broadbandDiffDb =
        broadbandSnrDb !== null ? Number((snrDb - broadbandSnrDb).toFixed(1)) : null;

      speechBandSnr = {
        isMeasurable: true,
        status: speechBandRange.truncatedByNyquist ? 'reference_nyquist' : 'measurable',
        unit: 'dB',
        frequencyRange: speechBandRange,
        snrDb,
        broadbandDiffDb,
        speechBandPowerDbFS: powerToDbFS(speechBandPowerLinear),
        noiseBandPowerDbFS: powerToDbFS(noiseBandPowerLinear),
        noiseEstimationMethod: 'percentile_20_70_linear_power',
      };
    }
  }

  // -------------------------------------------------------------------------
  // B. High-Frequency Rolloff (1500-4200Hz, 4200-8000Hz, ratio, 95% rolloff)
  // -------------------------------------------------------------------------
  const rolloffUpperNominalHz = 8000;
  const rolloffFrequencyRange = buildRangeMeta(20, rolloffUpperNominalHz, nyquistHz);
  const rolloff95SpeechBandRange = buildRangeMeta(300, rolloffUpperNominalHz, nyquistHz);
  const isHighBandMeasurable = nyquistHz >= 8000 && hasValidSpeechSpectrum;
  const fftResolutionHz = Number(binWidth.toFixed(2));

  const buildRolloffConstraintNote = (): string => {
    const baseNote = `実効上限 < ${rolloffFrequencyRange.effectiveHighHz}Hz（FFT点数 ${fftSize}, 分解能 ${fftResolutionHz}Hz, SR ${sampleRate}Hz）`;
    if (nyquistHz < 8000) {
      return `${baseNote}。ナイキスト周波数（${nyquistHz}Hz）が8000Hz未満のため、4200〜8000Hz帯域および高域/中高域比は測定不能です。`;
    }
    if (sampleRate === 16000) {
      return `${baseNote}。16kHz環境では7200〜8000Hz付近に録音系アンチエイリアシングフィルタ減衰が含まれます。`;
    }
    return `${baseNote}。`;
  };

  const computeRolloff95ForRange = (range: MetricFrequencyRange): number | null => {
    if (range.effectiveHighHz <= range.effectiveLowHz) return null;
    let totalBandPower = 0;
    const bins: Array<{ freq: number; power: number }> = [];
    for (let k = 1; k <= halfFft; k++) {
      const freq = k * binWidth;
      if (freq >= range.effectiveLowHz && freq < range.effectiveHighHz) {
        const p = avgSpeechSpectrum[k];
        if (Number.isFinite(p) && p >= 0) {
          bins.push({ freq, power: p });
          totalBandPower += p;
        }
      }
    }
    if (bins.length === 0 || !Number.isFinite(totalBandPower) || totalBandPower <= 1e-12) {
      return null;
    }
    const target = totalBandPower * 0.95;
    let cum = 0;
    for (let i = 0; i < bins.length; i++) {
      const prevCum = cum;
      cum += bins[i].power;
      if (cum >= target) {
        if (i === 0 || bins[i].power <= 0) {
          return Number(bins[i].freq.toFixed(1));
        }
        const frac = (target - prevCum) / bins[i].power;
        const prevFreq = bins[i - 1].freq;
        const interp = prevFreq + frac * (bins[i].freq - prevFreq);
        return Number(
          Math.max(range.effectiveLowHz, Math.min(range.effectiveHighHz, interp)).toFixed(1)
        );
      }
    }
    return Number(bins[bins.length - 1].freq.toFixed(1));
  };

  let highFreqRolloff: HighFreqRolloffMetric;
  if (!hasValidSpeechSpectrum) {
    highFreqRolloff = {
      isMeasurable: false,
      isHighBandMeasurable: false,
      unitHz: 'Hz',
      unitRatio: 'dB',
      unitPower: 'dBFS',
      sampleRateHz: sampleRate,
      nyquistHz,
      fftSize,
      fftResolutionHz,
      rolloffThresholdPercent: 95,
      rolloffFrequencyRange,
      rolloff95SpeechBandRange,
      midHighBandRangeHz: [1500, 4200],
      highBandRangeHz: [4200, 8000],
      power1500_4200Linear: null,
      power1500_4200DbFS: null,
      power4200_8000Linear: null,
      power4200_8000DbFS: null,
      highToMidHighRatioDb: null,
      rolloff95Hz: null,
      rolloff95SpeechBandHz: null,
      constraintNote: buildRolloffConstraintNote(),
      unmeasurableReason:
        overallUnmeasurableReason || '有効な発声区間が不足しているため高域減衰を測定できません',
    };
  } else {
    const midHighMeas = nyquistHz >= 4200 ? measureBandPower(1500, 4200, false) : null;
    const highMeas = isHighBandMeasurable ? measureBandPower(4200, 8000, true) : null;

    // 95% cumulative-power spectral rolloff within [20, min(8000, nyquistHz)) and [300, min(8000, nyquistHz))
    const rolloff95Hz = computeRolloff95ForRange(rolloffFrequencyRange);
    const rolloff95SpeechBandHz = computeRolloff95ForRange(rolloff95SpeechBandRange);

    const p1500 = midHighMeas && midHighMeas.binCount > 0 ? midHighMeas.power : null;
    const p4200 = highMeas && highMeas.binCount > 0 ? highMeas.power : null;

    let highToMidHighRatioDb: number | null = null;
    if (isHighBandMeasurable && p1500 !== null && p4200 !== null) {
      const ratioFloor = Math.max(1e-30, totalSpeechSpectrumPower * 1e-12);
      highToMidHighRatioDb = Number(
        (10 * Math.log10(Math.max(p4200, ratioFloor) / Math.max(p1500, ratioFloor))).toFixed(1)
      );
    }

    highFreqRolloff = {
      isMeasurable: rolloff95Hz !== null,
      isHighBandMeasurable,
      unitHz: 'Hz',
      unitRatio: 'dB',
      unitPower: 'dBFS',
      sampleRateHz: sampleRate,
      nyquistHz,
      fftSize,
      fftResolutionHz,
      rolloffThresholdPercent: 95,
      rolloffFrequencyRange,
      rolloff95SpeechBandRange,
      midHighBandRangeHz: [1500, 4200],
      highBandRangeHz: [4200, 8000],
      power1500_4200Linear: p1500,
      power1500_4200DbFS: p1500 !== null ? powerToDbFS(p1500) : null,
      power4200_8000Linear: p4200,
      power4200_8000DbFS: p4200 !== null ? powerToDbFS(p4200) : null,
      highToMidHighRatioDb,
      rolloff95Hz,
      rolloff95SpeechBandHz,
      constraintNote: buildRolloffConstraintNote(),
    };
  }

  // -------------------------------------------------------------------------
  // C. Band-Energy Comparison Ratios (bandwidth-normalized PSD + integrated)
  // -------------------------------------------------------------------------
  const makeBandValue = (
    label: string,
    lowHz: number,
    highHz: number,
    inclusiveHigh: boolean,
    requireFullHighHz = true
  ): BandEnergyValue => {
    const canMeasure =
      hasValidSpeechSpectrum &&
      (requireFullHighHz ? nyquistHz >= highHz : nyquistHz > lowHz);
    if (!canMeasure) {
      return {
        label,
        rangeHz: [lowHz, highHz],
        effectiveRangeHz: null,
        isMeasurable: false,
        powerLinear: null,
        powerDbFS: null,
        psdLinearPerHz: null,
        psdDbPerHz: null,
        actualBandwidthHz: null,
      };
    }
    const meas = measureBandPower(lowHz, Math.min(highHz, nyquistHz), inclusiveHigh);
    if (meas.binCount === 0 || meas.actualBandwidthHz <= 0) {
      return {
        label,
        rangeHz: [lowHz, highHz],
        effectiveRangeHz: null,
        isMeasurable: false,
        powerLinear: null,
        powerDbFS: null,
        psdLinearPerHz: null,
        psdDbPerHz: null,
        actualBandwidthHz: null,
      };
    }
    const psd = meas.power / meas.actualBandwidthHz;
    return {
      label,
      rangeHz: [lowHz, highHz],
      effectiveRangeHz: [lowHz, Math.min(highHz, nyquistHz)],
      isMeasurable: true,
      powerLinear: meas.power,
      powerDbFS: powerToDbFS(meas.power),
      psdLinearPerHz: psd,
      psdDbPerHz: psdToDbPerHz(psd),
      actualBandwidthHz: Number(meas.actualBandwidthHz.toFixed(1)),
    };
  };

  const lowBand = makeBandValue('低域 (120–300Hz)', 120, 300, false, true);
  const coreBand = makeBandValue('声の芯 (300–1000Hz)', 300, 1000, false, true);
  const clarityBand = makeBandValue('明瞭域 (1500–4200Hz)', 1500, 4200, false, true);
  const highBand = makeBandValue('高域 (4200–8000Hz)', 4200, 8000, true, true);

  const computeBandPairRatioDb = (
    numVal: BandEnergyValue,
    denVal: BandEnergyValue,
    usePsd: boolean
  ): number | null => {
    if (!numVal.isMeasurable || !denVal.isMeasurable) return null;
    const rawNum = usePsd ? numVal.psdLinearPerHz : numVal.powerLinear;
    const rawDen = usePsd ? denVal.psdLinearPerHz : denVal.powerLinear;
    if (rawNum === null || rawDen === null) return null;
    const refFloor = usePsd
      ? Math.max(1e-32, (totalSpeechSpectrumPower / Math.max(1, nyquistHz)) * 1e-12)
      : Math.max(1e-30, totalSpeechSpectrumPower * 1e-12);
    const ratio = 10 * Math.log10(Math.max(rawNum, refFloor) / Math.max(rawDen, refFloor));
    return Number.isFinite(ratio) ? Number(ratio.toFixed(1)) : null;
  };

  const bandEnergyComparison: BandEnergyComparisonMetric = {
    isMeasurable:
      hasValidSpeechSpectrum && lowBand.isMeasurable && coreBand.isMeasurable,
    unitRatio: 'dB',
    ratioMethod: 'bandwidth_normalized_psd',
    fftWindow: 'hann',
    fftSize,
    bands: {
      low_120_300: lowBand,
      core_300_1000: coreBand,
      clarity_1500_4200: clarityBand,
      high_4200_8000: highBand,
    },
    ratios: {
      lowToCoreDb: computeBandPairRatioDb(lowBand, coreBand, true),
      clarityToCoreDb: computeBandPairRatioDb(clarityBand, coreBand, true),
      highToClarityDb: computeBandPairRatioDb(highBand, clarityBand, true),
    },
    integratedRatiosDb: {
      lowToCoreDb: computeBandPairRatioDb(lowBand, coreBand, false),
      clarityToCoreDb: computeBandPairRatioDb(clarityBand, coreBand, false),
      highToClarityDb: computeBandPairRatioDb(highBand, clarityBand, false),
    },
    ...(!hasValidSpeechSpectrum
      ? {
          unmeasurableReason:
            overallUnmeasurableReason || '有効な発声区間が不足しているため帯域エネルギー比較を測定できません',
        }
      : {}),
  };

  // -------------------------------------------------------------------------
  // D. Speech Level Variability (IQR, p25/p75, median, min/max/range)
  // -------------------------------------------------------------------------
  const varNote =
    '発声区間内の30ms窓RMS音量のばらつき（IQR = p75 - p25）です。話者の抑揚・発話強弱の影響も受けるため、AGCやコンプレッサーの有無を断定する指標ではありません。';
  let speechLevelVariability: SpeechLevelVariabilityMetric;

  if (!isOverallMeasurable || detectedSpeechWindowDbValues.length < 4) {
    speechLevelVariability = {
      isMeasurable: false,
      unit: 'dB',
      windowDurationMs: 30,
      hopDurationMs: 15,
      speechWindowCount: detectedSpeechWindowDbValues.length,
      medianDbFS: null,
      p25DbFS: null,
      p75DbFS: null,
      iqrDb: null,
      minDbFS: null,
      maxDbFS: null,
      rangeDb: null,
      interpretationNote: varNote,
      unmeasurableReason:
        overallUnmeasurableReason || '発声ウィンドウ数が不足しているため音量変動を測定できません',
    };
  } else {
    const sortedDb = [...detectedSpeechWindowDbValues].sort((a, b) => a - b);
    const p25 = linearPercentile(sortedDb, 0.25);
    const median = linearPercentile(sortedDb, 0.5);
    const p75 = linearPercentile(sortedDb, 0.75);
    const minDb = sortedDb[0];
    const maxDb = sortedDb[sortedDb.length - 1];
    speechLevelVariability = {
      isMeasurable: true,
      unit: 'dB',
      windowDurationMs: 30,
      hopDurationMs: 15,
      speechWindowCount: sortedDb.length,
      medianDbFS: Number(median.toFixed(1)),
      p25DbFS: Number(p25.toFixed(1)),
      p75DbFS: Number(p75.toFixed(1)),
      iqrDb: Number(Math.max(0, p75 - p25).toFixed(1)),
      minDbFS: Number(minDb.toFixed(1)),
      maxDbFS: Number(maxDb.toFixed(1)),
      rangeDb: Number(Math.max(0, maxDb - minDb).toFixed(1)),
      interpretationNote: varNote,
    };
  }

  // -------------------------------------------------------------------------
  // E. Spectral Flatness (300 - 4200 Hz, clamped to Nyquist)
  // -------------------------------------------------------------------------
  const flatnessNote =
    '300〜4200Hzのスペクトル平坦度（幾何平均/算術平均、0〜1）です。1に近いほど広帯域雑音的、0に近いほど倍音・単音支配的です。有声音（母音）と無声音（子音）の比率で変わるため自然さ評価には直接変換しません。';
  let spectralFlatness: SpectralFlatnessMetric;

  if (!isOverallMeasurable || !hasValidSpeechSpectrum || frameFlatnessValues.length === 0) {
    spectralFlatness = {
      isMeasurable: false,
      unit: 'ratio_0_to_1',
      frequencyRange: speechBandRange,
      aggregationMethod: 'per_frame_median_and_quartiles',
      validSpeechFrameCount: frameFlatnessValues.length,
      median: null,
      mean: null,
      p25: null,
      p75: null,
      interpretationNote: flatnessNote,
      unmeasurableReason:
        overallUnmeasurableReason || '有効な発声フレームが不足しているためスペクトル平坦度を測定できません',
    };
  } else {
    const sortedSfm = [...frameFlatnessValues].sort((a, b) => a - b);
    const meanSfm =
      sortedSfm.reduce((acc, v) => acc + v, 0) / sortedSfm.length;
    spectralFlatness = {
      isMeasurable: true,
      unit: 'ratio_0_to_1',
      frequencyRange: speechBandRange,
      aggregationMethod: 'per_frame_median_and_quartiles',
      validSpeechFrameCount: sortedSfm.length,
      median: Number(linearPercentile(sortedSfm, 0.5).toFixed(3)),
      mean: Number(meanSfm.toFixed(3)),
      p25: Number(linearPercentile(sortedSfm, 0.25).toFixed(3)),
      p75: Number(linearPercentile(sortedSfm, 0.75).toFixed(3)),
      interpretationNote: flatnessNote,
    };
  }

  return {
    fftNormalization: 'parseval_one_sided_hann',
    fftSize,
    fftHopSize,
    sampleRateHz: sampleRate,
    nyquistHz,
    speechBandSnr,
    highFreqRolloff,
    bandEnergyComparison,
    speechLevelVariability,
    spectralFlatness,
  };
}

