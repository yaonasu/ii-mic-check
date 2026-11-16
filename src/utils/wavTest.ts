/**
 * Test script for WAV export and standalone HTML report generation
 */
import { audioBufferToWavBlob, audioBufferToBase64DataUrl } from './wavExport';
import { generateComparisonHtml, generateSingleClipHtml } from './reportExport';
import { analyzeAudioBuffer } from './audioDsp';
import { RecordedClip, HeadsetEvaluation } from '../types/audio';

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
  console.log(`✓ PASS: ${msg}`);
}

async function runTests() {
  console.log('=== Starting WAV Export & HTML Report Tests ===\n');

  // 1. Create a dummy AudioBuffer
  const sampleRate = 48000;
  const numSamples = 48000 * 2; // 2 seconds
  const channelData = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    channelData[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
  }

  const mockBuffer = {
    sampleRate,
    length: numSamples,
    duration: 2.0,
    numberOfChannels: 1,
    getChannelData: (ch: number) => {
      if (ch !== 0) throw new Error('Only ch 0 expected');
      return channelData;
    },
  } as unknown as AudioBuffer;

  // 2. Test audioBufferToWavBlob
  const blob = audioBufferToWavBlob(mockBuffer);
  assert(blob instanceof Blob, 'Blob created successfully');
  assert(blob.type === 'audio/wav', `Blob type is audio/wav (got ${blob.type})`);
  
  const expectedSize = 44 + numSamples * 2; // 44 bytes header + 2 bytes per sample
  assert(blob.size === expectedSize, `Blob size is exactly ${expectedSize} bytes (got ${blob.size})`);

  const arrayBuffer = await blob.arrayBuffer();
  const view = new DataView(arrayBuffer);

  // Check RIFF header
  const getAscii = (offset: number, len: number) => {
    let s = '';
    for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(offset + i));
    return s;
  };

  assert(getAscii(0, 4) === 'RIFF', 'Header starts with RIFF');
  assert(view.getUint32(4, true) === 36 + numSamples * 2, 'RIFF chunk size matches');
  assert(getAscii(8, 4) === 'WAVE', 'WAVE identifier present');
  assert(getAscii(12, 4) === 'fmt ', 'fmt chunk present');
  assert(view.getUint32(16, true) === 16, 'fmt chunk size is 16');
  assert(view.getUint16(20, true) === 1, 'AudioFormat is 1 (PCM)');
  assert(view.getUint16(22, true) === 1, 'NumChannels is 1 (Mono)');
  assert(view.getUint32(24, true) === 48000, 'SampleRate is 48000');
  assert(view.getUint32(28, true) === 48000 * 2, 'ByteRate is sampleRate * 2');
  assert(view.getUint16(32, true) === 2, 'BlockAlign is 2');
  assert(view.getUint16(34, true) === 16, 'BitsPerSample is 16');
  assert(getAscii(36, 4) === 'data', 'data chunk present');
  assert(view.getUint32(40, true) === numSamples * 2, 'data chunk size matches');

  // Check sample conversion values
  const firstSample = view.getInt16(44, true);
  // channelData[0] is 0
  assert(firstSample === 0, `First sample is 0 (got ${firstSample})`);

  // Peak sine value: sin(pi/2) = 1 => 0.5 * 32767 = 16383.5 => ~16384
  let maxIntSample = 0;
  for (let i = 0; i < 48000; i++) {
    const s = Math.abs(view.getInt16(44 + i * 2, true));
    if (s > maxIntSample) maxIntSample = s;
  }
  assert(Math.abs(maxIntSample - 16384) <= 2, `Peak 16-bit sample is ~16384 (got ${maxIntSample})`);

  // 3. Test Base64 Data URL generation
  const base64Url = audioBufferToBase64DataUrl(mockBuffer);
  assert(base64Url.startsWith('data:audio/wav;base64,'), 'Base64 Data URL has correct prefix');
  assert(base64Url.length > 1000, 'Base64 Data URL is populated');

  // 4. Test generateSingleClipHtml
  const mockEval: HeadsetEvaluation = {
    algoVersion: 'v2.0',
    isMeasurable: true,
    speechStats: {
      maxDb: -14.2,
      minDb: -32.1,
      avgDb: -18.5,
      durationSec: 2.0,
      ratioPercent: 80,
      appropriateRatioPercent: 92,
      targetRangeText: '-24〜-14dBFS',
      appropriateDescription: '適正',
    },
    noiseStats: {
      maxDb: -48.0,
      minDb: -60.0,
      avgDb: -52.0,
      durationSec: 0.5,
      ratioPercent: 20,
      appropriateRatioPercent: 100,
      targetRangeText: '-45dBFS以下',
      appropriateDescription: '良好',
    },
    noiseAnalysis: {
      preNoiseDbFS: -52.0,
      postNoiseDbFS: -51.8,
      noiseDifferenceDb: 0.2,
      hasNoiseLevelShiftWarning: false,
      representativeNoiseDbFS: -52.0,
      noisePowerLinear: 0.000001,
    },
    estimatedSnr: {
      isMeasurable: true,
      snrDb: 33.5,
      voicePowerLinear: 0.014,
      noisePowerLinear: 0.000001,
    },
    snrDb: 33.5,
    frequencyBalance: {
      subBassRumble: 4,
      vocalLowBoom: 18,
      vocalCore: 48,
      vocalClarity: 24,
      airAndHiss: 6,
    },
    bandRatio: {
      lowFreqPowerLinear: 0.005,
      midHighFreqPowerLinear: 0.004,
      ratioDb: 1.0,
      relativeObservationText: '概ね均整のとれた帯域分布',
    },
    spectralCentroidHz: 1850,
    mufflenessLevel: 'clear',
    mufflenessScore: 90,
    clarityScore: 85,
    clippingDetails: {
      peakValue: 0.5,
      peakDbFS: -6.0,
      clippedSampleCount: 0,
      clippingRatioPercent: 0,
      maxConsecutiveClipSamples: 0,
      hasClippingSign: false,
      statusText: 'デジタルクリッピングの兆候なし',
    },
    clippingDetected: false,
    clippingRatio: 0,
    overallScoreStatus: 'pending',
    overallScoreText: '算出保留（明瞭性検証中）',
    overallGradeText: '保留',
    overallGrade: 'A',
    stressScore: 10,
    gradeTitle: '評価実施済（客観測定値取得）',
    assessmentSummary: '明瞭性アルゴリズムの検証段階のため総合スコアは保留です。',
    assessmentItems: [],
    actionableTips: [],
    segments: [
      { startTime: 0, endTime: 0.3, isSpeech: false, avgDb: -52, maxDb: -48 },
      { startTime: 0.3, endTime: 1.8, isSpeech: true, avgDb: -18, maxDb: -14 },
      { startTime: 1.8, endTime: 2.0, isSpeech: false, avgDb: -52, maxDb: -48 },
    ],
  };

  const clip: RecordedClip = {
    id: 'clip-test-1',
    name: 'テスト記録',
    blob: blob,
    audioUrl: 'blob:http://localhost/test',
    duration: 2.0,
    sampleRate: 48000,
    buffer: mockBuffer,
    evaluation: mockEval,
    recordedAt: new Date(),
    micDeviceLabel: 'USBテストマイクロホン',
  };

  const html = generateSingleClipHtml(clip);
  assert(html.includes('<!DOCTYPE html>'), 'HTML contains DOCTYPE');
  assert(html.includes('data:audio/wav;base64,'), 'HTML embeds Base64 audio');
  assert(html.includes('waveform-svg'), 'HTML includes waveform SVG');
  assert(html.includes('音声データ埋め込み通知'), 'HTML includes privacy notice');
  assert(html.includes('report-play-btn'), 'HTML includes play button');
  assert(!html.includes('http://') && !html.includes('https://'), 'HTML has zero external network calls (standalone offline)');
  assert(html.includes('30ms窓最大RMS'), 'HTML clarifies speechStats.maxDb is 30ms窓最大RMS');
  assert(!html.includes('瞬時ピーク'), 'HTML does not label 30ms RMS as 瞬時ピーク');
  assert(html.includes('サンプルピーク値: -6.0 dBFS'), 'HTML shows actual sample peak from clippingDetails.peakDbFS');

  // Legacy saved clip with old dummy scores & assertive ratioDb > 10 text must be neutralized
  const legacyDummyClip: RecordedClip = {
    ...clip,
    evaluation: {
      ...mockEval,
      mufflenessLevel: 'heavy_muffle',
      mufflenessScore: 80,
      clarityScore: 80,
      overallGrade: 'B',
      stressScore: 30,
      bandRatio: {
        ...mockEval.bandRatio,
        ratioDb: 24.2,
        relativeObservationText:
          '低域（120〜500Hz）のエネルギー比率が高く、温かみまたは近接効果（マイク距離が近い傾向）が観測されます。',
      },
    },
  };
  const legacyHtml = generateSingleClipHtml(legacyDummyClip);
  assert(!legacyHtml.includes('近接効果'), 'Legacy HTML neutralizes old proximity-effect assertion');
  assert(!legacyHtml.includes('heavy_muffle'), 'Legacy HTML does not render mufflenessLevel');
  assert(legacyHtml.includes('+24.2 dB'), 'Legacy HTML preserves reference bandRatio.ratioDb');
  assert(legacyHtml.includes('4. 音声品質の参考指標'), 'Legacy HTML includes Section 4 heading');
  assert(legacyHtml.includes('未解析'), 'Legacy HTML without extendedMetrics renders 未解析');

  // 4b. Test Phase 2B-2B analyzed HTML output (including 8kHz Nyquist-limited high-band 測定不能)
  const sr8k = 8000;
  const arr8k = new Float32Array(sr8k * 9);
  for (let i = Math.floor(3.2 * sr8k); i < Math.floor(6.8 * sr8k); i++) {
    arr8k[i] = 0.25 * Math.sin((2 * Math.PI * 600 * i) / sr8k);
  }
  const buf8k = {
    sampleRate: sr8k,
    length: arr8k.length,
    duration: 9,
    numberOfChannels: 1,
    getChannelData: () => arr8k,
  } as unknown as AudioBuffer;
  const eval8k = analyzeAudioBuffer(buf8k, {
    recordStartTimeMs: 0,
    promptSpeechTimeMs: 3000,
    requestStopTimeMs: 7000,
    recordEndTimeMs: 9000,
  });
  const html8k = generateSingleClipHtml({
    ...clip,
    duration: 9,
    sampleRate: sr8k,
    buffer: buf8k,
    evaluation: eval8k,
  });
  assert(html8k.includes('4. 音声品質の参考指標'), 'Analyzed HTML includes Section 4');
  assert(html8k.includes('300–4000 Hz'), 'Analyzed 8kHz HTML displays clamped 300-4000 Hz speech-band rolloff range');
  assert(html8k.includes('測定不能'), '8kHz Nyquist-limited HTML displays 測定不能 for unmeasurable 4.2-8kHz band');
  assert(html8k.includes('5. 5段階聴感評価'), 'Analyzed HTML includes Section 5 subjective evaluation');
  assert(html8k.includes('未評価'), 'Unrated subjective HTML displays 未評価 explicitly');

  // 4c. Phase 2B-2D HTML assertions: separated original/normalized & legacy preservation & comparison report
  const ratedClipA: RecordedClip = {
    ...clip,
    id: 'clip-a',
    name: '録音A',
    duration: 9,
    buffer: buf8k,
    evaluation: eval8k,
    micDeviceId: 'usb-dev-123',
    micDeviceLabel: 'USB Headset A',
    subjectiveRating: {
      intelligibilityOriginal: 3,
      intelligibilityNormalized: 5,
      lowMuffleness: 4,
      lowBackgroundNoise: null,
      intelligibility: 4, // legacy unknown-origin score
      notes: '正規化で明瞭性向上',
    },
  };
  const ratedClipB: RecordedClip = {
    ...ratedClipA,
    id: 'clip-b',
    name: '録音B',
    subjectiveRating: {
      intelligibilityOriginal: 4,
      intelligibilityNormalized: 4,
      lowMuffleness: 3,
      lowBackgroundNoise: 5,
      notes: null,
    },
  };
  const singleRatedHtml = generateSingleClipHtml(ratedClipA);
  assert(singleRatedHtml.includes('聞き取りやすさ（原音）'), 'Single HTML lists original intelligibility');
  assert(singleRatedHtml.includes('聞き取りやすさ（正規化後）'), 'Single HTML lists normalized intelligibility');
  assert(singleRatedHtml.includes('旧形式データの保持'), 'Single HTML preserves legacy unknown-origin notice');
  assert(singleRatedHtml.includes('正規化で明瞭性向上'), 'Single HTML includes subjective comment');
  assert(!singleRatedHtml.includes('http://') && !singleRatedHtml.includes('https://'), 'Rated single HTML has zero external URLs');

  const compHtml = generateComparisonHtml([ratedClipA, ratedClipB]);
  assert(compHtml.includes('2. 同一機器別・複数録音統計比較'), 'Comparison HTML includes multi-recording device stats section');
  assert(compHtml.includes('USB Headset A'), 'Comparison HTML includes grouped device label');
  assert(compHtml.includes('95%ロールオフ周波数 (300-8000Hz)'), 'Comparison HTML includes 300-8000Hz rolloff row');
  assert(compHtml.includes('記述統計であり、線形電力平均ではありません'), 'Comparison HTML includes dB descriptive statistics disclaimer');
  assert(!compHtml.includes('http://') && !compHtml.includes('https://'), 'Comparison HTML has zero external URLs');

  // 5. Test fallback when buffer is undefined
  const clipWithoutBuffer = { ...clip, buffer: undefined as unknown as AudioBuffer };
  const htmlNoBuffer = generateSingleClipHtml(clipWithoutBuffer);
  assert(htmlNoBuffer.includes('音声データが存在しないため'), 'HTML handles missing buffer gracefully without crash');

  console.log('\n=== All WAV Export & HTML Report Tests Passed Successfully! ===');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
