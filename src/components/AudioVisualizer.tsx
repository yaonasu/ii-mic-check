/**
 * Copyright (c) 2026 八百茄子 (yaonasu)
 * SPDX-License-Identifier: MIT
 */

import React, { useEffect, useRef } from 'react';
import { rmsToDb, formatDb } from '../utils/audioDsp';
import { RecordingPhase } from '../types/audio';

interface AudioVisualizerProps {
  analyser: AnalyserNode | null;
  isRecording: boolean;
  recordingSeconds: number;
  maxSeconds?: number;
  recordingPhase?: RecordingPhase;
  phaseCountdownSeconds?: number;
}

export const AudioVisualizer: React.FC<AudioVisualizerProps> = ({
  analyser,
  isRecording,
  recordingSeconds,
  maxSeconds = 60,
  recordingPhase = 'idle',
  phaseCountdownSeconds = 0,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const currentDbRef = useRef<number>(-90);
  const peakDbRef = useRef<number>(-90);
  const isSpeechRef = useRef<boolean>(false);
  const animationFrameRef = useRef<number | null>(null);

  const [displayDb, setDisplayDb] = React.useState<number>(-90);
  const [displayPeak, setDisplayPeak] = React.useState<number>(-90);
  const [isSpeech, setIsSpeech] = React.useState<boolean>(false);

  useEffect(() => {
    if (!analyser || !isRecording) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const fftSize = analyser.fftSize;
    const timeData = new Float32Array(fftSize);
    const freqData = new Uint8Array(analyser.frequencyBinCount);

    let lastUiUpdate = 0;

    const render = (time: number) => {
      analyser.getFloatTimeDomainData(timeData);
      analyser.getByteFrequencyData(freqData);

      // Compute RMS and dBFS
      let sumSq = 0;
      let zeroCrossings = 0;
      for (let i = 0; i < timeData.length; i++) {
        const val = timeData[i];
        sumSq += val * val;
        if (i > 0) {
          const prev = timeData[i - 1];
          if ((val >= 0 && prev < 0) || (val < 0 && prev >= 0)) {
            zeroCrossings++;
          }
        }
      }
      const rms = Math.sqrt(sumSq / timeData.length);
      const db = rmsToDb(rms);
      currentDbRef.current = db;

      // Peak decay
      if (db > peakDbRef.current) {
        peakDbRef.current = db;
      } else {
        peakDbRef.current = Math.max(-90, peakDbRef.current - 0.25);
      }

      // Voice activity heuristic for live badge:
      // Voice fundamental band energy
      const nyquist = analyser.context.sampleRate / 2;
      const binWidth = nyquist / freqData.length;
      let vocalEnergy = 0;
      let totalEnergy = 0;
      for (let i = 0; i < freqData.length; i++) {
        const freq = i * binWidth;
        const p = freqData[i];
        totalEnergy += p;
        if (freq >= 250 && freq <= 3400) {
          vocalEnergy += p;
        }
      }
      const vocalRatio = totalEnergy > 0 ? vocalEnergy / totalEnergy : 0;
      const zcr = zeroCrossings / timeData.length;

      const detectedSpeech = db >= -48 && vocalRatio > 0.45 && zcr > 0.02 && zcr < 0.45;
      isSpeechRef.current = detectedSpeech;

      // Throttle React state updates to ~15fps for UI numbers
      if (time - lastUiUpdate > 66) {
        lastUiUpdate = time;
        setDisplayDb(Math.round(db * 10) / 10);
        setDisplayPeak(Math.round(peakDbRef.current * 10) / 10);
        setIsSpeech(detectedSpeech);
      }

      // Draw Canvas Visualizer
      const width = canvas.width;
      const height = canvas.height;

      // Dark background with subtle grid
      ctx.fillStyle = '#090d16';
      ctx.fillRect(0, 0, width, height);

      // Draw faint frequency grid lines
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
      ctx.lineWidth = 1;
      for (let y = height * 0.25; y < height; y += height * 0.25) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // Draw FFT Frequency Spectrum Bars (gradient cyan -> emerald)
      const barCount = 48;
      const barWidth = width / barCount;
      const step = Math.floor(freqData.length / barCount);

      for (let i = 0; i < barCount; i++) {
        const val = freqData[i * step] / 255;
        const barHeight = val * (height * 0.65);
        const x = i * barWidth;
        const y = height - barHeight;

        const grad = ctx.createLinearGradient(0, height, 0, y);
        if (detectedSpeech) {
          grad.addColorStop(0, '#059669'); // emerald
          grad.addColorStop(1, '#34d399');
        } else {
          grad.addColorStop(0, '#0e7490'); // cyan
          grad.addColorStop(1, '#38bdf8');
        }

        ctx.fillStyle = grad;
        ctx.fillRect(x + 1, y, Math.max(1, barWidth - 2), barHeight);
      }

      // Draw Real-time Oscilloscope Waveform line
      ctx.lineWidth = 2;
      ctx.strokeStyle = detectedSpeech ? '#10b981' : '#06b6d4';
      ctx.beginPath();

      const sliceWidth = width / timeData.length;
      let x = 0;
      for (let i = 0; i < timeData.length; i++) {
        const v = timeData[i];
        const y = (height / 2) + v * (height * 0.4);

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
        x += sliceWidth;
      }
      ctx.stroke();

      animationFrameRef.current = requestAnimationFrame(render);
    };

    animationFrameRef.current = requestAnimationFrame(render);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [analyser, isRecording]);

  // Meter meter calculations
  const meterPercent = Math.max(0, Math.min(100, ((displayDb + 60) / 60) * 100));
  const peakPercent = Math.max(0, Math.min(100, ((displayPeak + 60) / 60) * 100));

  return (
    <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-4 shadow-xl backdrop-blur-md">
      {/* Top Header: Real-time Indicators & Sequence Phase Guidance */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5">
          {isRecording && (
            <>
              <div className="w-3 h-3 rounded-full bg-red-500 animate-ping" />
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                リアルタイム音響モニタリング
              </span>
            </>
          )}
        </div>

        {/* Real-time Voice vs Noise Status Badge */}
        <div className="flex items-center gap-2">
          {isRecording && (
            <div
              className={`px-2.5 py-1 rounded-full text-xs font-bold transition-all flex items-center gap-1.5 ${
                recordingPhase === 'measuring_pre_noise' || recordingPhase === 'measuring_post_noise'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : isSpeech
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shadow-sm shadow-emerald-950'
                  : 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  recordingPhase === 'measuring_pre_noise' || recordingPhase === 'measuring_post_noise'
                    ? 'bg-amber-400 animate-pulse'
                    : isSpeech
                    ? 'bg-emerald-400 animate-pulse'
                    : 'bg-cyan-400'
                }`}
              />
              {recordingPhase === 'measuring_pre_noise'
                ? `周辺音測定中（無発声・残り${phaseCountdownSeconds}s）`
                : recordingPhase === 'measuring_post_noise'
                ? `周辺音測定中（無発声・残り${phaseCountdownSeconds}s）`
                : isSpeech
                ? '話者の発声を検出中 (Speech)'
                : '周辺音・環境ノイズ (Ambient)'}
            </div>
          )}
        </div>
      </div>

      {/* Sequence Banner Guidance */}
      {isRecording && (
        <div className="mb-3">
          {recordingPhase === 'measuring_pre_noise' && (
            <div className="w-full flex items-center justify-between text-amber-300 bg-amber-500/15 border border-amber-500/30 p-2.5 rounded-xl text-xs sm:text-sm font-bold">
              <span className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping shrink-0" />
                <span>周辺音を測定中です。話さないでください</span>
              </span>
              <span className="font-mono text-sm px-2 py-0.5 rounded bg-amber-500/25 text-amber-200 shrink-0">
                残り {phaseCountdownSeconds} 秒
              </span>
            </div>
          )}

          {recordingPhase === 'speaking' && (
            <div className="w-full flex items-center justify-between text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 p-2.5 rounded-xl text-xs sm:text-sm font-bold">
              <span className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                <span>読み上げを開始してください</span>
              </span>
              <span className="text-[11px] text-slate-300 hidden sm:inline">
                読み終えたら「録音を停止する」を押してください
              </span>
            </div>
          )}

          {recordingPhase === 'measuring_post_noise' && (
            <div className="w-full flex items-center justify-between text-amber-300 bg-amber-500/15 border border-amber-500/30 p-2.5 rounded-xl text-xs sm:text-sm font-bold">
              <span className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping shrink-0" />
                <span>周辺音を測定中です。話さないでください</span>
              </span>
              <span className="font-mono text-sm px-2 py-0.5 rounded bg-amber-500/25 text-amber-200 shrink-0">
                残り {phaseCountdownSeconds} 秒
              </span>
            </div>
          )}
        </div>
      )}

      {/* Canvas Viewport */}
      <div className="relative w-full h-36 sm:h-44 rounded-xl overflow-hidden border border-slate-800/80 bg-slate-950">
        <canvas
          ref={canvasRef}
          width={720}
          height={200}
          className="w-full h-full object-cover"
        />

        {/* Target Zone Guide Overlay */}
        <div className="absolute top-2 left-3 pointer-events-none text-[10px] text-slate-500 font-mono">
          <span>Web会議推奨: -24dB 〜 -14dB</span>
        </div>

        {/* Dynamic Peak Tag */}
        {isRecording && (
          <div className="absolute bottom-2 right-3 pointer-events-none text-right font-mono text-[11px] bg-slate-950/80 px-2 py-0.5 rounded border border-slate-800 text-slate-300">
            Peak: <span className="text-emerald-400 font-bold">{formatDb(displayPeak)}</span>
          </div>
        )}
      </div>

      {/* VU Meter & dBFS Scale */}
      <div className="mt-3 space-y-1.5">
        <div className="flex items-center justify-between text-xs font-mono text-slate-400">
          <div className="flex items-center gap-2">
            <span>リアルタイム音量:</span>
            <span
              className={`font-bold ${
                displayDb > -12
                  ? 'text-red-400'
                  : displayDb >= -24
                  ? 'text-emerald-400'
                  : 'text-cyan-400'
              }`}
            >
              {formatDb(displayDb)}
            </span>
          </div>
          <div className="text-[11px] text-slate-500">
            <span>-60dB</span>
            <span className="mx-2">|</span>
            <span className="text-emerald-500/80">-24dB (適正)</span>
            <span className="mx-2">|</span>
            <span className="text-red-500/80">-3dB (警告)</span>
          </div>
        </div>

        {/* Progress bar meter with peak tick */}
        <div className="relative h-2.5 w-full rounded-full bg-slate-950 overflow-hidden p-0.5 border border-slate-800">
          {/* Ideal range indicator stripe */}
          <div
            className="absolute top-0 bottom-0 bg-emerald-500/10 border-x border-emerald-500/30"
            style={{ left: '60%', width: '16.6%' }} // -24dB to -14dB in a 60dB range
          />

          <div
            className={`h-full rounded-full transition-all duration-75 ${
              displayDb > -6
                ? 'bg-gradient-to-r from-emerald-500 via-amber-500 to-red-500'
                : displayDb > -24
                ? 'bg-gradient-to-r from-cyan-500 to-emerald-400'
                : 'bg-cyan-600'
            }`}
            style={{ width: `${meterPercent}%` }}
          />

          {/* Peak line */}
          <div
            className="absolute top-0 bottom-0 w-1 bg-white shadow-xs transition-all duration-100"
            style={{ left: `${peakPercent}%` }}
          />
        </div>
      </div>
    </div>
  );
};
