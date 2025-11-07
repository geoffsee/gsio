/**
 * Root store that combines all application stores
 */

import { types, flow, Instance, SnapshotIn } from 'mobx-state-tree';
import { ChatStore, createChatStore } from './stores/ChatStore';
import { TodoStore, createTodoStore } from './stores/TodoStore';
import { ConfigStore, createConfigStore } from './stores/ConfigStore';
import { AudioStore, createAudioStore } from './stores/AudioStore';
import { IServices, IServiceProvider } from './services/interfaces';

/**
 * Service provider implementation
 */
class ServiceProvider implements IServiceProvider {
  private services: Map<keyof IServices, any> = new Map();

  get<T extends keyof IServices>(service: T): IServices[T] | undefined {
    return this.services.get(service);
  }

  register<T extends keyof IServices>(service: T, implementation: IServices[T]): void {
    this.services.set(service, implementation);
  }

  unregister<T extends keyof IServices>(service: T): void {
    this.services.delete(service);
  }

  has<T extends keyof IServices>(service: T): boolean {
    return this.services.has(service);
  }
}

/**
 * Root Store
 */
export const RootStore = types.model('RootStore', {
  chat: types.optional(ChatStore, {}),
  todos: types.optional(TodoStore, {}),
  config: types.optional(ConfigStore, {}),
  audio: types.optional(AudioStore, {}),
  // Application state
  initialized: types.optional(types.boolean, false),
  version: types.optional(types.string, '1.0.0')
})
.volatile(() => ({
  services: new ServiceProvider() as IServiceProvider
}))
.views((self) => ({
  get isInitialized() {
    return self.initialized;
  },

  get hasApiKey() {
    return self.config.hasApiKey;
  },

  get isConfigValid() {
    return self.config.isValid;
  },

  /**
   * Get application statistics
   */
  get statistics() {
    return {
      messages: self.chat.messageCount,
      todos: self.todos.count,
      activeTodos: self.todos.activeTodos.length,
      completedTodos: self.todos.completedTodos.length,
      audioEnabled: self.audio.enabled,
      memoryEnabled: self.config.memoryEnabled,
      lingerEnabled: self.config.lingerEnabled
    };
  },

  /**
   * Export entire application state
   */
  exportState() {
    return {
      version: self.version,
      chat: self.chat.exportMessages(),
      todos: self.todos.exportTodos(),
      config: self.config.exportConfig(),
      timestamp: new Date().toISOString()
    };
  }
}))
.actions((self) => ({
  /**
   * Register a service
   */
  registerService<T extends keyof IServices>(name: T, service: IServices[T]) {
    self.services.register(name, service);
  },

  /**
   * Unregister a service
   */
  unregisterService<T extends keyof IServices>(name: T) {
    self.services.unregister(name);
  },

  /**
   * Get a service
   */
  getService<T extends keyof IServices>(name: T): IServices[T] | undefined {
    return self.services.get(name);
  },

  /**
   * Initialize the application
   */
  initialize: flow(function* (services?: IServices) {
    try {
      // Register services if provided
      if (services) {
        for (const [name, service] of Object.entries(services)) {
          if (service) {
            self.services.register(name as keyof IServices, service);
          }
        }
      }

      // Load configuration
      yield self.config.load();

      // Load todos
      yield self.todos.load();

      // Initialize audio if enabled
      if (self.config.audioEnabled) {
        self.audio.setEnabled(true);
      }

      // Initialize memory if enabled
      if (self.config.memoryEnabled && self.services.has('memory')) {
        const memoryService = self.services.get('memory');
        if (memoryService) {
          yield memoryService.initialize(
            self.config.config.memory.userId,
            self.config.config.memory.storageDir
          );
        }
      }

      self.initialized = true;
    } catch (error: any) {
      console.error('Failed to initialize application:', error);
      throw error;
    }
  }),

  /**
   * Reset the entire application state
   */
  reset: flow(function* () {
    self.chat.clearMessages();
    self.todos.clearAllTodos();
    self.config.resetToDefaults();
    self.audio.reset();
    self.initialized = false;

    // Re-initialize
    yield self.initialize();
  }),

  /**
   * Import application state
   */
  importState: flow(function* (state: any) {
    try {
      if (state.chat) {
        self.chat.importMessages(state.chat);
      }
      if (state.todos) {
        self.todos.importTodos(state.todos);
      }
      if (state.config) {
        self.config.importConfig(state.config);
      }
    } catch (error: any) {
      console.error('Failed to import state:', error);
      throw error;
    }
  }),

  /**
   * Send a message and get response
   */
  sendMessage: flow(function* (content: string) {
    // Add user message
    const userMessage = self.chat.sendUserMessage(content);

    // Check if memory is enabled
    if (self.config.memoryEnabled && self.services.has('memory')) {
      // Store in memory
      const memoryService = self.services.get('memory');
      if (memoryService) {
        // Implementation would go here
      }
    }

    // Get AI response
    if (self.services.has('agent')) {
      const agentService = self.services.get('agent');
      if (agentService) {
        const assistantMessage = self.chat.startStreamingResponse();

        yield agentService.streamChat(
          self.chat.getContextMessages(),
          {
            model: self.config.config.ai.model,
            onDelta: (delta: string) => {
              self.chat.appendStreamDelta(delta);
            }
          }
        );

        self.chat.finishStreaming();
      }
    }
  }),

  /**
   * Process audio transcript
   */
  processTranscript(text: string) {
    self.audio.onTranscript(text);

    // Optionally send as message
    if (text.trim()) {
      self.sendMessage(text);
    }
  },

  /**
   * Handle tool approval
   */
  handleToolApproval: flow(function* (toolName: string, approved: boolean) {
    if (approved) {
      // Execute tool
      if (self.services.has('agent')) {
        // Tool execution logic would go here
      }
    }
  }),

  /**
   * Clean up resources
   */
  cleanup: flow(function* () {
    // Stop audio if capturing
    if (self.audio.isCapturing) {
      yield self.audio.stopCapture();
    }

    // Save todos
    yield self.todos.save();

    // Save config
    yield self.config.save();

    // Clean up services
    const services = ['audio', 'memory', 'agent'] as const;
    for (const service of services) {
      if (self.services.has(service)) {
        const svc = self.services.get(service);
        if (svc && 'cleanup' in svc && typeof svc.cleanup === 'function') {
          yield svc.cleanup();
        }
      }
    }
  })
}));

// Type exports
export interface IRootStore extends Instance<typeof RootStore> {}
export interface IRootStoreSnapshot extends SnapshotIn<typeof RootStore> {}

/**
 * Factory function to create root store with services
 */
export function createRootStore(services?: IServices): IRootStore {
  const store = RootStore.create({});

  // Register services if provided
  if (services) {
    for (const [name, service] of Object.entries(services)) {
      if (service) {
        store.registerService(name as keyof IServices, service);
      }
    }
  }

  return store;
}

/**
 * Create root store with default configuration
 */
export function createDefaultRootStore(): IRootStore {
  return createRootStore();
}