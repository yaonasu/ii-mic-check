/**
 * Copyright (c) 2026 八百茄子 (yaonasu)
 * SPDX-License-Identifier: MIT
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RecordedClip, SubjectiveRating, SubjectiveScoreValue } from '../types/audio';
import {
  Play,
  Pause,
  RotateCcw,
  Volume2,
  VolumeX,
  Sparkles,
  Headphones,
  FileText,
  Download,
  Trash2,
  Edit2,
  Check,
  ChevronDown,
  ClipboardCopy,
  FileSpreadsheet,
  FileJson,
  Star,
  Eraser,
  SlidersHorizontal,
  AlertTriangle,
} from 'lucide-react';
import { generateSingleClipHtml, downloadHtmlFile } from '../utils/reportExport';
import { audioBufferToWavBlob, downloadWavFile } from '../utils/wavExport';
import {
  ActiveSubjectiveCriterionKey,
  SUBJECTIVE_CRITERIA,
  clipsToCsv,
  clipsToJson,
  downloadCsvFile,
  downloadJsonFile,
  formatDiagnosticLogText,
  formatTrackBooleanSetting,
  getSpeechSegments,
  getSubjectiveRatingStatus,
  hasLegacyUnknownSubjectiveRating,
  isValidSubjectiveScore,
} from '../utils/verificationExport';
import {
  EffectivePlaybackGain,
  PlaybackFilterMode,
  PlaybackNormalizationMode,
  PlaybackNormalizationResult,
  computeClipPlaybackNormalization,
  findNextPlaybackOffset,
  resolveEffectivePlaybackGain,
} from '../utils/playbackNormalization';
import { normalizeEvaluationCompatibility } from '../utils/audioDsp';
import { computeProvisionalScore } from '../utils/provisionalScoring';
import { EvaluationSummary } from './EvaluationSummary';

interface RecordedClipViewProps {
  clips: RecordedClip[];
  selectedClipId: string | null;
  outputDeviceId: string;
  isDebugMode?: boolean;
  onSelectClip: (clipId: string) => void;
  onDeleteClip: (clipId: string) => void;
  onUpdateClipName: (clipId: string, newName: string) => void;
  onUpdateSubjectiveRating: (clipId: string, rating: SubjectiveRating | undefined) => void;
}

export const RecordedClipView: React.FC<RecordedClipViewProps> = ({
  clips,
  selectedClipId,
  outputDeviceId,
  isDebugMode = false,
  onSelectClip,
  onDeleteClip,
  onUpdateClipName,
  onUpdateSubjectiveRating,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Web Audio API playback nodes (supports GainNode boost up to +18 dB without mutating AudioBuffer)
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const normGainNodeRef = useRef<GainNode | null>(null);
  const volumeGainNodeRef = useRef<GainNode | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const playStartCtxTimeRef = useRef<number>(0);
  const playStartOffsetRef = useRef<number>(0);
  const currentOffsetRef = useRef<number>(0);
  const isPlayingRef = useRef<boolean>(false);
  const activeSegmentEndRef = useRef<number | null>(null);

  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [volume, setVolume] = useState<number>(1);
  const [playMode, setPlayMode] = useState<PlaybackFilterMode>('all');
  const [playbackNormMode, setPlaybackNormMode] = useState<PlaybackNormalizationMode>('original');

  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [editingName, setEditingName] = useState<string>('');
  const [copiedDiag, setCopiedDiag] = useState<boolean>(false);
  const [notesDraft, setNotesDraft] = useState<string>('');
  const [pendingDeleteClip, setPendingDeleteClip] = useState<{ id: string; name: string } | null>(
    null
  );

  const activeClip =
    clips.find((c) => c.id === selectedClipId) || clips[clips.length - 1];

  const activeClipRef = useRef<RecordedClip | undefined>(activeClip);
  activeClipRef.current = activeClip;

  const normResult: PlaybackNormalizationResult = useMemo(() => {
    if (!activeClip) {
      return {
        status: 'unmeasurable',
        statusLabel: '測定不能',
        targetRmsDbFS: -23.0,
        appliedGainDb: 0,
        appliedGainLinear: 1,
        limitedByMaxBoost: false,
        limitedByPeak: false,
        isTargetUnreached: false,
        reason: '記録が選択されていません',
      };
    }
    return computeClipPlaybackNormalization(activeClip);
  }, [activeClip]);

  const effectiveGain: EffectivePlaybackGain = useMemo(
    () => resolveEffectivePlaybackGain(playbackNormMode, playMode, normResult),
    [playbackNormMode, playMode, normResult]
  );

  const playModeRef = useRef<PlaybackFilterMode>(playMode);
  playModeRef.current = playMode;
  const effectiveGainRef = useRef<EffectivePlaybackGain>(effectiveGain);
  effectiveGainRef.current = effectiveGain;
  const volumeRef = useRef<number>(volume);
  volumeRef.current = volume;

  const stopSourceOnly = () => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    if (sourceNodeRef.current) {
      const src = sourceNodeRef.current;
      sourceNodeRef.current = null;
      src.onended = null;
      try {
        src.stop();
      } catch {
        // Ignore if already stopped
      }
      try {
        src.disconnect();
      } catch {
        // Ignore disconnect error
      }
    }
  };

  // Reset editing & stop playback cleanly when activeClip changes
  useEffect(() => {
    stopSourceOnly();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    isPlayingRef.current = false;
    setIsPlaying(false);
    currentOffsetRef.current = 0;
    setCurrentTime(0);
    setIsEditing(false);
    setCopiedDiag(false);
    setPendingDeleteClip(null);
    setNotesDraft(activeClip?.subjectiveRating?.notes ?? '');
  }, [activeClip?.id]);

  // Close delete confirmation dialog on Escape key
  useEffect(() => {
    if (!pendingDeleteClip) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPendingDeleteClip(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pendingDeleteClip]);

  // Clean up Web Audio context on unmount
  useEffect(() => {
    return () => {
      stopSourceOnly();
      if (playbackCtxRef.current && playbackCtxRef.current.state !== 'closed') {
        playbackCtxRef.current.close().catch(() => {});
      }
    };
  }, []);

  // Smoothly ramp gain when normalization mode, filter mode, or volume changes
  useEffect(() => {
    const ctx = playbackCtxRef.current;
    if (ctx && normGainNodeRef.current) {
      normGainNodeRef.current.gain.setTargetAtTime(
        effectiveGain.gainLinear,
        ctx.currentTime,
        0.015
      );
    }
  }, [effectiveGain.gainLinear]);

  useEffect(() => {
    const ctx = playbackCtxRef.current;
    if (ctx && volumeGainNodeRef.current) {
      volumeGainNodeRef.current.gain.setTargetAtTime(volume, ctx.currentTime, 0.015);
    }
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  // Handle output device routing (sinkId) for both AudioContext and fallback <audio>
  useEffect(() => {
    const audio = audioRef.current;
    if (
      audio &&
      outputDeviceId &&
      'setSinkId' in audio &&
      typeof (audio as unknown as { setSinkId: (id: string) => Promise<void> }).setSinkId ===
        'function'
    ) {
      (audio as unknown as { setSinkId: (id: string) => Promise<void> })
        .setSinkId(outputDeviceId)
        .catch((err) => {
          console.warn('HTMLAudioElement.setSinkId failed:', err);
        });
    }

    const ctx = playbackCtxRef.current;
    if (
      ctx &&
      outputDeviceId &&
      'setSinkId' in ctx &&
      typeof (ctx as unknown as { setSinkId: (id: string) => Promise<void> }).setSinkId ===
        'function'
    ) {
      (ctx as unknown as { setSinkId: (id: string) => Promise<void> })
        .setSinkId(outputDeviceId)
        .catch((err) => {
          console.warn('AudioContext.setSinkId failed:', err);
        });
    }
  }, [outputDeviceId]);

  // Fallback <audio> timeupdate & ended listener when activeClip.buffer is unavailable
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !activeClip || activeClip.buffer) return;

    const handleTimeUpdate = () => {
      const cur = audio.currentTime;
      setCurrentTime(cur);

      if (playMode !== 'all' && activeClip.evaluation.segments.length > 0) {
        const seg = activeClip.evaluation.segments.find(
          (s) => cur >= s.startTime && cur <= s.endTime
        );
        if (seg) {
          const shouldPlay = playMode === 'speech_only' ? seg.isSpeech : !seg.isSpeech;
          if (!shouldPlay) {
            const nextMatch = activeClip.evaluation.segments.find(
              (s) => s.startTime > cur && (playMode === 'speech_only' ? s.isSpeech : !s.isSpeech)
            );
            if (nextMatch) {
              audio.currentTime = nextMatch.startTime;
            } else {
              audio.pause();
              setIsPlaying(false);
              audio.currentTime = 0;
            }
          }
        }
      }
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [activeClip, playMode]);

  // Draw interactive color-coded waveform canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !activeClip || !activeClip.buffer) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const rawData = activeClip.buffer.getChannelData(0);
    const duration = activeClip.buffer.duration;
    const totalSamples = rawData.length;

    // Dark sleek background
    ctx.fillStyle = '#090d16';
    ctx.fillRect(0, 0, width, height);

    // Draw segment background colored regions
    for (const seg of activeClip.evaluation.segments) {
      const startX = (seg.startTime / duration) * width;
      const endX = (seg.endTime / duration) * width;
      const segWidth = Math.max(1, endX - startX);

      if (seg.isSpeech) {
        ctx.fillStyle = 'rgba(16, 185, 129, 0.12)';
      } else {
        ctx.fillStyle = 'rgba(56, 189, 248, 0.05)';
      }
      ctx.fillRect(startX, 0, segWidth, height);
    }

    // Midline
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    // Draw waveform bars
    const barsCount = 200;
    const samplesPerBar = Math.floor(totalSamples / barsCount);
    const barWidth = width / barsCount;

    for (let b = 0; b < barsCount; b++) {
      const startSample = b * samplesPerBar;
      let min = 1.0;
      let max = -1.0;

      for (let j = 0; j < samplesPerBar; j += 4) {
        const val = rawData[startSample + j] || 0;
        if (val < min) min = val;
        if (val > max) max = val;
      }

      const barTime = (b / barsCount) * duration;
      const isVoiceSegment = activeClip.evaluation.segments.some(
        (s) => barTime >= s.startTime && barTime <= s.endTime && s.isSpeech
      );

      const x = b * barWidth;
      const amp = Math.max(0.04, (max - min) / 2);
      const barH = amp * (height * 0.85);
      const y = (height - barH) / 2;

      // Color code by speech vs noise
      if (isVoiceSegment) {
        ctx.fillStyle = '#10b981'; // vibrant emerald
      } else {
        ctx.fillStyle = '#38bdf8'; // sky blue ambient
      }

      ctx.fillRect(x, y, Math.max(1, barWidth - 1), barH);
    }

    // Draw Playhead scrubber line
    const playheadX = (currentTime / duration) * width;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, height);
    ctx.stroke();

    // Playhead handle
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.arc(playheadX, 6, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }, [activeClip, currentTime]);

  if (!activeClip) return null;

  const ensureWebAudioGraph = async (): Promise<AudioContext> => {
    if (!playbackCtxRef.current || playbackCtxRef.current.state === 'closed') {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      const normGain = ctx.createGain();
      const volGain = ctx.createGain();
      normGain.gain.setValueAtTime(effectiveGainRef.current.gainLinear, ctx.currentTime);
      volGain.gain.setValueAtTime(volumeRef.current, ctx.currentTime);
      normGain.connect(volGain);
      volGain.connect(ctx.destination);
      playbackCtxRef.current = ctx;
      normGainNodeRef.current = normGain;
      volumeGainNodeRef.current = volGain;

      if (
        outputDeviceId &&
        'setSinkId' in ctx &&
        typeof (ctx as unknown as { setSinkId: (id: string) => Promise<void> }).setSinkId ===
          'function'
      ) {
        (ctx as unknown as { setSinkId: (id: string) => Promise<void> })
          .setSinkId(outputDeviceId)
          .catch((err) => {
            console.warn('AudioContext.setSinkId failed:', err);
          });
      }
    }

    if (playbackCtxRef.current.state === 'suspended') {
      await playbackCtxRef.current.resume();
    }
    return playbackCtxRef.current;
  };

  const pauseWebAudio = () => {
    if (playbackCtxRef.current && sourceNodeRef.current) {
      const elapsed = playbackCtxRef.current.currentTime - playStartCtxTimeRef.current;
      const duration = activeClipRef.current?.duration ?? 0;
      const pos = Math.min(duration, playStartOffsetRef.current + Math.max(0, elapsed));
      currentOffsetRef.current = pos;
      setCurrentTime(pos);
    }
    stopSourceOnly();
    isPlayingRef.current = false;
    setIsPlaying(false);
  };

  const startWebAudioAt = async (offsetSec: number) => {
    const clip = activeClipRef.current;
    if (!clip || !clip.buffer) return;

    const buffer = clip.buffer;
    const step = findNextPlaybackOffset(
      offsetSec,
      clip.evaluation.segments || [],
      playModeRef.current,
      buffer.duration
    );

    if (step.action === 'ended') {
      stopSourceOnly();
      isPlayingRef.current = false;
      setIsPlaying(false);
      currentOffsetRef.current = 0;
      setCurrentTime(0);
      return;
    }

    const startPos = step.nextTimeSec;
    activeSegmentEndRef.current = step.segmentEndTime ?? buffer.duration;

    const ctx = await ensureWebAudioGraph();
    if (activeClipRef.current?.id !== clip.id) return;

    stopSourceOnly();

    if (normGainNodeRef.current) {
      normGainNodeRef.current.gain.setValueAtTime(
        effectiveGainRef.current.gainLinear,
        ctx.currentTime
      );
    }
    if (volumeGainNodeRef.current) {
      volumeGainNodeRef.current.gain.setValueAtTime(volumeRef.current, ctx.currentTime);
    }

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(normGainNodeRef.current!);
    sourceNodeRef.current = src;
    playStartCtxTimeRef.current = ctx.currentTime;
    playStartOffsetRef.current = startPos;
    currentOffsetRef.current = startPos;
    setCurrentTime(startPos);
    isPlayingRef.current = true;
    setIsPlaying(true);

    src.onended = () => {
      if (sourceNodeRef.current !== src) return;
      sourceNodeRef.current = null;
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      isPlayingRef.current = false;
      setIsPlaying(false);
      currentOffsetRef.current = 0;
      setCurrentTime(0);
    };

    src.start(0, startPos);

    const tick = () => {
      if (!isPlayingRef.current || !playbackCtxRef.current || sourceNodeRef.current !== src) {
        return;
      }
      const elapsed = playbackCtxRef.current.currentTime - playStartCtxTimeRef.current;
      const pos = Math.min(buffer.duration, playStartOffsetRef.current + Math.max(0, elapsed));
      currentOffsetRef.current = pos;
      setCurrentTime(pos);

      if (
        playModeRef.current !== 'all' &&
        activeSegmentEndRef.current !== null &&
        pos >= activeSegmentEndRef.current - 0.005
      ) {
        const nextStep = findNextPlaybackOffset(
          activeSegmentEndRef.current + 0.005,
          clip.evaluation.segments || [],
          playModeRef.current,
          buffer.duration
        );
        if (nextStep.action === 'ended') {
          stopSourceOnly();
          isPlayingRef.current = false;
          setIsPlaying(false);
          currentOffsetRef.current = 0;
          setCurrentTime(0);
          return;
        }
        void startWebAudioAt(nextStep.nextTimeSec);
        return;
      }

      rafIdRef.current = requestAnimationFrame(tick);
    };

    rafIdRef.current = requestAnimationFrame(tick);
  };

  const togglePlay = () => {
    if (activeClip.buffer) {
      if (isPlayingRef.current) {
        pauseWebAudio();
      } else {
        void startWebAudioAt(currentOffsetRef.current);
      }
      return;
    }

    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play().catch(console.error);
      setIsPlaying(true);
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    const newTime = ratio * activeClip.duration;

    if (activeClip.buffer) {
      currentOffsetRef.current = newTime;
      setCurrentTime(newTime);
      if (isPlayingRef.current) {
        void startWebAudioAt(newTime);
      }
      return;
    }

    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const handleRestart = () => {
    if (activeClip.buffer) {
      currentOffsetRef.current = 0;
      setCurrentTime(0);
      void startWebAudioAt(0);
      return;
    }

    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    setCurrentTime(0);
    audio.play().catch(console.error);
    setIsPlaying(true);
  };

  const handlePlayModeChange = (newMode: PlaybackFilterMode) => {
    playModeRef.current = newMode;
    setPlayMode(newMode);

    const nextEffective = resolveEffectivePlaybackGain(playbackNormMode, newMode, normResult);
    effectiveGainRef.current = nextEffective;
    if (playbackCtxRef.current && normGainNodeRef.current) {
      normGainNodeRef.current.gain.setTargetAtTime(
        nextEffective.gainLinear,
        playbackCtxRef.current.currentTime,
        0.015
      );
    }

    if (activeClip.buffer && isPlayingRef.current) {
      const step = findNextPlaybackOffset(
        currentOffsetRef.current,
        activeClip.evaluation.segments || [],
        newMode,
        activeClip.buffer.duration
      );
      if (step.action === 'ended') {
        stopSourceOnly();
        isPlayingRef.current = false;
        setIsPlaying(false);
        currentOffsetRef.current = 0;
        setCurrentTime(0);
      } else if (step.action === 'jump') {
        void startWebAudioAt(step.nextTimeSec);
      } else {
        activeSegmentEndRef.current = step.segmentEndTime ?? activeClip.buffer.duration;
      }
    }
  };

  const handleNormModeChange = (nextNormMode: PlaybackNormalizationMode) => {
    setPlaybackNormMode(nextNormMode);
    const nextEffective = resolveEffectivePlaybackGain(nextNormMode, playModeRef.current, normResult);
    effectiveGainRef.current = nextEffective;
    if (playbackCtxRef.current && normGainNodeRef.current) {
      normGainNodeRef.current.gain.setTargetAtTime(
        nextEffective.gainLinear,
        playbackCtxRef.current.currentTime,
        0.015
      );
    }
  };

  const handleStartRename = () => {
    setEditingName(activeClip.name || `記録 #${clips.indexOf(activeClip) + 1}`);
    setIsEditing(true);
  };

  const handleSaveRename = () => {
    if (editingName.trim()) {
      onUpdateClipName(activeClip.id, editingName.trim());
    }
    setIsEditing(false);
  };

  const handleExportReport = () => {
    const html = generateSingleClipHtml(activeClip);
    const dateTag = new Date(activeClip.recordedAt)
      .toISOString()
      .slice(0, 19)
      .replace(/[-:T]/g, '');
    const filename = `ii-mic-check-report-${activeClip.name || 'clip'}-${dateTag}.html`;
    downloadHtmlFile(filename, html);
  };

  const handleDownloadWav = () => {
    if (!activeClip.buffer) {
      alert('音声データが保持されていないため、WAVファイルをダウンロードできません。');
      return;
    }

    try {
      const wavBlob = audioBufferToWavBlob(activeClip.buffer);
      const now = new Date(activeClip.recordedAt);
      const pad = (n: number) => n.toString().padStart(2, '0');
      const dateTag = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      
      const safeName = (activeClip.name || 'clip').replace(/[/\\?%*:|"<>]/g, '_');
      const filename = `ii-mic-check-record-${safeName}-${dateTag}.wav`;
      
      downloadWavFile(filename, wavBlob);
    } catch (err) {
      console.error('WAV export error:', err);
      alert('WAVファイルの生成に失敗しました。');
    }
  };

  const handleRequestDelete = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (!activeClip) return;
    const idx = clips.indexOf(activeClip);
    const displayName = activeClip.name || `記録 #${idx >= 0 ? idx + 1 : 1}`;
    setPendingDeleteClip({ id: activeClip.id, name: displayName });
  };

  const handleCancelDelete = () => {
    setPendingDeleteClip(null);
  };

  const handleConfirmDelete = () => {
    if (!pendingDeleteClip) return;
    const targetId = pendingDeleteClip.id;
    setPendingDeleteClip(null);
    stopSourceOnly();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    isPlayingRef.current = false;
    setIsPlaying(false);
    onDeleteClip(targetId);
  };

  const handleToggleScore = (
    key: ActiveSubjectiveCriterionKey,
    score: SubjectiveScoreValue
  ) => {
    const current = activeClip.subjectiveRating || {};
    const nextValue = current[key] === score ? null : score;
    onUpdateSubjectiveRating(activeClip.id, {
      ...current,
      [key]: nextValue,
      notes: notesDraft.trim().length > 0 ? notesDraft : null,
      updatedAt: new Date().toISOString(),
    });
  };

  const handleNotesChange = (value: string) => {
    setNotesDraft(value);
    const current = activeClip.subjectiveRating || {};
    onUpdateSubjectiveRating(activeClip.id, {
      ...current,
      notes: value,
      updatedAt: new Date().toISOString(),
    });
  };

  const handleClearSubjectiveRating = () => {
    setNotesDraft('');
    onUpdateSubjectiveRating(activeClip.id, undefined);
  };

  const handleCopyDiagnosticLog = async () => {
    const text = formatDiagnosticLogText(activeClip);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        setCopiedDiag(true);
        setTimeout(() => setCopiedDiag(false), 1800);
        return;
      }
    } catch {
      // Fallback below
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopiedDiag(true);
      setTimeout(() => setCopiedDiag(false), 1800);
    } catch {
      console.warn('Clipboard copy not available in this context');
    }
  };

  const handleExportCsv = () => {
    const csv = clipsToCsv(clips);
    const dateTag = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
    downloadCsvFile(`ii-mic-check-verification-${dateTag}.csv`, csv);
  };

  const handleExportJson = () => {
    const json = clipsToJson(clips);
    const dateTag = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
    downloadJsonFile(`ii-mic-check-verification-${dateTag}.json`, json);
  };

  const hasAudioData = Boolean(activeClip.buffer);
  const subjectiveStatus = getSubjectiveRatingStatus(activeClip.subjectiveRating);
  const speechSegments = getSpeechSegments(activeClip);
  const diag = activeClip.evaluation.verificationInfo;
  const diagTs = activeClip.evaluation.timestamps;
  const track = activeClip.trackSettings;

  return (
    <div className="rounded-3xl bg-slate-900 border border-slate-800 p-5 sm:p-6 shadow-xl space-y-6">
      <audio ref={audioRef} src={activeClip.audioUrl} />

      {/* Header Info: Title Dropdown + Right-aligned Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
        {/* Left: Dropdown Title & Details */}
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shrink-0"></span>

          {/* Title Dropdown Selector */}
          <div className="relative">
            <select
              value={activeClip.id}
              onChange={(e) => {
                onSelectClip(e.target.value);
                setIsEditing(false);
              }}
              className="appearance-none font-bold text-sm sm:text-base text-white bg-slate-950 border border-slate-700/80 hover:border-cyan-500 rounded-xl px-3 py-1.5 pr-8 focus:outline-none focus:ring-1 focus:ring-cyan-400 cursor-pointer"
            >
              {clips.map((c, idx) => {
                const labelName = c.name || `記録 #${idx + 1}`;
                if (isDebugMode) {
                  return (
                    <option key={c.id} value={c.id} className="bg-slate-900 text-white">
                      {labelName} ({c.duration.toFixed(1)}s) -{' '}
                      {c.evaluation.isMeasurable === false
                        ? '要件未達'
                        : c.evaluation.estimatedSnr?.isMeasurable
                        ? `SNR ${c.evaluation.estimatedSnr.snrDb}dB`
                        : '測定済'}
                    </option>
                  );
                }
                const prov = computeProvisionalScore(normalizeEvaluationCompatibility(c.evaluation));
                return (
                  <option key={c.id} value={c.id} className="bg-slate-900 text-white">
                    {labelName} ({c.duration.toFixed(1)}秒) -{' '}
                    {c.evaluation.isMeasurable === false || prov.totalScore === null
                      ? '測定不可'
                      : `${prov.totalScore}点`}
                  </option>
                );
              })}
            </select>
            <ChevronDown className="w-4 h-4 text-slate-400 pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2" />
          </div>

          <span className="text-[11px] px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 font-mono">
            {activeClip.duration.toFixed(1)}秒
          </span>

          {/* Legacy Recording Mode Badge (Only shown for historical reference-mode clips) */}
          {activeClip.recordingMode === 'eval_with_reference' && (
            <span className="text-[11px] px-2 py-0.5 rounded-md bg-purple-500/20 text-purple-300 border border-purple-500/30 font-medium">
              基準音源再生（旧記録）
            </span>
          )}

          <span className="text-xs text-slate-400 flex items-center gap-1.5 hidden sm:inline-flex">
            <Headphones className="w-3.5 h-3.5 text-cyan-400" />
            <span className="truncate max-w-[200px]">{activeClip.micDeviceLabel || '標準マイクロホン'}</span>
          </span>
        </div>

        {/* Right: 「音声をダウンロード」「レポート出力」「名前変更」「ごみ箱」 */}
        <div className="flex items-center gap-2">
          {/* 音声をダウンロード (WAV) */}
          <button
            onClick={handleDownloadWav}
            disabled={!hasAudioData}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition cursor-pointer ${
              hasAudioData
                ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-emerald-300 border-slate-700'
                : 'bg-slate-800/40 text-slate-500 border-slate-800 cursor-not-allowed'
            }`}
            title={
              hasAudioData
                ? '追加の音声加工を行わない16bit PCM WAV音声をダウンロード'
                : '音声データが存在しないためダウンロードできません'
            }
          >
            <Download className={`w-3.5 h-3.5 ${hasAudioData ? 'text-emerald-400' : 'text-slate-500'}`} />
            <span>音声をダウンロード</span>
          </button>

          {/* レポート出力（デバッグ詳細モードのみ） */}
          {isDebugMode && (
            <button
              onClick={handleExportReport}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-cyan-300 text-xs font-semibold border border-slate-700 transition cursor-pointer"
              title="この記録のレポートを出力 (HTML / 音声プレイヤー付き)"
            >
              <FileText className="w-3.5 h-3.5 text-cyan-400" />
              <span>レポート出力</span>
            </button>
          )}

          {/* 名前変更 */}
          {isEditing ? (
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                className="px-2 py-1 rounded-lg bg-slate-950 border border-cyan-500 text-xs text-white focus:outline-none w-28 sm:w-36"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveRename();
                  if (e.key === 'Escape') setIsEditing(false);
                }}
              />
              <button
                onClick={handleSaveRename}
                className="p-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white transition cursor-pointer"
                title="保存"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={handleStartRename}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-medium border border-slate-700 transition cursor-pointer"
              title="名前変更"
            >
              <Edit2 className="w-3.5 h-3.5 text-slate-400" />
              <span>名前変更</span>
            </button>
          )}

          {/* ごみ箱アイコン */}
          <button
            type="button"
            onClick={handleRequestDelete}
            aria-label="この記録を削除"
            className="p-2 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 border border-slate-700 hover:border-rose-500/30 transition cursor-pointer"
            title="この記録を削除"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Playback Controls & Selective Listening Mode (再生ボタンの行) */}
      <div className="space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          {/* Play / Pause / Restart */}
          <div className="flex items-center gap-2">
            <button
              onClick={togglePlay}
              className="flex items-center justify-center w-10 h-10 rounded-xl bg-cyan-600 hover:bg-cyan-500 active:scale-95 text-white shadow-md shadow-cyan-950 transition cursor-pointer"
              title={isPlaying ? '一時停止' : '再生'}
            >
              {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
            </button>
            <button
              onClick={handleRestart}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition cursor-pointer"
              title="最初から再生"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>

          {/* Selective listening filters (Diagnose speech vs background noise) */}
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => handlePlayModeChange('all')}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer ${
                playMode === 'all'
                  ? 'bg-slate-800 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              全編再生
            </button>
            <button
              onClick={() => handlePlayModeChange('speech_only')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer ${
                playMode === 'speech_only'
                  ? 'bg-emerald-500/30 text-emerald-300 border border-emerald-500/40'
                  : 'text-slate-400 hover:text-emerald-300'
              }`}
            >
              <Sparkles className="w-3 h-3 text-emerald-400" />
              <span>声のみ抽出再生</span>
            </button>
            <button
              onClick={() => handlePlayModeChange('noise_only')}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer ${
                playMode === 'noise_only'
                  ? 'bg-sky-500/30 text-sky-300 border border-sky-500/40'
                  : 'text-slate-400 hover:text-sky-300'
              }`}
            >
              周辺音のみ再生
            </button>
          </div>

          {/* Compact Playback Volume Normalization Toggle */}
          <div
            className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800"
            title={
              isDebugMode
                ? '発声区間の実効音量を -23 dBFS に揃えて再生比較します（WAV/解析値は変更しません）'
                : '聴き取りやすい標準の音量に揃えて再生比較します（保存音声・スコアは変更しません）'
            }
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400 ml-1.5 mr-0.5 shrink-0" />
            <button
              type="button"
              onClick={() => handleNormModeChange('original')}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer ${
                playbackNormMode === 'original'
                  ? 'bg-slate-800 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              原音量
            </button>
            <button
              type="button"
              onClick={() => handleNormModeChange('normalized')}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer ${
                playbackNormMode === 'normalized'
                  ? normResult.status === 'unmeasurable'
                    ? 'bg-rose-500/25 text-rose-200 border border-rose-500/40'
                    : normResult.status === 'limited'
                    ? 'bg-amber-500/25 text-amber-200 border border-amber-500/40'
                    : 'bg-cyan-500/25 text-cyan-200 border border-cyan-500/40'
                  : 'text-slate-400 hover:text-cyan-300'
              }`}
            >
              音量正規化
            </button>
          </div>

          {/* Volume slider */}
          <div className="flex items-center gap-2 text-slate-400">
            <button
              onClick={() => {
                const newVol = volume > 0 ? 0 : 1;
                setVolume(newVol);
              }}
              className="hover:text-white cursor-pointer"
              title={volume === 0 ? 'ミュート解除' : 'ミュート'}
            >
              {volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                setVolume(v);
              }}
              className="w-20 accent-cyan-500 cursor-pointer"
            />
          </div>
        </div>

        {/* Normalization Status Readout (Visible whenever 音量正規化 is active so users never lose state) */}
        {playbackNormMode === 'normalized' && (
          <div
            className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl border text-xs ${
              playMode === 'noise_only'
                ? 'bg-sky-950/40 border-sky-500/30 text-sky-200'
                : normResult.status === 'unmeasurable'
                ? 'bg-rose-950/30 border-rose-500/30 text-rose-200'
                : normResult.status === 'limited'
                ? 'bg-amber-950/30 border-amber-500/30 text-amber-200'
                : 'bg-cyan-950/30 border-cyan-500/30 text-cyan-100'
            }`}
          >
            {isDebugMode ? (
              <>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-mono">
                    目標音量: <strong>{normResult.targetRmsDbFS.toFixed(0)} dBFS</strong>
                  </span>
                  <span className="font-mono">
                    実際の適用ゲイン:{' '}
                    <strong>
                      {playMode === 'noise_only'
                        ? '+0.0 dB（原音量維持）'
                        : normResult.status === 'unmeasurable'
                        ? '+0.0 dB（未適用）'
                        : `${normResult.appliedGainDb >= 0 ? '+' : ''}${normResult.appliedGainDb.toFixed(1)} dB`}
                    </strong>
                  </span>
                  {normResult.measuredSpeechRmsDbFS !== undefined &&
                    normResult.resultingSpeechRmsDbFS !== undefined &&
                    playMode !== 'noise_only' &&
                    normResult.status !== 'unmeasurable' && (
                      <span className="text-[11px] text-slate-300 font-mono">
                        (発声 {normResult.measuredSpeechRmsDbFS.toFixed(1)} →{' '}
                        {normResult.resultingSpeechRmsDbFS.toFixed(1)} dBFS)
                      </span>
                    )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {playMode === 'noise_only' ? (
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-sky-500/20 border border-sky-400/30 text-sky-200">
                      周辺音のみ再生中：暗騒音比較のため原音量維持
                    </span>
                  ) : (
                    <>
                      <span
                        className={`text-[11px] font-bold px-2 py-0.5 rounded-md border ${
                          normResult.status === 'applied'
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                            : normResult.status === 'limited'
                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                            : 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                        }`}
                      >
                        正規化の状態:{' '}
                        {normResult.status === 'limited'
                          ? 'ゲイン制限（目標音量未達）'
                          : normResult.statusLabel}
                      </span>
                      {normResult.reason && (
                        <span className="flex items-center gap-1 text-[11px] text-slate-300">
                          <AlertTriangle className="w-3 h-3 shrink-0 text-amber-400" />
                          <span>{normResult.reason}</span>
                        </span>
                      )}
                    </>
                  )}
                </div>
              </>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2 w-full text-[11px]">
                <span>
                  {playMode === 'noise_only'
                    ? '周辺音のみ再生中は、元の雑音の大きさを確認するため原音量のまま再生します。'
                    : normResult.status === 'unmeasurable'
                    ? '話し声を十分に判定できなかったため、原音量のまま再生します。'
                    : normResult.status === 'limited'
                    ? '聴き取りやすい音量に自動調整して再生しています（音割れ防止のため上限まで調整）。'
                    : '聴き取りやすい標準の大きさに音量を自動調整して再生しています。'}
                </span>
                <span className="text-slate-300 shrink-0">※保存音声やスコアは変わりません</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Waveform Canvas & Legend (仕切り線なし) */}
      <div className="space-y-1.5">
        <div className="relative w-full h-24 sm:h-28 rounded-xl overflow-hidden border border-slate-800 cursor-pointer">
          <canvas
            ref={canvasRef}
            width={800}
            height={160}
            onClick={handleSeek}
            className="w-full h-full object-cover"
          />
        </div>

        {/* Time display & Legend (「■話者の発声区間・・・」の行) */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400 pt-0.5">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-emerald-400"></span>
              <span className="text-emerald-300 font-medium">話者の発声区間</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-sky-400"></span>
              <span className="text-sky-300 font-medium">周辺音・無音区間</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 font-mono text-slate-400">
            <span>{currentTime.toFixed(1)}s</span>
            <span>/</span>
            <span>{activeClip.duration.toFixed(1)}s</span>
          </div>
        </div>
      </div>

      {/* Acoustic Evaluation Details: Unified in the same group */}
      <div className="pt-6 border-t border-slate-800/80">
        <EvaluationSummary evaluation={activeClip.evaluation} isDebugMode={isDebugMode} />
      </div>

      {/* 5-Point Subjective Listening Evaluation (Independent of DSP calculation) */}
      <div className="pt-5 border-t border-slate-800/80 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Star className="w-4 h-4 text-amber-400" />
            <h4 className="font-bold text-sm text-white">5段階聴感評価（主観メモ）</h4>
            <span
              className={`text-[11px] font-bold px-2 py-0.5 rounded-md border ${
                subjectiveStatus.statusLabel === '評価済'
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                  : subjectiveStatus.statusLabel === '一部評価'
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                  : 'bg-slate-800 text-slate-400 border-slate-700'
              }`}
            >
              {subjectiveStatus.statusLabel}
              {subjectiveStatus.averageScore !== undefined && ` (平均 ${subjectiveStatus.averageScore})`}
            </span>
          </div>

          {subjectiveStatus.statusLabel !== '未評価' && (
            <button
              type="button"
              onClick={handleClearSubjectiveRating}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-medium border border-slate-700 transition cursor-pointer"
            >
              <Eraser className="w-3 h-3" />
              <span>評価をクリア</span>
            </button>
          )}
        </div>

        <p className="text-[11px] text-slate-400">
          {isDebugMode
            ? '再生して聴き比べた主観評価を1〜5（5が最良・同じ数字の再クリックで未評価(null)へ解除）で記録できます。原音と音量正規化後は独立して保存され、録音PCMや自動解析には影響しません。'
            : '再生して聴き比べた感想を1〜5（5が最も良い・同じ数字をもう一度押すと未評価に戻せます）で記録できます。自動スコアには影響しません。'}
        </p>

        {hasLegacyUnknownSubjectiveRating(activeClip.subjectiveRating) && (
          <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-[11px] text-amber-200 space-y-1">
            <div className="font-bold">
              旧形式の主観評価データを種別不明のまま保持しています（原音 / 正規化後へ自動移行していません）
            </div>
            <div className="text-amber-200/80 font-mono flex flex-wrap gap-x-4 gap-y-0.5">
              {isValidSubjectiveScore(activeClip.subjectiveRating?.intelligibility) && (
                <span>旧・聞き取りやすさ(種別不明): {activeClip.subjectiveRating!.intelligibility}/5</span>
              )}
              {isValidSubjectiveScore(activeClip.subjectiveRating?.naturalness) && (
                <span>旧・声の自然さ: {activeClip.subjectiveRating!.naturalness}/5</span>
              )}
              {isValidSubjectiveScore(activeClip.subjectiveRating?.noDropoutOrSuppression) && (
                <span>旧・音切れ少: {activeClip.subjectiveRating!.noDropoutOrSuppression}/5</span>
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          {SUBJECTIVE_CRITERIA.map((criterion) => {
            const rawVal = activeClip.subjectiveRating?.[criterion.key];
            const currentVal = isValidSubjectiveScore(rawVal) ? rawVal : null;
            return (
              <div
                key={criterion.key}
                className="flex items-center justify-between gap-3 rounded-xl bg-slate-950/70 border border-slate-800/80 px-3 py-2"
                title={criterion.description}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-200">{criterion.label}</span>
                    <span
                      className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                        currentVal !== null
                          ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                          : 'bg-slate-900 text-slate-500 border-slate-800'
                      }`}
                    >
                      {currentVal !== null ? `${currentVal}/5` : '未評価'}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-500 truncate">{criterion.description}</div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {([1, 2, 3, 4, 5] as SubjectiveScoreValue[]).map((score) => {
                    const isSelected = currentVal === score;
                    return (
                      <button
                        key={score}
                        type="button"
                        onClick={() => handleToggleScore(criterion.key, score)}
                        aria-pressed={isSelected}
                        className={`w-7 h-7 rounded-lg text-xs font-mono font-bold border transition cursor-pointer ${
                          isSelected
                            ? 'bg-cyan-600 text-white border-cyan-400 shadow-sm'
                            : 'bg-slate-900 text-slate-400 border-slate-700 hover:border-slate-500 hover:text-slate-200'
                        }`}
                      >
                        {score}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          <div className="md:col-span-2 rounded-xl bg-slate-950/70 border border-slate-800/80 px-3 py-2 flex flex-col justify-between gap-1.5">
            <label
              htmlFor={`subj-notes-${activeClip.id}`}
              className="text-xs font-semibold text-slate-200"
            >
              聴感メモ（自由記述）
            </label>
            <textarea
              id={`subj-notes-${activeClip.id}`}
              rows={2}
              value={notesDraft}
              onChange={(e) => handleNotesChange(e.target.value)}
              placeholder="例: 語頭のかすれ無し、近接でやや低域が厚め、ファン音はほぼ聴こえない"
              className="w-full rounded-lg bg-slate-900 border border-slate-700/80 px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500 resize-y"
            />
          </div>
        </div>
      </div>

      {/* Collapsible Hardware Verification Diagnostic Log (debug mode only) */}
      {isDebugMode && (
        <div className="pt-4 border-t border-slate-800/80">
          <details className="group rounded-2xl bg-slate-950/80 border border-slate-800">
            <summary className="list-none flex flex-wrap items-center justify-between gap-2 px-4 py-3 cursor-pointer select-none hover:bg-slate-900/60 rounded-2xl transition">
              <div className="flex items-center gap-2">
                <ChevronDown className="w-4 h-4 text-slate-400 transition-transform group-open:rotate-180" />
                <span className="text-xs sm:text-sm font-bold text-slate-200">
                  実機検証用診断ログ
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400">
                  {diag ? diag.clockSourceUsed : '未記録'}
                </span>
              </div>
              <span className="text-[11px] text-slate-500 group-open:hidden">
                クリックして詳細・CSV/JSON出力を展開
              </span>
            </summary>

            <div className="px-4 pb-4 pt-2 border-t border-slate-800/80 space-y-4">
              {/* Actions: Copy Log + CSV/JSON Export */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] text-slate-400">
                  取得できない診断項目・過去履歴の欠落項目は「未記録」として表示されます。
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopyDiagnosticLog}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition cursor-pointer"
                  >
                    {copiedDiag ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <ClipboardCopy className="w-3.5 h-3.5 text-cyan-400" />
                    )}
                    <span>{copiedDiag ? 'コピー済' : '診断ログをコピー'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleExportCsv}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition cursor-pointer"
                    title="現在保持している全記録をExcel対応UTF-8 BOM付きCSVで出力"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
                    <span>CSV出力</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleExportJson}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition cursor-pointer"
                    title="詳細な診断メタデータを含む構造化JSONを出力"
                  >
                    <FileJson className="w-3.5 h-3.5 text-amber-400" />
                    <span>JSON出力</span>
                  </button>
                </div>
              </div>

              {/* Diagnostic Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                {/* 1. Device Actual Settings */}
                <div className="rounded-xl bg-slate-900/70 border border-slate-800/80 p-3 space-y-1.5">
                  <div className="font-bold text-slate-300 text-[11px]">
                    1. デバイス実設定 (track.getSettings)
                  </div>
                  <div className="grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-[11px]">
                    <span className="text-slate-400">echoCancellation:</span>
                    <span className="text-slate-200">{formatTrackBooleanSetting(track?.echoCancellation)}</span>
                    <span className="text-slate-400">noiseSuppression:</span>
                    <span className="text-slate-200">{formatTrackBooleanSetting(track?.noiseSuppression)}</span>
                    <span className="text-slate-400">autoGainControl:</span>
                    <span className="text-slate-200">{formatTrackBooleanSetting(track?.autoGainControl)}</span>
                    <span className="text-slate-400">track.sampleRate:</span>
                    <span className="text-slate-200">
                      {typeof track?.sampleRate === 'number' ? `${track.sampleRate} Hz` : '未記録'}
                    </span>
                    <span className="text-slate-400">track.channelCount:</span>
                    <span className="text-slate-200">
                      {typeof track?.channelCount === 'number' ? `${track.channelCount} ch` : '未記録'}
                    </span>
                  </div>
                </div>

                {/* 2. Durations & Clock Differences */}
                <div className="rounded-xl bg-slate-900/70 border border-slate-800/80 p-3 space-y-1.5">
                  <div className="font-bold text-slate-300 text-[11px]">
                    2. 録音時間・各クロック時間差
                  </div>
                  <div className="grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-[11px]">
                    <span className="text-slate-400">AudioBuffer長:</span>
                    <span className="text-slate-200">
                      {diag ? `${diag.bufferDurationSec.toFixed(3)} s` : '未記録'}
                    </span>
                    <span className="text-slate-400">performance.now:</span>
                    <span className="text-slate-200">
                      {diag?.wallDurationSec !== undefined ? `${diag.wallDurationSec.toFixed(3)} s` : '未記録'}
                    </span>
                    <span className="text-slate-400">AudioContext:</span>
                    <span className="text-slate-200">
                      {diag?.audioCtxDurationSec !== undefined
                        ? `${diag.audioCtxDurationSec.toFixed(3)} s`
                        : '未記録'}
                    </span>
                    <span className="text-slate-400">Buffer - Wall差:</span>
                    <span className="text-slate-200">
                      {diag?.bufferVsWallDiffMs !== undefined
                        ? `${diag.bufferVsWallDiffMs > 0 ? '+' : ''}${diag.bufferVsWallDiffMs} ms`
                        : '未記録'}
                    </span>
                    <span className="text-slate-400">Buffer - AudioCtx差:</span>
                    <span className="text-slate-200">
                      {diag?.bufferVsAudioCtxDiffMs !== undefined
                        ? `${diag.bufferVsAudioCtxDiffMs > 0 ? '+' : ''}${diag.bufferVsAudioCtxDiffMs} ms`
                        : '未記録'}
                    </span>
                    <span className="text-slate-400">start()→onstart遅延:</span>
                    <span className="text-slate-200">
                      {typeof (diag?.recorderStartToOnstartMs ?? diagTs?.recorderStartToOnstartMs) === 'number'
                        ? `${(diag?.recorderStartToOnstartMs ?? diagTs?.recorderStartToOnstartMs)?.toFixed(1)} ms`
                        : '未記録'}
                    </span>
                  </div>
                </div>

                {/* 3. Phase Boundaries */}
                <div className="rounded-xl bg-slate-900/70 border border-slate-800/80 p-3 space-y-1.5">
                  <div className="font-bold text-slate-300 text-[11px]">
                    3. 解析フェーズ境界 ({diag ? diag.clockSourceUsed : '未記録'})
                  </div>
                  <div className="grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-[11px]">
                    <span className="text-slate-400">preNoiseEnd:</span>
                    <span className="text-slate-200">
                      {diag ? `${diag.preNoiseEndSec.toFixed(3)} s` : '未記録'}
                    </span>
                    <span className="text-slate-400">speechStart 〜 End:</span>
                    <span className="text-slate-200">
                      {diag
                        ? `${diag.speechStartSec.toFixed(3)} 〜 ${diag.speechEndSec.toFixed(3)} s`
                        : '未記録'}
                    </span>
                    <span className="text-slate-400">postNoiseStart 〜 End:</span>
                    <span className="text-slate-200">
                      {diag
                        ? `${diag.postNoiseStartSec.toFixed(3)} 〜 ${diag.postNoiseEndSec.toFixed(3)} s`
                        : '未記録'}
                    </span>
                    <span className="text-slate-400">発声中ポーズ参考ノイズ:</span>
                    <span className="text-slate-200">
                      {typeof activeClip.evaluation.noiseAnalysis?.intraSpeechPauseNoiseDbFS === 'number'
                        ? `${activeClip.evaluation.noiseAnalysis.intraSpeechPauseNoiseDbFS.toFixed(1)} dBFS`
                        : '未記録'}
                    </span>
                  </div>
                </div>

                {/* 4. VAD Detected Speech Segments */}
                <div className="rounded-xl bg-slate-900/70 border border-slate-800/80 p-3 space-y-1.5">
                  <div className="font-bold text-slate-300 text-[11px]">
                    4. VAD検出区間 ({speechSegments.length}区間 / 合計{' '}
                    {activeClip.evaluation.speechStats.durationSec.toFixed(1)}s)
                  </div>
                  {speechSegments.length === 0 ? (
                    <div className="text-[11px] text-slate-500">検出された発声区間なし</div>
                  ) : (
                    <div className="max-h-28 overflow-y-auto space-y-1 font-mono text-[11px] pr-1">
                      {speechSegments.map((seg, idx) => (
                        <div
                          key={`${seg.startTime}-${idx}`}
                          className="flex items-center justify-between text-slate-300 bg-slate-950/60 px-2 py-0.5 rounded"
                        >
                          <span>
                            #{idx + 1}: {seg.startTime.toFixed(2)}s 〜 {seg.endTime.toFixed(2)}s
                          </span>
                          <span className="text-slate-400">
                            平均 {seg.avgDb.toFixed(1)} dBFS
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </details>
        </div>
      )}

      {/* In-app Delete Confirmation Dialog (replaces window.confirm which is blocked in sandboxed iframes) */}
      {pendingDeleteClip && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-clip-dialog-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              handleCancelDelete();
            }
          }}
        >
          <div className="w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-400 flex items-center justify-center shrink-0">
                <Trash2 className="w-4 h-4" />
              </div>
              <div className="space-y-1 min-w-0">
                <h4 id="delete-clip-dialog-title" className="text-sm font-bold text-white">
                  録音の削除確認
                </h4>
                <p className="text-xs text-slate-300 leading-relaxed break-words">
                  「{pendingDeleteClip.name}」を削除してもよろしいですか？
                </p>
                <p className="text-[11px] text-slate-400">
                  この録音データおよび保存済みの聴感評価は一覧から削除され、元に戻せません。
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={handleCancelDelete}
                className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition cursor-pointer"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-md shadow-rose-950/50 transition cursor-pointer"
              >
                削除する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
