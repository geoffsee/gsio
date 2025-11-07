/**
 * Service interfaces for dependency injection
 */

import { IMessage } from '../../models/MessageModel';
import { ITodo } from '../../models/TodoModel';
import { IMemoryEntry } from '../../models/MemoryModel';
import { IResult, IStreamEvent, ICaptureMetrics } from '../../models/base/types';

/**
 * Storage service for persisting data
 */
export interface IStorageService {
  // Config operations
  loadConfig(path: string): Promise<any>;
  saveConfig(path: string, config: any): Promise<void>;

  // Todo operations
  loadTodos(): Promise<{ lastId: number; items: any[] } | null>;
  saveTodos(data: { lastId: number; items: any[] }): Promise<void>;

  // Generic file operations
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
}

/**
 * Memory service for semantic memory operations
 */
export interface IMemoryService {
  // Initialization
  initialize(userId: string, storageDir: string): Promise<void>;

  // Embedding operations
  createEmbedding(text: string): Promise<Float32Array>;

  // Storage operations
  store(entry: IMemoryEntry): Promise<void>;
  search(query: string, options?: {
    maxResults?: number;
    threshold?: number;
    userId?: string;
  }): Promise<IMemoryEntry[]>;

  // Management
  getCount(): Promise<number>;
  clear(): Promise<void>;
  compact(): Promise<void>;
}

/**
 * Audio capture service
 */
export interface IAudioService {
  // Capture control
  startCapture(): Promise<void>;
  stopCapture(): Promise<void>;
  isCapturing(): boolean;

  // Callbacks
  onTranscript?: (text: string) => void;
  onError?: (error: string) => void;
  onMetrics?: (metrics: ICaptureMetrics) => void;

  // Transcription
  transcribe(audioBuffer: Buffer): Promise<string>;
}

/**
 * Agent service for AI operations
 */
export interface IAgentService {
  // Chat operations
  streamChat(
    messages: Array<{ role: string; content: string }>,
    options?: {
      model?: string;
      temperature?: number;
      maxTokens?: number;
      onDelta?: (delta: string) => void;
      onToolCall?: (tool: any) => void;
    }
  ): Promise<string>;

  // Completion operations
  complete(
    prompt: string,
    options?: {
      model?: string;
      temperature?: number;
      maxTokens?: number;
    }
  ): Promise<string>;

  // Embedding operations
  createEmbedding(text: string, model?: string): Promise<Float32Array>;

  // Model management
  listModels(): Promise<string[]>;
  getModelInfo(model: string): Promise<any>;
}

/**
 * Event service for pub/sub
 */
export interface IEventService {
  // Event emission
  emit(event: string, data?: any): void;

  // Event subscription
  on(event: string, handler: (data?: any) => void): void;
  off(event: string, handler: (data?: any) => void): void;
  once(event: string, handler: (data?: any) => void): void;

  // Clear all listeners
  removeAllListeners(event?: string): void;
}

/**
 * Logger service
 */
export interface ILoggerService {
  debug(message: string, ...args: any[]): void;
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;

  // Structured logging
  log(level: 'debug' | 'info' | 'warn' | 'error', message: string, metadata?: any): void;
}

/**
 * Shell service for command execution
 */
export interface IShellService {
  // Command execution
  execute(command: string, options?: {
    cwd?: string;
    env?: Record<string, string>;
    timeout?: number;
  }): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }>;

  // Validation
  isCommandAllowed(command: string): boolean;
  sanitizeCommand(command: string): string;
}

/**
 * Notification service
 */
export interface INotificationService {
  // Show notifications
  notify(title: string, message: string, type?: 'info' | 'success' | 'warning' | 'error'): void;

  // Toast notifications
  toast(message: string, duration?: number): void;
}

/**
 * Clipboard service
 */
export interface IClipboardService {
  read(): Promise<string>;
  write(text: string): Promise<void>;
  clear(): Promise<void>;
}

/**
 * All services combined
 */
export interface IServices {
  storage?: IStorageService;
  memory?: IMemoryService;
  audio?: IAudioService;
  agent?: IAgentService;
  event?: IEventService;
  logger?: ILoggerService;
  shell?: IShellService;
  notification?: INotificationService;
  clipboard?: IClipboardService;
}

/**
 * Service provider interface
 */
export interface IServiceProvider {
  get<T extends keyof IServices>(service: T): IServices[T] | undefined;
  register<T extends keyof IServices>(service: T, implementation: IServices[T]): void;
  unregister<T extends keyof IServices>(service: T): void;
  has<T extends keyof IServices>(service: T): boolean;
}

/**
 * Factory for creating services
 */
export interface IServiceFactory {
  createStorageService(options?: any): IStorageService;
  createMemoryService(options?: any): IMemoryService;
  createAudioService(options?: any): IAudioService;
  createAgentService(options?: any): IAgentService;
  createEventService(options?: any): IEventService;
  createLoggerService(options?: any): ILoggerService;
  createShellService(options?: any): IShellService;
  createNotificationService(options?: any): INotificationService;
  createClipboardService(options?: any): IClipboardService;
}