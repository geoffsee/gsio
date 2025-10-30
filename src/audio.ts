import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import OpenAI from "openai";
import { loadConfig } from "./config";

export type CaptureMetrics = {
	startTimeMs: number;
	lastUpdateMs: number;
	feedActive: boolean;
	sampleRate: number;
	bytesReceived: number;
	totalSamples: number;
	framesProcessed: number;
	vadStarts: number;
	vadEnds: number;
	vadActive: boolean;
	segmentsEmitted: number;
	lastSegmentSamples: number;
	transcriptsEmitted: number;
	errors: number;
};

type Callbacks = {
	onTranscript: (text: string) => void;
	onStatus?: (msg: string) => void;
	onError?: (err: string) => void;
	onMetrics?: (m: CaptureMetrics) => void;
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
		threshold = 0.008,
		minSpeechMs = 150,
		maxSilenceMs = 500,
	}: {
		sampleRate: number;
		frameMs?: number;
		threshold?: number;
		minSpeechMs?: number;
		maxSilenceMs?: number;
	}) {
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
					return "end";
				}
			}
			return "speech";
		} else {
			if (voiced) {
				this.speechCount++;
				if (this.speechCount >= this.minSpeechFrames) {
					this.speechActive = true;
					this.silenceCount = 0;
					return "start";
				}
			} else {
				this.speechCount = 0;
			}
			return "silence";
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
	buffer.write("RIFF", 0);
	buffer.writeUInt32LE(36 + dataSize, 4);
	buffer.write("WAVE", 8);
	buffer.write("fmt ", 12);
	buffer.writeUInt32LE(16, 16); // PCM chunk size
	buffer.writeUInt16LE(1, 20); // PCM format
	buffer.writeUInt16LE(numChannels, 22);
	buffer.writeUInt32LE(sampleRate, 24);
	buffer.writeUInt32LE(byteRate, 28);
	buffer.writeUInt16LE(blockAlign, 32);
	buffer.writeUInt16LE(bitsPerSample, 34);
	buffer.write("data", 36);
	buffer.writeUInt32LE(dataSize, 40);
	Buffer.from(int16.buffer).copy(buffer, 44);
	return buffer;
}

export function startContinuousCapture(
	{ onTranscript, onStatus, onError, onMetrics }: Callbacks,
	opts: CaptureOptions = {}
) {
	const sampleRate = opts.sampleRate ?? 16000;
	const maxSegmentSec = opts.maxSegmentSec ?? 15;
	const device =
		process.platform === "darwin"
			? opts.device ?? ":0"
			: opts.device ?? "default";

	let ff: ChildProcessWithoutNullStreams | null = null;
	let stopped = false;
	let pcmBuffer = new Int16Array(0);
	const vad = new EnergyVAD({ sampleRate });
	const frameBytes = vad.getFrameSamples() * 2;
	let segStartMs = 0;
	let lastForceMs = Date.now();
	// Rolling buffer for fallback segmentation (keep ~12s)
	let rollingBuffer = new Int16Array(0);
	const metrics: CaptureMetrics = {
		startTimeMs: Date.now(),
		lastUpdateMs: Date.now(),
		feedActive: false,
		sampleRate,
		bytesReceived: 0,
		totalSamples: 0,
		framesProcessed: 0,
		vadStarts: 0,
		vadEnds: 0,
		vadActive: false,
		segmentsEmitted: 0,
		lastSegmentSamples: 0,
		transcriptsEmitted: 0,
		errors: 0,
	};
	let metricsTimer: NodeJS.Timeout | null = null;

	// Create client lazily in transcribeSegment; also allow disabling for unsupported providers

	function appendPCM(buf: Buffer) {
		// merge into pcmBuffer
		const chunk = new Int16Array(
			buf.buffer,
			buf.byteOffset,
			Math.floor(buf.byteLength / 2)
		);
		const merged = new Int16Array(pcmBuffer.length + chunk.length);
		merged.set(pcmBuffer, 0);
		merged.set(chunk, pcmBuffer.length);
		pcmBuffer = merged;
		metrics.bytesReceived += buf.byteLength;
		metrics.totalSamples += chunk.length;

		// Maintain rolling buffer capped to ~12s
		const maxRolling = sampleRate * 12;
		if (rollingBuffer.length === 0) {
			rollingBuffer = chunk.slice();
		} else {
			const keep = Math.max(
				0,
				Math.min(rollingBuffer.length, maxRolling - chunk.length)
			);
			const head =
				keep > 0
					? rollingBuffer.slice(rollingBuffer.length - keep)
					: new Int16Array(0);
			rollingBuffer = new Int16Array(head.length + chunk.length);
			rollingBuffer.set(head, 0);
			rollingBuffer.set(chunk, head.length);
		}
	}

	async function processFrames() {
		const now = Date.now();
		let offsetBytes = 0;
		while (pcmBuffer.length * 2 - offsetBytes >= frameBytes) {
			const frame = new Int16Array(
				pcmBuffer.buffer,
				pcmBuffer.byteOffset + offsetBytes,
				frameBytes / 2
			);
			offsetBytes += frameBytes;
			const state = vad.feed(frame);
			metrics.framesProcessed++;
			if (state === "start") {
				segStartMs = now;
				metrics.vadStarts++;
				metrics.vadActive = true;
			}
			if (
				state === "end" ||
				(segStartMs && now - segStartMs > maxSegmentSec * 1000)
			) {
				// Emit segment: from start to current offset
				const sampleCount = Math.floor(
					((now - segStartMs) / 1000) * sampleRate
				);
				const endIndex = Math.min(pcmBuffer.length, sampleCount);
				const segment = pcmBuffer.slice(0, endIndex);
				pcmBuffer = pcmBuffer.slice(endIndex);
				segStartMs = 0;
				if (segment.length > sampleRate * 0.2) {
					metrics.segmentsEmitted++;
					metrics.lastSegmentSamples = segment.length;
					void transcribeSegment(segment).catch((e) =>
						onError?.(String(e?.message || e))
					);
				}
				if (state === "end") {
					metrics.vadEnds++;
					metrics.vadActive = false;
				}
			}
		}
		// drop consumed bytes
		if (offsetBytes > 0) {
			pcmBuffer = new Int16Array(
				pcmBuffer.buffer.slice(
					pcmBuffer.byteOffset + offsetBytes,
					pcmBuffer.byteOffset + pcmBuffer.length * 2
				)
			);
		}

		// Fallback segmentation: if VAD never triggered, but we have a lot of audio buffered,
		// force a segment every ~6s to attempt transcription.
		if (!segStartMs) {
			const now2 = Date.now();
			const forceIntervalMs = 6000;
			const minSegmentSec = 4; // minimum forced segment length in seconds
			if (
				now2 - lastForceMs >= forceIntervalMs &&
				rollingBuffer.length >= sampleRate * minSegmentSec
			) {
				const forceLen = Math.min(rollingBuffer.length, sampleRate * 8); // cap to last 8s
				const segment = rollingBuffer.slice(rollingBuffer.length - forceLen);
				rollingBuffer = new Int16Array(0);
				lastForceMs = now2;
				onStatus?.("No speech detected; forcing segment");
				metrics.segmentsEmitted++;
				metrics.lastSegmentSamples = segment.length;
				void transcribeSegment(segment).catch((e) =>
					onError?.(String(e?.message || e))
				);
			}
		}
	}

	async function transcribeSegment(int16: Int16Array) {
		const wav = pcmToWav(int16, sampleRate);
		const tmpWav = path.join(os.tmpdir(), `gsio-cap-${Date.now()}.wav`);
		await fs.writeFile(tmpWav, wav);
		onStatus?.("Transcribing audio…");
		try {
			const cfg = await loadConfig();
			if (cfg.audio?.sttProvider === "whisper") {
				const text = await transcribeWithLocalWhisper(
					tmpWav,
					cfg.audio.whisper.command,
					cfg.audio.whisper.model,
					cfg.audio.whisper.language,
					cfg.audio.whisper.extraArgs || []
				);
				if (text.trim().length > 0) {
					metrics.transcriptsEmitted++;
					onTranscript(text.trim());
					onStatus?.(`Transcribed (${text.trim().length} chars)`);
				} else {
					onStatus?.("Transcribed (empty)");
				}
				return;
			}
			// Default to OpenAI-compatible transcription; prefer audio-specific overrides
			const sttApiKey =
				cfg.audio?.openaiApiKey && cfg.audio.openaiApiKey.length > 0
					? cfg.audio.openaiApiKey
					: cfg.ai?.apiKey && cfg.ai.apiKey.length > 0
					? cfg.ai.apiKey
					: process.env.OPENAI_API_KEY || "";
			const sttBaseUrl =
				cfg.audio?.openaiBaseUrl && cfg.audio.openaiBaseUrl.length > 0
					? cfg.audio.openaiBaseUrl
					: cfg.ai?.baseUrl && cfg.ai.baseUrl.length > 0
					? cfg.ai.baseUrl
					: undefined;
			const client = new OpenAI({
				apiKey: sttApiKey,
				baseURL: sttBaseUrl,
			} as any);
			const resp = await client.audio.transcriptions.create({
				file: (await import("node:fs")).createReadStream(tmpWav) as any,
				model: cfg.audio?.openaiTranscribeModel || "gpt-4o-transcribe",
			} as any);
			const text = (resp as any).text || "";
			if (text.trim().length > 0) {
				metrics.transcriptsEmitted++;
				onTranscript(text.trim());
				onStatus?.(`Transcribed (${text.trim().length} chars)`);
			} else {
				onStatus?.("Transcribed (empty)");
			}
		} catch (e: any) {
			metrics.errors++;
			onError?.(String(e?.message || e));
		} finally {
			// cleanup
			fs.unlink(tmpWav).catch(() => {});
		}
	}

	// Resolve a binary on PATH (cross-platform) and model file paths
	async function which(bin: string): Promise<string | null> {
		return await new Promise((resolve) => {
			try {
				const cmd = process.platform === "win32" ? "where" : "which";
				const p = spawn(cmd, [bin]);
				let out = "";
				p.stdout.on("data", (b) => (out += String(b || "")));
				p.on("close", (code) => {
					if (code === 0 && out.trim().length > 0)
						resolve(out.trim().split(/\r?\n/)[0] || bin);
					else resolve(null);
				});
				p.on("error", () => resolve(null));
			} catch {
				resolve(null);
			}
		});
	}

	async function fileExists(p: string): Promise<boolean> {
		try {
			await fs.access(p);
			return true;
		} catch {
			return false;
		}
	}

	async function resolveWhisperCommand(
		preferred?: string
	): Promise<string | null> {
		const candidates = [
			preferred,
			"whisper-cpp",
			"whisper_cli",
			"whisper",
			"main",
		].filter(Boolean) as string[];
		for (const c of candidates) {
			if (
				c.includes("/") ||
				(process.platform === "win32" && c.includes("\\"))
			) {
				if (await fileExists(c)) return c;
			} else {
				const w = await which(c);
				if (w) return w;
			}
		}
		return null;
	}

	function expandModelShorthand(model?: string): string[] {
		const m = (model || "").trim();
		if (!m) {
			return [
				"ggml-small.en.bin",
				"ggml-base.en.bin",
				"ggml-small.bin",
				"ggml-base.bin",
			];
		}
		if (!m.endsWith(".bin") && !m.includes(path.sep)) {
			return [`ggml-${m}.bin`, `ggml-${m.replace(/\.en$/, "")}.en.bin`];
		}
		return [m];
	}

	async function resolveWhisperModel(model?: string): Promise<string | null> {
		const home = process.env.HOME || process.env.USERPROFILE || "";
		const searchDirs = [
			process.cwd(),
			path.join(process.cwd(), "models"),
			home ? path.join(home, "models") : "",
			home ? path.join(home, ".cache", "whisper") : "",
			home ? path.join(home, ".local", "share", "whisper") : "",
			"/usr/local/share/whisper",
			"/opt/homebrew/share/whisper",
			"/opt/homebrew/opt/whisper-cpp/share/whisper",
		].filter(Boolean);
		const candidates = expandModelShorthand(model);
		for (const dir of searchDirs) {
			for (const name of candidates) {
				const p = path.isAbsolute(name) ? name : path.join(dir, name);
				if (await fileExists(p)) return p;
			}
		}
		if (model && !path.isAbsolute(model)) {
			const p = path.join(process.cwd(), model);
			if (await fileExists(p)) return p;
		}
		return null;
	}

	async function transcribeWithLocalWhisper(
		wavPath: string,
		cmd: string,
		modelPath: string,
		language?: string,
		extraArgs: string[] = []
	): Promise<string> {
		return await new Promise<string>((resolve) => {
			const run = async () => {
				const resolvedCmd = await resolveWhisperCommand(cmd);
				const resolvedModel = await resolveWhisperModel(modelPath);
				if (!resolvedCmd) {
					onError?.(
						"Whisper executable not found. Install whisper.cpp (e.g., brew install whisper-cpp) or set audio.whisper.command."
					);
					return resolve("");
				}
				if (!resolvedModel) {
					onError?.(
						"Whisper model not found. Place a ggml-*.bin in ./models or configure audio.whisper.model."
					);
					return resolve("");
				}
				const outPrefix = path.join(os.tmpdir(), `gsio-whisper-${Date.now()}`);
				const args = [
					"-m",
					resolvedModel,
					"-f",
					wavPath,
					"-otxt",
					"-of",
					outPrefix,
				];
				if (language) {
					args.push("-l", language);
				}
				if (Array.isArray(extraArgs) && extraArgs.length > 0) {
					args.push(...extraArgs);
				}
				const child = spawn(resolvedCmd, args);
				let stderr = "";
				child.stderr.on("data", (buf) => {
					stderr += String(buf || "");
				});
				child.on("error", (err) => {
					onError?.(`Failed to start Whisper: ${err?.message || err}`);
					resolve("");
				});
				child.on("close", async (code) => {
					if (code !== 0) {
						onError?.(
							`Whisper exited with code ${code}${stderr ? `: ${stderr}` : ""}`
						);
						return resolve("");
					}
					try {
						const outTxt = await fs.readFile(`${outPrefix}.txt`, "utf8");
						resolve(outTxt || "");
					} catch (e: any) {
						onError?.(`Failed reading Whisper output: ${e?.message || e}`);
						resolve("");
					} finally {
						fs.unlink(`${outPrefix}.txt`).catch(() => {});
					}
				});
			};
			void run();
		});
	}

	function start() {
		const args: string[] = [];
		if (process.platform === "darwin") {
			args.push("-f", "avfoundation", "-i", device);
		} else if (process.platform === "linux") {
			args.push("-f", "alsa", "-i", device);
		} else if (process.platform === "win32") {
			args.push("-f", "dshow", "-i", "audio=" + device);
		} else {
			onError?.("Audio capture not supported on this platform");
			return;
		}
		args.push("-ar", String(sampleRate), "-ac", "1", "-f", "s16le", "-");

		try {
			ff = spawn("ffmpeg", args);
		} catch (e: any) {
			metrics.errors++;
			onError?.("ffmpeg not found. Please install ffmpeg.");
			return;
		}
		onStatus?.("Audio capture started");
		metrics.feedActive = true;
		metrics.lastUpdateMs = Date.now();
		// Periodic metrics callback (3s)
		if (metricsTimer) clearInterval(metricsTimer);
		metricsTimer = setInterval(() => {
			metrics.lastUpdateMs = Date.now();
			onMetrics?.({ ...metrics });
		}, 3000);
		ff.stdout.on("data", (buf: Buffer) => {
			appendPCM(buf);
			void processFrames();
		});
		ff.stderr.on("data", () => {});
		ff.on("error", (e) => {
			metrics.errors++;
			onError?.(String(e?.message || e));
		});
		ff.on("close", () => {
			metrics.feedActive = false;
			if (metricsTimer) {
				clearInterval(metricsTimer);
				metricsTimer = null;
			}
			if (!stopped) onStatus?.("Audio capture stopped");
		});
	}

	start();

	return () => {
		stopped = true;
		try {
			ff?.kill("SIGKILL");
		} catch {}
		metrics.feedActive = false;
		if (metricsTimer) {
			clearInterval(metricsTimer);
			metricsTimer = null;
		}
	};
}
