/**
 * Mock services for testing
 */

import {
  IStorageService,
  IMemoryService,
  IAudioService,
  IAgentService,
  IEventService,
  ILoggerService,
  IShellService,
  INotificationService,
  IClipboardService
} from '../interfaces';
import { IMemoryEntry } from '../../models/MemoryModel';
import { ICaptureMetrics } from '../../models/base/types';

/**
 * Mock storage service
 */
export class MockStorageService implements IStorageService {
  private storage = new Map<string, any>();

  async loadConfig(path: string): Promise<any> {
    return this.storage.get(`config:${path}`) || null;
  }

  async saveConfig(path: string, config: any): Promise<void> {
    this.storage.set(`config:${path}`, config);
  }

  async loadTodos(): Promise<{ lastId: number; items: any[] } | null> {
    return this.storage.get('todos') || null;
  }

  async saveTodos(data: { lastId: number; items: any[] }): Promise<void> {
    this.storage.set('todos', data);
  }

  async readFile(path: string): Promise<string> {
    const content = this.storage.get(`file:${path}`);
    if (!content) {
      throw new Error(`File not found: ${path}`);
    }
    return content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.storage.set(`file:${path}`, content);
  }

  async exists(path: string): Promise<boolean> {
    return this.storage.has(`file:${path}`);
  }

  async mkdir(path: string): Promise<void> {
    this.storage.set(`dir:${path}`, true);
  }

  clear() {
    this.storage.clear();
  }
}

/**
 * Mock memory service
 */
export class MockMemoryService implements IMemoryService {
  private entries: IMemoryEntry[] = [];
  private initialized = false;

  async initialize(userId: string, storageDir: string): Promise<void> {
    this.initialized = true;
  }

  async createEmbedding(text: string): Promise<Float32Array> {
    // Create a simple mock embedding
    const embedding = new Float32Array(1536);
    for (let i = 0; i < embedding.length; i++) {
      embedding[i] = Math.random() * 2 - 1;
    }
    return embedding;
  }

  async store(entry: IMemoryEntry): Promise<void> {
    this.entries.push(entry);
  }

  async search(
    query: string,
    options?: {
      maxResults?: number;
      threshold?: number;
      userId?: string;
    }
  ): Promise<IMemoryEntry[]> {
    // Simple mock search - return recent entries
    const maxResults = options?.maxResults || 10;
    return this.entries.slice(-maxResults);
  }

  async getCount(): Promise<number> {
    return this.entries.length;
  }

  async clear(): Promise<void> {
    this.entries = [];
  }

  async compact(): Promise<void> {
    // Mock compaction - remove old entries
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000; // 7 days
    this.entries = this.entries.filter(e => e.createdAt.getTime() > cutoff);
  }
}

/**
 * Mock audio service
 */
export class MockAudioService implements IAudioService {
  private capturing = false;
  public onTranscript?: (text: string) => void;
  public onError?: (error: string) => void;
  public onMetrics?: (metrics: ICaptureMetrics) => void;

  async startCapture(): Promise<void> {
    this.capturing = true;

    // Simulate periodic transcripts
    setTimeout(() => {
      if (this.capturing && this.onTranscript) {
        this.onTranscript('This is a mock transcript');
      }
    }, 1000);
  }

  async stopCapture(): Promise<void> {
    this.capturing = false;
  }

  isCapturing(): boolean {
    return this.capturing;
  }

  async transcribe(audioBuffer: Buffer): Promise<string> {
    return 'Mock transcription of audio';
  }
}

/**
 * Mock agent service
 */
export class MockAgentService implements IAgentService {
  async streamChat(
    messages: Array<{ role: string; content: string }>,
    options?: {
      model?: string;
      temperature?: number;
      maxTokens?: number;
      onDelta?: (delta: string) => void;
      onToolCall?: (tool: any) => void;
    }
  ): Promise<string> {
    const response = 'This is a mock response from the AI agent.';

    // Simulate streaming
    if (options?.onDelta) {
      const words = response.split(' ');
      for (const word of words) {
        await new Promise(resolve => setTimeout(resolve, 50));
        options.onDelta(word + ' ');
      }
    }

    return response;
  }

  async complete(
    prompt: string,
    options?: {
      model?: string;
      temperature?: number;
      maxTokens?: number;
    }
  ): Promise<string> {
    return `Mock completion for: ${prompt}`;
  }

  async createEmbedding(text: string, model?: string): Promise<Float32Array> {
    const embedding = new Float32Array(1536);
    for (let i = 0; i < embedding.length; i++) {
      embedding[i] = Math.random() * 2 - 1;
    }
    return embedding;
  }

  async listModels(): Promise<string[]> {
    return ['gpt-4o', 'gpt-4o-mini', 'o4-mini'];
  }

  async getModelInfo(model: string): Promise<any> {
    return {
      id: model,
      name: model,
      context_length: 128000,
      capabilities: ['chat', 'completion']
    };
  }
}

/**
 * Mock event service
 */
export class MockEventService implements IEventService {
  private listeners = new Map<string, Set<(data?: any) => void>>();

  emit(event: string, data?: any): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.forEach(handler => handler(data));
    }
  }

  on(event: string, handler: (data?: any) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
  }

  off(event: string, handler: (data?: any) => void): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  once(event: string, handler: (data?: any) => void): void {
    const wrapper = (data?: any) => {
      handler(data);
      this.off(event, wrapper);
    };
    this.on(event, wrapper);
  }

  removeAllListeners(event?: string): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }
}

/**
 * Mock logger service
 */
export class MockLoggerService implements ILoggerService {
  private logs: Array<{ level: string; message: string; args: any[] }> = [];

  debug(message: string, ...args: any[]): void {
    this.logs.push({ level: 'debug', message, args });
  }

  info(message: string, ...args: any[]): void {
    this.logs.push({ level: 'info', message, args });
  }

  warn(message: string, ...args: any[]): void {
    this.logs.push({ level: 'warn', message, args });
  }

  error(message: string, ...args: any[]): void {
    this.logs.push({ level: 'error', message, args });
  }

  log(level: 'debug' | 'info' | 'warn' | 'error', message: string, metadata?: any): void {
    this.logs.push({ level, message, args: metadata ? [metadata] : [] });
  }

  getLogs() {
    return this.logs;
  }

  clear() {
    this.logs = [];
  }
}

/**
 * Mock shell service
 */
export class MockShellService implements IShellService {
  private allowedCommands = ['ls', 'pwd', 'echo'];

  async execute(
    command: string,
    options?: {
      cwd?: string;
      env?: Record<string, string>;
      timeout?: number;
    }
  ): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }> {
    if (!this.isCommandAllowed(command)) {
      return {
        stdout: '',
        stderr: `Command not allowed: ${command}`,
        exitCode: 1
      };
    }

    return {
      stdout: `Mock output for: ${command}`,
      stderr: '',
      exitCode: 0
    };
  }

  isCommandAllowed(command: string): boolean {
    const cmd = command.split(' ')[0];
    return this.allowedCommands.includes(cmd);
  }

  sanitizeCommand(command: string): string {
    // Simple mock sanitization
    return command.replace(/[;&|<>]/g, '');
  }
}

/**
 * Mock notification service
 */
export class MockNotificationService implements INotificationService {
  private notifications: Array<{
    title: string;
    message: string;
    type?: string;
  }> = [];

  notify(
    title: string,
    message: string,
    type?: 'info' | 'success' | 'warning' | 'error'
  ): void {
    this.notifications.push({ title, message, type });
  }

  toast(message: string, duration?: number): void {
    this.notifications.push({
      title: 'Toast',
      message,
      type: 'info'
    });
  }

  getNotifications() {
    return this.notifications;
  }

  clear() {
    this.notifications = [];
  }
}

/**
 * Mock clipboard service
 */
export class MockClipboardService implements IClipboardService {
  private content = '';

  async read(): Promise<string> {
    return this.content;
  }

  async write(text: string): Promise<void> {
    this.content = text;
  }

  async clear(): Promise<void> {
    this.content = '';
  }
}

/**
 * Create all mock services
 */
export function createMockServices() {
  return {
    storage: new MockStorageService(),
    memory: new MockMemoryService(),
    audio: new MockAudioService(),
    agent: new MockAgentService(),
    event: new MockEventService(),
    logger: new MockLoggerService(),
    shell: new MockShellService(),
    notification: new MockNotificationService(),
    clipboard: new MockClipboardService()
  };
}