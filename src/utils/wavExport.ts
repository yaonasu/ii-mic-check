/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Headset Clarity Lab - WAV Audio Export Utilities
 * 
 * 仕様:
 * - 追加の音声加工（音量正規化・ノイズ除去・EQ等）を行わない16bit量子化変換 (Linear PCM)
 * - 解析に使用する元のFloat32AudioBufferは一切変更せず参照のみ行う
 * - 音響解析で使用しているチャンネル（channel 0 / モノラル）と同一チャンネルを出力
 * - サンプリング周波数は録音データ（buffer.sampleRate）に自動追従
 */

/**
 * Convert an AudioBuffer to an uncompressed 16-bit PCM WAV Blob.
 * Uses channel 0 (mono), strictly matching the acoustic DSP analysis input.
 */
export function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const sampleRate = buffer.sampleRate;
  const numChannels = 1; // DSP analysis strictly uses channel 0
  const rawData = buffer.getChannelData(0);
  const numSamples = rawData.length;

  const bytesPerSample = 2; // 16-bit PCM
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataByteLength = numSamples * bytesPerSample;
  const headerByteLength = 44;
  const totalLength = headerByteLength + dataByteLength;

  const arrayBuffer = new ArrayBuffer(totalLength);
  const view = new DataView(arrayBuffer);

  // Helper to write ASCII strings into DataView
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  // --- 1. RIFF Chunk Descriptor ---
  writeString(0, 'RIFF');
  // ChunkSize = 36 + SubChunk2Size
  view.setUint32(4, 36 + dataByteLength, true);
  writeString(8, 'WAVE');

  // --- 2. "fmt " Sub-chunk ---
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);             // Subchunk1Size = 16 for PCM
  view.setUint16(20, 1, true);              // AudioFormat = 1 (Linear PCM)
  view.setUint16(22, numChannels, true);    // NumChannels = 1 (Mono)
  view.setUint32(24, sampleRate, true);     // SampleRate
  view.setUint32(28, byteRate, true);       // ByteRate
  view.setUint16(32, blockAlign, true);     // BlockAlign
  view.setUint16(34, 16, true);             // BitsPerSample = 16

  // --- 3. "data" Sub-chunk ---
  writeString(36, 'data');
  view.setUint32(40, dataByteLength, true); // Subchunk2Size

  // --- 4. Write 16-bit PCM Samples (Direct quantization, no DSP alterations) ---
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    // Clamp sample between -1.0 and 1.0
    const s = Math.max(-1, Math.min(1, rawData[i]));
    // Scale to 16-bit signed integer [-32768, 32767]
    const intSample = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
    // Ensure bounds within 16-bit signed integer
    const clampedInt = Math.max(-32768, Math.min(32767, intSample));
    view.setInt16(offset, clampedInt, true); // Little-endian
    offset += 2;
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

/**
 * Convert an AudioBuffer directly to a Base64 Data URL ('data:audio/wav;base64,...').
 * Safe for large audio clips by avoiding stack overflow through chunked string conversion.
 */
export function audioBufferToBase64DataUrl(buffer: AudioBuffer): string {
  const sampleRate = buffer.sampleRate;
  const numChannels = 1; // DSP analysis strictly uses channel 0
  const rawData = buffer.getChannelData(0);
  const numSamples = rawData.length;

  const bytesPerSample = 2; // 16-bit PCM
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataByteLength = numSamples * bytesPerSample;
  const headerByteLength = 44;
  const totalLength = headerByteLength + dataByteLength;

  const arrayBuffer = new ArrayBuffer(totalLength);
  const view = new DataView(arrayBuffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  // RIFF header
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataByteLength, true);
  writeString(8, 'WAVE');

  // fmt chunk
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);

  // data chunk
  writeString(36, 'data');
  view.setUint32(40, dataByteLength, true);

  // 16-bit PCM Quantization
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, rawData[i]));
    const intSample = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
    view.setInt16(offset, Math.max(-32768, Math.min(32767, intSample)), true);
    offset += 2;
  }

  // Convert to Base64 in safe 32KB chunks
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }

  return `data:audio/wav;base64,${btoa(binary)}`;
}

/**
 * Trigger client-side download of a WAV file
 */
export function downloadWavFile(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
