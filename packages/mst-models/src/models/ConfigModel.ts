/**
 * Configuration model for application settings
 */

import { types, Instance, SnapshotIn, SnapshotOut } from 'mobx-state-tree';
import { withSerialization, withValidation } from './base/mixins';
import {
  Provider,
  STTProvider,
  ReasoningEffort,
  ReasoningSummary,
  ThinkingVerbosity
} from './base/types';

/**
 * AI Models configuration
 */
export const AIModelsConfig = types.model('AIModelsConfig', {
  reasoning: types.optional(types.string, 'o4-mini'),
  guidance: types.optional(types.string, 'gpt-4o'),
  execution: types.optional(types.string, 'gpt-4o-mini')
});

/**
 * AI configuration
 */
export const AIConfig = types.model('AIConfig', {
  provider: types.optional(
    types.enumeration<Provider>(['openai', 'ollama']),
    'openai'
  ),
  model: types.optional(types.string, 'gpt-4o-mini'),
  baseUrl: types.maybe(types.string),
  apiKey: types.maybe(types.string),
  models: types.optional(AIModelsConfig, {})
})
.actions((self) => ({
  setProvider(provider: Provider) {
    self.provider = provider;
  },
  setModel(model: string) {
    self.model = model;
  },
  setBaseUrl(url: string | undefined) {
    self.baseUrl = url;
  },
  setApiKey(key: string | undefined) {
    self.apiKey = key;
  },
  setReasoningModel(model: string) {
    self.models.reasoning = model;
  },
  setGuidanceModel(model: string) {
    self.models.guidance = model;
  },
  setExecutionModel(model: string) {
    self.models.execution = model;
  }
}))
.views((self) => ({
  get isOpenAI() {
    return self.provider === 'openai';
  },
  get isOllama() {
    return self.provider === 'ollama';
  },
  get hasApiKey() {
    return !!self.apiKey;
  },
  get hasCustomBaseUrl() {
    return !!self.baseUrl;
  }
}));

/**
 * Shell configuration
 */
export const ShellConfig = types.model('ShellConfig', {
  allowDangerous: types.optional(types.boolean, false),
  extraAllowlist: types.optional(types.array(types.string), [])
})
.actions((self) => ({
  toggleDangerous() {
    self.allowDangerous = !self.allowDangerous;
  },
  setAllowDangerous(allow: boolean) {
    self.allowDangerous = allow;
  },
  addToAllowlist(command: string) {
    if (!self.extraAllowlist.includes(command)) {
      self.extraAllowlist.push(command);
    }
  },
  removeFromAllowlist(command: string) {
    const index = self.extraAllowlist.indexOf(command);
    if (index !== -1) {
      self.extraAllowlist.splice(index, 1);
    }
  },
  clearAllowlist() {
    self.extraAllowlist.clear();
  }
}));

/**
 * Whisper configuration
 */
export const WhisperConfig = types.model('WhisperConfig', {
  command: types.optional(types.string, 'whisper'),
  model: types.optional(types.string, 'base'),
  language: types.maybe(types.string),
  extraArgs: types.optional(types.array(types.string), [])
})
.actions((self) => ({
  setCommand(command: string) {
    self.command = command;
  },
  setModel(model: string) {
    self.model = model;
  },
  setLanguage(language: string | undefined) {
    self.language = language;
  },
  addExtraArg(arg: string) {
    self.extraArgs.push(arg);
  },
  removeExtraArg(arg: string) {
    const index = self.extraArgs.indexOf(arg);
    if (index !== -1) {
      self.extraArgs.splice(index, 1);
    }
  }
}));

/**
 * Audio configuration
 */
export const AudioConfig = types.model('AudioConfig', {
  captureEnabled: types.optional(types.boolean, false),
  sttProvider: types.optional(
    types.enumeration<STTProvider>(['openai', 'whisper']),
    'openai'
  ),
  whisper: types.optional(WhisperConfig, {}),
  openaiTranscribeModel: types.maybe(types.string),
  openaiBaseUrl: types.maybe(types.string),
  openaiApiKey: types.maybe(types.string)
})
.actions((self) => ({
  toggleCapture() {
    self.captureEnabled = !self.captureEnabled;
  },
  setCaptureEnabled(enabled: boolean) {
    self.captureEnabled = enabled;
  },
  setSTTProvider(provider: STTProvider) {
    self.sttProvider = provider;
  },
  setOpenAITranscribeModel(model: string | undefined) {
    self.openaiTranscribeModel = model;
  },
  setOpenAIBaseUrl(url: string | undefined) {
    self.openaiBaseUrl = url;
  },
  setOpenAIApiKey(key: string | undefined) {
    self.openaiApiKey = key;
  }
}))
.views((self) => ({
  get isUsingOpenAI() {
    return self.sttProvider === 'openai';
  },
  get isUsingWhisper() {
    return self.sttProvider === 'whisper';
  }
}));

/**
 * Memory configuration
 */
export const MemoryConfig = types.model('MemoryConfig', {
  enabled: types.optional(types.boolean, false),
  userId: types.optional(types.string, 'default'),
  maxEntries: types.optional(types.number, 1000),
  storageDir: types.optional(types.string, '.gsio-memory'),
  embeddingModel: types.optional(types.string, 'text-embedding-ada-002')
})
.actions((self) => ({
  toggleEnabled() {
    self.enabled = !self.enabled;
  },
  setEnabled(enabled: boolean) {
    self.enabled = enabled;
  },
  setUserId(userId: string) {
    self.userId = userId;
  },
  setMaxEntries(max: number) {
    self.maxEntries = Math.max(1, max);
  },
  setStorageDir(dir: string) {
    self.storageDir = dir;
  },
  setEmbeddingModel(model: string) {
    self.embeddingModel = model;
  }
}));

/**
 * Reasoning configuration
 */
export const ReasoningConfig = types.model('ReasoningConfig', {
  effort: types.optional(
    types.enumeration<ReasoningEffort>(['auto', 'minimal', 'low', 'medium', 'high']),
    'auto'
  ),
  summary: types.optional(
    types.enumeration<ReasoningSummary>(['auto', 'concise', 'detailed']),
    'auto'
  )
})
.actions((self) => ({
  setEffort(effort: ReasoningEffort) {
    self.effort = effort;
  },
  setSummary(summary: ReasoningSummary) {
    self.summary = summary;
  }
}));

/**
 * Thinking configuration
 */
export const ThinkingConfig = types.model('ThinkingConfig', {
  enabled: types.optional(types.boolean, false),
  verbosity: types.optional(
    types.enumeration<ThinkingVerbosity>(['low', 'medium', 'high']),
    'medium'
  )
})
.actions((self) => ({
  toggleEnabled() {
    self.enabled = !self.enabled;
  },
  setEnabled(enabled: boolean) {
    self.enabled = enabled;
  },
  setVerbosity(verbosity: ThinkingVerbosity) {
    self.verbosity = verbosity;
  }
}));

/**
 * Loops configuration
 */
export const LoopsConfig = types.model('LoopsConfig', {
  reasoning: types.optional(ReasoningConfig, {}),
  thinking: types.optional(ThinkingConfig, {})
});

/**
 * Linger configuration
 */
export const LingerConfig = types.model('LingerConfig', {
  enabled: types.optional(types.boolean, false),
  behavior: types.optional(types.string, 'auto'),
  minIntervalSec: types.optional(types.number, 30)
})
.actions((self) => ({
  toggleEnabled() {
    self.enabled = !self.enabled;
  },
  setEnabled(enabled: boolean) {
    self.enabled = enabled;
  },
  setBehavior(behavior: string) {
    self.behavior = behavior;
  },
  setMinInterval(seconds: number) {
    self.minIntervalSec = Math.max(1, seconds);
  }
}));

/**
 * Tools configuration
 */
export const ToolsConfig = types.model('ToolsConfig', {
  requireApproval: types.optional(types.array(types.string), [])
})
.actions((self) => ({
  addRequireApproval(toolName: string) {
    if (!self.requireApproval.includes(toolName)) {
      self.requireApproval.push(toolName);
    }
  },
  removeRequireApproval(toolName: string) {
    const index = self.requireApproval.indexOf(toolName);
    if (index !== -1) {
      self.requireApproval.splice(index, 1);
    }
  },
  clearRequireApproval() {
    self.requireApproval.clear();
  },
  toggleToolApproval(toolName: string) {
    const index = self.requireApproval.indexOf(toolName);
    if (index !== -1) {
      self.requireApproval.splice(index, 1);
    } else {
      self.requireApproval.push(toolName);
    }
  }
}))
.views((self) => ({
  requiresApproval(toolName: string) {
    return self.requireApproval.includes(toolName);
  }
}));

/**
 * Panel configuration
 */
export const PanelConfig = types.model('PanelConfig', {
  todoShowCompleted: types.optional(types.boolean, true),
  maxItems: types.optional(types.number, 10)
})
.actions((self) => ({
  toggleShowCompleted() {
    self.todoShowCompleted = !self.todoShowCompleted;
  },
  setShowCompleted(show: boolean) {
    self.todoShowCompleted = show;
  },
  setMaxItems(max: number) {
    self.maxItems = Math.max(1, max);
  }
}));

/**
 * Main Configuration model
 */
export const ConfigModel = types.compose(
  'ConfigModel',
  withSerialization,
  withValidation,
  types.model({
    ai: types.optional(AIConfig, {}),
    shell: types.optional(ShellConfig, {}),
    audio: types.optional(AudioConfig, {}),
    memory: types.optional(MemoryConfig, {}),
    loops: types.optional(LoopsConfig, {}),
    linger: types.optional(LingerConfig, {}),
    tools: types.optional(ToolsConfig, {}),
    panel: types.optional(PanelConfig, {}),
    // Version for migration support
    version: types.optional(types.string, '1.0.0')
  })
)
.actions((self) => ({
  /**
   * Validate the configuration
   */
  validate(): boolean {
    self.clearValidationErrors();

    // Validate API keys if using OpenAI
    if (self.ai.provider === 'openai' && !self.ai.apiKey) {
      self.addValidationError('OpenAI provider requires an API key');
    }

    // Validate audio settings
    if (self.audio.captureEnabled && self.audio.sttProvider === 'openai' && !self.audio.openaiApiKey) {
      self.addValidationError('OpenAI STT requires an API key');
    }

    // Validate memory settings
    if (self.memory.enabled && self.memory.maxEntries < 1) {
      self.addValidationError('Memory max entries must be at least 1');
    }

    // Validate linger interval
    if (self.linger.enabled && self.linger.minIntervalSec < 1) {
      self.addValidationError('Linger interval must be at least 1 second');
    }

    return self.isValid;
  },

  /**
   * Reset to default configuration
   */
  reset() {
    const defaults = ConfigModel.create({});
    Object.assign(self, defaults);
  },

  /**
   * Merge with another configuration
   */
  merge(config: Partial<IConfigSnapshot>) {
    if (config.ai) Object.assign(self.ai, config.ai);
    if (config.shell) Object.assign(self.shell, config.shell);
    if (config.audio) Object.assign(self.audio, config.audio);
    if (config.memory) Object.assign(self.memory, config.memory);
    if (config.loops) Object.assign(self.loops, config.loops);
    if (config.linger) Object.assign(self.linger, config.linger);
    if (config.tools) Object.assign(self.tools, config.tools);
    if (config.panel) Object.assign(self.panel, config.panel);
  },

  /**
   * Clone the configuration
   */
  clone(): Instance<typeof ConfigModel> {
    return ConfigModel.create(JSON.parse(JSON.stringify(self)));
  }
}))
.views((self) => ({
  /**
   * Get a flattened view of all settings
   */
  get flat() {
    return {
      aiProvider: self.ai.provider,
      aiModel: self.ai.model,
      aiReasoningModel: self.ai.models.reasoning,
      aiGuidanceModel: self.ai.models.guidance,
      aiExecutionModel: self.ai.models.execution,
      shellAllowDangerous: self.shell.allowDangerous,
      audioCaptureEnabled: self.audio.captureEnabled,
      audioSTTProvider: self.audio.sttProvider,
      memoryEnabled: self.memory.enabled,
      memoryUserId: self.memory.userId,
      lingerEnabled: self.linger.enabled,
      lingerBehavior: self.linger.behavior,
      reasoningEffort: self.loops.reasoning.effort,
      reasoningSummary: self.loops.reasoning.summary,
      thinkingEnabled: self.loops.thinking.enabled,
      thinkingVerbosity: self.loops.thinking.verbosity
    };
  },

  /**
   * Check if any experimental features are enabled
   */
  get hasExperimentalFeatures() {
    return self.linger.enabled || self.memory.enabled || self.loops.thinking.enabled;
  }
}));

// Type exports
export interface IConfig extends Instance<typeof ConfigModel> {}
export interface IConfigSnapshot extends SnapshotIn<typeof ConfigModel> {}
export interface IConfigOutput extends SnapshotOut<typeof ConfigModel> {}

// Factory function
export function createConfig(config?: Partial<IConfigSnapshot>): IConfig {
  return ConfigModel.create(config || {});
}