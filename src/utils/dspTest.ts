/**
 * Copyright (c) 2026 八百茄子 (yaonasu)
 * SPDX-License-Identifier: MIT
 */

/**
 * DSP verification script for known signals
 */
import {
  rmsToDb,
  detectClipping,
  fftRadix2,
  analyzeAudioBuffer,
} from './audioDsp';
import { RecordingSequenceTimestamps } from '../types/audio';

function assertApprox(name: string, actual: number, expected: number, tolerance = 0.1) {
  const diff = Math.abs(actual - expected);
  if (diff > tolerance) {
    throw new Error(`FAIL: ${name} expected ~${expected}, got ${actual} (diff: ${diff})`);
  }
  console.log(`✓ PASS: ${name} = ${actual} (expected ~${expected})`);
}

function assertTrue(name: string, condition: boolean) {
  if (!condition) {
    throw new Error(`FAIL: ${name} condition was false`);
  }
  console.log(`✓ PASS: ${name}`);
}

export function runDspVerificationTests() {
  console.log('=== Starting DSP Verification Tests ===\n');

  // Test 1: RMS & dBFS of pure sine wave (Amp = 0.5, 1000Hz, sampleRate = 48000)
  const sampleRate = 48000;
  const numSamples = 48000 * 4; // 4 seconds
  const sine1k = new Float32Array(numSamples);
  const targetAmp = 0.5;
  for (let i = 0; i < numSamples; i++) {
    sine1k[i] = targetAmp * Math.sin((2 * Math.PI * 1000 * i) / sampleRate);
  }

  let sumSq = 0;
  for (let i = 0; i < numSamples; i++) sumSq += sine1k[i] * sine1k[i];
  const rms = Math.sqrt(sumSq / numSamples);
  const expectedRms = targetAmp / Math.SQRT2; // ~0.35355
  assertApprox('Sine RMS', rms, expectedRms, 0.005);

  const dbFS = rmsToDb(rms);
  const expectedDbFS = 20 * Math.log10(expectedRms); // -9.03 dBFS
  assertApprox('Sine dBFS', dbFS, expectedDbFS, 0.05);

  // Test 2: Silence & Boundary safety
  const silenceDbFS = rmsToDb(0);
  assertApprox('Silence dBFS', silenceDbFS, -90, 0.01);
  assertTrue('Silence is not NaN', !Number.isNaN(silenceDbFS));

  // Test 3: Digital Clipping Detection
  const normalClip = detectClipping(sine1k);
  assertTrue('Normal sine has no clipping sign', !normalClip.hasClippingSign);
  assertApprox('Normal sine peak value', normalClip.peakValue, 0.5, 0.01);

  // Create heavily clipped signal (Amp 1.5 clamped to 1.0)
  const clippedSignal = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    const raw = 1.5 * Math.sin((2 * Math.PI * 400 * i) / sampleRate);
    clippedSignal[i] = Math.max(-1.0, Math.min(1.0, raw));
  }
  const clippedResult = detectClipping(clippedSignal);
  assertTrue('Clipped signal detected clipping sign', clippedResult.hasClippingSign);
  assertTrue('Clipped consecutive samples >= 3', clippedResult.maxConsecutiveClipSamples >= 3);
  assertApprox('Clipped signal peak value', clippedResult.peakValue, 1.0, 0.001);

  // Test 4: FFT 2048 frequency localization on 1000 Hz pure sine
  const fftSize = 2048;
  const real = new Float64Array(fftSize);
  const imag = new Float64Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    real[i] = Math.sin((2 * Math.PI * 1000 * i) / sampleRate);
    imag[i] = 0;
  }
  fftRadix2(real, imag, fftSize);

  let maxBin = 0;
  let maxPower = 0;
  for (let k = 0; k < fftSize / 2; k++) {
    const power = real[k] * real[k] + imag[k] * imag[k];
    if (power > maxPower) {
      maxPower = power;
      maxBin = k;
    }
  }
  const peakFreq = (maxBin * sampleRate) / fftSize;
  const expectedFreq = 1000;
  assertApprox('FFT peak frequency detection', peakFreq, expectedFreq, sampleRate / fftSize + 1);

  // Test 5: End-to-end analyzeAudioBuffer with simulated guided sequence:
  // 3s silence/noise -> 4s speech (1000Hz at -14dBFS) -> 2s silence/noise
  const totalDurationSec = 9;
  const totalSimSamples = sampleRate * totalDurationSec;
  const simBufferData = new Float32Array(totalSimSamples);

  // Background noise floor: white noise at -50 dBFS (Amp ~ 0.0044)
  const noiseAmp = 0.0044;
  for (let i = 0; i < totalSimSamples; i++) {
    simBufferData[i] = (Math.random() * 2 - 1) * noiseAmp;
  }

  // Add 4s speech in the middle: 3s to 7s (at amp 0.2 ~ -17dBFS)
  const speechStartIdx = sampleRate * 3;
  const speechEndIdx = sampleRate * 7;
  const speechAmp = 0.2;
  for (let i = speechStartIdx; i < speechEndIdx; i++) {
    simBufferData[i] += speechAmp * Math.sin((2 * Math.PI * 800 * (i - speechStartIdx)) / sampleRate);
  }

  // Mock AudioBuffer
  const mockAudioBuffer = {
    sampleRate,
    length: totalSimSamples,
    duration: totalDurationSec,
    numberOfChannels: 1,
    getChannelData: () => simBufferData,
  } as unknown as AudioBuffer;

  const timestamps: RecordingSequenceTimestamps = {
    recordStartTimeMs: 1000,
    promptSpeechTimeMs: 4000, // +3000ms
    requestStopTimeMs: 8000,  // +4000ms of speech
    recordEndTimeMs: 10000,   // +2000ms post noise
  };

  const evalResult = analyzeAudioBuffer(mockAudioBuffer, timestamps);

  assertTrue('Algo version is v2.0', evalResult.algoVersion === 'v2.0');
  assertTrue('Evaluation isMeasurable is true for 4s speech', evalResult.isMeasurable);
  assertTrue('SNR is measurable', evalResult.estimatedSnr.isMeasurable);
  console.log(`Estimated SNR: ${evalResult.estimatedSnr.snrDb} dB`);
  assertTrue('Estimated SNR is positive and significant', (evalResult.estimatedSnr.snrDb || 0) > 15);
  assertTrue('Overall score status is pending', evalResult.overallScoreStatus === 'pending');
  assertTrue('Clipping detected is false for normal speech', !evalResult.clippingDetected);

  // Test 6: Check unmeasurable when speech < 3s (e.g. only 1.5s speech)
  const shortTimestamps: RecordingSequenceTimestamps = {
    recordStartTimeMs: 1000,
    promptSpeechTimeMs: 4000,
    requestStopTimeMs: 5200, // only 1.2s
    recordEndTimeMs: 7200,
  };
  const shortEval = analyzeAudioBuffer(mockAudioBuffer, shortTimestamps);
  assertTrue('Short speech flagged as unmeasurable', !shortEval.isMeasurable);
  assertTrue('Has clear unmeasurable reason', !!shortEval.unmeasurableReason);

  // Test 7: Check unmeasurable when voice power <= noise power
  const allNoiseBuffer = {
    sampleRate,
    length: totalSimSamples,
    duration: totalDurationSec,
    numberOfChannels: 1,
    getChannelData: () => {
      const arr = new Float32Array(totalSimSamples);
      for (let i = 0; i < totalSimSamples; i++) arr[i] = (Math.random() * 2 - 1) * 0.05;
      return arr;
    },
  } as unknown as AudioBuffer;

  const noVoiceEval = analyzeAudioBuffer(allNoiseBuffer, timestamps);
  assertTrue(
    'No pure voice results in estimatedSnr unmeasurable (no clamping to 0dB)',
    !noVoiceEval.estimatedSnr.isMeasurable
  );

  // =========================================================================
  // Phase 2A Tests (Boundaries, 7-case VAD, FFT Alignment, SNR, Abnormal Inputs)
  // =========================================================================

  let seed = 42;
  const detRand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed / 0xffffffff) * 2 - 1;
  };
  const makeMockBuffer = (data: Float32Array, sr = sampleRate): AudioBuffer =>
    ({
      sampleRate: sr,
      length: data.length,
      duration: data.length / sr,
      numberOfChannels: 1,
      getChannelData: () => data,
    }) as unknown as AudioBuffer;

  const addHarmonicSpeech = (arr: Float32Array, sr: number, sSec: number, eSec: number, amp: number) => {
    const s0 = Math.floor(sSec * sr);
    const s1 = Math.floor(eSec * sr);
    for (let i = s0; i < s1 && i < arr.length; i++) {
      const t = (i - s0) / sr;
      const env = Math.min(1, t / 0.015, (eSec - sSec - t) / 0.015);
      arr[i] +=
        env *
        amp *
        (0.55 * Math.sin(2 * Math.PI * 150 * t) +
          0.3 * Math.sin(2 * Math.PI * 520 * t) +
          0.15 * Math.sin(2 * Math.PI * 1800 * t));
    }
  };

  const addFricativeBurst = (arr: Float32Array, sr: number, sSec: number, eSec: number, amp: number) => {
    const s0 = Math.floor(sSec * sr);
    const s1 = Math.floor(eSec * sr);
    for (let i = s0; i < s1 && i < arr.length; i++) {
      const t = (i - s0) / sr;
      arr[i] += amp * detRand() * Math.sin(2 * Math.PI * 5500 * t);
    }
  };

  const addKeyTransient = (arr: Float32Array, sr: number, tSec: number, amp: number) => {
    const s0 = Math.floor(tSec * sr);
    const len = Math.floor(0.025 * sr);
    for (let i = 0; i < len && s0 + i < arr.length; i++) {
      const env = Math.exp(-i / (0.006 * sr));
      arr[s0 + i] += amp * env * (0.5 * detRand() + 0.5 * Math.sin(2 * Math.PI * 2200 * (i / sr)));
    }
  };

  const evalVadMetrics = (
    segments: { startTime: number; endTime: number; isSpeech: boolean }[],
    gtIntervals: [number, number][],
    evalStart: number,
    evalEnd: number
  ) => {
    const step = 0.015;
    let tp = 0;
    let fp = 0;
    let fn = 0;
    let tn = 0;
    for (let t = evalStart + step / 2; t < evalEnd; t += step) {
      const gt = gtIntervals.some(([a, b]) => t >= a && t <= b);
      const pred = segments.some((s) => t >= s.startTime && t < s.endTime && s.isSpeech);
      if (gt && pred) tp++;
      else if (!gt && pred) fp++;
      else if (gt && !pred) fn++;
      else tn++;
    }
    const fpr = tn + fp > 0 ? (fp / (tn + fp)) * 100 : 0;
    const fnr = tp + fn > 0 ? (fn / (tp + fn)) * 100 : 0;
    const acc = tp + tn + fp + fn > 0 ? ((tp + tn) / (tp + tn + fp + fn)) * 100 : 100;
    return { fpr, fnr, acc };
  };

  // Test 8: Boundary precision & non-overlap verification (including AudioContext timestamps)
  {
    const dBoundary = new Float32Array(sampleRate * 10);
    for (let i = 0; i < dBoundary.length; i++) dBoundary[i] = detRand() * 0.002; // -57 dBFS noise
    // Loud speech starts EXACTLY at 3.00s and ends at 7.50s; click transient at 8.05s (inside 300ms skip)
    addHarmonicSpeech(dBoundary, sampleRate, 3.0, 7.5, 0.3);
    addKeyTransient(dBoundary, sampleRate, 8.05, 0.7);
    const tsBoundary: RecordingSequenceTimestamps = {
      recordStartTimeMs: 1000,
      promptSpeechTimeMs: 4000,
      requestStopTimeMs: 9000,
      recordEndTimeMs: 11000,
      audioCtxStartTimeSec: 10.0,
      audioCtxPromptTimeSec: 13.0,
      audioCtxStopRequestTimeSec: 18.0,
      audioCtxEndTimeSec: 20.0,
    };
    const resB = analyzeAudioBuffer(makeMockBuffer(dBoundary), tsBoundary);
    assertTrue(
      'Boundary: pre-noise unaffected by speech starting at 3.00s',
      resB.noiseAnalysis.preNoiseDbFS < -50
    );
    assertTrue(
      'Boundary: post-noise unaffected by 8.05s stop-click within 300ms skip',
      resB.noiseAnalysis.postNoiseDbFS < -50 && resB.noiseStats.maxDb < -45
    );
    // Ensure no speech segment exists before 2.99s or after 8.01s
    const leakedOutside = resB.segments.some(
      (s) => s.isSpeech && (s.startTime < 2.98 || s.endTime > 8.02)
    );
    assertTrue('Boundary: zero speech detections inside pre/post noise windows', !leakedOutside);
  }

  // Test 9: 7-case VAD verification (normal, quiet+rumble, fricatives, tails, fan, key clicks, pauses)
  {
    // 9a: Quiet speech (-38 dBFS) under 80Hz rumble (-35 dBFS)
    const dQuiet = new Float32Array(sampleRate * 10);
    for (let i = 0; i < dQuiet.length; i++) {
      dQuiet[i] = 0.025 * Math.sin((2 * Math.PI * 80 * i) / sampleRate) + detRand() * 0.0015;
    }
    addHarmonicSpeech(dQuiet, sampleRate, 3.2, 7.0, 0.025);
    const resQuiet = analyzeAudioBuffer(makeMockBuffer(dQuiet), {
      recordStartTimeMs: 0,
      promptSpeechTimeMs: 3000,
      requestStopTimeMs: 8000,
      recordEndTimeMs: 10000,
    });
    const mQuiet = evalVadMetrics(resQuiet.segments, [[3.2, 7.0]], 3.0, 8.0);
    assertTrue(
      `VAD Quiet+Rumble accuracy >= 95% (got ${mQuiet.acc.toFixed(1)}%, FNR=${mQuiet.fnr.toFixed(1)}%)`,
      mQuiet.acc >= 95 && mQuiet.fnr <= 5
    );

    // 9b: Unvoiced consonant /s/ + voiced speech + soft tail
    const dCons = new Float32Array(sampleRate * 10);
    for (let i = 0; i < dCons.length; i++) dCons[i] = detRand() * 0.002;
    addFricativeBurst(dCons, sampleRate, 3.35, 3.5, 0.04);
    addHarmonicSpeech(dCons, sampleRate, 3.5, 6.4, 0.22);
    // Soft trailing tail 6.4..6.7s
    for (let i = Math.floor(6.4 * sampleRate); i < Math.floor(6.7 * sampleRate); i++) {
      const t = (i - 6.4 * sampleRate) / sampleRate;
      dCons[i] += 0.1 * Math.exp(-3.0 * (t / 0.3)) * Math.sin(2 * Math.PI * 140 * t);
    }
    const resCons = analyzeAudioBuffer(makeMockBuffer(dCons), {
      recordStartTimeMs: 0,
      promptSpeechTimeMs: 3000,
      requestStopTimeMs: 8000,
      recordEndTimeMs: 10000,
    });
    const mCons = evalVadMetrics(resCons.segments, [[3.35, 6.7]], 3.0, 8.0);
    assertTrue(
      `VAD Fricative+Tail accuracy >= 95% (got ${mCons.acc.toFixed(1)}%)`,
      mCons.acc >= 95
    );

    // 9c: PC Fan stationary noise + 3 keyboard clicks ONLY (no speech) -> must have 0% FPR
    const dClicksOnly = new Float32Array(sampleRate * 10);
    for (let i = 0; i < dClicksOnly.length; i++) {
      dClicksOnly[i] = 0.012 * Math.sin((2 * Math.PI * 220 * i) / sampleRate) + detRand() * 0.014;
    }
    addKeyTransient(dClicksOnly, sampleRate, 3.8, 0.45);
    addKeyTransient(dClicksOnly, sampleRate, 5.0, 0.45);
    addKeyTransient(dClicksOnly, sampleRate, 6.2, 0.45);
    const resClicks = analyzeAudioBuffer(makeMockBuffer(dClicksOnly), {
      recordStartTimeMs: 0,
      promptSpeechTimeMs: 3000,
      requestStopTimeMs: 8000,
      recordEndTimeMs: 10000,
    });
    const mClicks = evalVadMetrics(resClicks.segments, [], 3.0, 8.0);
    assertTrue(
      `VAD Fan+Clicks-only FPR == 0% (got ${mClicks.fpr.toFixed(1)}%)`,
      mClicks.fpr === 0 && !resClicks.isMeasurable
    );

    // 9d: Normal speech with 300ms pause + 50ms intra-word closure + key click inside pause
    const dPauses = new Float32Array(sampleRate * 10);
    for (let i = 0; i < dPauses.length; i++) dPauses[i] = detRand() * 0.003;
    addHarmonicSpeech(dPauses, sampleRate, 3.1, 4.3, 0.25);
    addKeyTransient(dPauses, sampleRate, 4.6, 0.4); // click inside 800ms pause
    addHarmonicSpeech(dPauses, sampleRate, 5.1, 6.0, 0.25);
    // 50ms intra-word stop gap 6.0..6.05s
    addHarmonicSpeech(dPauses, sampleRate, 6.05, 7.4, 0.25);
    const resPauses = analyzeAudioBuffer(makeMockBuffer(dPauses), {
      recordStartTimeMs: 0,
      promptSpeechTimeMs: 3000,
      requestStopTimeMs: 8000,
      recordEndTimeMs: 10000,
    });
    const clickDetectedAsSpeech = resPauses.segments.some(
      (s) => s.isSpeech && s.startTime <= 4.62 && s.endTime >= 4.59
    );
    assertTrue('VAD rejects key click inside intra-speech pause', !clickDetectedAsSpeech);
    assertTrue('VAD detects >= 3.0s measurable speech across phrases', resPauses.isMeasurable);
  }

  // Test 10: FFT boundary alignment (must NOT leak adjacent loud out-of-band noise)
  {
    const dFft = new Float32Array(sampleRate * 10);
    // Pure 1000Hz speech in [3.0s, 6.2s], immediately followed at 6.20s by loud 60Hz sub-bass noise
    for (let i = Math.floor(3.0 * sampleRate); i < Math.floor(6.2 * sampleRate); i++) {
      dFft[i] = 0.25 * Math.sin((2 * Math.PI * 1000 * i) / sampleRate);
    }
    // Note: put 60Hz burst inside pause [6.20s, 6.60s] and after requestStop at 8.0s
    // To keep 6.20s out of speech, ensure speech ends strictly by 6.20s (sub-bass guard rejects <120Hz)
    for (let i = Math.floor(6.2 * sampleRate); i < Math.floor(7.5 * sampleRate); i++) {
      dFft[i] = 0.5 * Math.sin((2 * Math.PI * 60 * i) / sampleRate);
    }
    const resFft = analyzeAudioBuffer(makeMockBuffer(dFft), {
      recordStartTimeMs: 0,
      promptSpeechTimeMs: 3000,
      requestStopTimeMs: 8000,
      recordEndTimeMs: 10000,
    });
    assertApprox('FFT aligned: subBassRumble is 0% (no 60Hz leakage)', resFft.frequencyBalance.subBassRumble, 0, 1);
    assertApprox('FFT aligned: spectralCentroidHz ~ 1000Hz', resFft.spectralCentroidHz, 1000, 30);
  }

  // Test 11: SNR known-signal & zero-noise (no Infinity)
  {
    const dZeroNoise = new Float32Array(sampleRate * 9);
    addHarmonicSpeech(dZeroNoise, sampleRate, 3.2, 6.8, 0.2);
    const resZero = analyzeAudioBuffer(makeMockBuffer(dZeroNoise), {
      recordStartTimeMs: 0,
      promptSpeechTimeMs: 3000,
      requestStopTimeMs: 7000,
      recordEndTimeMs: 9000,
    });
    assertTrue(
      'Zero-noise clean speech produces finite SNR (never Infinity)',
      resZero.estimatedSnr.isMeasurable && Number.isFinite(resZero.estimatedSnr.snrDb)
    );
  }

  // Test 12: Abnormal inputs (all silence, 10ms ultra-short clip, NaN/Infinity samples)
  {
    // 12a: All silence
    const dSil = new Float32Array(sampleRate * 9);
    const resSil = analyzeAudioBuffer(makeMockBuffer(dSil), {
      recordStartTimeMs: 0,
      promptSpeechTimeMs: 3000,
      requestStopTimeMs: 7000,
      recordEndTimeMs: 9000,
    });
    assertTrue('All silence is unmeasurable', !resSil.isMeasurable && !resSil.estimatedSnr.isMeasurable);
    assertApprox('All silence speech minDb is -90 (not 0)', resSil.speechStats.minDb, -90, 0.1);
    assertApprox('All silence spectralCentroidHz is 0 (not fake 1500)', resSil.spectralCentroidHz, 0, 0.1);

    // 12b: Ultra-short 10ms buffer (< 30ms windowSize)
    const dTiny = new Float32Array(480);
    const resTiny = analyzeAudioBuffer(makeMockBuffer(dTiny));
    assertTrue(
      '10ms ultra-short buffer produces no NaN values',
      !resTiny.isMeasurable &&
        Number.isFinite(resTiny.speechStats.avgDb) &&
        Number.isFinite(resTiny.noiseStats.avgDb) &&
        Number.isFinite(resTiny.bandRatio.ratioDb)
    );

    // 12c: NaN / Infinity sample injection
    const dNan = new Float32Array(sampleRate * 9);
    addHarmonicSpeech(dNan, sampleRate, 3.1, 6.8, 0.2);
    dNan[100] = NaN;
    dNan[sampleRate * 4] = Infinity;
    dNan[sampleRate * 5] = -Infinity;
    const resNan = analyzeAudioBuffer(makeMockBuffer(dNan), {
      recordStartTimeMs: 0,
      promptSpeechTimeMs: 3000,
      requestStopTimeMs: 7000,
      recordEndTimeMs: 9000,
    });
    assertTrue(
      'NaN/Infinity samples sanitized cleanly without NaN propagation',
      Number.isFinite(resNan.speechStats.avgDb) &&
        Number.isFinite(resNan.noiseStats.avgDb) &&
        Number.isFinite(resNan.clippingDetails.peakDbFS) &&
        Number.isFinite(resNan.bandRatio.ratioDb) &&
        Number.isFinite(resNan.spectralCentroidHz)
    );
  }

  // =========================================================================
  // Phase 2B-2A Tests (Linear AudioSegment RMS, Overlap Deduplication,
  // Transient Exclusion, Clipping vs 30ms Max RMS, BandRatio Floor, Dummy Nulling)
  // =========================================================================

  // Test 13: Constant-amplitude sine wave RMS accuracy (speechStats & AudioSegment)
  {
    const dSine = new Float32Array(sampleRate * 9);
    const targetDb = -20.0;
    const amp = Math.pow(10, targetDb / 20) * Math.SQRT2;
    for (let i = Math.floor(3.2 * sampleRate); i < Math.floor(6.8 * sampleRate); i++) {
      dSine[i] = amp * Math.sin((2 * Math.PI * 600 * i) / sampleRate);
    }
    const resSine = analyzeAudioBuffer(makeMockBuffer(dSine), {
      recordStartTimeMs: 0,
      promptSpeechTimeMs: 3000,
      requestStopTimeMs: 7000,
      recordEndTimeMs: 9000,
    });
    assertApprox('Phase 2B-2A Sine: speechStats.avgDb ~ -20.0', resSine.speechStats.avgDb, -20.0, 0.2);
    assertApprox('Phase 2B-2A Sine: speechStats.maxDb ~ -20.0', resSine.speechStats.maxDb, -20.0, 0.2);
    const speechSegs = resSine.segments.filter((s) => s.isSpeech);
    assertTrue('Phase 2B-2A Sine: detected 1 contiguous speech segment', speechSegs.length === 1);
    assertApprox('Phase 2B-2A Sine: AudioSegment.avgDb ~ -20.0', speechSegs[0].avgDb, -20.0, 0.2);
  }

  // Test 14: Multi-level speech linear-power aggregation (both speechStats.avgDb & single AudioSegment.avgDb)
  {
    const dTwoLevel = new Float32Array(sampleRate * 10);
    for (let i = 0; i < dTwoLevel.length; i++) dTwoLevel[i] = detRand() * 0.0005;
    const rmsQuiet = Math.pow(10, -40 / 20); // 0.01
    const rmsLoud = Math.pow(10, -20 / 20);  // 0.1
    // Equal-length contiguous speech: [3.2..5.2] at -40 dBFS, [5.2..7.2] at -20 dBFS
    // True linear RMS = sqrt((0.01^2 + 0.1^2) / 2) = -22.97 dBFS (NOT -30.0 dB arithmetic mean!)
    for (let i = Math.floor(3.2 * sampleRate); i < Math.floor(5.2 * sampleRate); i++) {
      dTwoLevel[i] = rmsQuiet * Math.SQRT2 * Math.sin((2 * Math.PI * 500 * i) / sampleRate);
    }
    for (let i = Math.floor(5.2 * sampleRate); i < Math.floor(7.2 * sampleRate); i++) {
      dTwoLevel[i] = rmsLoud * Math.SQRT2 * Math.sin((2 * Math.PI * 500 * i) / sampleRate);
    }
    const resTwo = analyzeAudioBuffer(makeMockBuffer(dTwoLevel), {
      recordStartTimeMs: 0,
      promptSpeechTimeMs: 3000,
      requestStopTimeMs: 7500,
      recordEndTimeMs: 10000,
    });
    assertApprox(
      'Phase 2B-2A Multi-level: speechStats.avgDb uses linear power (~ -23.0, not -30.0)',
      resTwo.speechStats.avgDb,
      -22.97,
      0.35
    );
    const speechSegs = resTwo.segments.filter((s) => s.isSpeech);
    assertTrue('Phase 2B-2A Multi-level: contiguous speech forms 1 segment', speechSegs.length === 1);
    assertApprox(
      'Phase 2B-2A Multi-level: AudioSegment.avgDb uses linear power (~ -23.0, not -30.0)',
      speechSegs[0].avgDb,
      -22.97,
      0.35
    );
  }

  // Test 15: Overlap double-counting elimination on speechStats.avgDb, noiseStats.avgDb & SNR
  {
    const dEdge = new Float32Array(sampleRate * 9);
    // Pre-noise: first 15ms at -20 dBFS, remaining 2.985s at -60 dBFS
    // True RMS of 3.0s = sqrt((0.015 * 0.01 + 2.985 * 1e-6) / 3.0) = -42.77 dBFS
    // Overlap-biased window sum would double-count the 2.985s interior and underestimate edge -> ~ -45.7 dBFS!
    const prePulseAmp = Math.pow(10, -20 / 20) * Math.SQRT2;
    const preQuietAmp = Math.pow(10, -60 / 20) * Math.SQRT2;
    for (let i = 0; i < Math.floor(3.0 * sampleRate); i++) {
      const a = i < Math.floor(0.015 * sampleRate) ? prePulseAmp : preQuietAmp;
      dEdge[i] = a * Math.sin((2 * Math.PI * 500 * i) / sampleRate);
    }
    // Speech [3.20..6.23] (3.03s): first 15ms and last 15ms at -10 dBFS (power=0.1), interior 3.00s at -40 dBFS (power=1e-4)
    // True non-overlapping RMS = sqrt((0.03 * 0.1 + 3.00 * 1e-4) / 3.03) = -29.63 dBFS
    // Double-counted 50%-overlap RMS would be sqrt((0.03 * 0.1 + 6.00 * 1e-4) / 6.03) = -32.24 dBFS (2.6 dB error!)
    const sStart = Math.floor(3.2 * sampleRate);
    const sEnd = Math.floor(6.23 * sampleRate);
    const edgeSamples = Math.floor(0.015 * sampleRate);
    const speechEdgeAmp = Math.pow(10, -10 / 20) * Math.SQRT2;
    const speechMidAmp = Math.pow(10, -40 / 20) * Math.SQRT2;
    for (let i = sStart; i < sEnd; i++) {
      const inEdge = i < sStart + edgeSamples || i >= sEnd - edgeSamples;
      const a = inEdge ? speechEdgeAmp : speechMidAmp;
      dEdge[i] = a * Math.sin((2 * Math.PI * 500 * i) / sampleRate);
    }
    // Post-noise [7.0..9.0]: steady -60 dBFS
    for (let i = Math.floor(7.0 * sampleRate); i < dEdge.length; i++) {
      dEdge[i] = preQuietAmp * Math.sin((2 * Math.PI * 500 * i) / sampleRate);
    }

    const resEdge = analyzeAudioBuffer(makeMockBuffer(dEdge), {
      recordStartTimeMs: 0,
      promptSpeechTimeMs: 3000,
      requestStopTimeMs: 7000,
      recordEndTimeMs: 9000,
    });
    assertApprox(
      'Phase 2B-2A Overlap-free speechStats.avgDb (~ -29.6, not biased -32.2)',
      resEdge.speechStats.avgDb,
      -29.6,
      0.4
    );
    assertTrue(
      'Phase 2B-2A Steady noise (20-70pct) still excludes 15ms pre-noise transient (~ -60 dBFS)',
      resEdge.noiseAnalysis.preNoiseDbFS < -58
    );
    assertTrue(
      'Phase 2B-2A SNR remains measurable and uses non-overlapping speech power',
      resEdge.estimatedSnr.isMeasurable && (resEdge.estimatedSnr.snrDb ?? 0) > 28
    );
  }

  // Test 16: Ambient steady noise excludes transient desk bump while keeping 20-70th percentile behavior
  {
    const dBump = new Float32Array(sampleRate * 9);
    const steadyNoiseAmp = Math.pow(10, -55 / 20) * Math.SQRT2;
    for (let i = 0; i < dBump.length; i++) {
      dBump[i] = steadyNoiseAmp * detRand();
    }
    // 250ms loud desk bump in pre-noise [1.0..1.25s]
    for (let i = Math.floor(1.0 * sampleRate); i < Math.floor(1.25 * sampleRate); i++) {
      dBump[i] = 0.6 * Math.sin((2 * Math.PI * 120 * i) / sampleRate);
    }
    addHarmonicSpeech(dBump, sampleRate, 3.2, 6.8, 0.2);

    const resBump = analyzeAudioBuffer(makeMockBuffer(dBump), {
      recordStartTimeMs: 0,
      promptSpeechTimeMs: 3000,
      requestStopTimeMs: 7000,
      recordEndTimeMs: 9000,
    });
    assertTrue(
      'Phase 2B-2A Transient exclusion: steady representativeNoiseDbFS < -52 dBFS despite 0.6-amp bump',
      resBump.noiseAnalysis.representativeNoiseDbFS < -52
    );
    assertTrue(
      'Phase 2B-2A Transient captured in noiseStats.maxDb (> -15 dBFS)',
      resBump.noiseStats.maxDb > -15
    );
  }

  // Test 17: Distinction between clipping sample peak (peakDbFS) and 30ms window max RMS (speechStats.maxDb)
  {
    const dClipVsRms = new Float32Array(sampleRate * 9);
    const speechRmsAmp = Math.pow(10, -20 / 20) * Math.SQRT2;
    for (let i = Math.floor(3.2 * sampleRate); i < Math.floor(6.8 * sampleRate); i++) {
      dClipVsRms[i] = speechRmsAmp * Math.sin((2 * Math.PI * 500 * i) / sampleRate);
    }
    // Inject 6 consecutive clipped samples at 1.0 (0 dBFS) inside speech at 4.5s
    const clipStart = Math.floor(4.5 * sampleRate);
    for (let i = 0; i < 6; i++) {
      dClipVsRms[clipStart + i] = 1.0;
    }
    const resClip = analyzeAudioBuffer(makeMockBuffer(dClipVsRms), {
      recordStartTimeMs: 0,
      promptSpeechTimeMs: 3000,
      requestStopTimeMs: 7000,
      recordEndTimeMs: 9000,
    });
    assertTrue('Phase 2B-2A Clipping detected on 6 consecutive 1.0 samples', resClip.clippingDetails.hasClippingSign);
    assertApprox('Phase 2B-2A Sample peak is 0.0 dBFS', resClip.clippingDetails.peakDbFS, 0.0, 0.05);
    assertTrue(
      `Phase 2B-2A speechStats.maxDb stays ~30ms window RMS (< -14 dBFS, got ${resClip.speechStats.maxDb})`,
      resClip.speechStats.maxDb < -14.0 && resClip.speechStats.maxDb > -22.0
    );
  }

  // Test 18: BandRatio scale-invariance (no 0.000001 discontinuity) & disabled dummy/muffleness judgments
  {
    const makeImbalanced = (scale: number) => {
      const arr = new Float32Array(sampleRate * 9);
      for (let i = Math.floor(3.2 * sampleRate); i < Math.floor(6.8 * sampleRate); i++) {
        const t = i / sampleRate;
        // 300 Hz strong + 2400 Hz weak (-30 dB relative)
        arr[i] = scale * (Math.sin(2 * Math.PI * 300 * t) + 0.0316 * Math.sin(2 * Math.PI * 2400 * t));
      }
      return analyzeAudioBuffer(makeMockBuffer(arr), {
        recordStartTimeMs: 0,
        promptSpeechTimeMs: 3000,
        requestStopTimeMs: 7000,
        recordEndTimeMs: 9000,
      });
    };
    const resLoudBand = makeImbalanced(0.3);
    const resQuietBand = makeImbalanced(0.008); // near -45 dBFS speech, very small midHigh raw power
    assertApprox(
      'Phase 2B-2A BandRatio scale-invariant across -13 dBFS and -45 dBFS',
      resLoudBand.bandRatio.ratioDb,
      resQuietBand.bandRatio.ratioDb,
      0.3
    );
    assertTrue(
      'Phase 2B-2A BandRatio > 20 dB without broken +10 dB cap or proximity-effect text',
      resQuietBand.bandRatio.ratioDb > 20 &&
        !resQuietBand.bandRatio.relativeObservationText.includes('近接効果')
    );

    // Dummy scores & mufflenessLevel strictly disabled (null)
    assertTrue(
      'Phase 2B-2A Dummy fields disabled (null) on new analysis',
      resLoudBand.mufflenessScore === null &&
        resLoudBand.clarityScore === null &&
        resLoudBand.overallGrade === null &&
        resLoudBand.stressScore === null &&
        resLoudBand.mufflenessLevel === null &&
        resLoudBand.overallScoreStatus === 'pending'
    );
  }

  // =========================================================================
  // Phase 2B-2B Tests (Speech-Band SNR, Rolloff, Band PSD Comparison,
  // Level Variability, Spectral Flatness, Gain Invariance, Sample-Rate/Nyquist)
  // =========================================================================
  const stdTs: RecordingSequenceTimestamps = {
    recordStartTimeMs: 0,
    promptSpeechTimeMs: 3000,
    requestStopTimeMs: 7000,
    recordEndTimeMs: 9000,
  };

  // Windowed-sinc FIR low-pass filter helper for synthetic bandwidth limitation
  const applyLowPassFir = (input: Float32Array, sr: number, cutoffHz: number, taps = 101): Float32Array => {
    const half = Math.floor(taps / 2);
    const kernel = new Float64Array(taps);
    const fc = cutoffHz / sr;
    let sum = 0;
    for (let n = 0; n < taps; n++) {
      const m = n - half;
      const sinc = m === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * m) / (Math.PI * m);
      const blackman =
        0.42 - 0.5 * Math.cos((2 * Math.PI * n) / (taps - 1)) + 0.08 * Math.cos((4 * Math.PI * n) / (taps - 1));
      kernel[n] = sinc * blackman;
      sum += kernel[n];
    }
    for (let n = 0; n < taps; n++) kernel[n] /= sum;
    const out = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) {
      let acc = 0;
      for (let k = 0; k < taps; k++) {
        const idx = i + k - half;
        if (idx >= 0 && idx < input.length) acc += input[idx] * kernel[k];
      }
      out[i] = acc;
    }
    return out;
  };

  // Test 19: Pure sine waves at 500Hz, 3000Hz, and 6000Hz
  {
    const makeSineClip = (freqHz: number, sr = 48000) => {
      const arr = new Float32Array(sr * 9);
      for (let i = 0; i < arr.length; i++) arr[i] = detRand() * 0.0005;
      for (let i = Math.floor(3.2 * sr); i < Math.floor(6.8 * sr); i++) {
        arr[i] += 0.25 * Math.sin((2 * Math.PI * freqHz * i) / sr);
      }
      return analyzeAudioBuffer(makeMockBuffer(arr, sr), stdTs);
    };

    const res500 = makeSineClip(500);
    const res3k = makeSineClip(3000);
    const res6k = makeSineClip(6000);

    assertTrue('Phase 2B-2B 500Hz sine has extendedMetrics', !!res500.extendedMetrics);
    assertApprox('Phase 2B-2B 500Hz sine rolloff95Hz ~ 500Hz', res500.extendedMetrics!.highFreqRolloff.rolloff95Hz ?? 0, 500, 35);
    assertTrue(
      'Phase 2B-2B 500Hz sine spectral flatness near 0 (< 0.05)',
      (res500.extendedMetrics!.spectralFlatness.median ?? 1) < 0.05
    );
    assertTrue(
      'Phase 2B-2B 500Hz sine low/clarity negative wrt core (clarityToCoreDb < -20 dB)',
      (res500.extendedMetrics!.bandEnergyComparison.ratios.clarityToCoreDb ?? 0) < -20
    );

    assertApprox('Phase 2B-2B 3000Hz sine rolloff95Hz ~ 3000Hz', res3k.extendedMetrics!.highFreqRolloff.rolloff95Hz ?? 0, 3000, 40);
    assertTrue(
      'Phase 2B-2B 3000Hz sine clarityToCoreDb strongly positive (> +20 dB)',
      (res3k.extendedMetrics!.bandEnergyComparison.ratios.clarityToCoreDb ?? 0) > 20
    );
    assertTrue(
      'Phase 2B-2B 3000Hz sine highToMidHighRatioDb strongly negative (< -20 dB)',
      (res3k.extendedMetrics!.highFreqRolloff.highToMidHighRatioDb ?? 0) < -20
    );

    assertApprox('Phase 2B-2B 6000Hz sine rolloff95Hz ~ 6000Hz', res6k.extendedMetrics!.highFreqRolloff.rolloff95Hz ?? 0, 6000, 50);
    assertTrue(
      'Phase 2B-2B 6000Hz sine highToMidHighRatioDb strongly positive (> +20 dB)',
      (res6k.extendedMetrics!.highFreqRolloff.highToMidHighRatioDb ?? 0) > 20
    );
  }

  // Test 20: 3.4kHz LPF vs 8kHz LPF broadband speech-like signal
  {
    const baseBroadband = new Float32Array(sampleRate * 9);
    for (let i = Math.floor(3.2 * sampleRate); i < Math.floor(6.8 * sampleRate); i++) {
      baseBroadband[i] = 0.2 * detRand();
    }
    const lpf3400 = applyLowPassFir(baseBroadband, sampleRate, 3400);
    const lpf8000 = applyLowPassFir(baseBroadband, sampleRate, 8000);
    // Add minimal steady ambient floor so SNR is measurable cleanly
    for (let i = 0; i < baseBroadband.length; i++) {
      const n = detRand() * 0.001;
      lpf3400[i] += n;
      lpf8000[i] += n;
    }

    const res34 = analyzeAudioBuffer(makeMockBuffer(lpf3400), stdTs);
    const res80 = analyzeAudioBuffer(makeMockBuffer(lpf8000), stdTs);

    assertTrue(
      `Phase 2B-2B 3.4kHz LPF rolloff95Hz < 3600Hz (got ${res34.extendedMetrics!.highFreqRolloff.rolloff95Hz})`,
      (res34.extendedMetrics!.highFreqRolloff.rolloff95Hz ?? 9999) < 3600
    );
    assertTrue(
      `Phase 2B-2B 8kHz LPF rolloff95Hz > 6000Hz (got ${res80.extendedMetrics!.highFreqRolloff.rolloff95Hz})`,
      (res80.extendedMetrics!.highFreqRolloff.rolloff95Hz ?? 0) > 6000
    );
    assertTrue(
      'Phase 2B-2B 3.4kHz LPF has much lower high/midHigh ratio than 8kHz LPF',
      (res34.extendedMetrics!.highFreqRolloff.highToMidHighRatioDb ?? 0) <
        (res80.extendedMetrics!.highFreqRolloff.highToMidHighRatioDb ?? -99) - 15
    );
    assertTrue(
      `Phase 2B-2D 3.4kHz LPF rolloff95SpeechBandHz < 3600Hz (got ${res34.extendedMetrics!.highFreqRolloff.rolloff95SpeechBandHz})`,
      (res34.extendedMetrics!.highFreqRolloff.rolloff95SpeechBandHz ?? 9999) < 3600
    );
    assertTrue(
      `Phase 2B-2D 8kHz LPF rolloff95SpeechBandHz > 6000Hz (got ${res80.extendedMetrics!.highFreqRolloff.rolloff95SpeechBandHz})`,
      (res80.extendedMetrics!.highFreqRolloff.rolloff95SpeechBandHz ?? 0) > 6000
    );
  }

  // Test 21: White noise flatness & bandwidth-normalized PSD ratio fairness (~ 0 dB across bands)
  {
    const dWhite = new Float32Array(sampleRate * 9);
    for (let i = 0; i < dWhite.length; i++) dWhite[i] = detRand() * 0.001;
    for (let i = Math.floor(3.2 * sampleRate); i < Math.floor(6.8 * sampleRate); i++) {
      dWhite[i] = detRand() * 0.25;
    }
    const resWhite = analyzeAudioBuffer(makeMockBuffer(dWhite), stdTs);
    const sfmWhite = resWhite.extendedMetrics!.spectralFlatness;
    const psdRatios = resWhite.extendedMetrics!.bandEnergyComparison.ratios;

    assertTrue(
      `Phase 2B-2B White noise per-frame spectralFlatness.median > 0.5 (got ${sfmWhite.median}, theory ~0.561)`,
      sfmWhite.isMeasurable && (sfmWhite.median ?? 0) > 0.5
    );
    assertTrue(
      `Phase 2B-2B White noise PSD ratios near 0 dB regardless of band width (low/core=${psdRatios.lowToCoreDb}, clarity/core=${psdRatios.clarityToCoreDb}, high/clarity=${psdRatios.highToClarityDb})`,
      Math.abs(psdRatios.lowToCoreDb ?? 99) < 1.5 &&
        Math.abs(psdRatios.clarityToCoreDb ?? 99) < 1.5 &&
        Math.abs(psdRatios.highToClarityDb ?? 99) < 1.5
    );
  }

  // Test 22: Low-freq (<120Hz) noise overlay reduces broadband SNR while Speech-band SNR stays high
  {
    const dRumble = new Float32Array(sampleRate * 9);
    for (let i = 0; i < dRumble.length; i++) {
      // Strong 65 Hz rumble (-20 dBFS) + quiet broadband hiss (-58 dBFS)
      dRumble[i] = 0.14 * Math.sin((2 * Math.PI * 65 * i) / sampleRate) + detRand() * 0.0015;
    }
    // Speech in [3.2..6.8s] at 1000 Hz (-17 dBFS)
    for (let i = Math.floor(3.2 * sampleRate); i < Math.floor(6.8 * sampleRate); i++) {
      dRumble[i] += 0.2 * Math.sin((2 * Math.PI * 1000 * i) / sampleRate);
    }
    const resRumble = analyzeAudioBuffer(makeMockBuffer(dRumble), stdTs);
    const bandSnr = resRumble.extendedMetrics!.speechBandSnr;
    const broadbandSnr = resRumble.estimatedSnr.snrDb ?? 0;

    assertTrue(
      `Phase 2B-2B Low-freq noise separated: speechBandSnr (${bandSnr.snrDb} dB) > broadband SNR (${broadbandSnr} dB) by > 15 dB`,
      bandSnr.isMeasurable && (bandSnr.snrDb ?? 0) > broadbandSnr + 15 && (bandSnr.broadbandDiffDb ?? 0) > 15
    );
  }

  // Test 23: Intra-speech level variability (variable-RMS vs constant-RMS) & gain invariance
  {
    const makeVariableClip = (gain: number) => {
      const arr = new Float32Array(sampleRate * 9);
      for (let i = 0; i < arr.length; i++) arr[i] = detRand() * 0.0002 * gain;
      // Alternating 0.4s blocks between -32 dBFS and -16 dBFS inside [3.2..6.8s]
      for (let i = Math.floor(3.2 * sampleRate); i < Math.floor(6.8 * sampleRate); i++) {
        const block = Math.floor(((i / sampleRate) - 3.2) / 0.4) % 2;
        const amp = (block === 0 ? 0.035 : 0.22) * gain;
        const t = i / sampleRate;
        arr[i] += amp * (0.7 * Math.sin(2 * Math.PI * 500 * t) + 0.3 * Math.sin(2 * Math.PI * 2200 * t));
      }
      return analyzeAudioBuffer(makeMockBuffer(arr), stdTs);
    };

    const resVar1 = makeVariableClip(1.0);
    const resVarScaled = makeVariableClip(0.35);

    const dConst = new Float32Array(sampleRate * 9);
    for (let i = Math.floor(3.2 * sampleRate); i < Math.floor(6.8 * sampleRate); i++) {
      dConst[i] = 0.15 * Math.sin((2 * Math.PI * 500 * i) / sampleRate);
    }
    const resConst = analyzeAudioBuffer(makeMockBuffer(dConst), stdTs);

    assertTrue(
      `Phase 2B-2B Variable-RMS IQR (${resVar1.extendedMetrics!.speechLevelVariability.iqrDb} dB) >> Constant-RMS IQR (${resConst.extendedMetrics!.speechLevelVariability.iqrDb} dB)`,
      (resVar1.extendedMetrics!.speechLevelVariability.iqrDb ?? 0) > 10 &&
        (resConst.extendedMetrics!.speechLevelVariability.iqrDb ?? 99) < 1.0
    );

    assertApprox(
      'Phase 2B-2B Gain invariance: bandEnergyComparison clarityToCoreDb preserved across gain 1.0 vs 0.35',
      resVar1.extendedMetrics!.bandEnergyComparison.ratios.clarityToCoreDb ?? 0,
      resVarScaled.extendedMetrics!.bandEnergyComparison.ratios.clarityToCoreDb ?? 99,
      0.2
    );
    assertApprox(
      'Phase 2B-2B Gain invariance: speechLevelVariability IQR preserved across gain 1.0 vs 0.35',
      resVar1.extendedMetrics!.speechLevelVariability.iqrDb ?? 0,
      resVarScaled.extendedMetrics!.speechLevelVariability.iqrDb ?? 99,
      0.2
    );
  }

  // Test 24: Silence / unmeasurable / absent ambient / 8k, 16k, 44.1k, 48k sample rates
  {
    const dSilent = new Float32Array(sampleRate * 9);
    const resSilent = analyzeAudioBuffer(makeMockBuffer(dSilent), stdTs);
    const extSil = resSilent.extendedMetrics!;
    assertTrue(
      'Phase 2B-2B Silence produces unmeasurable null extended metrics (never 0)',
      !extSil.speechBandSnr.isMeasurable &&
        extSil.speechBandSnr.snrDb === null &&
        !extSil.highFreqRolloff.isMeasurable &&
        extSil.highFreqRolloff.rolloff95Hz === null &&
        !extSil.bandEnergyComparison.isMeasurable &&
        extSil.bandEnergyComparison.ratios.lowToCoreDb === null &&
        !extSil.speechLevelVariability.isMeasurable &&
        extSil.speechLevelVariability.iqrDb === null &&
        !extSil.spectralFlatness.isMeasurable &&
        extSil.spectralFlatness.median === null
    );

    // Zero pre/post ambient intervals (all 9s mapped to speech candidate [0..9s])
    const dNoAmbient = new Float32Array(sampleRate * 9);
    for (let i = Math.floor(1.0 * sampleRate); i < Math.floor(6.0 * sampleRate); i++) {
      dNoAmbient[i] = 0.2 * Math.sin((2 * Math.PI * 800 * i) / sampleRate);
    }
    const resNoAmb = analyzeAudioBuffer(makeMockBuffer(dNoAmbient), {
      recordStartTimeMs: 0,
      promptSpeechTimeMs: 0,
      requestStopTimeMs: 9000,
      recordEndTimeMs: 9000,
    });
    assertTrue(
      'Phase 2B-2B Missing pre/post ambient marks speechBandSnr unmeasurable (null)',
      !resNoAmb.extendedMetrics!.speechBandSnr.isMeasurable &&
        resNoAmb.extendedMetrics!.speechBandSnr.snrDb === null
    );

    // Sample rates: 8000 Hz (<8kHz Nyquist -> high band null), 16000 Hz, 44100 Hz
    const runAtSr = (sr: number) => {
      const arr = new Float32Array(sr * 9);
      for (let i = 0; i < arr.length; i++) arr[i] = detRand() * 0.001;
      for (let i = Math.floor(3.2 * sr); i < Math.floor(6.8 * sr); i++) {
        const t = i / sr;
        arr[i] += 0.2 * (Math.sin(2 * Math.PI * 500 * t) + 0.5 * Math.sin(2 * Math.PI * 2200 * t));
      }
      return analyzeAudioBuffer(makeMockBuffer(arr, sr), stdTs);
    };

    const res8k = runAtSr(8000);
    assertTrue(
      'Phase 2B-2B 8kHz SR marks highFreqRolloff.isHighBandMeasurable false & ratio null (never 0 dB)',
      !res8k.extendedMetrics!.highFreqRolloff.isHighBandMeasurable &&
        res8k.extendedMetrics!.highFreqRolloff.highToMidHighRatioDb === null &&
        res8k.extendedMetrics!.highFreqRolloff.power4200_8000DbFS === null &&
        !res8k.extendedMetrics!.bandEnergyComparison.bands.high_4200_8000.isMeasurable &&
        res8k.extendedMetrics!.bandEnergyComparison.ratios.highToClarityDb === null &&
        res8k.extendedMetrics!.speechBandSnr.status === 'reference_nyquist'
    );

    const res16k = runAtSr(16000);
    const res44k = runAtSr(44100);
    assertTrue(
      'Phase 2B-2B 16kHz and 44.1kHz SR compute extended metrics cleanly',
      res16k.extendedMetrics!.speechBandSnr.isMeasurable &&
        res16k.extendedMetrics!.highFreqRolloff.constraintNote.includes('16kHz') &&
        res44k.extendedMetrics!.speechBandSnr.isMeasurable &&
        res44k.extendedMetrics!.bandEnergyComparison.bands.high_4200_8000.isMeasurable
    );

    // =========================================================================
    // Phase 2B-2D Tests: 300-8000 Hz 95% Rolloff Frequency
    // =========================================================================
    const makeTone = (freqHz: number, sr = 48000) => {
      const arr = new Float32Array(sr * 9);
      for (let i = 0; i < arr.length; i++) arr[i] = detRand() * 0.0004;
      for (let i = Math.floor(3.2 * sr); i < Math.floor(6.8 * sr); i++) {
        arr[i] += 0.25 * Math.sin((2 * Math.PI * freqHz * i) / sr);
      }
      return analyzeAudioBuffer(makeMockBuffer(arr, sr), stdTs);
    };

    const r500 = makeTone(500).extendedMetrics!.highFreqRolloff;
    const r3k = makeTone(3000).extendedMetrics!.highFreqRolloff;
    const r6k = makeTone(6000).extendedMetrics!.highFreqRolloff;

    assertApprox('Phase 2B-2D 500Hz sine rolloff95SpeechBandHz ~ 500Hz', r500.rolloff95SpeechBandHz ?? 0, 500, 35);
    assertApprox('Phase 2B-2D 3000Hz sine rolloff95SpeechBandHz ~ 3000Hz', r3k.rolloff95SpeechBandHz ?? 0, 3000, 40);
    assertApprox('Phase 2B-2D 6000Hz sine rolloff95SpeechBandHz ~ 6000Hz', r6k.rolloff95SpeechBandHz ?? 0, 6000, 50);

    // Sub-300Hz (200Hz) strong component + 1500Hz component: 20-8000Hz drops near 200Hz while 300-8000Hz isolates speech band (~1500Hz)
    const dLowPlusVoice = new Float32Array(sampleRate * 9);
    for (let i = 0; i < dLowPlusVoice.length; i++) dLowPlusVoice[i] = detRand() * 0.0002;
    for (let i = Math.floor(3.2 * sampleRate); i < Math.floor(6.8 * sampleRate); i++) {
      const t = i / sampleRate;
      dLowPlusVoice[i] +=
        0.3 * Math.sin(2 * Math.PI * 200 * t) + 0.055 * Math.sin(2 * Math.PI * 1500 * t);
    }
    const resLowPlus = analyzeAudioBuffer(makeMockBuffer(dLowPlusVoice), stdTs);
    const roLow = resLowPlus.extendedMetrics!.highFreqRolloff;
    assertTrue(
      `Phase 2B-2D 200Hz+1500Hz: rolloff95Hz (${roLow.rolloff95Hz}) pulled near 200Hz while rolloff95SpeechBandHz (${roLow.rolloff95SpeechBandHz}) tracks ~1500Hz`,
      roLow.rolloff95Hz !== null &&
        roLow.rolloff95Hz < 300 &&
        typeof roLow.rolloff95SpeechBandHz === 'number' &&
        Math.abs(roLow.rolloff95SpeechBandHz - 1500) < 60
    );

    // Sub-bass-only 100Hz signal: rejected by VAD / unmeasurable -> rolloff95SpeechBandHz === null
    const d100Only = new Float32Array(sampleRate * 9);
    for (let i = Math.floor(3.2 * sampleRate); i < Math.floor(6.8 * sampleRate); i++) {
      d100Only[i] = 0.25 * Math.sin((2 * Math.PI * 100 * i) / sampleRate);
    }
    const ro100Only = analyzeAudioBuffer(makeMockBuffer(d100Only), stdTs).extendedMetrics!.highFreqRolloff;
    assertTrue(
      'Phase 2B-2D 100Hz-only tone produces null rolloff95SpeechBandHz',
      ro100Only.rolloff95SpeechBandHz === null
    );

    // Silence -> rolloff95SpeechBandHz === null
    assertTrue(
      'Phase 2B-2D Silence produces null rolloff95SpeechBandHz',
      resSilent.extendedMetrics!.highFreqRolloff.rolloff95SpeechBandHz === null
    );

    // 8kHz Nyquist clamping check on 300-8000Hz range
    assertTrue(
      'Phase 2B-2D 8kHz SR clamps rolloff95SpeechBandRange effectiveHighHz to <= 4000Hz',
      res8k.extendedMetrics!.highFreqRolloff.rolloff95SpeechBandRange?.effectiveLowHz === 300 &&
        (res8k.extendedMetrics!.highFreqRolloff.rolloff95SpeechBandRange?.effectiveHighHz ?? 0) <= 4000 &&
        res8k.extendedMetrics!.highFreqRolloff.rolloff95SpeechBandRange?.truncatedByNyquist === true &&
        typeof res8k.extendedMetrics!.highFreqRolloff.rolloff95SpeechBandHz === 'number'
    );
    assertTrue(
      'Phase 2B-2D 16kHz/44.1kHz rolloff95SpeechBandHz finite & valid',
      typeof res16k.extendedMetrics!.highFreqRolloff.rolloff95SpeechBandHz === 'number' &&
        typeof res44k.extendedMetrics!.highFreqRolloff.rolloff95SpeechBandHz === 'number'
    );
  }

  console.log('\n=== All DSP Verification Tests Passed Successfully! ===');
}

// Run when executed directly via tsx / node
runDspVerificationTests();
