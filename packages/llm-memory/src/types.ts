import type { Storage } from 'unstorage';

export interface Message {
  content: string;
  role: 'user' | 'assistant' | 'system';
  modelId?: string;
}

export interface MemoryEntry {
  id: string;
  embedding: Float32Array;
  summary: string;
  keywords: string[];
  timestamp: number;
  importance: number;
  raw?: string;
}

export interface RecallOptions {
  maxTokens?: number;
  topK?: number;
  minSimilarity?: number;
  includeRecent?: boolean;
  userId?: string;
}

export interface MemoryConfig {
  storage: Storage;
  prefix?: string;
  maxEntries?: number;
  compressionRatio?: number;
  embeddingDimensions?: number;
}

export interface StorageAdapter {
  get(key: string): Promise<MemoryEntry | null>;
  set(key: string, entry: MemoryEntry): Promise<void>;
  list(prefix?: string): Promise<string[]>;
  delete(key: string): Promise<void>;
}

export interface SimilarityResult {
  entry: MemoryEntry;
  score: number;
}
