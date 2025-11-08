import { flow, getEnv, Instance, SnapshotIn, types, cast } from "mobx-state-tree";
import { prefixStorage, type Storage } from "unstorage";

type MemoryEnvironment = {
  storage: Storage;
};

type CreateMemorySystemConfig = {
  storage: Storage;
  prefix?: string;
  maxEntries?: number;
  compressionRatio?: number;
  embeddingDimensions?: number;
};

const MessageModel = types.model("MemoryMessage", {
  role: types.enumeration("MemoryMessageRole", ["user", "assistant", "system"]),
  content: types.string,
  modelId: types.maybeNull(types.string)
});

const MemoryConfigModel = types.model("MemoryConfig", {
  prefix: types.string,
  maxEntries: types.number,
  compressionRatio: types.number,
  embeddingDimensions: types.number
});

const MemoryEntryModel = types
  .model("MemoryEntry", {
    id: types.identifier,
    userId: types.string,
    summary: types.string,
    keywords: types.array(types.string),
    timestamp: types.number,
    importance: types.number,
    embedding: types.array(types.number),
    raw: types.maybe(types.string)
  })
  .views((self) => ({
    get recencyScore(): number {
      const age = Date.now() - self.timestamp;
      const maxAge = 30 * 24 * 60 * 60 * 1000;
      return Math.max(0, 1 - age / maxAge);
    }
  }));

const MemorySystemModel = types
  .model("MemorySystem", {
    config: MemoryConfigModel,
    entries: types.map(MemoryEntryModel),
    status: types.enumeration("MemoryStatus", ["idle", "loading", "ready", "error"]),
    lastRecall: types.maybeNull(types.string),
    lastError: types.maybeNull(types.string)
  })
  .volatile(() => ({
    adapter: undefined as MemoryStorage | undefined,
    loadedUsers: new Set<string>()
  }))
  .actions((self) => {
    function afterCreate() {
      const env = getEnv<MemoryEnvironment>(self);
      if (!env?.storage) {
        throw new Error("MemorySystem requires a storage instance in the environment");
      }
      self.adapter = new MemoryStorage(env.storage, self.config.prefix);
    }

    const loadEntries = flow(function* loadEntries(userId: string) {
      if (!self.adapter || !userId || self.loadedUsers.has(userId)) return;
      self.status = "loading";
      try {
        const snapshots: MemoryEntrySnapshotIn[] = yield self.adapter.readAll(userId);
        removeUserEntries(userId);
        for (const entry of snapshots) {
          self.entries.set(entry.id, cast(entry));
        }
        self.loadedUsers.add(userId);
        self.status = "ready";
        self.lastError = null;
      } catch (error) {
        self.status = "error";
        self.lastError = formatError(error);
      }
    });

    const memorize = flow(function* memorize(messages: MemoryMessage[], userId: string) {
      if (!self.adapter || !messages.length || !userId) return;
      yield loadEntries(userId);
      const conversation = messagesToText(messages);
      if (!conversation.trim()) return;

      const entry: MemoryEntrySnapshotIn = {
        id: generateId(userId),
        userId,
        summary: compressText(conversation, self.config.compressionRatio),
        keywords: extractKeywords(conversation),
        timestamp: Date.now(),
        importance: calculateImportance(messages),
        embedding: generateEmbedding(conversation, self.config.embeddingDimensions),
        raw: conversation.length < 500 ? conversation : undefined
      };

      self.entries.set(entry.id, cast(entry));
      yield self.adapter.save(entry);
      yield pruneUserEntries(userId);
    });

    const recall = flow(function* recall(messages: MemoryMessage[], options: RecallOptions = {}) {
      const userId = options.userId ?? "default_user";
      if (!userId || !messages.length) return "";

      yield loadEntries(userId);
      const relevantEntries = userEntries(userId);
      if (!relevantEntries.length) return "";

      const query = messagesToText(messages.slice(-2));
      if (!query.trim()) return "";

      const queryEmbedding = generateEmbedding(query, self.config.embeddingDimensions);
      const ranked = relevantEntries
        .map((entry) => ({
          entry,
          score: cosineSimilarity(queryEmbedding, entry.embedding),
          recency: entry.recencyScore
        }))
        .filter((result) => result.score >= (options.minSimilarity ?? 0.5))
        .sort((a, b) => {
          const scoreWeight = 0.7;
          const recencyWeight = options.includeRecent === false ? 0 : 0.2;
          const importanceWeight = 0.1;
          const aScore = a.score * scoreWeight + a.recency * recencyWeight + a.entry.importance * importanceWeight;
          const bScore = b.score * scoreWeight + b.recency * recencyWeight + b.entry.importance * importanceWeight;
          return bScore - aScore;
        })
        .slice(0, options.topK ?? 3);

      if (!ranked.length) return "";

      const context = buildContext(ranked.map((r) => r.entry.summary), options.maxTokens ?? 500);
      self.lastRecall = context;
      return context;
    });

    const search = flow(function* search(query: string, userId: string) {
      if (!self.adapter || !userId || !query.trim()) return [] as MemoryEntrySnapshotIn[];
      yield loadEntries(userId);
      const relevantEntries = userEntries(userId);
      if (!relevantEntries.length) return [] as MemoryEntrySnapshotIn[];

      const queryEmbedding = generateEmbedding(query, self.config.embeddingDimensions);
      return relevantEntries
        .map((entry) => ({ entry, score: cosineSimilarity(queryEmbedding, entry.embedding) }))
        .filter((result) => result.score > 0.6)
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)
        .map((result) => toSnapshot(result.entry));
    });

    const optimize = flow(function* optimize(userId: string) {
      if (!self.adapter || !userId) return;
      yield loadEntries(userId);
      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const outdated = userEntries(userId).filter((entry) => entry.timestamp < cutoff && entry.raw);
      for (const entry of outdated) {
        entry.raw = undefined;
        yield self.adapter.save(toSnapshot(entry));
      }
    });

    const clear = flow(function* clear(userId: string) {
      if (!self.adapter || !userId) return;
      yield self.adapter.clearUser(userId);
      removeUserEntries(userId);
      self.loadedUsers.delete(userId);
    });

    const pruneUserEntries = flow(function* pruneUserEntries(userId: string) {
      const entries = userEntries(userId);
      if (entries.length <= self.config.maxEntries) return;
      const ranked = entries.slice().sort((a, b) => {
        const aScore = a.importance * 0.6 + a.recencyScore * 0.4;
        const bScore = b.importance * 0.6 + b.recencyScore * 0.4;
        return aScore - bScore;
      });
      const overflow = ranked.length - self.config.maxEntries;
      const toDrop = ranked.slice(0, overflow);
      for (const entry of toDrop) {
        self.entries.delete(entry.id);
        if (self.adapter) {
          yield self.adapter.remove(entry.id);
        }
      }
    });

    function userEntries(userId: string): Instance<typeof MemoryEntryModel>[] {
      return Array.from(self.entries.values()).filter((entry) => entry.userId === userId);
    }

    function removeUserEntries(userId: string) {
      for (const entry of userEntries(userId)) {
        self.entries.delete(entry.id);
      }
    }

    return { afterCreate, loadEntries, memorize, recall, search, optimize, clear };
  });

export type MemoryMessage = SnapshotIn<typeof MessageModel>;
export type MemoryEntrySnapshotIn = SnapshotIn<typeof MemoryEntryModel>;
export type MemoryEntryInstance = Instance<typeof MemoryEntryModel>;
export type MemorySystemInstance = Instance<typeof MemorySystemModel>;
export type RecallOptions = {
  userId?: string;
  maxTokens?: number;
  topK?: number;
  minSimilarity?: number;
  includeRecent?: boolean;
};

class MemoryStorage {
  private storage: Storage<MemoryEntrySnapshotIn>;

  constructor(storage: Storage, prefix: string) {
    this.storage = prefix
      ? prefixStorage<MemoryEntrySnapshotIn>(storage, prefix)
      : (storage as Storage<MemoryEntrySnapshotIn>);
  }

  async save(entry: MemoryEntrySnapshotIn): Promise<void> {
    await this.storage.setItem(entry.id, entry);
  }

  async remove(id: string): Promise<void> {
    await this.storage.removeItem(id);
  }

  async readAll(userId: string): Promise<MemoryEntrySnapshotIn[]> {
    const keys = await this.storage.getKeys(`${userId}:`);
    const entries = await Promise.all(keys.map((key) => this.storage.getItem<MemoryEntrySnapshotIn>(key)));
    return entries.filter((entry): entry is MemoryEntrySnapshotIn => Boolean(entry));
  }

  async clearUser(userId: string): Promise<void> {
    const keys = await this.storage.getKeys(`${userId}:`);
    await Promise.all(keys.map((key) => this.storage.removeItem(key)));
  }
}

export function createMemorySystem(config: CreateMemorySystemConfig): MemorySystemInstance {
  const { storage, prefix = "llm_memory:mst", maxEntries = 1000, compressionRatio = 0.15, embeddingDimensions = 384 } = config;
  return MemorySystemModel.create(
    {
      config: { prefix, maxEntries, compressionRatio, embeddingDimensions },
      entries: {},
      status: "idle",
      lastRecall: null,
      lastError: null
    },
    { storage }
  );
}

export { MemorySystemModel, MemoryEntryModel, MessageModel };

function messagesToText(messages: MemoryMessage[]): string {
  return messages.map((msg) => `${msg.role}: ${msg.content}`).join("\n");
}

function compressText(text: string, ratio: number): string {
  const sentences = text.split(/[.!?]+/).map((sentence) => sentence.trim()).filter((sentence) => sentence.length > 0);
  if (!sentences.length) return text;
  const target = Math.max(1, Math.floor(sentences.length * ratio));
  const ranked = sentences
    .map((sentence) => ({ sentence, score: calculateSentenceImportance(sentence) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, target)
    .map((item) => item.sentence);
  return ranked.join(". ") + ".";
}

function calculateSentenceImportance(sentence: string): number {
  const keywords = ["decided", "important", "remember", "key", "critical", "note"];
  const keywordHits = keywords.reduce((total, keyword) => total + (sentence.toLowerCase().includes(keyword) ? 1 : 0), 0);
  return keywordHits + Math.log(Math.max(sentence.length, 1)) * 0.1;
}

function extractKeywords(text: string): string[] {
  const frequency: Record<string, number> = {};
  text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter((word) => word.length > 3)
    .forEach((word) => {
      frequency[word] = (frequency[word] || 0) + 1;
    });
  return Object.entries(frequency)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([word]) => word);
}

function generateEmbedding(text: string, dimensions: number): number[] {
  const normalized = text.toLowerCase().replace(/[^\w\s]/g, " ");
  const words = normalized.split(/\s+/).filter(Boolean);
  const vector = new Array(dimensions).fill(0);

  for (let i = 0; i < words.length; i++) {
    const hash = simpleHash(words[i]);
    for (let j = 0; j < dimensions; j++) {
      const index = (hash + j) % dimensions;
      vector[index] += Math.sin(hash * (j + 1) * 0.01) * (1 / Math.sqrt(words.length));
    }
  }

  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return norm === 0 ? vector : vector.map((value) => value / norm);
}

function simpleHash(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dot / denominator;
}

function calculateImportance(messages: MemoryMessage[]): number {
  const factors = [
    messages.length > 5 ? 0.3 : 0.1,
    messages.some((message) => message.content.length > 200) ? 0.2 : 0.1,
    messages.some((message) => /\b(help|error|issue|problem)\b/i.test(message.content)) ? 0.3 : 0.1
  ];
  return Math.min(factors.reduce((sum, value) => sum + value, 0), 1);
}

function buildContext(summaries: string[], maxTokens: number): string {
  let context = "Previous context: ";
  let tokens = context.length / 4;
  for (const summary of summaries) {
    const summaryTokens = summary.length / 4;
    if (tokens + summaryTokens > maxTokens) break;
    context += summary + "; ";
    tokens += summaryTokens;
  }
  return context.trim();
}

function generateId(userId: string): string {
  return `${userId}:${Date.now()}:${Math.random().toString(36).slice(2, 9)}`;
}

function toSnapshot(entry: Instance<typeof MemoryEntryModel>): MemoryEntrySnapshotIn {
  return {
    id: entry.id,
    userId: entry.userId,
    summary: entry.summary,
    keywords: entry.keywords.slice(),
    timestamp: entry.timestamp,
    importance: entry.importance,
    embedding: entry.embedding.slice(),
    raw: entry.raw
  };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
