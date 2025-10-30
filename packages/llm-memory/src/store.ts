import { prefixStorage, type Storage } from 'unstorage';
import { MemoryEntry, StorageAdapter } from './types.js';

type SerializedMemoryEntry = Omit<MemoryEntry, 'embedding'> & { embedding: number[] };

export class UnstorageAdapter implements StorageAdapter {
  private storage: Storage<SerializedMemoryEntry>;

  constructor(storage: Storage, prefix = 'llm_memory:') {
    this.storage = prefix ? prefixStorage<SerializedMemoryEntry>(storage, prefix) : (storage as Storage<SerializedMemoryEntry>);
  }

  async get(key: string): Promise<MemoryEntry | null> {
    try {
      const data = await this.storage.getItem<SerializedMemoryEntry>(key);
      if (!data) return null;
      return this.deserializeEntry(data);
    } catch (error) {
      console.error('Unstorage get error:', error);
      return null;
    }
  }

  async set(key: string, entry: MemoryEntry): Promise<void> {
    try {
      const serialized = this.serializeEntry(entry);
      await this.storage.setItem(key, serialized);
    } catch (error) {
      console.error('Unstorage set error:', error);
      throw error;
    }
  }

  async list(prefix = ''): Promise<string[]> {
    try {
      return await this.storage.getKeys(prefix);
    } catch (error) {
      console.error('Unstorage list error:', error);
      return [];
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.storage.removeItem(key);
    } catch (error) {
      console.error('Unstorage delete error:', error);
    }
  }

  private serializeEntry(entry: MemoryEntry): SerializedMemoryEntry {
    return {
      id: entry.id,
      embedding: Array.from(entry.embedding),
      summary: entry.summary,
      keywords: [...entry.keywords],
      timestamp: entry.timestamp,
      importance: entry.importance,
      raw: entry.raw
    };
  }

  private deserializeEntry(data: SerializedMemoryEntry): MemoryEntry {
    return {
      ...data,
      embedding: new Float32Array(data.embedding)
    };
  }
}
