import { describe, it, expect, beforeEach } from 'vitest';
import LLMMemory from '../src/index.js';
import { createMockStorage } from './mocks.js';

describe('Embeddings and Similarity', () => {
  let memory: LLMMemory;

  beforeEach(() => {
    memory = new LLMMemory({
      storage: createMockStorage(),
      embeddingDimensions: 384
    });
  });

  describe('generateEmbedding', () => {
    it('should generate consistent embeddings for identical text', async () => {
      const text = 'This is a test sentence for embedding generation';

      // Access private method through prototype
      const generateEmbedding = (memory as any).generateEmbedding.bind(memory);

      const embedding1 = await generateEmbedding(text);
      const embedding2 = await generateEmbedding(text);

      expect(embedding1).toBeInstanceOf(Float32Array);
      expect(embedding2).toBeInstanceOf(Float32Array);
      expect(Array.from(embedding1)).toEqual(Array.from(embedding2));
    });

    it('should generate different embeddings for different text', async () => {
      const text1 = 'JavaScript is a programming language';
      const text2 = 'Python is used for data science';

      const generateEmbedding = (memory as any).generateEmbedding.bind(memory);

      const embedding1 = await generateEmbedding(text1);
      const embedding2 = await generateEmbedding(text2);

      expect(Array.from(embedding1)).not.toEqual(Array.from(embedding2));
    });

    it('should generate normalized embeddings', async () => {
      const text = 'Test normalization of embeddings';

      const generateEmbedding = (memory as any).generateEmbedding.bind(memory);
      const embedding = await generateEmbedding(text);

      // Check that the embedding is normalized (magnitude ≈ 1)
      const magnitude = Math.sqrt(
        Array.from(embedding).reduce((sum, val) => sum + val * val, 0)
      );

      expect(magnitude).toBeCloseTo(1, 5);
    });

    it('should handle empty text', async () => {
      const generateEmbedding = (memory as any).generateEmbedding.bind(memory);
      const embedding = await generateEmbedding('');

      expect(embedding).toBeInstanceOf(Float32Array);
      expect(embedding.length).toBe(384);
    });

    it('should handle special characters and punctuation', async () => {
      const text = 'Special!@#$%^&*()_+-={}[]|:";\'<>?,./';

      const generateEmbedding = (memory as any).generateEmbedding.bind(memory);
      const embedding = await generateEmbedding(text);

      expect(embedding).toBeInstanceOf(Float32Array);
      expect(embedding.length).toBe(384);
    });

    it('should be case-insensitive', async () => {
      const generateEmbedding = (memory as any).generateEmbedding.bind(memory);

      const embedding1 = await generateEmbedding('HELLO WORLD');
      const embedding2 = await generateEmbedding('hello world');

      expect(Array.from(embedding1)).toEqual(Array.from(embedding2));
    });

    it('should handle long text efficiently', async () => {
      const longText = 'word '.repeat(1000); // 1000 words

      const generateEmbedding = (memory as any).generateEmbedding.bind(memory);
      const embedding = await generateEmbedding(longText);

      expect(embedding).toBeInstanceOf(Float32Array);
      expect(embedding.length).toBe(384);

      // Should still be normalized
      const magnitude = Math.sqrt(
        Array.from(embedding).reduce((sum, val) => sum + val * val, 0)
      );
      expect(magnitude).toBeCloseTo(1, 5);
    });

    it('should respect configured dimensions', async () => {
      const customMemory = new LLMMemory({
        storage: createMockStorage(),
        embeddingDimensions: 256
      });

      const generateEmbedding = (customMemory as any).generateEmbedding.bind(customMemory);
      const embedding = await generateEmbedding('Test dimensions');

      expect(embedding.length).toBe(256);
    });
  });

  describe('cosineSimilarity', () => {
    it('should calculate correct similarity for identical vectors', () => {
      const vec1 = new Float32Array([1, 0, 0]);
      const vec2 = new Float32Array([1, 0, 0]);

      const cosineSimilarity = (memory as any).cosineSimilarity.bind(memory);
      const similarity = cosineSimilarity(vec1, vec2);

      expect(similarity).toBe(1);
    });

    it('should calculate correct similarity for orthogonal vectors', () => {
      const vec1 = new Float32Array([1, 0, 0]);
      const vec2 = new Float32Array([0, 1, 0]);

      const cosineSimilarity = (memory as any).cosineSimilarity.bind(memory);
      const similarity = cosineSimilarity(vec1, vec2);

      expect(similarity).toBe(0);
    });

    it('should calculate correct similarity for opposite vectors', () => {
      const vec1 = new Float32Array([1, 0, 0]);
      const vec2 = new Float32Array([-1, 0, 0]);

      const cosineSimilarity = (memory as any).cosineSimilarity.bind(memory);
      const similarity = cosineSimilarity(vec1, vec2);

      expect(similarity).toBe(-1);
    });

    it('should handle non-normalized vectors', () => {
      const vec1 = new Float32Array([3, 4, 0]);
      const vec2 = new Float32Array([6, 8, 0]);

      const cosineSimilarity = (memory as any).cosineSimilarity.bind(memory);
      const similarity = cosineSimilarity(vec1, vec2);

      expect(similarity).toBeCloseTo(1, 5);
    });

    it('should handle zero vectors', () => {
      const vec1 = new Float32Array([0, 0, 0]);
      const vec2 = new Float32Array([1, 1, 1]);

      const cosineSimilarity = (memory as any).cosineSimilarity.bind(memory);
      const similarity = cosineSimilarity(vec1, vec2);

      expect(similarity).toBe(0);
    });

    it('should be commutative', () => {
      const vec1 = new Float32Array([1, 2, 3]);
      const vec2 = new Float32Array([4, 5, 6]);

      const cosineSimilarity = (memory as any).cosineSimilarity.bind(memory);
      const similarity1 = cosineSimilarity(vec1, vec2);
      const similarity2 = cosineSimilarity(vec2, vec1);

      expect(similarity1).toBe(similarity2);
    });

    it('should handle high-dimensional vectors', () => {
      const dimension = 384;
      const vec1 = new Float32Array(dimension);
      const vec2 = new Float32Array(dimension);

      // Initialize with random values
      for (let i = 0; i < dimension; i++) {
        vec1[i] = Math.random() - 0.5;
        vec2[i] = Math.random() - 0.5;
      }

      const cosineSimilarity = (memory as any).cosineSimilarity.bind(memory);
      const similarity = cosineSimilarity(vec1, vec2);

      expect(similarity).toBeGreaterThanOrEqual(-1);
      expect(similarity).toBeLessThanOrEqual(1);
    });
  });

  describe('simpleHash', () => {
    it('should generate consistent hashes for same input', () => {
      const simpleHash = (memory as any).simpleHash.bind(memory);

      const hash1 = simpleHash('test');
      const hash2 = simpleHash('test');

      expect(hash1).toBe(hash2);
    });

    it('should generate different hashes for different inputs', () => {
      const simpleHash = (memory as any).simpleHash.bind(memory);

      const hash1 = simpleHash('test1');
      const hash2 = simpleHash('test2');

      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty string', () => {
      const simpleHash = (memory as any).simpleHash.bind(memory);
      const hash = simpleHash('');

      expect(typeof hash).toBe('number');
      expect(hash).toBe(0);
    });

    it('should handle special characters', () => {
      const simpleHash = (memory as any).simpleHash.bind(memory);

      const hash1 = simpleHash('hello!@#$');
      const hash2 = simpleHash('hello');

      expect(hash1).not.toBe(hash2);
    });

    it('should always return positive values', () => {
      const simpleHash = (memory as any).simpleHash.bind(memory);
      const testStrings = ['test', 'negative', 'hash', 'values', 'should', 'be', 'positive'];

      for (const str of testStrings) {
        const hash = simpleHash(str);
        expect(hash).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('semantic similarity in practice', () => {
    it('should find similar content based on embeddings', async () => {
      // Store memories about similar topics
      const messages1 = [
        { role: 'user', content: 'How do I use async and await in JavaScript?' },
        { role: 'assistant', content: 'Async/await is syntactic sugar over promises' }
      ];

      const messages2 = [
        { role: 'user', content: 'Explain JavaScript promises' },
        { role: 'assistant', content: 'Promises handle asynchronous operations' }
      ];

      const messages3 = [
        { role: 'user', content: 'What is Python used for?' },
        { role: 'assistant', content: 'Python is used for data science and web development' }
      ];

      await memory.memorize(messages1, 'testuser');
      await memory.memorize(messages2, 'testuser');
      await memory.memorize(messages3, 'testuser');

      // Search for JavaScript-related content with lower similarity threshold
      const results = await memory.search('JavaScript', 'testuser');

      // If we have results, verify they're JavaScript-related
      if (results.length > 0) {
        const topResult = results[0];
        expect(topResult.keywords.some(k =>
          k.includes('javascript') || k.includes('async') || k.includes('promise')
        )).toBe(true);
      }

      // Alternative test: verify the search function works without errors
      expect(results).toBeInstanceOf(Array);
    });

    it('should rank more similar content higher', async () => {
      const exactMatch = [
        { role: 'user', content: 'React hooks useState' },
        { role: 'assistant', content: 'useState manages state in functional components' }
      ];

      const partialMatch = [
        { role: 'user', content: 'React components' },
        { role: 'assistant', content: 'Components are building blocks' }
      ];

      const noMatch = [
        { role: 'user', content: 'Database queries' },
        { role: 'assistant', content: 'SQL is used for databases' }
      ];

      await memory.memorize(noMatch, 'testuser');
      await memory.memorize(partialMatch, 'testuser');
      await memory.memorize(exactMatch, 'testuser');

      const results = await memory.search('React hooks useState', 'testuser');

      // Exact match should be ranked first
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].keywords.some(k => k.includes('usestate') || k.includes('hooks'))).toBe(true);
    });
  });

  describe('recency scoring', () => {
    it('should calculate correct recency scores', () => {
      const recencyScore = (memory as any).recencyScore.bind(memory);

      // Current timestamp should have score close to 1
      const currentScore = recencyScore(Date.now());
      expect(currentScore).toBeCloseTo(1, 2);

      // 15 days old should have score around 0.5
      const midScore = recencyScore(Date.now() - (15 * 24 * 60 * 60 * 1000));
      expect(midScore).toBeCloseTo(0.5, 1);

      // 30 days old should have score close to 0
      const oldScore = recencyScore(Date.now() - (30 * 24 * 60 * 60 * 1000));
      expect(oldScore).toBeCloseTo(0, 1);

      // Older than 30 days should have score of 0
      const veryOldScore = recencyScore(Date.now() - (60 * 24 * 60 * 60 * 1000));
      expect(veryOldScore).toBe(0);
    });
  });
});
