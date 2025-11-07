/**
 * Configuration store for managing application settings
 */

import { types, flow, Instance, SnapshotIn, getRoot, getSnapshot } from 'mobx-state-tree';
import { ConfigModel, IConfig, createConfig } from '../models/ConfigModel';
import { withLoadingState } from '../models/base/mixins';

/**
 * Configuration Store
 */
export const ConfigStore = types.compose(
  'ConfigStore',
  withLoadingState,
  types.model({
    config: types.optional(ConfigModel, {}),
    configPath: types.optional(types.string, '.gsio-config.json'),
    lastSavedAt: types.maybe(types.Date),
    isDirty: types.optional(types.boolean, false),
    autoSave: types.optional(types.boolean, true)
  })
)
.views((self) => ({
  get isValid() {
    return self.config.validate();
  },

  get hasApiKey() {
    return !!self.config.ai.apiKey;
  },

  get isUsingOpenAI() {
    return self.config.ai.provider === 'openai';
  },

  get isUsingOllama() {
    return self.config.ai.provider === 'ollama';
  },

  get memoryEnabled() {
    return self.config.memory.enabled;
  },

  get audioEnabled() {
    return self.config.audio.captureEnabled;
  },

  get lingerEnabled() {
    return self.config.linger.enabled;
  },

  get dangerousCommandsAllowed() {
    return self.config.shell.allowDangerous;
  },

  /**
   * Get configuration as JSON
   */
  toJSON() {
    return getSnapshot(self.config);
  }
}))
.actions((self) => ({
  /**
   * Mark configuration as dirty
   */
  markDirty() {
    self.isDirty = true;
    if (self.autoSave) {
      this.save();
    }
  },

  /**
   * Load configuration from storage
   */
  load: flow(function* () {
    try {
      self.setLoading(true);
      const root = getRoot(self) as any;

      if (root.services?.storage) {
        const data = yield root.services.storage.loadConfig(self.configPath);
        if (data) {
          self.config = ConfigModel.create(data);
        }
      }

      self.isDirty = false;
      self.setLoading(false);
    } catch (error: any) {
      self.setError(`Failed to load configuration: ${error.message}`);
      // Use default configuration on error
      self.config = createConfig();
    }
  }),

  /**
   * Save configuration to storage
   */
  save: flow(function* () {
    try {
      self.setLoading(true);
      const root = getRoot(self) as any;

      if (root.services?.storage) {
        yield root.services.storage.saveConfig(self.configPath, self.toJSON());
        self.lastSavedAt = new Date();
        self.isDirty = false;
      }

      self.setLoading(false);
    } catch (error: any) {
      self.setError(`Failed to save configuration: ${error.message}`);
    }
  }),

  /**
   * Reset to default configuration
   */
  resetToDefaults() {
    self.config = createConfig();
    self.markDirty();
  },

  /**
   * Import configuration
   */
  importConfig(config: any) {
    try {
      self.config = ConfigModel.create(config);
      self.markDirty();
    } catch (error: any) {
      self.setError(`Invalid configuration: ${error.message}`);
    }
  },

  /**
   * Export configuration
   */
  exportConfig() {
    return self.toJSON();
  },

  // AI Configuration Actions
  setProvider(provider: 'openai' | 'ollama') {
    self.config.ai.setProvider(provider);
    self.markDirty();
  },

  toggleProvider() {
    const newProvider = self.config.ai.provider === 'openai' ? 'ollama' : 'openai';
    this.setProvider(newProvider);
  },

  setModel(model: string) {
    self.config.ai.setModel(model);
    self.markDirty();
  },

  setApiKey(key: string) {
    self.config.ai.setApiKey(key);
    self.markDirty();
  },

  setBaseUrl(url: string) {
    self.config.ai.setBaseUrl(url);
    self.markDirty();
  },

  setReasoningModel(model: string) {
    self.config.ai.setReasoningModel(model);
    self.markDirty();
  },

  setGuidanceModel(model: string) {
    self.config.ai.setGuidanceModel(model);
    self.markDirty();
  },

  setExecutionModel(model: string) {
    self.config.ai.setExecutionModel(model);
    self.markDirty();
  },

  // Shell Configuration Actions
  toggleDangerousCommands() {
    self.config.shell.toggleDangerous();
    self.markDirty();
  },

  setAllowDangerous(allow: boolean) {
    self.config.shell.setAllowDangerous(allow);
    self.markDirty();
  },

  addToAllowlist(command: string) {
    self.config.shell.addToAllowlist(command);
    self.markDirty();
  },

  removeFromAllowlist(command: string) {
    self.config.shell.removeFromAllowlist(command);
    self.markDirty();
  },

  // Audio Configuration Actions
  toggleAudioCapture() {
    self.config.audio.toggleCapture();
    self.markDirty();
  },

  setAudioCaptureEnabled(enabled: boolean) {
    self.config.audio.setCaptureEnabled(enabled);
    self.markDirty();
  },

  setSTTProvider(provider: 'openai' | 'whisper') {
    self.config.audio.setSTTProvider(provider);
    self.markDirty();
  },

  setWhisperCommand(command: string) {
    self.config.audio.whisper.setCommand(command);
    self.markDirty();
  },

  setWhisperModel(model: string) {
    self.config.audio.whisper.setModel(model);
    self.markDirty();
  },

  setWhisperLanguage(language: string | undefined) {
    self.config.audio.whisper.setLanguage(language);
    self.markDirty();
  },

  // Memory Configuration Actions
  toggleMemory() {
    self.config.memory.toggleEnabled();
    self.markDirty();
  },

  setMemoryEnabled(enabled: boolean) {
    self.config.memory.setEnabled(enabled);
    self.markDirty();
  },

  setMemoryUserId(userId: string) {
    self.config.memory.setUserId(userId);
    self.markDirty();
  },

  setMemoryMaxEntries(max: number) {
    self.config.memory.setMaxEntries(max);
    self.markDirty();
  },

  setMemoryStorageDir(dir: string) {
    self.config.memory.setStorageDir(dir);
    self.markDirty();
  },

  setMemoryEmbeddingModel(model: string) {
    self.config.memory.setEmbeddingModel(model);
    self.markDirty();
  },

  // Reasoning Configuration Actions
  setReasoningEffort(effort: 'auto' | 'minimal' | 'low' | 'medium' | 'high') {
    self.config.loops.reasoning.setEffort(effort);
    self.markDirty();
  },

  setReasoningSummary(summary: 'auto' | 'concise' | 'detailed') {
    self.config.loops.reasoning.setSummary(summary);
    self.markDirty();
  },

  // Thinking Configuration Actions
  toggleThinking() {
    self.config.loops.thinking.toggleEnabled();
    self.markDirty();
  },

  setThinkingEnabled(enabled: boolean) {
    self.config.loops.thinking.setEnabled(enabled);
    self.markDirty();
  },

  setThinkingVerbosity(verbosity: 'low' | 'medium' | 'high') {
    self.config.loops.thinking.setVerbosity(verbosity);
    self.markDirty();
  },

  // Linger Configuration Actions
  toggleLinger() {
    self.config.linger.toggleEnabled();
    self.markDirty();
  },

  setLingerEnabled(enabled: boolean) {
    self.config.linger.setEnabled(enabled);
    self.markDirty();
  },

  setLingerBehavior(behavior: string) {
    self.config.linger.setBehavior(behavior);
    self.markDirty();
  },

  setLingerInterval(seconds: number) {
    self.config.linger.setMinInterval(seconds);
    self.markDirty();
  },

  // Tools Configuration Actions
  addToolRequiresApproval(toolName: string) {
    self.config.tools.addRequireApproval(toolName);
    self.markDirty();
  },

  removeToolRequiresApproval(toolName: string) {
    self.config.tools.removeRequireApproval(toolName);
    self.markDirty();
  },

  toggleToolApproval(toolName: string) {
    self.config.tools.toggleToolApproval(toolName);
    self.markDirty();
  },

  // Panel Configuration Actions
  toggleTodoShowCompleted() {
    self.config.panel.toggleShowCompleted();
    self.markDirty();
  },

  setTodoShowCompleted(show: boolean) {
    self.config.panel.setShowCompleted(show);
    self.markDirty();
  },

  setPanelMaxItems(max: number) {
    self.config.panel.setMaxItems(max);
    self.markDirty();
  },

  /**
   * Apply a configuration preset
   */
  applyPreset(preset: 'minimal' | 'balanced' | 'advanced') {
    switch (preset) {
      case 'minimal':
        self.config.memory.setEnabled(false);
        self.config.linger.setEnabled(false);
        self.config.loops.thinking.setEnabled(false);
        self.config.loops.reasoning.setEffort('minimal');
        self.config.shell.setAllowDangerous(false);
        break;

      case 'balanced':
        self.config.memory.setEnabled(true);
        self.config.linger.setEnabled(false);
        self.config.loops.thinking.setEnabled(false);
        self.config.loops.reasoning.setEffort('auto');
        self.config.shell.setAllowDangerous(false);
        break;

      case 'advanced':
        self.config.memory.setEnabled(true);
        self.config.linger.setEnabled(true);
        self.config.loops.thinking.setEnabled(true);
        self.config.loops.reasoning.setEffort('high');
        self.config.shell.setAllowDangerous(true);
        break;
    }
    self.markDirty();
  },

  /**
   * Validate and fix configuration
   */
  validateAndFix() {
    const isValid = self.config.validate();

    if (!isValid) {
      // Apply fixes based on validation errors
      const errors = self.config.validationErrors;

      for (const error of errors) {
        if (error.includes('API key')) {
          // Switch to Ollama if OpenAI API key is missing
          self.config.ai.setProvider('ollama');
        }

        if (error.includes('Memory max entries')) {
          self.config.memory.setMaxEntries(100);
        }

        if (error.includes('Linger interval')) {
          self.config.linger.setMinInterval(30);
        }
      }

      self.markDirty();
    }

    return self.config.validate();
  }
}));

// Type exports
export interface IConfigStore extends Instance<typeof ConfigStore> {}
export interface IConfigStoreSnapshot extends SnapshotIn<typeof ConfigStore> {}

// Factory function
export function createConfigStore(): IConfigStore {
  return ConfigStore.create({});
}