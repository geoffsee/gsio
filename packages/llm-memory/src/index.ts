import { Message, MemoryEntry, RecallOptions, MemoryConfig, SimilarityResult } from './types';
import { UnstorageAdapter } from './store';

export default class LLMMemory {
  private adapter: UnstorageAdapter;
  private config: Required<MemoryConfig>;

  constructor(config: MemoryConfig) {
    this.config = {
      storage: config.storage,
      prefix: config.prefix ?? 'llm_memory:',
      maxEntries: config.maxEntries ?? 1000,
      compressionRatio: config.compressionRatio ?? 0.1,
      embeddingDimensions: config.embeddingDimensions ?? 384
    };
    this.adapter = new UnstorageAdapter(this.config.storage, this.config.prefix);
  }

  async memorize(messages: Message[], userId: string): Promise<void> {
    if (!messages.length) return;

    const conversationText = this.messagesToText(messages);
    const summary = await this.compress(conversationText);
    const keywords = this.extractKeywords(conversationText);
    const embedding = await this.generateEmbedding(summary);

    const entry: MemoryEntry = {
      id: this.generateId(userId, Date.now()),
      embedding,
      summary,
      keywords,
      timestamp: Date.now(),
      importance: this.calculateImportance(messages),
      raw: conversationText.length < 500 ? conversationText : undefined
    };

    await this.adapter.set(entry.id, entry);
    await this.pruneOldEntries(userId);
  }

  async recall(currentMessages: Message[], options: RecallOptions = {}): Promise<string> {
    const opts = {
      maxTokens: options.maxTokens ?? 500,
      topK: options.topK ?? 3,
      minSimilarity: options.minSimilarity ?? 0.5,
      includeRecent: options.includeRecent ?? true,
      ...options
    };

    const query = this.messagesToText(currentMessages.slice(-2));
    const queryEmbedding = await this.generateEmbedding(query);

    const userId = this.extractUserId(currentMessages);
    if (!userId) return '';

    const entries = await this.getAllEntries(userId);
    const similarities = entries.map(entry => ({
      entry,
      score: this.cosineSimilarity(queryEmbedding, entry.embedding)
    }));

    const relevant = similarities
      .filter(result => result.score >= opts.minSimilarity)
      .sort((a, b) => {
        const scoreWeight = 0.7;
        const recencyWeight = 0.2;
        const importanceWeight = 0.1;

        const aScore = (a.score * scoreWeight) +
                      (this.recencyScore(a.entry.timestamp) * recencyWeight) +
                      (a.entry.importance * importanceWeight);

        const bScore = (b.score * scoreWeight) +
                      (this.recencyScore(b.entry.timestamp) * recencyWeight) +
                      (b.entry.importance * importanceWeight);

        return bScore - aScore;
      })
      .slice(0, opts.topK);

    if (!relevant.length) return '';

    return this.buildContext(relevant, opts.maxTokens);
  }

  async search(query: string, userId: string): Promise<MemoryEntry[]> {
    const queryEmbedding = await this.generateEmbedding(query);
    const entries = await this.getAllEntries(userId);

    return entries
      .map(entry => ({
        entry,
        score: this.cosineSimilarity(queryEmbedding, entry.embedding)
      }))
      .filter(result => result.score > 0.6)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(result => result.entry);
  }

  async optimize(userId: string): Promise<void> {
    const entries = await this.getAllEntries(userId);
    const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);

    const toCompress = entries.filter(entry =>
      entry.timestamp < cutoff && entry.raw
    );

    for (const entry of toCompress) {
      entry.raw = undefined;
      await this.adapter.set(entry.id, entry);
    }
  }

  async clear(userId: string): Promise<void> {
    const keys = await this.adapter.list(userId);
    await Promise.all(keys.map(key => this.adapter.delete(key)));
  }

  private messagesToText(messages: Message[]): string {
    return messages
      .map(msg => `${msg.role}: ${msg.content}`)
      .join('\n');
  }

  private async compress(text: string): Promise<string> {
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
    const targetLength = Math.max(
      Math.floor(sentences.length * this.config.compressionRatio),
      1
    );

    const important = sentences
      .map(sentence => ({
        text: sentence.trim(),
        score: this.calculateSentenceImportance(sentence)
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, targetLength)
      .map(item => item.text);

    return important.join('. ') + '.';
  }

  private calculateSentenceImportance(sentence: string): number {
    const keywords = ['decided', 'important', 'remember', 'key', 'critical', 'note'];
    const score = keywords.reduce((acc, keyword) =>
      acc + (sentence.toLowerCase().includes(keyword) ? 1 : 0), 0
    );
    return score + Math.log(sentence.length) * 0.1;
  }

  private extractKeywords(text: string): string[] {
    const words = text.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 3);

    const frequency: Record<string, number> = {};
    words.forEach(word => {
      frequency[word] = (frequency[word] || 0) + 1;
    });

    return Object.entries(frequency)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10)
      .map(([word]) => word);
  }

  private async generateEmbedding(text: string): Promise<Float32Array> {
    const normalized = text.toLowerCase().replace(/[^\w\s]/g, ' ');
    const words = normalized.split(/\s+/).filter(w => w.length > 0);

    const embedding = new Float32Array(this.config.embeddingDimensions);

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const hash = this.simpleHash(word);

      for (let j = 0; j < this.config.embeddingDimensions; j++) {
        const index = (hash + j) % this.config.embeddingDimensions;
        embedding[index] += Math.sin(hash * j * 0.01) * (1 / Math.sqrt(words.length));
      }
    }

    const norm = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    if (norm > 0) {
      for (let i = 0; i < embedding.length; i++) {
        embedding[i] /= norm;
      }
    }

    return embedding;
  }

  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const norm = Math.sqrt(normA) * Math.sqrt(normB);
    return norm > 0 ? dotProduct / norm : 0;
  }

  private calculateImportance(messages: Message[]): number {
    const factors = [
      messages.length > 5 ? 0.3 : 0.1,
      messages.some(m => m.content.length > 200) ? 0.2 : 0.1,
      messages.some(m => /\b(help|error|issue|problem)\b/i.test(m.content)) ? 0.3 : 0.1
    ];
    return Math.min(factors.reduce((sum, factor) => sum + factor, 0), 1);
  }

  private generateId(userId: string, timestamp: number): string {
    return `${userId}:${timestamp}:${Math.random().toString(36).substr(2, 9)}`;
  }

  private extractUserId(messages: Message[]): string {
    return 'default_user';
  }

  private recencyScore(timestamp: number): number {
    const age = Date.now() - timestamp;
    const maxAge = 30 * 24 * 60 * 60 * 1000;
    return Math.max(0, 1 - (age / maxAge));
  }

  private async getAllEntries(userId: string): Promise<MemoryEntry[]> {
    const keys = await this.adapter.list(userId);
    const entries = await Promise.all(
      keys.map(key => this.adapter.get(key))
    );
    return entries.filter((entry): entry is MemoryEntry => entry !== null);
  }

  private buildContext(results: SimilarityResult[], maxTokens: number): string {
    const summaries = results.map(r => r.entry.summary);
    let context = 'Previous context: ';
    let tokenCount = context.length / 4;

    for (const summary of summaries) {
      const summaryTokens = summary.length / 4;
      if (tokenCount + summaryTokens > maxTokens) break;

      context += summary + '; ';
      tokenCount += summaryTokens;
    }

    return context.trim();
  }

  private async pruneOldEntries(userId: string): Promise<void> {
    const entries = await this.getAllEntries(userId);
    if (entries.length <= this.config.maxEntries) return;

    const sorted = entries.sort((a, b) =>
      (b.importance * 0.6 + this.recencyScore(b.timestamp) * 0.4) -
      (a.importance * 0.6 + this.recencyScore(a.timestamp) * 0.4)
    );

    const toDelete = sorted.slice(this.config.maxEntries);
    await Promise.all(toDelete.map(entry => this.adapter.delete(entry.id)));
  }
}

export * from './types';
export { UnstorageAdapter } from './store';
