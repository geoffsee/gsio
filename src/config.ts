import fs from 'node:fs/promises';
import path from 'node:path';

export type AppConfig = {
  ai: {
    provider: 'openai' | 'ollama';
    model: string; // default model to use for chat/summarization
    baseUrl?: string; // override API base (e.g., http://localhost:11434/v1 for Ollama)
    apiKey?: string; // optional override; for Ollama, can be any non-empty string
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
    sttProvider: 'openai' | 'whisper';
    whisper: {
      command: string; // e.g., 'whisper-cpp' or './main'
      model: string;   // path to ggml model file, e.g., '~/models/ggml-base.en.bin'
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
};

const DEFAULT_CONFIG: AppConfig = {
  ai: { provider: 'openai', model: 'gpt-4o-mini', baseUrl: '', apiKey: '' },
  shell: { allowDangerous: false, extraAllowlist: [] },
  panel: { todoShowCompleted: true, maxItems: 5 },
  audio: {
    captureEnabled: false,
    sttProvider: 'openai',
    whisper: {
      command: 'whisper-cpp',
      model: '',
      language: 'en',
      extraArgs: [],
    },
    openaiTranscribeModel: 'gpt-4o-transcribe',
    openaiBaseUrl: '',
    openaiApiKey: '',
  },
  linger: {
    enabled: false,
    behavior:
      'When useful, infer what the user is doing from recent audio and take helpful actions: add/update TODOs, set focus/status/priority, or fetch information. Keep changes minimal and safe. Respond concisely only when it adds value.',
    minIntervalSec: 20,
  },
  tools: {
    requireApproval: ['shell_exec'],
  },
};

const FILE_NAME = '.gsio-config.json';

export function getConfigPath(cwd = process.cwd()) {
  return path.resolve(cwd, FILE_NAME);
}

export async function loadConfig(): Promise<AppConfig> {
  const file = getConfigPath();
  try {
    const raw = await fs.readFile(file, 'utf8');
    const data = JSON.parse(raw);
    return normalizeConfig(data);
  } catch (err: any) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) {
      return DEFAULT_CONFIG;
    }
    throw err;
  }
}

export async function saveConfig(cfg: AppConfig): Promise<void> {
  const file = getConfigPath();
  const data = JSON.stringify(normalizeConfig(cfg), null, 2);
  await fs.writeFile(file, data, 'utf8');
}

function normalizeConfig(input: any): AppConfig {
  const cfg: AppConfig = {
    ai: {
      provider: input?.ai?.provider === 'ollama' ? 'ollama' : 'openai',
      model:
        typeof input?.ai?.model === 'string' && input.ai.model.trim().length > 0
          ? String(input.ai.model)
          : (input?.ai?.provider === 'ollama' ? 'llama3.1:8b' : DEFAULT_CONFIG.ai.model),
      baseUrl:
        typeof input?.ai?.baseUrl === 'string' ? input.ai.baseUrl : DEFAULT_CONFIG.ai.baseUrl,
      apiKey:
        typeof input?.ai?.apiKey === 'string' ? input.ai.apiKey : DEFAULT_CONFIG.ai.apiKey,
    },
    shell: {
      allowDangerous: !!input?.shell?.allowDangerous,
      extraAllowlist: Array.isArray(input?.shell?.extraAllowlist)
        ? input.shell.extraAllowlist.filter((s: any) => typeof s === 'string' && s.trim().length > 0)
        : [],
    },
    panel: {
      todoShowCompleted: input?.panel?.todoShowCompleted !== false,
      maxItems: clampInt(input?.panel?.maxItems, 1, 20, 5),
    },
    audio: {
      captureEnabled: !!input?.audio?.captureEnabled,
      sttProvider: input?.audio?.sttProvider === 'whisper' ? 'whisper' : 'openai',
      whisper: {
        command: typeof input?.audio?.whisper?.command === 'string' && input.audio.whisper.command.trim().length > 0
          ? String(input.audio.whisper.command)
          : DEFAULT_CONFIG.audio.whisper.command,
        model: typeof input?.audio?.whisper?.model === 'string' ? String(input.audio.whisper.model) : DEFAULT_CONFIG.audio.whisper.model,
        language: typeof input?.audio?.whisper?.language === 'string' && input.audio.whisper.language.trim().length > 0
          ? String(input.audio.whisper.language)
          : DEFAULT_CONFIG.audio.whisper.language,
        extraArgs: Array.isArray(input?.audio?.whisper?.extraArgs)
          ? input.audio.whisper.extraArgs.filter((s: any) => typeof s === 'string')
          : DEFAULT_CONFIG.audio.whisper.extraArgs,
      },
      openaiTranscribeModel:
        typeof input?.audio?.openaiTranscribeModel === 'string' && input.audio.openaiTranscribeModel.trim().length > 0
          ? String(input.audio.openaiTranscribeModel)
          : DEFAULT_CONFIG.audio.openaiTranscribeModel,
      openaiBaseUrl:
        typeof input?.audio?.openaiBaseUrl === 'string' ? String(input.audio.openaiBaseUrl) : DEFAULT_CONFIG.audio.openaiBaseUrl,
      openaiApiKey:
        typeof input?.audio?.openaiApiKey === 'string' ? String(input.audio.openaiApiKey) : DEFAULT_CONFIG.audio.openaiApiKey,
    },
    linger: {
      enabled: !!input?.linger?.enabled,
      behavior:
        typeof input?.linger?.behavior === 'string' && input.linger.behavior.trim().length > 0
          ? String(input.linger.behavior)
          : DEFAULT_CONFIG.linger.behavior,
      minIntervalSec: clampInt(input?.linger?.minIntervalSec, 5, 600, DEFAULT_CONFIG.linger.minIntervalSec),
    },
    tools: {
      requireApproval: Array.isArray(input?.tools?.requireApproval)
        ? input.tools.requireApproval
            .map((s: any) => (typeof s === 'string' ? s.trim() : ''))
            .filter((s: string) => s.length > 0)
        : [],
    },
  };
  cfg.tools.requireApproval = Array.from(
    new Set([
      ...cfg.tools.requireApproval,
      ...DEFAULT_CONFIG.tools.requireApproval,
    ]),
  );
  return cfg;
}

function clampInt(v: any, min: number, max: number, def: number): number {
  const n = Number(v);
  if (!Number.isInteger(n)) return def;
  return Math.max(min, Math.min(max, n));
}
