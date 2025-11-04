import fs from "node:fs/promises";
import path from "node:path";

type ReasoningEffort = "auto" | "minimal" | "low" | "medium" | "high";
type ReasoningSummary = "auto" | "concise" | "detailed";
type ThinkingVerbosity = "low" | "medium" | "high";

export type AppConfig = {
	ai: {
		provider: "openai" | "ollama";
		model: string; // default model to use for chat/summarization
		baseUrl?: string; // override API base (e.g., http://localhost:11434/v1 for Ollama)
		apiKey?: string; // optional override; for Ollama, can be any non-empty string
		models: {
			reasoning: string;
			guidance: string;
			execution: string;
		};
	};
	shell: {
		allowDangerous: boolean;
		extraAllowlist: string[];
	};
	panel: {
		todoShowCompleted: boolean;
		maxItems: number; // how many todos to show in panel
	};
	audio: {
		captureEnabled: boolean;
		sttProvider: "openai" | "whisper";
		whisper: {
			command: string; // e.g., 'whisper-cpp' or './main'
			model: string; // path to ggml model file, e.g., '~/models/ggml-base.en.bin'
			language?: string; // optional language code, e.g., 'en'
			extraArgs?: string[]; // optional extra CLI args
		};
		openaiTranscribeModel?: string; // model id for /v1/audio/transcriptions
		openaiBaseUrl?: string; // optional override for STT server (e.g., MLX Omni)
		openaiApiKey?: string; // optional override for STT server
	};
	linger: {
		enabled: boolean;
		behavior: string; // natural language
		minIntervalSec: number; // cooldown between autonomous runs
	};
	tools: {
		requireApproval: string[]; // tool names requiring approval before execution
	};
	memory: {
		enabled: boolean;
		userId: string;
		maxEntries: number;
		storageDir: string;
		embeddingModel: string;
	};
	loops: {
		reasoning: {
			effort: ReasoningEffort;
			summary: ReasoningSummary;
		};
		thinking: {
			enabled: boolean;
			verbosity: ThinkingVerbosity;
		};
	};
};

const DEFAULT_CONFIG: AppConfig = {
	ai: {
		provider: "openai",
		model: "gpt-4o-mini",
		baseUrl: "",
		apiKey: "",
		models: {
			reasoning: "o4-mini",
			guidance: "gpt-4o",
			execution: "gpt-4o-mini",
		},
	},
	shell: { allowDangerous: false, extraAllowlist: [] },
	panel: { todoShowCompleted: true, maxItems: 5 },
	audio: {
		captureEnabled: false,
		sttProvider: "openai",
		whisper: {
			command: "whisper-cpp",
			model: "",
			language: "en",
			extraArgs: [],
		},
		openaiTranscribeModel: "gpt-4o-transcribe",
		openaiBaseUrl: "",
		openaiApiKey: "",
	},
	linger: {
		enabled: false,
		behavior:
			"When useful, infer what the user is doing from recent audio and take helpful actions: add/update TODOs, set focus/status/priority, or fetch information. Keep changes minimal and safe. Respond concisely only when it adds value.",
		minIntervalSec: 20,
	},
	tools: {
		requireApproval: ["shell_exec"],
	},
	memory: {
		enabled: true,
		userId: "local_user",
		maxEntries: 500,
		storageDir: ".gsio-memory",
		embeddingModel: "text-embedding-3-small",
	},
	loops: {
		reasoning: {
			effort: "medium",
			summary: "concise",
		},
		thinking: {
			enabled: false,
			verbosity: "medium",
		},
	},
};

const REASONING_EFFORTS: readonly ReasoningEffort[] = [
	"auto",
	"minimal",
	"low",
	"medium",
	"high",
] as const;

const REASONING_SUMMARIES: readonly ReasoningSummary[] = [
	"auto",
	"concise",
	"detailed",
] as const;

const THINKING_VERBOSITIES: readonly ThinkingVerbosity[] = [
	"low",
	"medium",
	"high",
] as const;

const FILE_NAME = ".gsio-config.json";

export function getConfigPath(cwd = process.cwd()) {
	return path.resolve(cwd, FILE_NAME);
}

export async function loadConfig(): Promise<AppConfig> {
	const file = getConfigPath();
	try {
		const raw = await fs.readFile(file, "utf8");
		const data = JSON.parse(raw);
		return normalizeConfig(data);
	} catch (err: any) {
		if (err && (err.code === "ENOENT" || err.code === "ENOTDIR")) {
			return DEFAULT_CONFIG;
		}
		throw err;
	}
}

export async function saveConfig(cfg: AppConfig): Promise<void> {
	const file = getConfigPath();
	const data = JSON.stringify(normalizeConfig(cfg), null, 2);
	await fs.writeFile(file, data, "utf8");
}

function normalizeConfig(input: any): AppConfig {
	const providerIsOllama = input?.ai?.provider === "ollama";
	const defaultExecutionModel = providerIsOllama
		? "llama3.1:8b"
		: DEFAULT_CONFIG.ai.models.execution;
	const normalizedExecutionModel = normalizeModelString(
		input?.ai?.models?.execution,
		defaultExecutionModel
	);
	const normalizedReasoningModel = normalizeModelString(
		input?.ai?.models?.reasoning,
		providerIsOllama
			? normalizedExecutionModel
			: DEFAULT_CONFIG.ai.models.reasoning
	);
	const normalizedGuidanceModel = normalizeModelString(
		input?.ai?.models?.guidance,
		providerIsOllama
			? normalizedExecutionModel
			: DEFAULT_CONFIG.ai.models.guidance
	);
	const normalizedDefaultModel = normalizeModelString(
		input?.ai?.model,
		normalizedExecutionModel
	);

	const cfg: AppConfig = {
		ai: {
			provider: input?.ai?.provider === "ollama" ? "ollama" : "openai",
			model: normalizedDefaultModel,
			baseUrl:
				typeof input?.ai?.baseUrl === "string"
					? input.ai.baseUrl
					: DEFAULT_CONFIG.ai.baseUrl,
			apiKey:
				typeof input?.ai?.apiKey === "string"
					? input.ai.apiKey
					: DEFAULT_CONFIG.ai.apiKey,
			models: {
				reasoning: normalizedReasoningModel,
				guidance: normalizedGuidanceModel,
				execution: normalizedExecutionModel,
			},
		},
		shell: {
			allowDangerous: !!input?.shell?.allowDangerous,
			extraAllowlist: Array.isArray(input?.shell?.extraAllowlist)
				? input.shell.extraAllowlist.filter(
						(s: any) => typeof s === "string" && s.trim().length > 0
				  )
				: [],
		},
		panel: {
			todoShowCompleted: input?.panel?.todoShowCompleted !== false,
			maxItems: clampInt(input?.panel?.maxItems, 1, 20, 5),
		},
		audio: {
			captureEnabled: !!input?.audio?.captureEnabled,
			sttProvider:
				input?.audio?.sttProvider === "whisper" ? "whisper" : "openai",
			whisper: {
				command:
					typeof input?.audio?.whisper?.command === "string" &&
					input.audio.whisper.command.trim().length > 0
						? String(input.audio.whisper.command)
						: DEFAULT_CONFIG.audio.whisper.command,
				model:
					typeof input?.audio?.whisper?.model === "string"
						? String(input.audio.whisper.model)
						: DEFAULT_CONFIG.audio.whisper.model,
				language:
					typeof input?.audio?.whisper?.language === "string" &&
					input.audio.whisper.language.trim().length > 0
						? String(input.audio.whisper.language)
						: DEFAULT_CONFIG.audio.whisper.language,
				extraArgs: Array.isArray(input?.audio?.whisper?.extraArgs)
					? input.audio.whisper.extraArgs.filter(
							(s: any) => typeof s === "string"
					  )
					: DEFAULT_CONFIG.audio.whisper.extraArgs,
			},
			openaiTranscribeModel:
				typeof input?.audio?.openaiTranscribeModel === "string" &&
				input.audio.openaiTranscribeModel.trim().length > 0
					? String(input.audio.openaiTranscribeModel)
					: DEFAULT_CONFIG.audio.openaiTranscribeModel,
			openaiBaseUrl:
				typeof input?.audio?.openaiBaseUrl === "string"
					? String(input.audio.openaiBaseUrl)
					: DEFAULT_CONFIG.audio.openaiBaseUrl,
			openaiApiKey:
				typeof input?.audio?.openaiApiKey === "string"
					? String(input.audio.openaiApiKey)
					: DEFAULT_CONFIG.audio.openaiApiKey,
		},
		linger: {
			enabled: !!input?.linger?.enabled,
			behavior:
				typeof input?.linger?.behavior === "string" &&
				input.linger.behavior.trim().length > 0
					? String(input.linger.behavior)
					: DEFAULT_CONFIG.linger.behavior,
			minIntervalSec: clampInt(
				input?.linger?.minIntervalSec,
				5,
				600,
				DEFAULT_CONFIG.linger.minIntervalSec
			),
		},
		tools: {
			requireApproval: Array.isArray(input?.tools?.requireApproval)
				? input.tools.requireApproval
						.map((s: any) => (typeof s === "string" ? s.trim() : ""))
						.filter((s: string) => s.length > 0)
				: [],
		},
		memory: {
			enabled: input?.memory?.enabled !== false,
			userId:
				typeof input?.memory?.userId === "string" &&
				input.memory.userId.trim().length > 0
					? String(input.memory.userId).trim()
					: DEFAULT_CONFIG.memory.userId,
			maxEntries: clampInt(
				input?.memory?.maxEntries,
				50,
				5000,
				DEFAULT_CONFIG.memory.maxEntries
			),
			storageDir:
				typeof input?.memory?.storageDir === "string" &&
				input.memory.storageDir.trim().length > 0
					? String(input.memory.storageDir).trim()
					: DEFAULT_CONFIG.memory.storageDir,
			embeddingModel:
				typeof input?.memory?.embeddingModel === "string" &&
				input.memory.embeddingModel.trim().length > 0
					? String(input.memory.embeddingModel).trim()
					: DEFAULT_CONFIG.memory.embeddingModel,
		},
		loops: {
			reasoning: {
				effort:
					typeof input?.loops?.reasoning?.effort === "string" &&
					REASONING_EFFORTS.includes(
						input.loops.reasoning.effort as ReasoningEffort
					)
						? (input.loops.reasoning.effort as ReasoningEffort)
						: DEFAULT_CONFIG.loops.reasoning.effort,
				summary:
					typeof input?.loops?.reasoning?.summary === "string" &&
					REASONING_SUMMARIES.includes(
						input.loops.reasoning.summary as ReasoningSummary
					)
						? (input.loops.reasoning.summary as ReasoningSummary)
						: DEFAULT_CONFIG.loops.reasoning.summary,
			},
			thinking: {
				enabled:
					input?.loops?.thinking?.enabled === undefined
						? DEFAULT_CONFIG.loops.thinking.enabled
						: Boolean(input.loops.thinking.enabled),
				verbosity:
					typeof input?.loops?.thinking?.verbosity === "string" &&
					THINKING_VERBOSITIES.includes(
						input.loops.thinking.verbosity as ThinkingVerbosity
					)
						? (input.loops.thinking.verbosity as ThinkingVerbosity)
						: DEFAULT_CONFIG.loops.thinking.verbosity,
			},
		},
	};
	cfg.tools.requireApproval = Array.from(
		new Set([
			...cfg.tools.requireApproval,
			...DEFAULT_CONFIG.tools.requireApproval,
		])
	);
	return cfg;
}

function clampInt(v: any, min: number, max: number, def: number): number {
	const n = Number(v);
	if (!Number.isInteger(n)) return def;
	return Math.max(min, Math.min(max, n));
}

function normalizeModelString(value: any, fallback: string): string {
	if (typeof value === "string" && value.trim().length > 0) {
		return value.trim();
	}
	return fallback;
}
