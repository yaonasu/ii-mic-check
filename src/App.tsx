/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
/*
 * Copyright (c) 2026 八百茄子 (yaonasu)
 * Application-specific additions for ii-mic-check are licensed under the MIT License (see LICENSE.md).
 * Template-derived and existing Apache-2.0 portions remain under Apache-2.0.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  AudioDeviceOption,
  RecordedClip,
  RecordingPhase,
  RecordingSequenceTimestamps,
  SubjectiveRating,
} from './types/audio';
import { analyzeAudioBuffer } from './utils/audioDsp';
import {
  computeClipDeletionTransition,
  normalizeSubjectiveRating,
  removeSubjectiveRatingFromStorage,
  saveSubjectiveRatingToStorage,
} from './utils/verificationExport';
import { AudioVisualizer } from './components/AudioVisualizer';
import { RecordedClipView } from './components/RecordedClipView';
import { ComparisonTable } from './components/ComparisonTable';
import { PWAInstallButton } from './components/PWAInstallButton';
import { OfflineIndicator } from './components/OfflineIndicator';
import { getCurrentDisplayMode } from './utils/viewMode';
import {
  Square,
  Headphones,
  Mic,
  Volume2,
  RefreshCw,
  AlertCircle,
  ShieldCheck,
  X,
} from 'lucide-react';

const MAX_RECORDING_SECONDS = 60; // 1分未満制限 (最大60秒)
const MAX_CLIPS = 4; // 記録できる音声を4個に制限 (4個を超えたら古い順にFIFOで上書き)
const RAW_BASE_URL =
  typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL
    ? import.meta.env.BASE_URL
    : '/';
const BASE_PATH = RAW_BASE_URL.endsWith('/') ? RAW_BASE_URL : `${RAW_BASE_URL}/`;
const APP_LICENSE_URL = `${BASE_PATH}LICENSE.md`;
const THIRD_PARTY_LICENSES_URL = `${BASE_PATH}THIRD-PARTY-LICENSES.md`;

const MIT_LICENSE_TEXT = `Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

const ISC_LICENSE_TEXT = `Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`;

export default function App() {
  // Display-only mode flag (?debug=1 -> debug detail mode, otherwise general-user simple mode)
  const isDebugMode = getCurrentDisplayMode() === 'debug';

  // Audio devices
  const [inputDevices, setInputDevices] = useState<AudioDeviceOption[]>([]);
  const [outputDevices, setOutputDevices] = useState<AudioDeviceOption[]>([]);
  const [selectedInputId, setSelectedInputId] = useState<string>('');
  const [selectedOutputId, setSelectedOutputId] = useState<string>('');
  const [hasMicPermission, setHasMicPermission] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  // Recording state & guided sequence
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [recordingPhase, setRecordingPhase] = useState<RecordingPhase>('idle');
  const [phaseCountdownSeconds, setPhaseCountdownSeconds] = useState<number>(0);
  const [recordingSeconds, setRecordingSeconds] = useState<number>(0);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [showLicenses, setShowLicenses] = useState<boolean>(false);
  const [licenseModalTab, setLicenseModalTab] = useState<'app' | 'thirdParty'>('app');
  const openLicenseModal = (tab: 'app' | 'thirdParty') => {
    setLicenseModalTab(tab);
    setShowLicenses(true);
  };
  const recordingPhaseRef = useRef<RecordingPhase>('idle');

  const updateRecordingPhase = (phase: RecordingPhase) => {
    recordingPhaseRef.current = phase;
    setRecordingPhase(phase);
  };

  // Up to 4 recorded clips (FIFO: 4個を超えたら古い順に自動上書き)
  const [clips, setClips] = useState<RecordedClip[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const clipsRef = useRef<RecordedClip[]>(clips);
  clipsRef.current = clips;
  const selectedClipIdRef = useRef<string | null>(selectedClipId);
  selectedClipIdRef.current = selectedClipId;

  const activeClip =
    clips.find((c) => c.id === selectedClipId) || (clips.length > 0 ? clips[clips.length - 1] : null);

  // Audio nodes & stream references
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const timerIntervalRef = useRef<number | null>(null);
  const postNoiseTimerRef = useRef<number | null>(null);

  const timestampsRef = useRef<RecordingSequenceTimestamps>({
    recordStartTimeMs: 0,
    promptSpeechTimeMs: 0,
    requestStopTimeMs: 0,
    recordEndTimeMs: 0,
  });

  // Track captured hardware/browser settings (preserves boolean vs undefined)
  const trackSettingsRef = useRef<RecordedClip['trackSettings']>({});

  // Enumerate devices
  const refreshDevices = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        return;
      }
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices
        .filter((d) => d.kind === 'audioinput')
        .map((d, i) => ({
          deviceId: d.deviceId,
          label: d.label || `マイク ${i + 1}`,
          kind: 'audioinput' as const,
        }));
      const outputs = devices
        .filter((d) => d.kind === 'audiooutput')
        .map((d, i) => ({
          deviceId: d.deviceId,
          label: d.label || `スピーカー・ヘッドセット ${i + 1}`,
          kind: 'audiooutput' as const,
        }));

      setInputDevices(inputs);
      setOutputDevices(outputs);

      if (!selectedInputId && inputs.length > 0) {
        setSelectedInputId(inputs[0].deviceId);
      }
      if (!selectedOutputId && outputs.length > 0) {
        setSelectedOutputId(outputs[0].deviceId);
      }

      // Check if permission was already granted
      const hasLabels = inputs.some((i) => i.label && !i.label.startsWith('マイク '));
      if (hasLabels) setHasMicPermission(true);
    } catch (err) {
      console.warn('Failed to enumerate audio devices:', err);
    }
  };

  const handleRefreshDevices = async () => {
    setIsRefreshing(true);
    await refreshDevices();
    setTimeout(() => setIsRefreshing(false), 400);
  };

  // Load devices on mount
  useEffect(() => {
    refreshDevices();

    const handleDeviceChange = () => {
      refreshDevices();
    };

    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
    }

    return () => {
      if (navigator.mediaDevices && navigator.mediaDevices.removeEventListener) {
        navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
      }
    };
  }, []);

  // Request microphone permission explicitly
  const requestPermission = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setHasMicPermission(true);
      // Stop the temp stream immediately
      stream.getTracks().forEach((t) => t.stop());
      await refreshDevices();
    } catch (err) {
      console.error('Microphone permission denied:', err);
      alert('マイクへのアクセスが拒否されました。ブラウザの設定からマイク使用を許可してください。');
    }
  };

  // Clean up all timers on unmount
  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      if (postNoiseTimerRef.current) clearTimeout(postNoiseTimerRef.current);
    };
  }, []);

  // Stop recording helper (immediate cancellation / emergency stop)
  const cancelOrAbortRecording = () => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    if (postNoiseTimerRef.current) {
      clearTimeout(postNoiseTimerRef.current);
      postNoiseTimerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      timestampsRef.current.recorderStopCallTimeMs = performance.now();
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    updateRecordingPhase('idle');
  };

  // Helper to trigger trailing 2-second ambient noise measurement
  const triggerPostNoisePhase = () => {
    if (recordingPhaseRef.current !== 'speaking') return;
    const now = performance.now();
    timestampsRef.current.requestStopTimeMs = now;
    if (audioContextRef.current) {
      timestampsRef.current.audioCtxStopRequestTimeSec = audioContextRef.current.currentTime;
    }
    updateRecordingPhase('measuring_post_noise');
    setPhaseCountdownSeconds(2);

    postNoiseTimerRef.current = window.setTimeout(() => {
      setPhaseCountdownSeconds(1);
      postNoiseTimerRef.current = window.setTimeout(() => {
        timestampsRef.current.recordEndTimeMs = performance.now();
        if (audioContextRef.current) {
          timestampsRef.current.audioCtxEndTimeSec = audioContextRef.current.currentTime;
        }
        if (timerIntervalRef.current) {
          clearInterval(timerIntervalRef.current);
          timerIntervalRef.current = null;
        }
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          timestampsRef.current.recorderStopCallTimeMs = performance.now();
          mediaRecorderRef.current.stop();
        }
        setIsRecording(false);
        updateRecordingPhase('idle');
      }, 1000);
    }, 1000);
  };

  // User clicked "録音を停止する" (triggers 2s post-noise measurement)
  const requestStopRecording = () => {
    const currentPhase = recordingPhaseRef.current;
    if (currentPhase === 'idle') return;

    if (currentPhase === 'measuring_pre_noise') {
      cancelOrAbortRecording();
      return;
    }

    if (currentPhase === 'speaking') {
      triggerPostNoisePhase();
    }
  };

  // Start recording
  const startRecording = async () => {
    try {
      if (isRecording) {
        cancelOrAbortRecording();
      }

      // 1. AudioContext
      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioContextRef.current = new AudioCtx();
      }
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      // 2. Clean up existing tracks
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      }

      // 3. Request user media stream without browser DSP processing
      const constraints: MediaStreamConstraints = {
        audio: {
          deviceId: selectedInputId ? { exact: selectedInputId } : undefined,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      mediaStreamRef.current = stream;
      setHasMicPermission(true);

      // Extract actual track settings (distinguishing false from undefined)
      const track = stream.getAudioTracks()[0];
      const settings = track?.getSettings ? track.getSettings() : {};
      trackSettingsRef.current = {
        deviceId: typeof settings.deviceId === 'string' && settings.deviceId.length > 0 ? settings.deviceId : undefined,
        echoCancellation:
          typeof settings.echoCancellation === 'boolean' ? settings.echoCancellation : undefined,
        noiseSuppression:
          typeof settings.noiseSuppression === 'boolean' ? settings.noiseSuppression : undefined,
        autoGainControl:
          typeof settings.autoGainControl === 'boolean' ? settings.autoGainControl : undefined,
        sampleRate: typeof settings.sampleRate === 'number' ? settings.sampleRate : undefined,
        channelCount: typeof settings.channelCount === 'number' ? settings.channelCount : undefined,
      };

      // Create AnalyserNode for real-time visualization
      const source = audioContextRef.current.createMediaStreamSource(stream);
      const analyser = audioContextRef.current.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.65;
      source.connect(analyser);
      analyserRef.current = analyser;

      // 4. Setup MediaRecorder
      const options: MediaRecorderOptions = {};
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        options.mimeType = 'audio/webm;codecs=opus';
      } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
        options.mimeType = 'audio/mp4';
      }

      const recorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = recorder;
      recordedChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          recordedChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        timestampsRef.current.recorderOnStopTimeMs = performance.now();
        const timestampsSnapshot: RecordingSequenceTimestamps = { ...timestampsRef.current };
        const trackSettingsSnapshot = trackSettingsRef.current
          ? { ...trackSettingsRef.current }
          : undefined;

        setIsAnalyzing(true);
        try {
          const mimeType = recorder.mimeType || 'audio/webm';
          const blob = new Blob(recordedChunksRef.current, { type: mimeType });
          const arrayBuffer = await blob.arrayBuffer();

          // Decode AudioBuffer
          const offlineCtx = new (window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
          const rawAudioBuffer = await offlineCtx.decodeAudioData(arrayBuffer);

          const resolvedMicDeviceId =
            trackSettingsSnapshot?.deviceId ||
            (selectedInputId && selectedInputId.length > 0 ? selectedInputId : undefined);
          const micDevice = inputDevices.find(
            (d) => d.deviceId === (resolvedMicDeviceId || selectedInputId)
          );
          const micLabel = micDevice ? micDevice.label : 'マイクロホン';
          const outDevice = outputDevices.find((d) => d.deviceId === selectedOutputId);

          // Analyze recorded audio with speaker voice evaluation
          const evaluation = analyzeAudioBuffer(rawAudioBuffer, timestampsSnapshot);

          const newClip: RecordedClip = {
            id: `clip-${Date.now()}`,
            name: `記録 #${clips.length + 1}`,
            blob,
            audioUrl: URL.createObjectURL(blob),
            duration: rawAudioBuffer.duration,
            sampleRate: rawAudioBuffer.sampleRate,
            buffer: rawAudioBuffer,
            evaluation,
            recordedAt: new Date(),
            micDeviceId: resolvedMicDeviceId,
            micDeviceLabel: micLabel,
            outputDeviceLabel: outDevice?.label,
            recordingMode: 'eval_with_voice',
            trackSettings: trackSettingsSnapshot,
          };

          // Store up to MAX_CLIPS (FIFO: 4個を超えたら古い順に上書き)
          setClips((prev) => {
            const updated = [...prev];
            if (updated.length >= MAX_CLIPS) {
              const oldest = updated.shift();
              if (oldest) {
                if (oldest.audioUrl) {
                  URL.revokeObjectURL(oldest.audioUrl);
                }
                removeSubjectiveRatingFromStorage(oldest.id);
              }
            }
            updated.push(newClip);
            return updated;
          });
          setSelectedClipId(newClip.id);
          offlineCtx.close();
        } catch (err) {
          console.error('Audio decoding / analysis error:', err);
          alert('録音データの処理中にエラーが発生しました。もう一度録音をお試しください。');
        } finally {
          setIsAnalyzing(false);
          if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach((t) => t.stop());
            mediaStreamRef.current = null;
          }
        }
      };

      // 5. Start guided recording sequence
      const startCallTimeMs = performance.now();
      let captureStartTimeMs = startCallTimeMs;
      timestampsRef.current = {
        recordStartTimeMs: captureStartTimeMs,
        promptSpeechTimeMs: captureStartTimeMs + 3000,
        requestStopTimeMs: 0,
        recordEndTimeMs: 0,
        audioCtxStartTimeSec: audioContextRef.current?.currentTime,
        recorderStartCallTimeMs: startCallTimeMs,
      };

      recorder.onstart = () => {
        // Re-anchor to the actual moment MediaRecorder starts capturing
        const onstartTimeMs = performance.now();
        captureStartTimeMs = onstartTimeMs;
        timestampsRef.current.recordStartTimeMs = onstartTimeMs;
        timestampsRef.current.promptSpeechTimeMs = onstartTimeMs + 3000;
        timestampsRef.current.recorderStartToOnstartMs = Math.max(
          0,
          onstartTimeMs - startCallTimeMs
        );
        if (audioContextRef.current) {
          timestampsRef.current.audioCtxStartTimeSec = audioContextRef.current.currentTime;
        }
      };

      recorder.start(100);
      setIsRecording(true);
      updateRecordingPhase('measuring_pre_noise');
      setPhaseCountdownSeconds(3);
      setRecordingSeconds(0);

      timerIntervalRef.current = window.setInterval(() => {
        const now = performance.now();
        const elapsedSec = Math.max(0, (now - captureStartTimeMs) / 1000);
        setRecordingSeconds(elapsedSec);

        // First 3 seconds: Pre-noise ambient measurement
        if (elapsedSec < 3.0) {
          const rem = Math.max(1, Math.ceil(3.0 - elapsedSec));
          setPhaseCountdownSeconds(rem);
        } else if (recordingPhaseRef.current === 'measuring_pre_noise') {
          // 3.0 seconds reached -> prompt speech (recorded deterministically outside React updater)
          timestampsRef.current.promptSpeechTimeMs = now;
          if (audioContextRef.current) {
            timestampsRef.current.audioCtxPromptTimeSec = audioContextRef.current.currentTime;
          }
          updateRecordingPhase('speaking');
        }

        // Strict limit: 60s
        if (elapsedSec >= MAX_RECORDING_SECONDS) {
          requestStopRecording();
        }
      }, 50);
    } catch (err) {
      console.error('Failed to start recording:', err);
      alert('マイク録音の開始に失敗しました。マイクの接続とブラウザのアクセス許可をご確認ください。');
      setIsRecording(false);
      updateRecordingPhase('idle');
    }
  };

  // Delete clip handler (safe against missing target, stale closure, and storage failure)
  const handleDeleteClip = (clipId: string) => {
    const transition = computeClipDeletionTransition(
      clipsRef.current,
      selectedClipIdRef.current,
      clipId
    );

    const storageResult = removeSubjectiveRatingFromStorage(clipId);
    if (!storageResult.ok) {
      console.warn('Failed to remove persisted subjective rating:', storageResult.error);
    }

    if (!transition.deleted) {
      if (transition.nextSelectedClipId !== selectedClipIdRef.current) {
        selectedClipIdRef.current = transition.nextSelectedClipId;
        setSelectedClipId(transition.nextSelectedClipId);
      }
      return;
    }

    if (transition.deletedClip?.audioUrl) {
      try {
        URL.revokeObjectURL(transition.deletedClip.audioUrl);
      } catch {
        // Ignore URL revocation errors
      }
    }

    clipsRef.current = transition.nextClips;
    selectedClipIdRef.current = transition.nextSelectedClipId;
    setClips(transition.nextClips);
    setSelectedClipId(transition.nextSelectedClipId);
  };

  // Rename clip handler
  const handleUpdateClipName = (clipId: string, newName: string) => {
    setClips((prev) =>
      prev.map((c) => (c.id === clipId ? { ...c, name: newName } : c))
    );
  };

  // Update 5-point subjective listening rating (independent of automatic DSP evaluation)
  const handleUpdateSubjectiveRating = (
    clipId: string,
    rating: SubjectiveRating | undefined
  ) => {
    const normalized = normalizeSubjectiveRating(rating);
    saveSubjectiveRatingToStorage(clipId, normalized);
    setClips((prev) =>
      prev.map((c) => (c.id === clipId ? { ...c, subjectiveRating: normalized } : c))
    );
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Offline status indicator */}
      <OfflineIndicator />

      {/* App Header */}
      <header className="sticky top-0 z-40 bg-slate-950/80 backdrop-blur-md border-b border-slate-800/80 px-4 sm:px-6 py-3.5">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-cyan-600 to-emerald-500 flex items-center justify-center shadow-lg shadow-cyan-950/50">
              <Headphones className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex flex-wrap items-baseline gap-2">
                <h1 className="font-extrabold text-base sm:text-lg tracking-tight text-white">
                  マイク音質チェッカー
                </h1>
                <span className="text-xs font-mono text-cyan-400">ii-mic-check</span>
              </div>
              <p className="text-[11px] text-slate-400 hidden sm:block">
                音声を外部送信せずブラウザ内だけでマイクやヘッドセットの音質を確認・比較できるローカル診断ツール
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <PWAInstallButton />
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* マイク音質チェック: 機器選択・録音制御・朗読テキスト・音量バー統合カード */}
        <div className="rounded-3xl bg-slate-900 border border-slate-800 p-5 sm:p-6 shadow-xl space-y-5">
          {/* タイトル行 */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-800/80">
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-cyan-400"></span>
              <h2 className="font-bold text-base sm:text-lg text-white">
                マイク音質チェック
              </h2>
            </div>

            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              {!hasMicPermission && (
                <button
                  onClick={requestPermission}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/40 text-xs font-medium hover:bg-amber-500/30 transition cursor-pointer"
                >
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>マイクを許可する</span>
                </button>
              )}

              {/* 録音の開始・終了ボタン */}
              {!isRecording ? (
                <button
                  onClick={startRecording}
                  disabled={isAnalyzing}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-2xl text-white font-extrabold text-xs sm:text-sm shadow-lg active:scale-95 transition cursor-pointer disabled:opacity-50 bg-gradient-to-r from-red-600 via-rose-600 to-red-500 hover:from-red-500 hover:to-rose-400 shadow-red-950/60"
                >
                  <div className="w-2.5 h-2.5 rounded-full bg-white animate-pulse" />
                  <span>録音を開始する</span>
                </button>
              ) : (
                <button
                  onClick={requestStopRecording}
                  disabled={recordingPhase === 'measuring_post_noise'}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-2xl text-white active:scale-95 font-extrabold text-xs sm:text-sm shadow-lg shadow-red-950/60 transition cursor-pointer ${
                    recordingPhase === 'measuring_post_noise'
                      ? 'bg-amber-600 cursor-wait opacity-80'
                      : 'bg-red-600 hover:bg-red-500'
                  }`}
                >
                  <Square className="w-3.5 h-3.5 fill-current text-white" />
                  <span>
                    {recordingPhase === 'measuring_post_noise'
                      ? '周辺音測定中（終了待機中）'
                      : '録音を停止する'}
                  </span>
                </button>
              )}
            </div>
          </div>

          {/* タイトル行の直下: 「記録機器」「再生機器」の選択UI と 右横に「機器を再読込」ボタン */}
          <div className="flex flex-col md:flex-row items-end gap-3.5">
            {/* Input Device */}
            <div className="flex-1 w-full space-y-1.5">
              <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                <Mic className="w-3.5 h-3.5 text-emerald-400" />
                <span>記録機器</span>
              </label>
              <select
                value={selectedInputId}
                onChange={(e) => setSelectedInputId(e.target.value)}
                className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2.5 text-xs sm:text-sm text-slate-100 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 cursor-pointer"
              >
                {inputDevices.length === 0 ? (
                  <option value="">利用可能なマイクを検索中...</option>
                ) : (
                  inputDevices.map((d, index) => (
                    <option key={d.deviceId || index} value={d.deviceId}>
                      {d.label || `マイク ${index + 1}`}
                    </option>
                  ))
                )}
              </select>
            </div>

            {/* Output Device */}
            <div className="flex-1 w-full space-y-1.5">
              <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                <Volume2 className="w-3.5 h-3.5 text-cyan-400" />
                <span>再生機器</span>
              </label>
              <select
                value={selectedOutputId}
                onChange={(e) => setSelectedOutputId(e.target.value)}
                className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2.5 text-xs sm:text-sm text-slate-100 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 cursor-pointer"
              >
                {outputDevices.length === 0 ? (
                  <option value="">規定の再生デバイス (Default)</option>
                ) : (
                  outputDevices.map((d, index) => (
                    <option key={d.deviceId || index} value={d.deviceId}>
                      {d.label || `スピーカー・イヤホン ${index + 1}`}
                    </option>
                  ))
                )}
              </select>
            </div>

            {/* 「機器を再読込」ボタン */}
            <div className="shrink-0 w-full md:w-auto">
              <button
                onClick={handleRefreshDevices}
                disabled={isRefreshing}
                className="w-full md:w-auto flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 text-xs sm:text-sm font-semibold border border-slate-700 transition cursor-pointer disabled:opacity-50 h-[42px]"
                title="接続機器一覧を更新"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                <span>機器を再読込</span>
              </button>
            </div>
          </div>

          {/* 出力先指定に関する注記 */}
          <div className="text-[11px] text-slate-400">
            ※お使いのブラウザや環境が出力先指定に対応していない場合はOS既定のデバイスから再生されます。
          </div>

          {/* 仕切り線 */}
          <div className="border-b border-slate-800/80 my-1" />

          {/* 朗読用テキストと音量バー統合エリア */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch pt-1">
            {/* Left Column: 朗読用テキスト */}
            <div className="rounded-2xl bg-slate-950 border border-slate-800/80 p-4 sm:p-5 flex flex-col justify-between">
              <div className="space-y-3">
                <div className="flex items-center gap-2 pb-2 border-b border-slate-800/60">
                  <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
                  <span className="text-xs font-bold text-cyan-400 tracking-wider">
                    朗読用テキスト
                  </span>
                </div>
                <p className="text-sm sm:text-base text-slate-100 leading-relaxed font-sans font-medium">
                  お疲れ様です。<br />
                  本日はお時間をいただき、ありがとうございます。<br />
                  私の声は問題なく聞こえていますでしょうか？<br />
                  画面を共有しながら進めさせていただきます。
                </p>
              </div>
              <div className="pt-4 text-xs text-slate-500">
                ※通常の声の大きさとヘッドセットマイクの標準的な距離で発声してください。
              </div>
            </div>

            {/* Right Column: 音量を示す計測中バタつくグラフとバー */}
            <div className="flex flex-col justify-center">
              <AudioVisualizer
                analyser={analyserRef.current}
                isRecording={isRecording}
                recordingSeconds={recordingSeconds}
                recordingPhase={recordingPhase}
                phaseCountdownSeconds={phaseCountdownSeconds}
              />
            </div>
          </div>
        </div>

        {/* Loading Spinner during offline DSP analysis */}
        {isAnalyzing && (
          <div className="rounded-3xl bg-slate-900 border border-slate-800 p-8 text-center space-y-3">
            <div className="w-10 h-10 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto" />
            <h3 className="font-bold text-base text-white">
              音響スペクトル＆周辺音分離を解析中…
            </h3>
            <p className="text-xs text-slate-400">
              音声データから話者の発声区間と暗騒音を識別し、最大・最小・平均音量および帯域バランスを演算しています
            </p>
          </div>
        )}

        {/* 記録・音響評価グループ */}
        {activeClip && !isRecording && (
          <RecordedClipView
            clips={clips}
            selectedClipId={selectedClipId}
            outputDeviceId={selectedOutputId}
            isDebugMode={isDebugMode}
            onSelectClip={setSelectedClipId}
            onDeleteClip={handleDeleteClip}
            onUpdateClipName={handleUpdateClipName}
            onUpdateSubjectiveRating={handleUpdateSubjectiveRating}
          />
        )}

        {/* 記録された音声の比較表 (2件以上記録がある場合のみ表示) */}
        {!isRecording && clips.length >= 2 && (
          <ComparisonTable clips={clips} isDebugMode={isDebugMode} />
        )}

        {/* プライバシー・データ保持・暫定スコアに関する説明 */}
        <section
          aria-label="プライバシーとご利用上の注意"
          className="rounded-2xl bg-slate-900/70 border border-slate-800 p-4 sm:p-5 space-y-2.5 text-xs text-slate-300"
        >
          <div className="flex items-center gap-2 text-cyan-300 font-bold">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span>プライバシーとご利用上の注意（完全ローカル処理）</span>
          </div>
          <ul className="space-y-1.5 text-[11px] sm:text-xs text-slate-300 list-disc list-inside leading-relaxed">
            <li>
              <strong className="text-slate-100">外部送信なし：</strong>
              録音した音声・音響解析結果・マイク機器情報はすべてお使いのブラウザ内だけで処理され、外部サーバーへ送信・保存されません。
            </li>
            <li>
              <strong className="text-slate-100">データの保持：</strong>
              録音音声と測定結果（最大4件）はブラウザのメモリ上にのみ保持され、ページの再読み込みやタブを閉じると消去されます（※ご自身で入力した5段階聴感評価メモのみ端末のブラウザ内に保存されます）。
            </li>
            <li>
              <strong className="text-slate-100">暫定スコアの限界：</strong>
              表示される100点スコアは客観測定値に基づく暫定的な参考値であり、人間が感じる音質や、Teams・Zoom・Google Meet等のWeb会議アプリ側での自動調整を経た実際の聞こえ方を保証するものではありません。
            </li>
          </ul>
        </section>
      </main>

      {/* Footer */}
      <footer className="mt-auto border-t border-slate-800/80 bg-slate-950 px-4 py-4 text-center text-xs text-slate-500">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>
            Copyright (c) 2026 八百茄子 (yaonasu) / ii-mic-check（マイク音質チェッカー）
          </span>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <span>完全ローカル処理（外部送信なし）</span>
            <button
              type="button"
              onClick={() => openLicenseModal('app')}
              className="text-slate-400 hover:text-cyan-300 underline underline-offset-2 transition cursor-pointer"
            >
              利用条件・ライセンス
            </button>
            <button
              type="button"
              onClick={() => openLicenseModal('thirdParty')}
              className="text-slate-400 hover:text-cyan-300 underline underline-offset-2 transition cursor-pointer"
            >
              サードパーティライセンス
            </button>
          </div>
        </div>
      </footer>

      {/* License & Third-Party Licenses Modal */}
      {showLicenses && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="third-party-licenses-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowLicenses(false);
          }}
        >
          <div className="w-full max-w-2xl rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-5 space-y-4 text-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 id="third-party-licenses-title" className="text-sm font-bold text-white">
                ライセンス・著作権表記（ii-mic-check）
              </h3>
              <button
                type="button"
                onClick={() => setShowLicenses(false)}
                aria-label="閉じる"
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setLicenseModalTab('app')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition cursor-pointer ${
                  licenseModalTab === 'app'
                    ? 'bg-cyan-500/20 text-cyan-200 border-cyan-500/50'
                    : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
                }`}
              >
                利用条件・著作権（本アプリ）
              </button>
              <button
                type="button"
                onClick={() => setLicenseModalTab('thirdParty')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition cursor-pointer ${
                  licenseModalTab === 'thirdParty'
                    ? 'bg-cyan-500/20 text-cyan-200 border-cyan-500/50'
                    : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
                }`}
              >
                サードパーティライセンス（全文）
              </button>
            </div>

            {licenseModalTab === 'app' ? (
              <div className="max-h-80 overflow-y-auto space-y-3 text-xs leading-relaxed pr-1">
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                  <div className="font-bold text-white">
                    ii-mic-check（マイク音質チェッカー）— MIT License
                  </div>
                  <div className="text-slate-300">Copyright (c) 2026 八百茄子 (yaonasu)</div>
                </div>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2 text-[11px] text-slate-300">
                  <p>
                    <strong className="text-white">1. 独自コードのライセンス（MIT License）：</strong>
                    八百茄子 (yaonasu) が権利を保有する本アプリの独自ソースコード等は MIT License の下で公開されており、著作権表示および許諾表示を保持する条件のもとで、改変・再配布・商用利用（個人利用・業務利用を含む）が許可されます。
                  </p>
                  <p>
                    <strong className="text-white">2. 既存 Apache-2.0 および第三者 OSS：</strong>
                    <code className="text-cyan-300">src/App.tsx</code>・
                    <code className="text-cyan-300">src/utils/wavExport.ts</code> の{' '}
                    <code className="text-cyan-300">SPDX-License-Identifier: Apache-2.0</code>{' '}
                    適用部分、および第三者オープンソースライブラリ（MIT / ISC 等）については、それぞれの原ライセンス条件が維持されます。
                  </p>
                  <p>
                    <strong className="text-white">3. 無保証（AS IS）：</strong>
                    本アプリおよび測定結果は現状のまま無保証で提供され、品質・適合性・正確性についていかなる保証も行いません。
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
                  <div className="font-bold text-white text-[11px]">MIT License 本文</div>
                  <pre className="whitespace-pre-wrap font-sans text-[10px] text-slate-400 leading-relaxed">
                    {`MIT License\n\nCopyright (c) 2026 八百茄子 (yaonasu)\n\n${MIT_LICENSE_TEXT}`}
                  </pre>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
                  <span>配信ファイル（オフラインPWA対応）:</span>
                  <a
                    href={APP_LICENSE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-cyan-300 hover:text-cyan-200 underline underline-offset-2"
                  >
                    LICENSE.md を開く
                  </a>
                </div>
              </div>
            ) : (
              <div className="max-h-80 overflow-y-auto space-y-3 text-[11px] leading-relaxed pr-1">
                <p className="text-slate-400">
                  本アプリの配信バンドル（JS / CSS / Service Worker）には以下のオープンソースソフトウェアが含まれます。オフライン PWA 環境でも確認できるよう、著作権表示とライセンス全文をアプリ内および{' '}
                  <a
                    href={THIRD_PARTY_LICENSES_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-cyan-300 hover:text-cyan-200 underline underline-offset-2"
                  >
                    THIRD-PARTY-LICENSES.md
                  </a>{' '}
                  に保持しています。
                </p>

                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                  <div className="font-bold text-white">
                    react / react-dom / scheduler (MIT License)
                  </div>
                  <div className="text-slate-400">
                    Copyright (c) Meta Platforms, Inc. and affiliates.
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                  <div className="font-bold text-white">lucide-react (ISC License)</div>
                  <div className="text-slate-400">
                    Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2023 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2025.
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                  <div className="font-bold text-white">
                    Workbox ランタイム: workbox-window / workbox-core / workbox-precaching / workbox-routing / workbox-strategies (MIT License)
                  </div>
                  <div className="text-slate-400">Copyright 2018 Google LLC</div>
                </div>

                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                  <div className="font-bold text-white">
                    tailwindcss — 配信 CSS / Preflight 出力 (MIT License)
                  </div>
                  <div className="text-slate-400">Copyright (c) Tailwind Labs, Inc.</div>
                </div>

                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                  <div className="font-bold text-white">
                    vite — ランタイム補助コード (MIT License)
                  </div>
                  <div className="text-slate-400">
                    Copyright (c) 2019-present, VoidZero Inc. and Vite contributors
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
                  <div className="font-bold text-white">MIT License 全文</div>
                  <pre className="whitespace-pre-wrap font-sans text-[10px] text-slate-400 leading-relaxed">
                    {MIT_LICENSE_TEXT}
                  </pre>
                </div>

                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
                  <div className="font-bold text-white">ISC License 全文</div>
                  <pre className="whitespace-pre-wrap font-sans text-[10px] text-slate-400 leading-relaxed">
                    {ISC_LICENSE_TEXT}
                  </pre>
                </div>

                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                  <div className="font-bold text-white">
                    テンプレート由来・既存 Apache-2.0 適用部分の注記
                  </div>
                  <div className="text-slate-400">
                    `src/App.tsx` および `src/utils/wavExport.ts` の `SPDX-License-Identifier: Apache-2.0` 表示部分には Apache License, Version 2.0 が引き続き適用されます。
                  </div>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex items-center gap-3 text-[11px]">
                <a
                  href={APP_LICENSE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-slate-400 hover:text-cyan-300 underline underline-offset-2"
                >
                  LICENSE.md
                </a>
                <a
                  href={THIRD_PARTY_LICENSES_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-slate-400 hover:text-cyan-300 underline underline-offset-2"
                >
                  THIRD-PARTY-LICENSES.md
                </a>
              </div>
              <button
                type="button"
                onClick={() => setShowLicenses(false)}
                className="px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white border border-slate-700 cursor-pointer"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
