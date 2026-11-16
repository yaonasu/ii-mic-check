/**
 * Copyright (c) 2026 八百茄子 (yaonasu)
 * SPDX-License-Identifier: MIT
 */

export type RecordingPhase =
  | 'idle'
  | 'measuring_pre_noise'
  | 'speaking'
  | 'measuring_post_noise'
  | 'analyzing';

export type RecordingMode =
  | 'eval_with_voice'
  /** Legacy read-only value for historical clips recorded under the abolished reference-audio mode */
  | 'eval_with_reference';

export interface RecordingSequenceTimestamps {
  recordStartTimeMs: number;
  promptSpeechTimeMs: number;
  requestStopTimeMs: number;
  recordEndTimeMs: number;
  /** Optional AudioContext hardware-clock timestamps (seconds) for diagnostics */
  audioCtxStartTimeSec?: number;
  audioCtxPromptTimeSec?: number;
  audioCtxStopRequestTimeSec?: number;
  audioCtxEndTimeSec?: number;
  /** Optional MediaRecorder lifecycle timestamps (ms) for boundary verification */
  recorderStartCallTimeMs?: number;
  recorderStartToOnstartMs?: number;
  recorderStopCallTimeMs?: number;
  recorderOnStopTimeMs?: number;
}

export interface VerificationDiagnostics {
  bufferDurationSec: number;
  wallDurationSec?: number;
  audioCtxDurationSec?: number;
  bufferVsWallDiffMs?: number;
  bufferVsAudioCtxDiffMs?: number;
  clockSourceUsed: 'audioContext' | 'performanceNow' | 'fallbackDefault';
  recorderStartToOnstartMs?: number;
  preNoiseEndSec: number;
  speechStartSec: number;
  speechEndSec: number;
  postNoiseStartSec: number;
  postNoiseEndSec: number;
}

export type SubjectiveScoreValue = 1 | 2 | 3 | 4 | 5;

export interface SubjectiveRating {
  intelligibilityOriginal?: SubjectiveScoreValue | null;
  intelligibilityNormalized?: SubjectiveScoreValue | null;
  lowMuffleness?: SubjectiveScoreValue | null;
  lowBackgroundNoise?: SubjectiveScoreValue | null;
  /** Legacy fields preserved read-only without automatic migration */
  intelligibility?: SubjectiveScoreValue | null;
  naturalness?: SubjectiveScoreValue | null;
  noDropoutOrSuppression?: SubjectiveScoreValue | null;
  notes?: string | null;
  updatedAt?: string;
}

export interface AudioDeviceOption {
  deviceId: string;
  label: string;
  kind: 'audioinput' | 'audiooutput';
}

export interface VolumeStats {
  maxDb: number;
  minDb: number;
  avgDb: number;
  durationSec: number;
  ratioPercent: number;
  appropriateRatioPercent: number; // Web会議の適正値内にある割合 (%)
  targetRangeText: string;         // 適正範囲の基準テキスト
  appropriateDescription: string;  // 適正値の説明
}

export interface FrequencyBalance {
  subBassRumble: number; // < 120 Hz
  vocalLowBoom: number;   // 120 - 300 Hz
  vocalCore: number;      // 300 - 1500 Hz
  vocalClarity: number;   // 1500 - 4200 Hz
  airAndHiss: number;     // 4200 - 10000 Hz
}

export interface AudioSegment {
  startTime: number;
  endTime: number;
  isSpeech: boolean;
  avgDb: number;
  maxDb: number;
}

export interface AssessmentItem {
  category: 'volume' | 'noise' | 'clarity' | 'muffleness' | 'clipping';
  title: string;
  status: 'excellent' | 'good' | 'warning' | 'poor';
  valueText: string;
  detail: string;
}

export interface ClippingDetails {
  peakValue: number;
  peakDbFS: number;
  clippedSampleCount: number;
  clippingRatioPercent: number;
  maxConsecutiveClipSamples: number;
  hasClippingSign: boolean;
  statusText: string;
}

export interface AmbientNoiseAnalysis {
  preNoiseDbFS: number;
  postNoiseDbFS: number;
  noiseDifferenceDb: number;
  hasNoiseLevelShiftWarning: boolean;
  representativeNoiseDbFS: number;
  noisePowerLinear: number;
  /** Optional steady noise level observed in intra-speech pauses (if >=150ms available) */
  intraSpeechPauseNoiseDbFS?: number;
}

export interface EstimatedSnrResult {
  isMeasurable: boolean;
  snrDb?: number;
  unmeasurableReason?: string;
  voicePowerLinear?: number;
  noisePowerLinear?: number;
}

export interface BandRatioAnalysis {
  lowFreqPowerLinear: number;     // 120 - 500 Hz
  midHighFreqPowerLinear: number; // 1500 - 4200 Hz
  ratioDb: number;                // 10 * log10(low / midHigh)
  relativeObservationText: string;
}

export interface MetricFrequencyRange {
  nominalLowHz: number;
  nominalHighHz: number;
  effectiveLowHz: number;
  effectiveHighHz: number;
  truncatedByNyquist: boolean;
}

export interface SpeechBandSnrMetric {
  isMeasurable: boolean;
  status: 'measurable' | 'reference_nyquist' | 'unmeasurable';
  unit: 'dB';
  frequencyRange: MetricFrequencyRange;
  snrDb: number | null;
  broadbandDiffDb: number | null;
  speechBandPowerDbFS: number | null;
  noiseBandPowerDbFS: number | null;
  noiseEstimationMethod: 'percentile_20_70_linear_power';
  unmeasurableReason?: string;
}

export interface HighFreqRolloffMetric {
  isMeasurable: boolean;
  isHighBandMeasurable: boolean;
  unitHz: 'Hz';
  unitRatio: 'dB';
  unitPower: 'dBFS';
  sampleRateHz: number;
  nyquistHz: number;
  fftSize: number;
  fftResolutionHz: number;
  rolloffThresholdPercent: 95;
  rolloffFrequencyRange: MetricFrequencyRange;
  rolloff95SpeechBandRange?: MetricFrequencyRange;
  midHighBandRangeHz: [number, number];
  highBandRangeHz: [number, number];
  power1500_4200Linear: number | null;
  power1500_4200DbFS: number | null;
  power4200_8000Linear: number | null;
  power4200_8000DbFS: number | null;
  highToMidHighRatioDb: number | null;
  rolloff95Hz: number | null;
  rolloff95SpeechBandHz?: number | null;
  constraintNote: string;
  unmeasurableReason?: string;
}

export interface BandEnergyValue {
  label: string;
  rangeHz: [number, number];
  effectiveRangeHz: [number, number] | null;
  isMeasurable: boolean;
  powerLinear: number | null;
  powerDbFS: number | null;
  psdLinearPerHz: number | null;
  psdDbPerHz: number | null;
  actualBandwidthHz: number | null;
}

export interface BandEnergyComparisonMetric {
  isMeasurable: boolean;
  unitRatio: 'dB';
  ratioMethod: 'bandwidth_normalized_psd';
  fftWindow: 'hann';
  fftSize: number;
  bands: {
    low_120_300: BandEnergyValue;
    core_300_1000: BandEnergyValue;
    clarity_1500_4200: BandEnergyValue;
    high_4200_8000: BandEnergyValue;
  };
  ratios: {
    lowToCoreDb: number | null;
    clarityToCoreDb: number | null;
    highToClarityDb: number | null;
  };
  integratedRatiosDb: {
    lowToCoreDb: number | null;
    clarityToCoreDb: number | null;
    highToClarityDb: number | null;
  };
  unmeasurableReason?: string;
}

export interface SpeechLevelVariabilityMetric {
  isMeasurable: boolean;
  unit: 'dBFS' | 'dB';
  windowDurationMs: 30;
  hopDurationMs: 15;
  speechWindowCount: number;
  medianDbFS: number | null;
  p25DbFS: number | null;
  p75DbFS: number | null;
  iqrDb: number | null;
  minDbFS: number | null;
  maxDbFS: number | null;
  rangeDb: number | null;
  interpretationNote: string;
  unmeasurableReason?: string;
}

export interface SpectralFlatnessMetric {
  isMeasurable: boolean;
  unit: 'ratio_0_to_1';
  frequencyRange: MetricFrequencyRange;
  aggregationMethod: 'per_frame_median_and_quartiles';
  validSpeechFrameCount: number;
  median: number | null;
  mean: number | null;
  p25: number | null;
  p75: number | null;
  interpretationNote: string;
  unmeasurableReason?: string;
}

export interface Phase2bExtendedMetrics {
  fftNormalization: 'parseval_one_sided_hann';
  fftSize: number;
  fftHopSize: number;
  sampleRateHz: number;
  nyquistHz: number;
  speechBandSnr: SpeechBandSnrMetric;
  highFreqRolloff: HighFreqRolloffMetric;
  bandEnergyComparison: BandEnergyComparisonMetric;
  speechLevelVariability: SpeechLevelVariabilityMetric;
  spectralFlatness: SpectralFlatnessMetric;
}

export interface HeadsetEvaluation {
  algoVersion: 'v1.0' | 'v2.0';
  isMeasurable: boolean;
  unmeasurableReason?: string;

  // Recording timestamps & verification diagnostics
  timestamps?: RecordingSequenceTimestamps;
  verificationInfo?: VerificationDiagnostics;

  // Voice (話者の発声) Stats
  speechStats: VolumeStats;
  // Ambient Noise (周辺音) Stats
  noiseStats: VolumeStats;

  // Ambient Noise & S/N Ratio
  noiseAnalysis: AmbientNoiseAnalysis;
  estimatedSnr: EstimatedSnrResult;
  snrDb: number; // backward compatibility

  // Frequency analysis
  frequencyBalance: FrequencyBalance;
  bandRatio: BandRatioAnalysis;
  spectralCentroidHz: number;
  mufflenessLevel?: 'clear' | 'slight_boom' | 'moderate_muffle' | 'heavy_muffle' | null;
  mufflenessScore?: number | null;
  clarityScore?: number | null;

  // Phase 2B-2B Extended Objective Metrics
  extendedMetrics?: Phase2bExtendedMetrics | null;

  // Clipping
  clippingDetails: ClippingDetails;
  clippingDetected: boolean;
  clippingRatio: number;

  // Overall Score (保留方針)
  overallScoreStatus: 'pending' | 'calculated';
  overallScoreText: string;
  overallGradeText: string;
  overallGrade?: 'S' | 'A' | 'B' | 'C' | 'D' | null; // disabled until Phase 2B-3
  stressScore?: number | null; // disabled until Phase 2B-3

  // Descriptive feedback
  gradeTitle: string;
  assessmentSummary: string;
  assessmentItems: AssessmentItem[];
  actionableTips: string[];

  // Segments for timeline visualizer
  segments: AudioSegment[];
}

export interface RecordedClip {
  id: string;
  name?: string;
  blob: Blob;
  audioUrl: string;
  duration: number; // in seconds (< 60s)
  sampleRate: number;
  buffer: AudioBuffer;
  evaluation: HeadsetEvaluation;
  recordedAt: Date;
  micDeviceId?: string;
  micDeviceLabel: string;
  recordingMode?: RecordingMode;
  outputDeviceLabel?: string;
  trackSettings?: {
    deviceId?: string;
    echoCancellation?: boolean;
    noiseSuppression?: boolean;
    autoGainControl?: boolean;
    sampleRate?: number;
    channelCount?: number;
  };
  subjectiveRating?: SubjectiveRating;
}

export interface MetricDescriptiveStats {
  count: number;
  mean: number | null;
  min: number | null;
  max: number | null;
  stdDev: number | null;
  stdDevMethod: 'population';
  unit: string;
  isDbScale: boolean;
}

export interface DeviceComparisonGroup {
  deviceKey: string;
  deviceLabel: string;
  deviceId: string | null;
  identificationMethod: 'deviceId_and_label' | 'label_only_no_deviceId' | 'unidentified';
  identificationNote: string;
  clipCount: number;
  clipIds: string[];
  clipNames: string[];
  stats: {
    speechRmsDbFS: MetricDescriptiveStats;
    noiseRmsDbFS: MetricDescriptiveStats;
    broadbandSnrDb: MetricDescriptiveStats;
    speechBandSnrDb: MetricDescriptiveStats;
    psdRatioLowToCoreDb: MetricDescriptiveStats;
    psdRatioClarityToCoreDb: MetricDescriptiveStats;
    psdRatioHighToClarityDb: MetricDescriptiveStats;
    speechLevelIqrDb: MetricDescriptiveStats;
    spectralFlatnessMedian: MetricDescriptiveStats;
    rolloff95Hz_20_8000: MetricDescriptiveStats;
    rolloff95Hz_300_8000: MetricDescriptiveStats;
    subjectiveIntelligibilityOriginal: MetricDescriptiveStats;
    subjectiveIntelligibilityNormalized: MetricDescriptiveStats;
    subjectiveLowMuffleness: MetricDescriptiveStats;
    subjectiveLowBackgroundNoise: MetricDescriptiveStats;
  };
  legacyUnknownIntelligibilityCount: number;
}

export interface TestScript {
  id: string;
  title: string;
  purpose: string;
  text: string;
  durationEst: string;
}

export type ProvisionalScoreItemStatus = 'scored' | 'unavailable' | 'provisional';
export type ProvisionalGradeLetter = 'S' | 'A' | 'B' | 'C' | 'D';
export type ProvisionalScoreItemKey =
  | 'inputVolume'
  | 'noisePerformance'
  | 'frequencyCharacteristics'
  | 'speechStability';

export interface ProvisionalScoreItem {
  key: ProvisionalScoreItemKey;
  label: string;
  score: number | null;
  maxScore: number;
  status: ProvisionalScoreItemStatus;
  usedMetrics: string[];
  metricValues: Record<string, number | string | boolean | null>;
  referenceOnlyMetrics: string[];
  rationale: string;
  notes: string[];
}

export interface ProvisionalScoreNotices {
  provisionalScoreTitle: string;
  provisionalScoreNotice: string;
  webMeetingDspTitle: string;
  webMeetingDspNotice: string;
  browserDspSettingNote: string;
}

export interface ProvisionalScoreResult {
  scoringVersion: string;
  isProvisional: true;
  status: 'provisional' | 'unavailable';
  totalScore: number | null;
  maxTotalScore: 100;
  provisionalGrade: ProvisionalGradeLetter | null;
  provisionalGradeLabel: string;
  rawScoreSum: number | null;
  availableMaxScoreSum: number;
  isRescaled: boolean;
  rescalingNote: string | null;
  summary: string;
  unavailableItems: string[];
  usedMetricNames: string[];
  referenceOnlyIndicators: string[];
  items: {
    inputVolume: ProvisionalScoreItem;
    noisePerformance: ProvisionalScoreItem;
    frequencyCharacteristics: ProvisionalScoreItem;
    speechStability: ProvisionalScoreItem;
  };
  notices: ProvisionalScoreNotices;
}

