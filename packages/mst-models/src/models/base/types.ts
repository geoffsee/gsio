/**
 * Base types and interfaces for MST models
 */

export type MessageRole = 'user' | 'assistant' | 'system';
export type TodoStatus = 'todo' | 'in_progress' | 'blocked' | 'done';
export type TodoPriority = 1 | 2 | 3 | 4 | 5;
export type Provider = 'openai' | 'ollama';
export type STTProvider = 'openai' | 'whisper';
export type LingerBehavior = 'auto' | 'manual';
export type ReasoningEffort = 'auto' | 'minimal' | 'low' | 'medium' | 'high';
export type ReasoningSummary = 'auto' | 'concise' | 'detailed';
export type ThinkingVerbosity = 'low' | 'medium' | 'high';
export type Phase = 'planning' | 'guidance' | 'execution' | 'idle';
export type InterruptionSource = 'chat' | 'linger';

export interface IMessageMetadata {
  modelId?: string;
  toolCalls?: any[];
  reasoning?: string;
  timestamp?: number;
}

export interface IToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
  result?: any;
}

export interface ICaptureMetrics {
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
}

export interface IRecallOptions {
  maxResults?: number;
  threshold?: number;
  startDate?: Date;
  endDate?: Date;
}

export interface ISerializable {
  toJSON(): any;
}

export interface IIdentifiable {
  id: string | number;
}

export interface ITimestamped {
  createdAt: Date;
  updatedAt: Date;
}

export interface IDeletable {
  deletedAt?: Date;
  isDeleted: boolean;
}

// Service result types
export interface IResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface IStreamEvent {
  type: string;
  data: any;
  timestamp: number;
}

// Configuration interfaces
export interface IAIConfig {
  provider: Provider;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  models: {
    reasoning: string;
    guidance: string;
    execution: string;
  };
}

export interface IShellConfig {
  allowDangerous: boolean;
  extraAllowlist: string[];
}

export interface IAudioConfig {
  captureEnabled: boolean;
  sttProvider: STTProvider;
  whisper: {
    command: string;
    model: string;
    language?: string;
    extraArgs?: string[];
  };
  openaiTranscribeModel?: string;
  openaiBaseUrl?: string;
  openaiApiKey?: string;
}

export interface IMemoryConfig {
  enabled: boolean;
  userId: string;
  maxEntries: number;
  storageDir: string;
  embeddingModel: string;
}

export interface ILoopsConfig {
  reasoning: {
    effort: ReasoningEffort;
    summary: ReasoningSummary;
  };
  thinking: {
    enabled: boolean;
    verbosity: ThinkingVerbosity;
  };
}

export interface ILingerConfig {
  enabled: boolean;
  behavior: string;
  minIntervalSec: number;
}

export interface IToolsConfig {
  requireApproval: string[];
}

export interface IPanelConfig {
  todoShowCompleted: boolean;
  maxItems: number;
}