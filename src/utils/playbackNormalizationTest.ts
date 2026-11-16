/**
 * Unit tests for Phase 2A Playback Volume Normalization (-23 dBFS target,
 * +18 dB max boost, -1 dBFS peak protection, linear speech RMS aggregation,
 * and filter-aware playback stepping).
 */
import { analyzeAudioBuffer } from './audioDsp';
import {
  NORMALIZATION_MAX_BOOST_DB,
  NORMALIZATION_PEAK_CEILING_DB,
  NORMALIZATION_TARGET_RMS_DB,
  computeClipPlaybackNormalization,
  computeSpeechLinearRmsFromSegments,
  findNextPlaybackOffset,
  resolveEffectivePlaybackGain,
} from './playbackNormalization';
import { AudioSegment, RecordedClip, RecordingSequenceTimestamps } from '../types/audio';

function assertTrue(name: string, condition: boolean) {
  if (!condition) {
    throw new Error(`FAIL: ${name} condition was false`);
  }
  console.log(`✓ PASS: ${name}`);
}

function assertApprox(name: string, actual: number, expected: number, tolerance = 0.15) {
  const diff = Math.abs(actual - expected);
  if (diff > tolerance) {
    throw new Error(`FAIL: ${name} expected ~${expected}, got ${actual} (diff: ${diff})`);
  }
  console.log(`✓ PASS: ${name} = ${actual} (expected ~${expected})`);
}

function assertEqual<T>(name: string, actual: T, expected: T) {
  if (actual !== expected) {
    throw new Error(`FAIL: ${name} expected ${String(expected)}, got ${String(actual)}`);
  }
  console.log(`✓ PASS: ${name} = ${String(actual)}`);
}

function makeBufferFromSamples(samples: Float32Array, sampleRate = 48000): AudioBuffer {
  return {
    sampleRate,
    length: samples.length,
    duration: samples.length / sampleRate,
    numberOfChannels: 1,
    getChannelData: () => samples,
  } as unknown as AudioBuffer;
}

function makeSineClipWithDb(
  speechRmsDbFS: number,
  options?: {
    noiseRmsDbFS?: number;
    spikePeakDbFS?: number;
    spikeAtSec?: number;
    durationSec?: number;
    speechStartSec?: number;
    speechEndSec?: number;
  }
): Pick<RecordedClip, 'buffer' | 'evaluation'> {
  const sr = 48000;
  const durationSec = options?.durationSec ?? 9;
  const speechStartSec = options?.speechStartSec ?? 3.2;
  const speechEndSec = options?.speechEndSec ?? 6.8;
  const totalSamples = sr * durationSec;
  const data = new Float32Array(totalSamples);

  const noiseRms =
    options?.noiseRmsDbFS !== undefined ? Math.pow(10, options.noiseRmsDbFS / 20) : 0.0005;
  for (let i = 0; i < totalSamples; i++) {
    // Low steady ambient background
    data[i] = noiseRms * Math.SQRT2 * Math.sin((2 * Math.PI * 180 * i) / sr);
  }

  const speechRms = Math.pow(10, speechRmsDbFS / 20);
  const speechPeakAmp = speechRms * Math.SQRT2;
  const s0 = Math.floor(speechStartSec * sr);
  const s1 = Math.floor(speechEndSec * sr);
  for (let i = s0; i < s1 && i < totalSamples; i++) {
    data[i] = speechPeakAmp * Math.sin((2 * Math.PI * 600 * (i - s0)) / sr);
  }

  if (options?.spikePeakDbFS !== undefined) {
    const spikeIdx = Math.floor((options.spikeAtSec ?? 4.0) * sr);
    data[spikeIdx] = Math.pow(10, options.spikePeakDbFS / 20);
  }

  const timestamps: RecordingSequenceTimestamps = {
    recordStartTimeMs: 0,
    promptSpeechTimeMs: 3000,
    requestStopTimeMs: 7000,
    recordEndTimeMs: durationSec * 1000,
  };

  const buffer = makeBufferFromSamples(data, sr);
  const evaluation = analyzeAudioBuffer(buffer, timestamps);
  return { buffer, evaluation };
}

export function runPlaybackNormalizationTests() {
  console.log('=== Starting Playback Volume Normalization Tests ===\n');

  // 1. Normalize -38 dBFS speech to -23 dBFS (and verify measured #4 ~ -37.9 dBFS case)
  const clipMinus38 = makeSineClipWithDb(-38.0, { noiseRmsDbFS: -68 });
  const beforeSnapshot = new Float32Array(clipMinus38.buffer.getChannelData(0));
  const res38 = computeClipPlaybackNormalization(clipMinus38);
  assertEqual('Test 1: -38 dBFS status is applied', res38.status, 'applied');
  assertApprox('Test 1: measuredSpeechRmsDbFS ~ -38.0', res38.measuredSpeechRmsDbFS ?? 0, -38.0, 0.3);
  assertApprox('Test 1: appliedGainDb ~ +15.0 dB', res38.appliedGainDb, 15.0, 0.3);
  assertApprox(
    'Test 1: resultingSpeechRmsDbFS reaches -23.0 dBFS',
    res38.resultingSpeechRmsDbFS ?? 0,
    NORMALIZATION_TARGET_RMS_DB,
    0.1
  );
  assertTrue('Test 1: target reached', !res38.isTargetUnreached);

  // Verify non-destructive behavior on AudioBuffer
  const afterSnapshot = clipMinus38.buffer.getChannelData(0);
  let mutated = false;
  for (let i = 0; i < beforeSnapshot.length; i++) {
    if (beforeSnapshot[i] !== afterSnapshot[i]) {
      mutated = true;
      break;
    }
  }
  assertTrue('Test 1: Original Float32 AudioBuffer is strictly unmodified', !mutated);

  // Simulate #4 real-world measurement (-37.9 dBFS) and #1 (-21.7 dBFS attenuation) and #3 (-26.8 dBFS)
  const clipReal4 = makeSineClipWithDb(-37.9, { noiseRmsDbFS: -65 });
  const resReal4 = computeClipPlaybackNormalization(clipReal4);
  assertEqual('Measured #4 sim status is applied', resReal4.status, 'applied');
  assertApprox('Measured #4 sim (+14.9 dB gain)', resReal4.appliedGainDb, 14.9, 0.3);

  const clipReal1 = makeSineClipWithDb(-21.7, { noiseRmsDbFS: -60 });
  const resReal1 = computeClipPlaybackNormalization(clipReal1);
  assertEqual('Measured #1 sim (attenuation) status is applied', resReal1.status, 'applied');
  assertApprox('Measured #1 sim (-1.3 dB attenuation)', resReal1.appliedGainDb, -1.3, 0.3);

  const clipReal3 = makeSineClipWithDb(-26.8, { noiseRmsDbFS: -60 });
  const resReal3 = computeClipPlaybackNormalization(clipReal3);
  assertEqual('Measured #3 sim (+3.8 dB boost) status is applied', resReal3.status, 'applied');
  assertApprox('Measured #3 sim appliedGainDb ~ +3.8 dB', resReal3.appliedGainDb, 3.8, 0.3);

  // 2. Peak ceiling protection (-1 dBFS) causes target unreached
  const clipPeakLimited = makeSineClipWithDb(-30.0, {
    noiseRmsDbFS: -65,
    spikePeakDbFS: -4.0,
    spikeAtSec: 5.0,
  });
  const resPeak = computeClipPlaybackNormalization(clipPeakLimited);
  assertEqual('Test 2: peak-limited status is limited', resPeak.status, 'limited');
  assertTrue('Test 2: limitedByPeak is true', resPeak.limitedByPeak);
  assertTrue('Test 2: isTargetUnreached is true', resPeak.isTargetUnreached);
  // Desired +7.0 dB, but spike at -4.0 dBFS allows only -1.0 - (-4.0) = +3.0 dB
  assertApprox('Test 2: appliedGainDb capped at +3.0 dB', resPeak.appliedGainDb, 3.0, 0.2);
  assertTrue(
    'Test 2: predicted output peak <= -1.0 dBFS',
    (resPeak.truePeakDbFS ?? 0) + resPeak.appliedGainDb <= NORMALIZATION_PEAK_CEILING_DB + 0.15
  );
  assertTrue('Test 2: reason explains peak protection / target unreached', !!resPeak.reason?.includes('未達'));

  // 3. Max boost ceiling (+18 dB) test
  const clipVeryQuiet = makeSineClipWithDb(-46.0, { noiseRmsDbFS: -78 });
  const resMaxBoost = computeClipPlaybackNormalization(clipVeryQuiet);
  assertEqual('Test 3: very quiet clip status is limited', resMaxBoost.status, 'limited');
  assertTrue('Test 3: limitedByMaxBoost is true', resMaxBoost.limitedByMaxBoost);
  assertTrue('Test 3: isTargetUnreached is true', resMaxBoost.isTargetUnreached);
  assertApprox(
    'Test 3: appliedGainDb capped at +18.0 dB',
    resMaxBoost.appliedGainDb,
    NORMALIZATION_MAX_BOOST_DB,
    0.05
  );
  assertApprox(
    'Test 3: resulting speech RMS is -28.0 dBFS (short of -23)',
    resMaxBoost.resultingSpeechRmsDbFS ?? 0,
    -28.0,
    0.3
  );

  // 4. Silence, no speech detected, unmeasurable, and NaN/Infinity abnormal inputs
  const silenceSamples = new Float32Array(48000 * 9);
  const silenceBuf = makeBufferFromSamples(silenceSamples, 48000);
  const silenceEval = analyzeAudioBuffer(silenceBuf);
  const resSilence = computeClipPlaybackNormalization({ buffer: silenceBuf, evaluation: silenceEval });
  assertEqual('Test 4a: all-silence status is unmeasurable', resSilence.status, 'unmeasurable');
  assertEqual('Test 4a: all-silence gain is 0 dB', resSilence.appliedGainDb, 0);
  assertEqual('Test 4a: all-silence linear gain is 1', resSilence.appliedGainLinear, 1);

  // Speech segments artificially marked, but samples are NaN / Infinity / 0
  const corruptSamples = new Float32Array(48000 * 5);
  for (let i = 0; i < corruptSamples.length; i++) {
    corruptSamples[i] = i % 2 === 0 ? NaN : Infinity;
  }
  const corruptBuf = makeBufferFromSamples(corruptSamples, 48000);
  const fakeMeasurableEval = {
    ...clipMinus38.evaluation,
    isMeasurable: true,
    segments: [{ startTime: 1, endTime: 4, isSpeech: true, avgDb: -25, maxDb: -20 }],
  };
  const resCorrupt = computeClipPlaybackNormalization({
    buffer: corruptBuf,
    evaluation: fakeMeasurableEval,
  });
  assertEqual('Test 4b: NaN/Infinity buffer status is unmeasurable', resCorrupt.status, 'unmeasurable');
  assertTrue('Test 4b: appliedGainLinear is finite 1', Number.isFinite(resCorrupt.appliedGainLinear) && resCorrupt.appliedGainLinear === 1);

  // No speech segments even if isMeasurable true
  const resNoSegs = computeClipPlaybackNormalization({
    buffer: clipMinus38.buffer,
    evaluation: {
      ...clipMinus38.evaluation,
      isMeasurable: true,
      segments: [{ startTime: 0, endTime: 9, isSpeech: false, avgDb: -60, maxDb: -55 }],
    },
  });
  assertEqual('Test 4c: no speech segments status is unmeasurable', resNoSegs.status, 'unmeasurable');
  assertTrue('Test 4c: unmeasurable includes explanation reason', !!resNoSegs.reason);

  // 5. Linear-power RMS aggregation verification (NOT arithmetic average of segment dB values!)
  {
    const sr = 48000;
    const dLinear = new Float32Array(sr * 6);
    // Seg A (1s..3s, 2s): -40 dBFS (rms = 0.01)
    const rmsA = Math.pow(10, -40 / 20);
    for (let i = 1 * sr; i < 3 * sr; i++) {
      dLinear[i] = rmsA * Math.SQRT2 * Math.sin((2 * Math.PI * 500 * i) / sr);
    }
    // Seg B (3s..5s, 2s): -20 dBFS (rms = 0.1)
    const rmsB = Math.pow(10, -20 / 20);
    for (let i = 3 * sr; i < 5 * sr; i++) {
      dLinear[i] = rmsB * Math.SQRT2 * Math.sin((2 * Math.PI * 500 * i) / sr);
    }
    // True linear-power RMS = sqrt((0.01^2 + 0.1^2) / 2) = sqrt(0.0101 / 2) = 0.071063 -> -22.97 dBFS
    // (Whereas naive arithmetic mean of dB would be (-40 + -20)/2 = -30.0 dBFS — 7 dB error!)
    const segs: AudioSegment[] = [
      { startTime: 1, endTime: 3, isSpeech: true, avgDb: -40, maxDb: -40 },
      { startTime: 2.5, endTime: 5, isSpeech: true, avgDb: -20, maxDb: -20 }, // intentional overlap to test deduplication
    ];
    // Test clean non-overlapping first
    const cleanStats = computeSpeechLinearRmsFromSegments(dLinear, sr, [
      { startTime: 1, endTime: 3, isSpeech: true, avgDb: -40, maxDb: -40 },
      { startTime: 3, endTime: 5, isSpeech: true, avgDb: -20, maxDb: -20 },
    ]);
    assertEqual('Test 5a: sampleCount matches 4s = 192000 samples', cleanStats.sampleCount, 4 * sr);
    assertApprox('Test 5b: linear RMS dBFS ~ -22.97 dBFS (not -30 dB arithmetic mean)', cleanStats.dbFS, -22.97, 0.1);

    const overlapStats = computeSpeechLinearRmsFromSegments(dLinear, sr, segs);
    assertEqual('Test 5c: overlapping segments deduplicated to 4s', overlapStats.sampleCount, 4 * sr);
  }

  // 6 & 7. Filter-aware gain resolution (all & speech_only apply normalization; noise_only strictly keeps 0 dB)
  {
    const gainAllOrig = resolveEffectivePlaybackGain('original', 'all', res38);
    assertEqual('Test 6a: original mode all -> gainLinear = 1', gainAllOrig.gainLinear, 1);

    const gainAllNorm = resolveEffectivePlaybackGain('normalized', 'all', res38);
    assertTrue('Test 6b: normalized mode all -> active & gain > 5', gainAllNorm.isNormalizationActive && gainAllNorm.gainLinear > 5);

    const gainSpeechNorm = resolveEffectivePlaybackGain('normalized', 'speech_only', res38);
    assertTrue('Test 6c: normalized mode speech_only -> active & matches res38', gainSpeechNorm.isNormalizationActive && gainSpeechNorm.gainDb === res38.appliedGainDb);

    const gainNoiseNorm = resolveEffectivePlaybackGain('normalized', 'noise_only', res38);
    assertEqual('Test 7a: normalized mode noise_only -> forces gainLinear = 1', gainNoiseNorm.gainLinear, 1);
    assertEqual('Test 7b: normalized mode noise_only -> gainDb = 0', gainNoiseNorm.gainDb, 0);
    assertTrue('Test 7c: normalized mode noise_only -> isNormalizationActive = false', !gainNoiseNorm.isNormalizationActive);

    const gainUnmeasurable = resolveEffectivePlaybackGain('normalized', 'all', resSilence);
    assertEqual('Test 7d: unmeasurable clip stays at 1.0 gain', gainUnmeasurable.gainLinear, 1);
  }

  // 8. Playback stepping, seek, and mode switch tests
  {
    const segs: AudioSegment[] = [
      { startTime: 0, endTime: 3.0, isSpeech: false, avgDb: -60, maxDb: -55 },
      { startTime: 3.0, endTime: 5.0, isSpeech: true, avgDb: -25, maxDb: -20 },
      { startTime: 5.0, endTime: 6.0, isSpeech: false, avgDb: -60, maxDb: -55 },
      { startTime: 6.0, endTime: 8.0, isSpeech: true, avgDb: -25, maxDb: -20 },
      { startTime: 8.0, endTime: 10.0, isSpeech: false, avgDb: -60, maxDb: -55 },
    ];

    const s1 = findNextPlaybackOffset(0, segs, 'speech_only', 10);
    assertEqual('Step 8a: speech_only from 0 jumps to 3.0s', s1.action, 'jump');
    assertApprox('Step 8a: nextTimeSec = 3.0', s1.nextTimeSec, 3.0, 0.001);

    const s2 = findNextPlaybackOffset(4.2, segs, 'speech_only', 10);
    assertEqual('Step 8b: seek to 4.2s plays in place', s2.action, 'play_here');
    assertApprox('Step 8b: segmentEndTime = 5.0', s2.segmentEndTime ?? 0, 5.0, 0.001);

    const s3 = findNextPlaybackOffset(5.001, segs, 'speech_only', 10);
    assertEqual('Step 8c: after 5.0s jumps across pause to 6.0s', s3.action, 'jump');
    assertApprox('Step 8c: nextTimeSec = 6.0', s3.nextTimeSec, 6.0, 0.001);

    const s4 = findNextPlaybackOffset(8.001, segs, 'speech_only', 10);
    assertEqual('Step 8d: after last speech segment ends cleanly', s4.action, 'ended');

    const n1 = findNextPlaybackOffset(3.5, segs, 'noise_only', 10);
    assertEqual('Step 8e: switching to noise_only at 3.5s jumps to 5.0s noise', n1.action, 'jump');
    assertApprox('Step 8e: nextTimeSec = 5.0', n1.nextTimeSec, 5.0, 0.001);

    // Rapid per-clip switching simulation (Clip #4 -> Clip #1 -> Unmeasurable)
    const g4 = resolveEffectivePlaybackGain('normalized', 'all', resReal4);
    const g1 = resolveEffectivePlaybackGain('normalized', 'all', resReal1);
    const g0 = resolveEffectivePlaybackGain('normalized', 'all', resSilence);
    assertTrue('Clip switch #4 (+14.9dB) -> #1 (-1.3dB) -> silence (0dB)', g4.gainDb > 14 && g1.gainDb < 0 && g0.gainDb === 0);
  }

  console.log('\n=== All Playback Volume Normalization Tests Passed Successfully! ===');
}

runPlaybackNormalizationTests();
