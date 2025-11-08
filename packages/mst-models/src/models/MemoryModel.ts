/**
 * Memory model for storing embeddings and memories
 */

import { types, Instance, SnapshotIn, SnapshotOut } from 'mobx-state-tree';
import { withIdentifier, withTimestamps, withMetadata, withSerialization } from './base/mixins';

/**
 * Memory entry model for storing embeddings
 */
export const MemoryEntryModel = types.compose(
  'MemoryEntryModel',
  withIdentifier,
  withTimestamps,
  withMetadata,
  withSerialization,
  types.model({
    // Core fields
    summary: types.string,
    keywords: types.optional(types.array(types.string), []),
    importance: types.optional(types.number, 0.5),

    // Embedding stored as array of numbers (will be converted to Float32Array)
    embedding: types.optional(types.array(types.number), []),

    // Raw content (optional)
    raw: types.maybe(types.string),

    // Source information
    source: types.optional(types.string, 'chat'),
    userId: types.optional(types.string, 'default'),

    // Similarity score (computed during recall)
    similarity: types.optional(types.number, 0),

    // Access tracking
    accessCount: types.optional(types.number, 0),
    lastAccessedAt: types.maybe(types.Date)
  })
)
.views((self) => ({
  get embeddingSize() {
    return self.embedding.length;
  },

  get hasEmbedding() {
    return self.embedding.length > 0;
  },

  get hasRawContent() {
    return !!self.raw;
  },

  get keywordCount() {
    return self.keywords.length;
  },

  get isImportant() {
    return self.importance > 0.7;
  },

  get isRecent() {
    const dayAgo = Date.now() - (24 * 60 * 60 * 1000);
    return self.createdAt.getTime() > dayAgo;
  },

  get age() {
    return Date.now() - self.createdAt.getTime();
  },

  get ageInDays() {
    return Math.floor(this.age / (24 * 60 * 60 * 1000));
  },

  get ageInHours() {
    return Math.floor(this.age / (60 * 60 * 1000));
  },

  /**
   * Get embedding as Float32Array for efficient computation
   */
  get embeddingFloat32(): Float32Array {
    return new Float32Array(self.embedding);
  },

  /**
   * Get a preview of the content
   */
  get preview() {
    const content = self.raw || self.summary;
    if (content.length <= 100) {
      return content;
    }
    return content.substring(0, 97) + '...';
  },

  /**
   * Get a formatted display string
   */
  get display() {
    const stars = '⭐'.repeat(Math.floor(self.importance * 5));
    const keywords = self.keywords.slice(0, 3).join(', ');
    return `${stars} ${self.summary} [${keywords}]`;
  }
}))
.actions((self) => ({
  setSummary(summary: string) {
    self.summary = summary;
    self.updateTimestamp();
  },

  setRawContent(raw: string | null) {
    self.raw = raw || undefined;
    self.updateTimestamp();
  },

  setImportance(importance: number) {
    self.importance = Math.max(0, Math.min(1, importance));
    self.updateTimestamp();
  },

  setSimilarity(similarity: number) {
    self.similarity = Math.max(0, Math.min(1, similarity));
  },

  setEmbedding(embedding: number[] | Float32Array) {
    if (embedding instanceof Float32Array) {
      self.embedding = Array.from(embedding);
    } else {
      self.embedding = embedding;
    }
    self.updateTimestamp();
  },

  addKeyword(keyword: string) {
    if (!self.keywords.includes(keyword)) {
      self.keywords.push(keyword);
      self.updateTimestamp();
    }
  },

  removeKeyword(keyword: string) {
    const index = self.keywords.indexOf(keyword);
    if (index !== -1) {
      self.keywords.splice(index, 1);
      self.updateTimestamp();
    }
  },

  setKeywords(keywords: string[]) {
    self.keywords.clear();
    self.keywords.push(...keywords);
    self.updateTimestamp();
  },

  incrementAccess() {
    self.accessCount++;
    self.lastAccessedAt = new Date();
  },

  /**
   * Calculate cosine similarity with another embedding
   */
  cosineSimilarity(otherEmbedding: number[] | Float32Array): number {
    const a = self.embeddingFloat32;
    const b = otherEmbedding instanceof Float32Array
      ? otherEmbedding
      : new Float32Array(otherEmbedding);

    if (a.length !== b.length) {
      throw new Error('Embeddings must have the same dimension');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (normA * normB);
  },

  /**
   * Calculate Euclidean distance with another embedding
   */
  euclideanDistance(otherEmbedding: number[] | Float32Array): number {
    const a = self.embeddingFloat32;
    const b = otherEmbedding instanceof Float32Array
      ? otherEmbedding
      : new Float32Array(otherEmbedding);

    if (a.length !== b.length) {
      throw new Error('Embeddings must have the same dimension');
    }

    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      const diff = a[i] - b[i];
      sum += diff * diff;
    }

    return Math.sqrt(sum);
  },

  /**
   * Update importance based on access patterns
   */
  updateImportance() {
    // Increase importance based on access count
    const accessBoost = Math.min(0.2, self.accessCount * 0.02);

    // Decrease importance based on age
    const ageDecay = Math.min(0.3, self.ageInDays * 0.01);

    const newImportance = self.importance + accessBoost - ageDecay;
    self.importance = Math.max(0, Math.min(1, newImportance));
  },

  clone(): Instance<typeof MemoryEntryModel> {
    return MemoryEntryModel.create({
      summary: self.summary,
      keywords: [...self.keywords],
      importance: self.importance,
      embedding: [...self.embedding],
      raw: self.raw,
      source: self.source,
      userId: self.userId,
      metadata: { ...self.metadata }
    });
  }
}));

/**
 * Auxiliary models for memory operations
 */

/**
 * Memory query model
 */
export const MemoryQuery = types.model('MemoryQuery', {
  query: types.string,
  maxResults: types.optional(types.number, 10),
  threshold: types.optional(types.number, 0.5),
  userId: types.maybe(types.string),
  source: types.maybe(types.string),
  startDate: types.maybe(types.Date),
  endDate: types.maybe(types.Date),
  keywords: types.optional(types.array(types.string), []),
  minImportance: types.optional(types.number, 0)
});

/**
 * Memory statistics model
 */
export const MemoryStats = types.model('MemoryStats', {
  totalEntries: types.number,
  totalSize: types.number, // in bytes
  averageImportance: types.number,
  oldestEntry: types.maybe(types.Date),
  newestEntry: types.maybe(types.Date),
  topKeywords: types.optional(types.array(types.string), []),
  entriesBySource: types.optional(types.map(types.number), {}),
  entriesByUser: types.optional(types.map(types.number), {})
});

// Type exports
export interface IMemoryEntry extends Instance<typeof MemoryEntryModel> {}
export interface IMemoryEntrySnapshot extends SnapshotIn<typeof MemoryEntryModel> {}
export interface IMemoryEntryOutput extends SnapshotOut<typeof MemoryEntryModel> {}
export interface IMemoryQuery extends Instance<typeof MemoryQuery> {}
export interface IMemoryStats extends Instance<typeof MemoryStats> {}

// Factory functions
export function createMemoryEntry(
  summary: string,
  embedding?: number[] | Float32Array,
  keywords?: string[],
  importance?: number
): IMemoryEntry {
  return MemoryEntryModel.create({
    summary,
    embedding: embedding ? (embedding instanceof Float32Array ? Array.from(embedding) : embedding) : [],
    keywords: keywords || [],
    importance: importance || 0.5
  });
}

export function createMemoryQuery(
  query: string,
  options?: Partial<SnapshotIn<typeof MemoryQuery>>
): IMemoryQuery {
  return MemoryQuery.create({
    query,
    ...options
  });
}