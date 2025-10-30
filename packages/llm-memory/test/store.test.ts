import { describe, it, expect, beforeEach } from 'vitest';
import { UnstorageAdapter } from '../src/store';
import { MemoryEntry } from '../src/types';
import { createMockStorage, createThrowingStorage } from './mocks';

describe('UnstorageAdapter', () => {
  let adapter: UnstorageAdapter;
  let storage = createMockStorage();

  beforeEach(() => {
    storage = createMockStorage();
    adapter = new UnstorageAdapter(storage);
  });

  describe('get/set operations', () => {
    it('stores and retrieves a memory entry', async () => {
      const entry: MemoryEntry = {
        id: 'test-123',
        embedding: new Float32Array([0.1, 0.2, 0.3]),
        summary: 'Test summary',
        keywords: ['test', 'memory'],
        timestamp: Date.now(),
        importance: 0.5,
        raw: 'Raw text content'
      };

      await adapter.set(entry.id, entry);
      const retrieved = await adapter.get(entry.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(entry.id);
      expect(retrieved?.summary).toBe(entry.summary);
      expect(retrieved?.keywords).toEqual(entry.keywords);
      expect(retrieved?.importance).toBe(entry.importance);
      expect(retrieved?.raw).toBe(entry.raw);
      const retrievedEmbedding = Array.from(retrieved?.embedding || []);
      expect(retrievedEmbedding).toHaveLength(3);
      expect(retrievedEmbedding[0]).toBeCloseTo(0.1, 5);
      expect(retrievedEmbedding[1]).toBeCloseTo(0.2, 5);
      expect(retrievedEmbedding[2]).toBeCloseTo(0.3, 5);
    });

    it('returns null for missing entries', async () => {
      const retrieved = await adapter.get('non-existent');
      expect(retrieved).toBeNull();
    });

    it('handles entries without raw content', async () => {
      const entry: MemoryEntry = {
        id: 'test-no-raw',
        embedding: new Float32Array([0.5, 0.5]),
        summary: 'Summary without raw',
        keywords: ['test'],
        timestamp: Date.now(),
        importance: 0.3
      };

      await adapter.set(entry.id, entry);
      const retrieved = await adapter.get(entry.id);

      expect(retrieved?.raw).toBeUndefined();
      expect(retrieved?.summary).toBe(entry.summary);
    });

    it('handles large embeddings', async () => {
      const largeEmbedding = new Float32Array(1024);
      for (let i = 0; i < largeEmbedding.length; i++) {
        largeEmbedding[i] = Math.random();
      }

      const entry: MemoryEntry = {
        id: 'large-embedding',
        embedding: largeEmbedding,
        summary: 'Large embedding test',
        keywords: ['large'],
        timestamp: Date.now(),
        importance: 0.7
      };

      await adapter.set(entry.id, entry);
      const retrieved = await adapter.get(entry.id);

      expect(retrieved?.embedding.length).toBe(largeEmbedding.length);
      expect(Array.from(retrieved?.embedding || [])).toEqual(Array.from(largeEmbedding));
    });
  });

  describe('list operations', () => {
    beforeEach(async () => {
      for (let i = 0; i < 5; i++) {
        const entry: MemoryEntry = {
          id: `user1:${i}`,
          embedding: new Float32Array([i * 0.1]),
          summary: `Summary ${i}`,
          keywords: [`keyword${i}`],
          timestamp: Date.now() + i,
          importance: i * 0.2
        };
        await adapter.set(entry.id, entry);
      }

      for (let i = 0; i < 3; i++) {
        const entry: MemoryEntry = {
          id: `user2:${i}`,
          embedding: new Float32Array([i * 0.2]),
          summary: `Summary ${i}`,
          keywords: [`keyword${i}`],
          timestamp: Date.now() + i,
          importance: i * 0.3
        };
        await adapter.set(entry.id, entry);
      }
    });

    it('lists keys with a given prefix', async () => {
      const user1Keys = await adapter.list('user1');
      expect(user1Keys).toHaveLength(5);
      expect(user1Keys.every(key => key.startsWith('user1'))).toBe(true);

      const user2Keys = await adapter.list('user2');
      expect(user2Keys).toHaveLength(3);
      expect(user2Keys.every(key => key.startsWith('user2'))).toBe(true);
    });

    it('returns empty array for missing prefix', async () => {
      const keys = await adapter.list('non-existent');
      expect(keys).toEqual([]);
    });

    it('returns all keys when prefix omitted', async () => {
      const allKeys = await adapter.list();
      expect(allKeys).toHaveLength(8);
    });
  });

  describe('delete operations', () => {
    it('removes an entry', async () => {
      const entry: MemoryEntry = {
        id: 'to-delete',
        embedding: new Float32Array([0.5]),
        summary: 'To be deleted',
        keywords: ['delete'],
        timestamp: Date.now(),
        importance: 0.5
      };

      await adapter.set(entry.id, entry);
      expect(await adapter.get(entry.id)).not.toBeNull();

      await adapter.delete(entry.id);
      expect(await adapter.get(entry.id)).toBeNull();
    });

    it('ignores deleting unknown keys', async () => {
      await expect(adapter.delete('non-existent')).resolves.toBeUndefined();
    });
  });

  describe('custom prefix', () => {
    it('uses provided prefix for storage keys', async () => {
      const entry: MemoryEntry = {
        id: 'test-custom',
        embedding: new Float32Array([0.7]),
        summary: 'Custom prefix test',
        keywords: ['custom'],
        timestamp: Date.now(),
        importance: 0.6
      };

      const baseStorage = createMockStorage();
      const customAdapter = new UnstorageAdapter(baseStorage, 'custom:');

      await customAdapter.set(entry.id, entry);

      const storedKeys = await baseStorage.getKeys();
      expect(storedKeys).toHaveLength(1);
      expect(storedKeys[0]).toBe('custom:test-custom');

      const listedKeys = await customAdapter.list();
      expect(listedKeys[0]).toBe('test-custom');
    });
  });

  describe('error handling', () => {
    it('handles storage get errors', async () => {
      const errorAdapter = new UnstorageAdapter(
        createThrowingStorage('getItem', new Error('Storage get error'))
      );
      const result = await errorAdapter.get('any-key');
      expect(result).toBeNull();
    });

    it('handles storage list errors', async () => {
      const errorAdapter = new UnstorageAdapter(
        createThrowingStorage('getKeys', new Error('Storage list error'))
      );
      const result = await errorAdapter.list();
      expect(result).toEqual([]);
    });

    it('propagates storage set errors', async () => {
      const errorAdapter = new UnstorageAdapter(
        createThrowingStorage('setItem', new Error('Storage set error'))
      );
      const entry: MemoryEntry = {
        id: 'error-test',
        embedding: new Float32Array([0.1]),
        summary: 'Error test',
        keywords: ['error'],
        timestamp: Date.now(),
        importance: 0.5
      };

      await expect(errorAdapter.set(entry.id, entry)).rejects.toThrow('Storage set error');
    });
  });

  describe('serialization/deserialization', () => {
    it('preserves data during roundtrip', async () => {
      const entry: MemoryEntry = {
        id: 'serialization-test',
        embedding: new Float32Array([0.1, -0.5, 0.99, -0.99]),
        summary: 'Test with special characters: 🎉 "quotes" and \nnewlines',
        keywords: ['test', 'special-chars', '日本語'],
        timestamp: 1234567890123,
        importance: 0.999,
        raw: undefined
      };

      await adapter.set(entry.id, entry);
      const retrieved = await adapter.get(entry.id);

      expect(retrieved?.id).toBe(entry.id);
      expect(retrieved?.summary).toBe(entry.summary);
      expect(retrieved?.keywords).toEqual(entry.keywords);
      expect(retrieved?.timestamp).toBe(entry.timestamp);
      expect(retrieved?.importance).toBeCloseTo(entry.importance);
      expect(retrieved?.raw).toBeUndefined();
      expect(Array.from(retrieved?.embedding || [])).toEqual(Array.from(entry.embedding));
    });

    it('handles empty arrays and strings', async () => {
      const entry: MemoryEntry = {
        id: 'empty-test',
        embedding: new Float32Array(0),
        summary: '',
        keywords: [],
        timestamp: 0,
        importance: 0
      };

      await adapter.set(entry.id, entry);
      const retrieved = await adapter.get(entry.id);

      expect(retrieved?.summary).toBe('');
      expect(retrieved?.keywords).toEqual([]);
      expect(retrieved?.embedding.length).toBe(0);
    });
  });
});
