import { HeadsetEvaluation, MetricDescriptiveStats, RecordedClip } from '../types/audio';
import { formatDb, normalizeEvaluationCompatibility } from './audioDsp';
import {
  DEVICE_COMPARISON_METRIC_DEFS,
  computeDeviceComparisonGroups,
  formatSubjectiveRatingSummary,
  hasLegacyUnknownSubjectiveRating,
  isValidSubjectiveScore,
} from './verificationExport';
import { audioBufferToBase64DataUrl } from './wavExport';
import { PROVISIONAL_SCORE_NOTICES, computeProvisionalScore } from './provisionalScoring';

/**
 * Trigger client-side download of generated HTML file
 */
export function downloadHtmlFile(filename: string, htmlContent: string) {
  const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Helper: Render interactive waveform display with offline audio player
 */
function renderWaveformSection(clip: RecordedClip): { html: string; script: string } {
  if (!clip.buffer) {
    return {
      html: `
        <div class="card" style="padding: 24px; text-align: center; margin-bottom: 28px; background: #f8fafc;">
          <div style="font-size: 14px; color: #64748b; font-weight: 600;">
            ※ 音声データが存在しないため、波形表示および音声再生プレイヤーは利用できません（音響解析データのみ表示）
          </div>
        </div>
      `,
      script: '',
    };
  }

  const duration = clip.duration;
  const sampleRate = clip.buffer.sampleRate;
  const rawData = clip.buffer.getChannelData(0);
  const totalSamples = rawData.length;
  const base64Audio = audioBufferToBase64DataUrl(clip.buffer);

  // Downsample to 600 peak-preserving slices for clear SVG rendering
  const numBars = 600;
  const step = totalSamples / numBars;
  const segments = clip.evaluation.segments || [];

  let barsSvg = '';
  const height = 120;
  const midY = height / 2;

  for (let i = 0; i < numBars; i++) {
    const startIdx = Math.floor(i * step);
    const endIdx = Math.min(totalSamples, Math.floor((i + 1) * step));
    let min = 0;
    let max = 0;

    for (let j = startIdx; j < endIdx; j++) {
      const val = rawData[j];
      if (val < min) min = val;
      if (val > max) max = val;
    }

    const t = ((startIdx + endIdx) / 2) / sampleRate;
    const seg = segments.find((s) => t >= s.startTime && t <= s.endTime);
    const isSpeech = seg ? seg.isSpeech : false;
    const color = isSpeech ? '#10b981' : '#38bdf8';

    const x = ((i + 0.5) / numBars) * 800;
    const barHeight = Math.max(1.5, (max - min) * 52);

    barsSvg += `<line x1="${x.toFixed(1)}" y1="${(midY - barHeight / 2).toFixed(1)}" x2="${x.toFixed(1)}" y2="${(midY + barHeight / 2).toFixed(1)}" stroke="${color}" stroke-width="1.1" stroke-linecap="round" />`;
  }

  // Time ticks & labels
  let timeMarkersSvg = '';
  const stepSec = duration <= 10 ? 1 : duration <= 30 ? 2 : 5;
  for (let sec = 0; sec <= duration; sec += stepSec) {
    const x = (sec / duration) * 800;
    timeMarkersSvg += `
      <line x1="${x.toFixed(1)}" y1="0" x2="${x.toFixed(1)}" y2="${height}" stroke="rgba(255,255,255,0.08)" stroke-width="1" stroke-dasharray="2 2" />
      <text x="${(x + 3).toFixed(1)}" y="13" fill="#64748b" font-size="9" font-family="monospace">${sec}s</text>
    `;
  }

  const html = `
    <!-- 音声プライバシー注意喚起 -->
    <div class="privacy-notice">
      <b>⚠️ 音声データ埋め込み通知:</b> このHTMLレポートには、解析対象となった録音音声データ（追加の音声加工を行わない16bit PCM WAV、${duration.toFixed(1)}秒）がBase64形式で直接埋め込まれています。ブラウザ単体で完全オフライン再生可能ですが、外部へ配布・共有する際は音声の機密性や個人情報にご配慮ください。
    </div>

    <!-- 音声再生プレイヤー & 波形表示 -->
    <div class="player-container">
      <div style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 12px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 14px; font-weight: 700; color: #f8fafc;">録音音声の再生と区間波形</span>
          <span style="font-size: 11px; background: #1e293b; color: #94a3b8; padding: 2px 8px; border-radius: 6px; font-weight: 600; font-family: monospace;">
            ${(sampleRate / 1000).toFixed(1)} kHz / 16bit PCM / モノラル
          </span>
        </div>
        <div style="display: flex; align-items: center; gap: 14px;">
          <span class="legend-item"><span class="legend-dot" style="background: #10b981;"></span>話者発声区間 (Speech)</span>
          <span class="legend-item"><span class="legend-dot" style="background: #38bdf8;"></span>周辺音・暗騒音 (Ambient)</span>
        </div>
      </div>

      <!-- Waveform SVG Container (Clickable for direct seek) -->
      <div style="position: relative; overflow: hidden; border-radius: 8px;">
        <svg id="report-waveform" class="waveform-svg" viewBox="0 0 800 ${height}" preserveAspectRatio="none" title="波形をクリックするとその位置から再生します">
          <!-- Center line -->
          <line x1="0" y1="${midY}" x2="800" y2="${midY}" stroke="rgba(255,255,255,0.15)" stroke-width="1" />
          <!-- Time ticks -->
          ${timeMarkersSvg}
          <!-- Waveform amplitude bars -->
          ${barsSvg}
          <!-- Real-time Playhead line -->
          <line id="report-playhead" x1="0" y1="0" x2="0" y2="${height}" stroke="#f43f5e" stroke-width="2.5" style="display: none;" />
        </svg>
      </div>

      <audio id="report-audio" src="${base64Audio}" preload="auto"></audio>

      <!-- Interactive Audio Controls -->
      <div class="player-controls">
        <div style="display: flex; align-items: center; gap: 10px;">
          <button id="report-play-btn" class="player-btn" type="button">
            <span id="play-btn-icon">▶</span>
            <span id="play-btn-text">再生</span>
          </button>
          <button id="report-rewind-btn" class="player-btn player-btn-secondary" type="button" title="最初から再生">
            ↺ 最初へ
          </button>
          <div style="font-family: monospace; font-size: 13px; color: #cbd5e1; margin-left: 6px;">
            <span id="report-cur-time" style="font-weight: 700; color: #38bdf8;">0.0s</span> / <span>${duration.toFixed(1)}s</span>
          </div>
        </div>

        <div style="display: flex; align-items: center; gap: 10px; font-size: 12px; color: #94a3b8;">
          <span>音量</span>
          <input id="report-volume" type="range" min="0" max="1" step="0.05" value="1" style="width: 80px; accent-color: #38bdf8; cursor: pointer;" />
          <span style="font-size: 11px; color: #64748b;">※波形クリックで任意位置シーク</span>
        </div>
      </div>
    </div>
  `;

  const script = `
    (function() {
      var audio = document.getElementById('report-audio');
      var playBtn = document.getElementById('report-play-btn');
      var playIcon = document.getElementById('play-btn-icon');
      var playText = document.getElementById('play-btn-text');
      var rewindBtn = document.getElementById('report-rewind-btn');
      var curTime = document.getElementById('report-cur-time');
      var volSlider = document.getElementById('report-volume');
      var waveform = document.getElementById('report-waveform');
      var playhead = document.getElementById('report-playhead');
      var duration = ${duration};

      if (!audio || !playBtn) return;

      playBtn.addEventListener('click', function() {
        if (audio.paused) {
          audio.play().then(function() {
            playIcon.textContent = '⏸';
            playText.textContent = '一時停止';
            if (playhead) playhead.style.display = 'block';
          }).catch(function(e) {
            console.error('Playback error:', e);
          });
        } else {
          audio.pause();
          playIcon.textContent = '▶';
          playText.textContent = '再生';
        }
      });

      if (rewindBtn) {
        rewindBtn.addEventListener('click', function() {
          audio.currentTime = 0;
          if (curTime) curTime.textContent = '0.0s';
          if (playhead) {
            playhead.setAttribute('x1', '0');
            playhead.setAttribute('x2', '0');
          }
        });
      }

      audio.addEventListener('timeupdate', function() {
        if (curTime) {
          curTime.textContent = audio.currentTime.toFixed(1) + 's';
        }
        if (playhead && duration > 0) {
          var x = (audio.currentTime / duration) * 800;
          playhead.style.display = 'block';
          playhead.setAttribute('x1', x.toFixed(1));
          playhead.setAttribute('x2', x.toFixed(1));
        }
      });

      audio.addEventListener('ended', function() {
        playIcon.textContent = '▶';
        playText.textContent = '再生';
        audio.currentTime = 0;
        if (curTime) curTime.textContent = '0.0s';
        if (playhead) {
          playhead.setAttribute('x1', '0');
          playhead.setAttribute('x2', '0');
        }
      });

      if (volSlider) {
        volSlider.addEventListener('input', function(e) {
          audio.volume = parseFloat(e.target.value);
        });
      }

      if (waveform) {
        waveform.addEventListener('click', function(e) {
          var rect = waveform.getBoundingClientRect();
          var ratio = (e.clientX - rect.left) / rect.width;
          ratio = Math.max(0, Math.min(1, ratio));
          var newTime = ratio * duration;
          audio.currentTime = newTime;
          if (curTime) curTime.textContent = newTime.toFixed(1) + 's';
          if (playhead) {
            var x = ratio * 800;
            playhead.style.display = 'block';
            playhead.setAttribute('x1', x.toFixed(1));
            playhead.setAttribute('x2', x.toFixed(1));
          }
        });
      }
    })();
  `;

  return { html, script };
}

function renderExtendedMetricsHtml(evalData: HeadsetEvaluation): string {
  const ext = evalData.extendedMetrics;
  if (!ext) {
    return `
      <h2 style="font-size: 17px; margin-top: 32px; border-left: 4px solid #64748b; padding-left: 10px;">
        4. 音声品質の参考指標（客観特徴量・良否判定なし）
      </h2>
      <div class="card" style="background: #f8fafc; color: #475569; font-size: 13px;">
        <b>未解析:</b> 拡張指標導入前に記録されたデータのため、音声品質の参考指標は算出されていません。
      </div>
    `;
  }

  const fmtVal = (v: number | null | undefined, unit: string, digits = 1, signed = false) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return '測定不能';
    const sign = signed && v > 0 ? '+' : '';
    return `${sign}${v.toFixed(digits)}${unit ? ` ${unit}` : ''}`;
  };

  const snrBand = ext.speechBandSnr;
  const rolloff = ext.highFreqRolloff;
  const bandCmp = ext.bandEnergyComparison;
  const lvlVar = ext.speechLevelVariability;
  const flatness = ext.spectralFlatness;

  return `
    <h2 style="font-size: 17px; margin-top: 32px; border-left: 4px solid #64748b; padding-left: 10px;">
      4. 音声品質の参考指標（客観特徴量・良否判定なし）
    </h2>
    <p style="font-size: 12px; color: #64748b; margin-top: -4px;">
      2048点 Hann窓 FFT（hop ${ext.fftHopSize}, Parseval片側電力正規化, SR ${(ext.sampleRateHz / 1000).toFixed(1)} kHz）に基づく物理特徴量です。スコア化や閾値による良否判定は行っていません。
    </p>
    <table>
      <thead>
        <tr>
          <th style="width: 28%;">指標</th>
          <th style="width: 26%;">測定値</th>
          <th>条件・注記</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><b>音声帯域内S/N比</b><br><span style="font-size: 11px; color: #64748b;">(${snrBand.frequencyRange.effectiveLowHz}–${snrBand.frequencyRange.effectiveHighHz} Hz)</span></td>
          <td style="font-family: monospace;"><b>${snrBand.isMeasurable ? fmtVal(snrBand.snrDb, 'dB') : '測定不能'}</b></td>
          <td style="font-size: 12px; color: #475569;">
            ${
              snrBand.isMeasurable
                ? `全帯域との差: ${fmtVal(snrBand.broadbandDiffDb, 'dB', 1, true)}（発声 ${fmtVal(snrBand.speechBandPowerDbFS, 'dBFS')} / 暗騒音 ${fmtVal(snrBand.noiseBandPowerDbFS, 'dBFS')}）${snrBand.status === 'reference_nyquist' ? ' ※ナイキスト制限参考値' : ''}`
                : snrBand.unmeasurableReason || '測定不能'
            }
          </td>
        </tr>
        <tr>
          <td><b>高域減衰（95%ロールオフ）</b></td>
          <td style="font-family: monospace;">
            20–${rolloff.rolloffFrequencyRange.effectiveHighHz} Hz: <b>${rolloff.isMeasurable ? fmtVal(rolloff.rolloff95Hz, 'Hz') : '測定不能'}</b><br>
            300–${rolloff.rolloff95SpeechBandRange?.effectiveHighHz ?? Math.min(8000, Math.round(ext.nyquistHz))} Hz: <b>${typeof rolloff.rolloff95SpeechBandHz === 'number' && Number.isFinite(rolloff.rolloff95SpeechBandHz) ? fmtVal(rolloff.rolloff95SpeechBandHz, 'Hz') : '測定不能'}</b>
          </td>
          <td style="font-size: 12px; color: #475569;">
            1.5–4.2kHz: ${fmtVal(rolloff.power1500_4200DbFS, 'dBFS')} ｜ 4.2–8kHz: ${rolloff.isHighBandMeasurable ? fmtVal(rolloff.power4200_8000DbFS, 'dBFS') : '測定不能'} ｜ 比: ${rolloff.isHighBandMeasurable ? fmtVal(rolloff.highToMidHighRatioDb, 'dB', 1, true) : '測定不能'}<br>${rolloff.constraintNote}
          </td>
        </tr>
        <tr>
          <td><b>帯域エネルギー比（PSD比）</b></td>
          <td style="font-family: monospace; font-size: 12px;">
            低域/声の芯: <b>${fmtVal(bandCmp.ratios.lowToCoreDb, 'dB', 1, true)}</b><br>
            明瞭域/声の芯: <b>${fmtVal(bandCmp.ratios.clarityToCoreDb, 'dB', 1, true)}</b><br>
            高域/明瞭域: <b>${bandCmp.bands.high_4200_8000.isMeasurable ? fmtVal(bandCmp.ratios.highToClarityDb, 'dB', 1, true) : '測定不能'}</b>
          </td>
          <td style="font-size: 12px; color: #475569;">
            帯域幅正規化（W/Hz）PSD比。低域(120–300Hz): ${fmtVal(bandCmp.bands.low_120_300.powerDbFS, 'dBFS')} / 声の芯(300–1000Hz): ${fmtVal(bandCmp.bands.core_300_1000.powerDbFS, 'dBFS')} / 明瞭域(1500–4200Hz): ${fmtVal(bandCmp.bands.clarity_1500_4200.powerDbFS, 'dBFS')} / 高域(4200–8000Hz): ${bandCmp.bands.high_4200_8000.isMeasurable ? fmtVal(bandCmp.bands.high_4200_8000.powerDbFS, 'dBFS') : '測定不能'}
          </td>
        </tr>
        <tr>
          <td><b>発声内音量変動 (IQR)</b></td>
          <td style="font-family: monospace;"><b>${lvlVar.isMeasurable ? fmtVal(lvlVar.iqrDb, 'dB') : '測定不能'}</b></td>
          <td style="font-size: 12px; color: #475569;">
            ${lvlVar.isMeasurable ? `中央値 ${fmtVal(lvlVar.medianDbFS, 'dBFS')} / p25–p75: ${lvlVar.p25DbFS?.toFixed(1)}〜${lvlVar.p75DbFS?.toFixed(1)} dBFS / 範囲 ${fmtVal(lvlVar.rangeDb, 'dB')}。` : ''}${lvlVar.interpretationNote}
          </td>
        </tr>
        <tr>
          <td><b>スペクトル平坦度</b><br><span style="font-size: 11px; color: #64748b;">(${flatness.frequencyRange.effectiveLowHz}–${flatness.frequencyRange.effectiveHighHz} Hz)</span></td>
          <td style="font-family: monospace;"><b>${flatness.isMeasurable ? fmtVal(flatness.median, '', 3) : '測定不能'}</b> <span style="font-size: 11px;">(中央値)</span></td>
          <td style="font-size: 12px; color: #475569;">
            ${flatness.isMeasurable ? `平均 ${fmtVal(flatness.mean, '', 3)} / p25–p75: ${flatness.p25?.toFixed(3)}〜${flatness.p75?.toFixed(3)}（${flatness.validSpeechFrameCount}フレーム）。` : ''}${flatness.interpretationNote}
          </td>
        </tr>
      </tbody>
    </table>
  `;
}

/**
 * Generate a standalone, styled HTML report for a single recorded clip
 */
export function generateSingleClipHtml(clip: RecordedClip): string {
  const dateStr = new Date(clip.recordedAt).toLocaleString('ja-JP');
  const evalData = normalizeEvaluationCompatibility(clip.evaluation);
  const provisional = computeProvisionalScore(evalData);
  const title = clip.name || 'ii-mic-check（マイク音質チェッカー）レポート';
  const waveformSection = renderWaveformSection(clip);

  const hasSpeech = evalData.speechStats.durationSec > 0;
  const snrText = evalData.estimatedSnr?.isMeasurable
    ? `${evalData.estimatedSnr.snrDb} dB`
    : '測定不能（純音声分離不可）';

  const bandRatioText = !hasSpeech
    ? '測定不能'
    : evalData.bandRatio
    ? `${evalData.bandRatio.ratioDb > 0 ? '+' : ''}${evalData.bandRatio.ratioDb} dB`
    : '-';

  const clipStatusText = evalData.clippingDetails?.statusText ||
    (evalData.clippingDetected ? 'クリッピング歪み兆候あり' : 'デジタルクリッピングの兆候なし');

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>${title} - ${dateStr}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      margin: 0;
      padding: 32px 16px;
      background-color: #f8fafc;
      color: #0f172a;
      line-height: 1.6;
    }
    .container {
      max-width: 860px;
      margin: 0 auto;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      padding: 36px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
    }
    .header {
      border-bottom: 2px solid #f1f5f9;
      padding-bottom: 20px;
      margin-bottom: 28px;
    }
    .badge {
      display: inline-block;
      padding: 4px 10px;
      font-size: 12px;
      font-weight: 700;
      border-radius: 9999px;
    }
    .grade-box {
      display: flex;
      align-items: center;
      gap: 24px;
      padding: 24px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      margin-bottom: 28px;
    }
    .grade-circle {
      width: 80px;
      height: 80px;
      border-radius: 16px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      font-weight: 900;
      border: 2px solid #94a3b8;
      background: #e2e8f0;
      color: #334155;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 16px 0 24px 0;
    }
    th, td {
      border: 1px solid #e2e8f0;
      padding: 10px 14px;
      text-align: left;
      font-size: 14px;
    }
    th {
      background-color: #f1f5f9;
      font-weight: 700;
      color: #334155;
    }
    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .metric-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 16px;
      margin-bottom: 28px;
    }
    .card {
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 20px;
      background: #ffffff;
    }
    .warning-box {
      background: #fffbeb;
      border: 1px solid #fde68a;
      color: #92400e;
      padding: 14px;
      border-radius: 10px;
      margin-bottom: 20px;
      font-size: 13px;
    }
    .alert-box {
      background: #fff1f2;
      border: 1px solid #fecdd3;
      color: #9f1239;
      padding: 14px;
      border-radius: 10px;
      margin-bottom: 20px;
      font-size: 13px;
    }
    .privacy-notice {
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      border-left: 4px solid #64748b;
      padding: 12px 14px;
      border-radius: 8px;
      margin-bottom: 24px;
      font-size: 12px;
      color: #475569;
      line-height: 1.5;
    }
    .player-container {
      background: #0f172a;
      border: 1px solid #1e293b;
      border-radius: 14px;
      padding: 18px 20px;
      margin-bottom: 28px;
      color: #f8fafc;
      box-shadow: 0 4px 12px rgba(15, 23, 42, 0.08);
    }
    .waveform-svg {
      width: 100%;
      height: 120px;
      cursor: pointer;
      display: block;
      border-radius: 8px;
      background: #020617;
      transition: opacity 0.15s ease;
    }
    .waveform-svg:hover {
      opacity: 0.95;
    }
    .player-controls {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-top: 14px;
      padding-top: 12px;
      border-top: 1px solid #1e293b;
    }
    .player-btn {
      background: #0284c7;
      color: #ffffff;
      border: none;
      border-radius: 8px;
      padding: 7px 16px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: background 0.15s ease;
    }
    .player-btn:hover {
      background: #0369a1;
    }
    .player-btn-secondary {
      background: #334155;
    }
    .player-btn-secondary:hover {
      background: #475569;
    }
    .legend-item {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: #cbd5e1;
    }
    .legend-dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
    }
    @media print {
      body { background: #ffffff; padding: 0; }
      .container { border: none; box-shadow: none; padding: 0; }
      .player-controls, .privacy-notice { display: none !important; }
      .player-container { background: #f8fafc !important; color: #0f172a !important; border: 1px solid #e2e8f0 !important; }
      .waveform-svg { background: #0f172a !important; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div style="font-size: 13px; color: #64748b; font-weight: 600; text-transform: uppercase;">
        ii-mic-check（マイク音質チェッカー）レポート [Algo: ${evalData.algoVersion || 'v2.0'}]
      </div>
      <h1 style="margin: 8px 0; font-size: 24px;">${title}</h1>
      <div style="font-size: 13px; color: #64748b;">
        <span>測定日時: <b>${dateStr}</b></span> ｜ 
        <span>録音時間: <b>${clip.duration.toFixed(1)} 秒</b></span> ｜ 
        <span>マイク機器: <b>${clip.micDeviceLabel}</b></span>${
          clip.recordingMode === 'eval_with_reference'
            ? ' ｜ <span>録音方式: <b>基準音源再生（旧記録）</b></span>'
            : ''
        }
      </div>
    </div>

    ${
      evalData.isMeasurable === false
        ? `<div class="alert-box">
             <b>⚠️ 測定要件未達:</b> ${evalData.unmeasurableReason || '有効発声時間が不足しています。3秒以上の発声を行って再測定してください。'}
           </div>`
        : ''
    }

    ${
      evalData.noiseAnalysis?.hasNoiseLevelShiftWarning
        ? `<div class="warning-box">
             <b>⚠️ 周辺環境の騒音レベル変動警告:</b> 測定前半（${evalData.noiseAnalysis.preNoiseDbFS} dBFS）と後半（${evalData.noiseAnalysis.postNoiseDbFS} dBFS）で ${evalData.noiseAnalysis.noiseDifferenceDb} dB の騒音変動が観測されました。S/N比の比較精度が低下している可能性があります。
           </div>`
        : ''
    }

    <!-- 総合評価 -->
    <div class="grade-box">
      <div class="grade-circle" style="${provisional.totalScore === null ? 'font-size: 15px;' : 'background: #e0f2fe; border-color: #0284c7; color: #0369a1;'}">
        ${provisional.provisionalGradeLabel}
        <span style="font-size: 10px; font-weight: 700; color: #64748b; margin-top: 2px;">暫定区分</span>
      </div>
      <div>
        <div style="font-size: 11px; font-weight: 700; color: #0284c7; margin-bottom: 2px;">
          暫定評価（客観指標ベース / ${provisional.scoringVersion}）
        </div>
        <div style="font-size: 20px; font-weight: 800; color: #0f172a;">
          総合音声品質スコア：${provisional.totalScore !== null ? `${provisional.totalScore} / 100` : '算出不能'}
          <span class="badge" style="background: #e0f2fe; color: #0369a1; margin-left: 8px; vertical-align: middle;">暫定評価</span>
        </div>
        <div style="font-size: 13px; color: #475569; margin: 4px 0 6px 0;">${provisional.summary}</div>
        <div style="font-size: 12px; color: #64748b;">
          ${evalData.gradeTitle}: ${evalData.assessmentSummary}
        </div>
      </div>
    </div>

    <!-- 暫定スコア内訳テーブル -->
    <div class="card" style="margin-bottom: 24px;">
      <div style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 10px;">
        <div style="font-size: 15px; font-weight: 800; color: #0f172a;">
          暫定スコア内訳（100点満点・暫定評価）
        </div>
        <div style="font-size: 11px; font-family: monospace; color: #64748b;">
          採点バージョン: ${provisional.scoringVersion}
        </div>
      </div>
      ${
        provisional.rescalingNote
          ? `<div class="warning-box" style="margin-bottom: 12px;"><b>比例換算注記:</b> ${provisional.rescalingNote}</div>`
          : ''
      }
      <table style="margin: 8px 0 12px 0;">
        <thead>
          <tr>
            <th style="width: 18%;">採点項目</th>
            <th class="text-center" style="width: 14%;">得点 / 配点</th>
            <th class="text-center" style="width: 14%;">状態</th>
            <th>算出根拠・使用指標・注意事項</th>
          </tr>
        </thead>
        <tbody>
          ${[
            provisional.items.inputVolume,
            provisional.items.noisePerformance,
            provisional.items.frequencyCharacteristics,
            provisional.items.speechStability,
          ]
            .map((item) => {
              const statusText =
                item.status === 'scored'
                  ? '客観採点'
                  : item.status === 'provisional'
                  ? '暫定基準'
                  : '採点不能';
              const usedTxt =
                item.usedMetrics.length > 0 ? item.usedMetrics.join(', ') : 'なし';
              const notesTxt =
                item.notes.length > 0
                  ? `<div style="font-size: 11px; color: #64748b; margin-top: 4px;">${item.notes.join(' / ')}</div>`
                  : '';
              return `
          <tr>
            <td><b>${item.label}</b></td>
            <td class="text-center" style="font-family: monospace;"><b>${item.score !== null ? `${item.score} / ${item.maxScore}` : `算出不能 / ${item.maxScore}`}</b></td>
            <td class="text-center" style="font-size: 12px;">${statusText}</td>
            <td style="font-size: 12px; color: #334155;">
              <div>${item.rationale}</div>
              <div style="font-size: 11px; color: #64748b; font-family: monospace; margin-top: 2px;">使用指標: ${usedTxt}</div>
              ${notesTxt}
            </td>
          </tr>`;
            })
            .join('')}
        </tbody>
      </table>
      ${
        provisional.unavailableItems.length > 0
          ? `<div style="font-size: 12px; color: #be123c; margin-bottom: 8px;"><b>採点不能項目:</b> ${provisional.unavailableItems.join(' ／ ')}</div>`
          : ''
      }
      <div style="font-size: 11px; color: #64748b;">
        <b>参考表示のみの項目（配点外）:</b> ${provisional.referenceOnlyIndicators.join(' ／ ')}
      </div>
    </div>

    <!-- 必須注意書き -->
    <div class="warning-box" style="margin-bottom: 14px;">
      <b>📌 ${PROVISIONAL_SCORE_NOTICES.provisionalScoreTitle}:</b> ${PROVISIONAL_SCORE_NOTICES.provisionalScoreNotice}
    </div>
    <div class="privacy-notice" style="border-left-color: #0284c7; margin-bottom: 24px;">
      <b>🎙️ ${PROVISIONAL_SCORE_NOTICES.webMeetingDspTitle}:</b> ${PROVISIONAL_SCORE_NOTICES.webMeetingDspNotice} ${PROVISIONAL_SCORE_NOTICES.browserDspSettingNote}
    </div>

    ${waveformSection.html}

    <!-- 発声と周辺音の音量比較テーブル -->
    <h2 style="font-size: 17px; margin-top: 32px; border-left: 4px solid #0284c7; padding-left: 10px;">
      1. 発声 と 周辺音 の実効音量比較 (dBFS)
    </h2>
    <table>
      <thead>
        <tr>
          <th>区分</th>
          <th class="text-center">最大音量<br><span style="font-size: 11px; font-weight: normal; color: #64748b;">(30ms窓最大RMS)</span></th>
          <th class="text-center">最小音量<br><span style="font-size: 11px; font-weight: normal; color: #64748b;">(30ms窓最小RMS)</span></th>
          <th class="text-center">平均音量 (区間RMS)</th>
          <th class="text-center">推奨基準</th>
          <th class="text-center">適正範囲内割合</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><b>話者の発声 (Speech)</b></td>
          <td class="text-center">${hasSpeech ? formatDb(evalData.speechStats.maxDb) : '未検出'}</td>
          <td class="text-center">${hasSpeech ? formatDb(evalData.speechStats.minDb) : '未検出'}</td>
          <td class="text-center"><b>${hasSpeech ? formatDb(evalData.speechStats.avgDb) : '未検出'}</b></td>
          <td class="text-center">-24 〜 -14 dBFS</td>
          <td class="text-center" style="font-weight: 700; color: #059669;">${evalData.speechStats.appropriateRatioPercent}%</td>
        </tr>
        <tr>
          <td><b>周辺音・暗騒音 (Ambient)</b></td>
          <td class="text-center">${formatDb(evalData.noiseStats.maxDb)}</td>
          <td class="text-center">${formatDb(evalData.noiseStats.minDb)}</td>
          <td class="text-center"><b>${formatDb(evalData.noiseAnalysis?.representativeNoiseDbFS ?? evalData.noiseStats.avgDb)}</b></td>
          <td class="text-center">-45 dBFS 以下</td>
          <td class="text-center" style="font-weight: 700; color: #0284c7;">${evalData.noiseStats.appropriateRatioPercent}%</td>
        </tr>
      </tbody>
    </table>

    <!-- 客観測定指標 -->
    <h2 style="font-size: 17px; margin-top: 32px; border-left: 4px solid #0284c7; padding-left: 10px;">
      2. 推定S/N比・帯域パワー比・クリッピング
    </h2>
    <div class="metric-grid">
      <div class="card">
        <div style="font-size: 13px; color: #64748b; font-weight: 600;">推定S/N比（純音声分離）</div>
        <div style="font-size: 22px; font-weight: 800; color: #0284c7; margin: 6px 0;">
          ${snrText}
        </div>
        <div style="font-size: 12px; color: #475569;">
          発話前後の無音区間の定常ノイズ電力が発話中も同等と仮定して減算推定した参考値
        </div>
      </div>

      <div class="card">
        <div style="font-size: 13px; color: #64748b; font-weight: 600;">低域/中高域パワー比 (120-500Hz / 1.5-4.2kHz)</div>
        <div style="font-size: 22px; font-weight: 800; color: #0f172a; margin: 6px 0;">
          ${bandRatioText}
        </div>
        <div style="font-size: 12px; color: #475569;">
          ${evalData.bandRatio?.relativeObservationText || '帯域バランス測定値'}
        </div>
      </div>
    </div>

    <!-- デジタルクリッピング -->
    <div class="card" style="margin-bottom: 24px;">
      <div style="font-size: 13px; color: #64748b; font-weight: 600;">デジタルクリッピング診断</div>
      <div style="font-size: 15px; font-weight: 700; color: #0f172a; margin: 4px 0;">
        ${clipStatusText}
      </div>
      <div style="font-size: 12px; color: #475569;">
        サンプルピーク値: ${evalData.clippingDetails ? formatDb(evalData.clippingDetails.peakDbFS) : '未記録'} ｜ 
        上限飽和サンプル数: ${evalData.clippingDetails?.clippedSampleCount ?? 0}
      </div>
    </div>

    <!-- 周波数帯域バランス -->
    <h2 style="font-size: 17px; margin-top: 32px; border-left: 4px solid #0284c7; padding-left: 10px;">
      3. 周波数帯域バランス（2048点FFT・Hann窓）
    </h2>
    <table>
      <thead>
        <tr>
          <th>暗騒音 (&lt;120Hz)</th>
          <th>胴鳴り (120-300Hz)</th>
          <th>声の芯 (300-1.5kHz)</th>
          <th>明瞭度 (1.5-4.2kHz)</th>
          <th>抜け感 (4.2k-10kHz)</th>
        </tr>
      </thead>
      <tbody>
        <tr class="text-center font-bold">
          <td>${evalData.frequencyBalance.subBassRumble}%</td>
          <td>${evalData.frequencyBalance.vocalLowBoom}%</td>
          <td>${evalData.frequencyBalance.vocalCore}%</td>
          <td>${evalData.frequencyBalance.vocalClarity}%</td>
          <td>${evalData.frequencyBalance.airAndHiss}%</td>
        </tr>
      </tbody>
    </table>

    ${renderExtendedMetricsHtml(evalData)}

    ${(() => {
      const r = clip.subjectiveRating;
      const fmtSubj = (v: unknown) => (isValidSubjectiveScore(v) ? `${v} / 5` : '未評価');
      const hasLegacy = hasLegacyUnknownSubjectiveRating(r);
      const escapeHtmlText = (s: string) =>
        s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `
      <h2 style="font-size: 17px; margin-top: 32px; border-left: 4px solid #f59e0b; padding-left: 10px;">
        5. 5段階聴感評価（主観メモ・客観値とは独立）
      </h2>
      ${
        hasLegacy
          ? `<div class="warning-box">
               <b>旧形式データの保持:</b> 旧形式の評価項目を種別不明のまま保持しています（原音/正規化後への自動移行なし）。
               ${isValidSubjectiveScore(r?.intelligibility) ? `旧・聞き取りやすさ(種別不明): <b>${r!.intelligibility}/5</b> ` : ''}
               ${isValidSubjectiveScore(r?.naturalness) ? `｜ 旧・声の自然さ: <b>${r!.naturalness}/5</b> ` : ''}
               ${isValidSubjectiveScore(r?.noDropoutOrSuppression) ? `｜ 旧・音切れ少: <b>${r!.noDropoutOrSuppression}/5</b>` : ''}
             </div>`
          : ''
      }
      <table>
        <thead>
          <tr>
            <th>聞き取りやすさ（原音）</th>
            <th>聞き取りやすさ（正規化後）</th>
            <th>こもりの少なさ</th>
            <th>ノイズの少なさ</th>
          </tr>
        </thead>
        <tbody>
          <tr class="text-center font-bold">
            <td>${fmtSubj(r?.intelligibilityOriginal)}</td>
            <td>${fmtSubj(r?.intelligibilityNormalized)}</td>
            <td>${fmtSubj(r?.lowMuffleness)}</td>
            <td>${fmtSubj(r?.lowBackgroundNoise)}</td>
          </tr>
        </tbody>
      </table>
      <div class="card" style="font-size: 13px; color: #334155;">
        <b>自由記述コメント:</b> ${
          r?.notes && r.notes.trim().length > 0 ? escapeHtmlText(r.notes) : '未評価（メモなし）'
        }
      </div>`;
    })()}

    <div style="margin-top: 36px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; text-align: center;">
      ※本レポートの各数値は同一条件での比較を目的とした客観測定値であり、絶対的な良否を保証するものではありません。
    </div>
  </div>
  ${waveformSection.script ? `<script>${waveformSection.script}</script>` : ''}
</body>
</html>`;
}

/**
 * Generate a standalone comparison HTML report for multiple recorded clips
 */
export function generateComparisonHtml(clips: RecordedClip[]): string {
  const generatedAt = new Date().toLocaleString('ja-JP');
  const versions = Array.from(new Set(clips.map((c) => c.evaluation.algoVersion || 'v1.0')));
  const hasMixedVersions = versions.length > 1;

  const modes = Array.from(new Set(clips.map((c) => c.recordingMode || 'eval_with_voice')));
  const hasMixedModes = modes.length > 1;
  const hasLegacyReferenceMode = clips.some((c) => c.recordingMode === 'eval_with_reference');

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>ヘッドセット性能 比較診断レポート - ${generatedAt}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      margin: 0;
      padding: 32px 16px;
      background-color: #f8fafc;
      color: #0f172a;
      line-height: 1.6;
    }
    .container {
      max-width: 1100px;
      margin: 0 auto;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      padding: 36px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
    }
    .header {
      border-bottom: 2px solid #f1f5f9;
      padding-bottom: 20px;
      margin-bottom: 28px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
      font-size: 13px;
    }
    th, td {
      border: 1px solid #e2e8f0;
      padding: 10px 12px;
      text-align: center;
    }
    th {
      background-color: #f1f5f9;
      font-weight: 700;
      color: #334155;
    }
    .row-header {
      text-align: left;
      font-weight: 700;
      background-color: #f8fafc;
      white-space: nowrap;
      color: #1e293b;
    }
    .warning-box {
      background: #fffbeb;
      border: 1px solid #fde68a;
      color: #92400e;
      padding: 12px 16px;
      border-radius: 8px;
      margin: 16px 0;
      font-size: 13px;
    }
    @media print {
      body { background: #ffffff; padding: 0; }
      .container { border: none; box-shadow: none; padding: 0; width: 100%; max-width: none; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div style="font-size: 13px; color: #64748b; font-weight: 600; text-transform: uppercase;">
        ii-mic-check（マイク音質チェッカー） 総合比較
      </div>
      <h1 style="margin: 8px 0; font-size: 24px;">マイク・ヘッドセット 比較診断レポート</h1>
      <div style="font-size: 13px; color: #64748b;">
        <span>出力日時: <b>${generatedAt}</b></span> ｜ 
        <span>比較対象件数: <b>${clips.length} 件</b></span>
      </div>
    </div>

    ${
      hasMixedVersions
        ? `<div class="warning-box">
             <b>⚠️ 警告:</b> 異なる評価アルゴリズム（${versions.join(' / ')}）の記録が混在しています。正確な比較を行うには最新バージョンでの再測定をおすすめします。
           </div>`
        : ''
    }

    ${
      hasMixedModes || hasLegacyReferenceMode
        ? `<div class="warning-box" style="background: #eef2ff; border-color: #c7d2fe; color: #3730a3;">
             <b>⚠️ 警告:</b> 過去の基準音源再生モードの記録が含まれています（現在は肉声発声モードに一本化）。発声・収録条件が異なるため比較時はご注意ください。
           </div>`
        : ''
    }

    <p style="font-size: 14px; color: #475569;">
      各ヘッドセット・マイクの録音データから、推定S/N比、実効音量、低域/中高域パワー比、クリッピング兆候を同一条件で横並び比較したレポートです。
    </p>

    <!-- 比較テーブル -->
    <div style="overflow-x: auto;">
      <table>
        <thead>
          <tr>
            <th class="row-header" style="min-width: 170px;">比較項目</th>
            ${clips
              .map(
                (c, idx) => `
              <th style="min-width: 140px;">
                <div><b>${c.name || `記録 #${idx + 1}`}</b></div>
                <div style="font-size: 11px; color: #64748b; font-weight: normal; margin-top: 2px;">
                  ${new Date(c.recordedAt).toLocaleTimeString('ja-JP')}
                </div>
                <div style="font-size: 11px; color: #0284c7; font-weight: normal; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                  ${c.micDeviceLabel}
                </div>
              </th>`
              )
              .join('')}
          </tr>
        </thead>
        <tbody>
          ${
            hasLegacyReferenceMode
              ? `<!-- 録音方式（履歴互換） -->
          <tr>
            <td class="row-header">録音方式（履歴互換）</td>
            ${clips
              .map(
                (c) => `
              <td>
                <b>${c.recordingMode === 'eval_with_reference' ? '基準音源再生（旧記録）' : '肉声発声'}</b>
              </td>`
              )
              .join('')}
          </tr>`
              : ''
          }

          <!-- 測定ステータス -->
          <tr>
            <td class="row-header">測定ステータス</td>
            ${clips
              .map((c) => {
                const ev = normalizeEvaluationCompatibility(c.evaluation);
                return `
              <td>
                ${ev.isMeasurable === false ? '<span style="color: #e11d48; font-weight: 700;">要件未達</span>' : (ev.overallGradeText || '保留')}
              </td>`;
              })
              .join('')}
          </tr>

          <!-- 暫定総合スコア -->
          <tr>
            <td class="row-header">暫定総合スコア<br><span style="font-size: 10px; color: #64748b; font-weight: normal;">(100点満点・暫定評価)</span></td>
            ${clips
              .map((c) => {
                const prov = computeProvisionalScore(normalizeEvaluationCompatibility(c.evaluation));
                return `
              <td class="font-mono">
                <b style="font-size: 15px; color: ${prov.totalScore !== null ? '#0369a1' : '#e11d48'};">
                  ${prov.totalScore !== null ? `${prov.totalScore} / 100` : '算出不能'}
                </b>
                <div style="font-size: 11px; color: #475569;">${prov.provisionalGradeLabel}${prov.isRescaled ? ' (比例換算)' : ''}</div>
              </td>`;
              })
              .join('')}
          </tr>

          <!-- 暫定項目別スコア内訳 -->
          <tr>
            <td class="row-header">暫定スコア内訳<br><span style="font-size: 10px; color: #64748b; font-weight: normal;">音量20 / 雑音35 / 周波25 / 安定20</span></td>
            ${clips
              .map((c) => {
                const prov = computeProvisionalScore(normalizeEvaluationCompatibility(c.evaluation));
                const f = (v: number | null, m: number) => (v !== null ? `${v}/${m}` : `不能/${m}`);
                const cautions: string[] = [];
                if (prov.items.noisePerformance.metricValues?.noiseGateSuspected === true) {
                  cautions.push('ゲート疑い注意');
                }
                if (
                  prov.items.frequencyCharacteristics.metricValues
                    ?.highBandNoiseContaminationWarning === true
                ) {
                  cautions.push('高域信頼性注意');
                }
                if (prov.items.speechStability.metricValues?.extremeVariationWarning === true) {
                  cautions.push('音量変動大注意');
                }
                return `
              <td class="font-mono" style="font-size: 12px;">
                音:${f(prov.items.inputVolume.score, 20)} / 雑:${f(prov.items.noisePerformance.score, 35)}<br>
                周:${f(prov.items.frequencyCharacteristics.score, 25)} / 安:${f(prov.items.speechStability.score, 20)}
                <div style="font-size: 10px; color: #64748b; margin-top: 2px;">${prov.scoringVersion}</div>
                ${
                  cautions.length > 0
                    ? `<div style="font-size: 10px; color: #b45309; font-weight: 600; margin-top: 2px;">${cautions.join(' / ')}</div>`
                    : ''
                }
              </td>`;
              })
              .join('')}
          </tr>

          <!-- 推定S/N比 -->
          <tr>
            <td class="row-header">推定S/N比（純音声分離）</td>
            ${clips
              .map(
                (c) => `
              <td class="font-mono">
                <b>${c.evaluation.estimatedSnr?.isMeasurable ? `${c.evaluation.estimatedSnr.snrDb} dB` : '<span style="color: #e11d48;">測定不能</span>'}</b>
              </td>`
              )
              .join('')}
          </tr>

          <!-- 発声 平均音量 -->
          <tr>
            <td class="row-header">発声: 平均実効音量 (RMS)</td>
            ${clips
              .map(
                (c) => `
              <td class="font-mono">
                ${c.evaluation.speechStats.durationSec > 0 ? formatDb(c.evaluation.speechStats.avgDb) : '<span style="color: #94a3b8;">未検出</span>'}
              </td>`
              )
              .join('')}
          </tr>

          <!-- 発声の適正値内割合 -->
          <tr>
            <td class="row-header">発声: 適正値内割合<br><span style="font-size: 10px; color: #64748b; font-weight: normal;">(-24〜-14dBFS)</span></td>
            ${clips
              .map(
                (c) => `
              <td class="font-mono">
                <b style="color: ${c.evaluation.speechStats.appropriateRatioPercent >= 70 ? '#059669' : '#d97706'};">
                  ${c.evaluation.speechStats.appropriateRatioPercent}%
                </b>
              </td>`
              )
              .join('')}
          </tr>

          <!-- 周辺音 定常ノイズ -->
          <tr>
            <td class="row-header">周辺音: 定常暗騒音</td>
            ${clips
              .map(
                (c) => `
              <td class="font-mono">
                ${formatDb(c.evaluation.noiseAnalysis?.representativeNoiseDbFS ?? c.evaluation.noiseStats.avgDb)}
              </td>`
              )
              .join('')}
          </tr>

          <!-- 低域/中高域比 -->
          <tr>
            <td class="row-header">低域/中高域パワー比<br><span style="font-size: 10px; color: #64748b; font-weight: normal;">(120-500Hz / 1.5-4.2kHz)</span></td>
            ${clips
              .map(
                (c) => `
              <td class="font-mono">
                <b>${c.evaluation.speechStats.durationSec > 0 && c.evaluation.bandRatio ? `${c.evaluation.bandRatio.ratioDb > 0 ? '+' : ''}${c.evaluation.bandRatio.ratioDb} dB` : '-'}</b>
              </td>`
              )
              .join('')}
          </tr>

          <!-- 音声帯域内S/N比 -->
          <tr>
            <td class="row-header">音声帯域内S/N比 (300–4200Hz)</td>
            ${clips
              .map((c) => {
                const sb = c.evaluation.extendedMetrics?.speechBandSnr;
                return `<td class="font-mono">${!sb ? '未解析' : sb.isMeasurable && sb.snrDb !== null ? `<b>${sb.snrDb.toFixed(1)} dB</b>` : '測定不能'}</td>`;
              })
              .join('')}
          </tr>

          <!-- 95%ロールオフ -->
          <tr>
            <td class="row-header">95%ロールオフ周波数<br><span style="font-size: 10px; color: #64748b; font-weight: normal;">(20–8kHz / 300–8kHz)</span></td>
            ${clips
              .map((c) => {
                const ro = c.evaluation.extendedMetrics?.highFreqRolloff;
                if (!ro) return '<td>未解析</td>';
                const rAll = ro.isMeasurable && ro.rolloff95Hz !== null ? `${ro.rolloff95Hz.toFixed(1)} Hz` : '測定不能';
                const rVoice = typeof ro.rolloff95SpeechBandHz === 'number' && Number.isFinite(ro.rolloff95SpeechBandHz) ? `${ro.rolloff95SpeechBandHz.toFixed(1)} Hz` : '測定不能';
                return `<td class="font-mono" style="font-size: 12px;">${rAll}<br><span style="color:#0284c7;">${rVoice}</span></td>`;
              })
              .join('')}
          </tr>

          <!-- 帯域PSD比 & IQR & 平坦度 -->
          <tr>
            <td class="row-header">帯域PSD比 (dB)<br><span style="font-size: 10px; color: #64748b; font-weight: normal;">低/芯・明瞭/芯・高/明瞭</span></td>
            ${clips
              .map((c) => {
                const bc = c.evaluation.extendedMetrics?.bandEnergyComparison;
                if (!bc) return '<td>未解析</td>';
                const f = (ok: boolean, v: number | null) =>
                  ok && typeof v === 'number' && Number.isFinite(v) ? `${v > 0 ? '+' : ''}${v.toFixed(1)}` : '不能';
                return `<td class="font-mono" style="font-size: 12px;">${f(bc.bands.low_120_300.isMeasurable && bc.bands.core_300_1000.isMeasurable, bc.ratios.lowToCoreDb)} / ${f(bc.bands.clarity_1500_4200.isMeasurable && bc.bands.core_300_1000.isMeasurable, bc.ratios.clarityToCoreDb)} / ${f(bc.bands.high_4200_8000.isMeasurable && bc.bands.clarity_1500_4200.isMeasurable, bc.ratios.highToClarityDb)}</td>`;
              })
              .join('')}
          </tr>

          <tr>
            <td class="row-header">音量IQR / スペクトル平坦度</td>
            ${clips
              .map((c) => {
                const ext = c.evaluation.extendedMetrics;
                if (!ext) return '<td>未解析</td>';
                const iqr = ext.speechLevelVariability.isMeasurable && ext.speechLevelVariability.iqrDb !== null ? `${ext.speechLevelVariability.iqrDb.toFixed(1)} dB` : '測定不能';
                const sfm = ext.spectralFlatness.isMeasurable && ext.spectralFlatness.median !== null ? ext.spectralFlatness.median.toFixed(3) : '測定不能';
                return `<td class="font-mono" style="font-size: 12px;">${iqr} / ${sfm}</td>`;
              })
              .join('')}
          </tr>

          <!-- クリッピング -->
          <tr>
            <td class="row-header">クリッピング兆候</td>
            ${clips
              .map(
                (c) => `
              <td style="font-size: 12px; color: ${c.evaluation.clippingDetails?.hasClippingSign ? '#e11d48' : '#059669'}; font-weight: 700;">
                ${c.evaluation.clippingDetails?.hasClippingSign ? '兆候あり ⚠' : '兆候なし ✔'}
              </td>`
              )
              .join('')}
          </tr>

          <!-- 5段階聴感評価 -->
          <tr>
            <td class="row-header">5段階聴感評価<br><span style="font-size: 10px; color: #64748b; font-weight: normal;">原音 / 正規化 / こもり / ノイズ</span></td>
            ${clips
              .map((c) => {
                const r = c.subjectiveRating;
                const fmtS = (v: unknown) => (isValidSubjectiveScore(v) ? `${v}` : '未評価');
                const legacyTxt = hasLegacyUnknownSubjectiveRating(r) && isValidSubjectiveScore(r?.intelligibility)
                  ? `<div style="font-size:10px; color:#b45309;">旧・聞き取り(種別不明): ${r!.intelligibility}/5</div>`
                  : '';
                return `<td style="font-size: 12px;">
                  <div>原:${fmtS(r?.intelligibilityOriginal)} / 正:${fmtS(r?.intelligibilityNormalized)} / 籠:${fmtS(r?.lowMuffleness)} / 雑:${fmtS(r?.lowBackgroundNoise)}</div>
                  <div style="font-size:10px; color:#64748b;">${formatSubjectiveRatingSummary(r)}</div>
                  ${legacyTxt}
                </td>`;
              })
              .join('')}
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 同一機器別・複数録音統計比較 -->
    ${(() => {
      const groups = computeDeviceComparisonGroups(clips);
      const fmtStatVal = (stat: MetricDescriptiveStats, val: number | null): string => {
        if (val === null || !Number.isFinite(val)) return 'データなし';
        if (stat.unit === 'Hz') return `${val.toFixed(1)} Hz`;
        if (stat.unit === 'ratio') return val.toFixed(3);
        if (stat.unit === 'score_1_to_5') return val.toFixed(1);
        return `${val.toFixed(1)} ${stat.unit}`;
      };
      return `
      <h2 style="font-size: 17px; margin-top: 32px; border-left: 4px solid #0284c7; padding-left: 10px;">
        2. 同一機器別・複数録音統計比較
      </h2>
      <p style="font-size: 12px; color: #475569;">
        deviceIdと機器名により保守的に同一機器を識別して集計しています。dB系指標の平均・最小・最大・標準偏差は値のばらつき把握を目的とした記述統計であり、線形電力平均ではありません。
      </p>
      ${groups
        .map((g) => {
          if (g.clipCount < 2) {
            return `<div style="border:1px solid #e2e8f0; border-radius:8px; padding:12px; margin-bottom:12px; font-size:12px; color:#475569;">
              <b>${g.deviceLabel}</b> (録音数 n=${g.clipCount} / ${g.identificationMethod}): ${g.identificationNote}
            </div>`;
          }
          return `
          <div style="margin-bottom: 20px;">
            <div style="font-size: 13px; font-weight: 700; color: #0f172a; margin-bottom: 6px;">
              ${g.deviceLabel} （録音数 n=${g.clipCount}｜${g.identificationNote}）
            </div>
            <table>
              <thead>
                <tr>
                  <th class="row-header">測定項目</th>
                  <th>有効数 n</th>
                  <th>平均</th>
                  <th>最小</th>
                  <th>最大</th>
                  <th>標準偏差</th>
                </tr>
              </thead>
              <tbody>
                ${DEVICE_COMPARISON_METRIC_DEFS.map((def) => {
                  const st = g.stats[def.statKey];
                  return `<tr>
                    <td class="row-header">${def.label}${st.isDbScale ? ' <span style="font-size:10px;color:#64748b;font-weight:normal;">[dB記述]</span>' : ''}</td>
                    <td class="font-mono">${st.count}/${g.clipCount}</td>
                    <td class="font-mono"><b>${fmtStatVal(st, st.mean)}</b></td>
                    <td class="font-mono">${fmtStatVal(st, st.min)}</td>
                    <td class="font-mono">${fmtStatVal(st, st.max)}</td>
                    <td class="font-mono">${fmtStatVal(st, st.stdDev)}</td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>`;
        })
        .join('')}`;
    })()}

    <div class="warning-box" style="margin-top: 24px;">
      <b>📌 ${PROVISIONAL_SCORE_NOTICES.provisionalScoreTitle}:</b> ${PROVISIONAL_SCORE_NOTICES.provisionalScoreNotice}
    </div>
    <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-left: 4px solid #0284c7; padding: 12px 14px; border-radius: 8px; font-size: 12px; color: #334155;">
      <b>🎙️ ${PROVISIONAL_SCORE_NOTICES.webMeetingDspTitle}:</b> ${PROVISIONAL_SCORE_NOTICES.webMeetingDspNotice} ${PROVISIONAL_SCORE_NOTICES.browserDspSettingNote}
    </div>

    <div style="margin-top: 36px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; text-align: center;">
      ※本レポートの各数値は同一環境・同一話者による相対比較を目的とした客観測定値です。
    </div>
  </div>
</body>
</html>`;
}
