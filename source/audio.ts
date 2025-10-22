import {spawn, ChildProcessWithoutNullStreams} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import OpenAI from 'openai';

type Callbacks = {
  onTranscript: (text: string) => void;
  onStatus?: (msg: string) => void;
  onError?: (err: string) => void;
};

export type CaptureOptions = {
  sampleRate?: number; // default 16000
  device?: string; // avfoundation device string like ":0"
  maxSegmentSec?: number; // default 15
};

// Very simple VAD based on short-term energy
class EnergyVAD {
  private threshold: number;
  private minSpeechFrames: number;
  private maxSilenceFrames: number;
  private frameSamples: number;

  private speechActive = false;
  private silenceCount = 0;
  private speechCount = 0;

  constructor({
    sampleRate,
    frameMs = 20,
    threshold = 0.015,
    minSpeechMs = 200,
    maxSilenceMs = 400,
  }: { sampleRate: number; frameMs?: number; threshold?: number; minSpeechMs?: number; maxSilenceMs?: number }) {
    this.frameSamples = Math.floor((sampleRate * frameMs) / 1000);
    this.threshold = threshold;
    this.minSpeechFrames = Math.max(1, Math.floor(minSpeechMs / frameMs));
    this.maxSilenceFrames = Math.max(1, Math.floor(maxSilenceMs / frameMs));
  }

  feed(frame: Int16Array) {
    // RMS energy in [-1, 1]
    let sum = 0;
    for (const sample of frame) {
      const v = (sample ?? 0) / 32768;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / frame.length);
    const voiced = rms >= this.threshold;

    if (this.speechActive) {
      if (voiced) {
        this.silenceCount = 0;
      } else {
        this.silenceCount++;
        if (this.silenceCount >= this.maxSilenceFrames) {
          this.speechActive = false;
          this.silenceCount = 0;
          this.speechCount = 0;
          return 'end';
        }
      }
      return 'speech';
    } else {
      if (voiced) {
        this.speechCount++;
        if (this.speechCount >= this.minSpeechFrames) {
          this.speechActive = true;
          this.silenceCount = 0;
          return 'start';
        }
      } else {
        this.speechCount = 0;
      }
      return 'silence';
    }
  }

  getFrameSamples() {
    return this.frameSamples;
  }
}

function pcmToWav(int16: Int16Array, sampleRate: number): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = int16.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // PCM chunk size
  buffer.writeUInt16LE(1, 20); // PCM format
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  Buffer.from(int16.buffer).copy(buffer, 44);
  return buffer;
}

export function startContinuousCapture({ onTranscript, onStatus, onError }: Callbacks, opts: CaptureOptions = {}) {
  const sampleRate = opts.sampleRate ?? 16000;
  const maxSegmentSec = opts.maxSegmentSec ?? 15;
  const device = process.platform === 'darwin' ? (opts.device ?? ':0') : (opts.device ?? 'default');

  let ff: ChildProcessWithoutNullStreams | null = null;
  let stopped = false;
  let pcmBuffer = new Int16Array(0);
  const vad = new EnergyVAD({ sampleRate });
  const frameBytes = vad.getFrameSamples() * 2;
  let segStartMs = 0;

  const client = new OpenAI();

  function appendPCM(buf: Buffer) {
    // merge into pcmBuffer
    const chunk = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 2));
    const merged = new Int16Array(pcmBuffer.length + chunk.length);
    merged.set(pcmBuffer, 0);
    merged.set(chunk, pcmBuffer.length);
    pcmBuffer = merged;
  }

  async function processFrames() {
    const now = Date.now();
    let offsetBytes = 0;
    while (pcmBuffer.length * 2 - offsetBytes >= frameBytes) {
      const frame = new Int16Array(pcmBuffer.buffer, pcmBuffer.byteOffset + offsetBytes, frameBytes / 2);
      offsetBytes += frameBytes;
      const state = vad.feed(frame);
      if (state === 'start') {
        segStartMs = now;
      }
      if (state === 'end' || (segStartMs && now - segStartMs > maxSegmentSec * 1000)) {
        // Emit segment: from start to current offset
        const sampleCount = Math.floor((now - segStartMs) / 1000 * sampleRate);
        const endIndex = Math.min(pcmBuffer.length, sampleCount);
        const segment = pcmBuffer.slice(0, endIndex);
        pcmBuffer = pcmBuffer.slice(endIndex);
        segStartMs = 0;
        if (segment.length > sampleRate * 0.2) {
          void transcribeSegment(segment).catch((e) => onError?.(String(e?.message || e)));
        }
      }
    }
    // drop consumed bytes
    if (offsetBytes > 0) {
      pcmBuffer = new Int16Array(pcmBuffer.buffer.slice(pcmBuffer.byteOffset + offsetBytes, pcmBuffer.byteOffset + pcmBuffer.length * 2));
    }
  }

  async function transcribeSegment(int16: Int16Array) {
    const wav = pcmToWav(int16, sampleRate);
    const tmp = path.join(os.tmpdir(), `gsio-cap-${Date.now()}.wav`);
    await fs.writeFile(tmp, wav);
    onStatus?.('Transcribing audio…');
    try {
      const resp = await client.audio.transcriptions.create({
        file: (await import('node:fs')).createReadStream(tmp) as any,
        model: 'gpt-4o-transcribe',
      } as any);
      const text = (resp as any).text || '';
      if (text.trim().length > 0) onTranscript(text.trim());
    } finally {
      // cleanup
      fs.unlink(tmp).catch(() => {});
    }
  }

  function start() {
    const args: string[] = [];
    if (process.platform === 'darwin') {
      args.push('-f', 'avfoundation', '-i', device);
    } else if (process.platform === 'linux') {
      args.push('-f', 'alsa', '-i', device);
    } else if (process.platform === 'win32') {
      args.push('-f', 'dshow', '-i', 'audio=' + device);
    } else {
      onError?.('Audio capture not supported on this platform');
      return;
    }
    args.push('-ar', String(sampleRate), '-ac', '1', '-f', 's16le', '-');

    try {
      ff = spawn('ffmpeg', args);
    } catch (e: any) {
      onError?.('ffmpeg not found. Please install ffmpeg.');
      return;
    }
    onStatus?.('Audio capture started');
    ff.stdout.on('data', (buf: Buffer) => {
      appendPCM(buf);
      void processFrames();
    });
    ff.stderr.on('data', () => {});
    ff.on('error', (e) => onError?.(String(e?.message || e)));
    ff.on('close', () => {
      if (!stopped) onStatus?.('Audio capture stopped');
    });
  }

  start();

  return () => {
    stopped = true;
    try {
      ff?.kill('SIGKILL');
    } catch {}
  };
}
