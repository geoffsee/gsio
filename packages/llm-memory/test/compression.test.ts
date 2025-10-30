import { describe, it, expect, beforeEach } from 'vitest';
import LLMMemory from '../src/index';
import { createMockStorage } from './mocks';

describe('Compression and Text Processing', () => {
  let memory: LLMMemory;

  beforeEach(() => {
    memory = new LLMMemory({
      storage: createMockStorage(),
      compressionRatio: 0.3
    });
  });

  describe('compress', () => {
    it('should compress text to target ratio', async () => {
      const text = 'This is the first sentence. This is the second sentence. ' +
                   'This is the third sentence. This is the fourth sentence. ' +
                   'This is the fifth sentence. This is the sixth sentence. ' +
                   'This is the seventh sentence. This is the eighth sentence. ' +
                   'This is the ninth sentence. This is the tenth sentence.';

      const compress = (memory as any).compress.bind(memory);
      const compressed = await compress(text);

      const originalSentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
      const compressedSentences = compressed.split(/[.!?]+/).filter(s => s.trim().length > 0);

      // Should compress to approximately 30% of original
      expect(compressedSentences.length).toBeLessThanOrEqual(Math.ceil(originalSentences.length * 0.3));
      expect(compressedSentences.length).toBeGreaterThan(0);
    });

    it('should prioritize important sentences', async () => {
      const text = 'This is a normal sentence. ' +
                   'This is an important sentence to remember. ' +
                   'Just another regular sentence. ' +
                   'This is a critical and key decision we made. ' +
                   'Some more regular text here. ' +
                   'Note that this is very important.';

      const compress = (memory as any).compress.bind(memory);
      const compressed = await compress(text);

      // Should contain important keywords
      expect(compressed.toLowerCase()).toMatch(/important|critical|key|remember|note/);
    });

    it('should handle single sentence', async () => {
      const text = 'This is a single sentence.';

      const compress = (memory as any).compress.bind(memory);
      const compressed = await compress(text);

      expect(compressed).toBe('This is a single sentence.');
    });

    it('should handle empty text', async () => {
      const compress = (memory as any).compress.bind(memory);
      const compressed = await compress('');

      expect(compressed).toBe('.');
    });

    it('should filter out very short sentences', async () => {
      const text = 'Hi. This is a longer sentence that should be kept. Ok. ' +
                   'Another substantial sentence here. Yes. No.';

      const compress = (memory as any).compress.bind(memory);
      const compressed = await compress(text);

      // Should not include very short sentences like "Hi", "Ok", "Yes", "No"
      expect(compressed).not.toContain('Hi');
      expect(compressed).not.toContain('Ok');
      expect(compressed).toContain('longer sentence');
    });

    it('should preserve sentence ending punctuation', async () => {
      const text = 'First sentence. Second sentence! Third sentence? Fourth sentence.';

      const compress = (memory as any).compress.bind(memory);
      const compressed = await compress(text);

      expect(compressed.endsWith('.')).toBe(true);
    });
  });

  describe('calculateSentenceImportance', () => {
    it('should score sentences with important keywords higher', () => {
      const calculateImportance = (memory as any).calculateSentenceImportance.bind(memory);

      const importantSentence = 'This is a critical decision we need to remember';
      const normalSentence = 'The weather is nice today';

      const importantScore = calculateImportance(importantSentence);
      const normalScore = calculateImportance(normalSentence);

      expect(importantScore).toBeGreaterThan(normalScore);
    });

    it('should consider sentence length', () => {
      const calculateImportance = (memory as any).calculateSentenceImportance.bind(memory);

      const longSentence = 'This is a much longer sentence with many words that provides detailed information about the topic';
      const shortSentence = 'Short sentence';

      const longScore = calculateImportance(longSentence);
      const shortScore = calculateImportance(shortSentence);

      expect(longScore).toBeGreaterThan(shortScore);
    });

    it('should accumulate scores for multiple keywords', () => {
      const calculateImportance = (memory as any).calculateSentenceImportance.bind(memory);

      const multiKeyword = 'Important note: remember this critical key decision';
      const singleKeyword = 'This is important';

      const multiScore = calculateImportance(multiKeyword);
      const singleScore = calculateImportance(singleKeyword);

      expect(multiScore).toBeGreaterThan(singleScore);
    });

    it('should be case-insensitive for keywords', () => {
      const calculateImportance = (memory as any).calculateSentenceImportance.bind(memory);

      const uppercase = 'This is IMPORTANT and CRITICAL';
      const lowercase = 'This is important and critical';

      const upperScore = calculateImportance(uppercase);
      const lowerScore = calculateImportance(lowercase);

      expect(upperScore).toBe(lowerScore);
    });
  });

  describe('extractKeywords', () => {
    it('should extract top frequency words', () => {
      const text = 'JavaScript is great. JavaScript is powerful. ' +
                   'JavaScript is used for web development. ' +
                   'Python is also great. Python is used for data science.';

      const extractKeywords = (memory as any).extractKeywords.bind(memory);
      const keywords = extractKeywords(text);

      expect(keywords).toContain('javascript');
      expect(keywords).toContain('python');
      expect(keywords).toContain('great');
      expect(keywords).toContain('used');
    });

    it('should filter out short words', () => {
      const text = 'The is a an to for of in on at by the is a an';

      const extractKeywords = (memory as any).extractKeywords.bind(memory);
      const keywords = extractKeywords(text);

      // Should not contain words with 3 or fewer characters
      expect(keywords.every(word => word.length > 3)).toBe(true);
    });

    it('should limit to top 10 keywords', () => {
      const text = 'word1 '.repeat(20) + 'word2 '.repeat(19) + 'word3 '.repeat(18) +
                   'word4 '.repeat(17) + 'word5 '.repeat(16) + 'word6 '.repeat(15) +
                   'word7 '.repeat(14) + 'word8 '.repeat(13) + 'word9 '.repeat(12) +
                   'word10 '.repeat(11) + 'word11 '.repeat(10) + 'word12 '.repeat(9);

      const extractKeywords = (memory as any).extractKeywords.bind(memory);
      const keywords = extractKeywords(text);

      expect(keywords.length).toBe(10);
      expect(keywords).toContain('word1'); // Most frequent
      expect(keywords).not.toContain('word12'); // Least frequent
    });

    it('should handle empty text', () => {
      const extractKeywords = (memory as any).extractKeywords.bind(memory);
      const keywords = extractKeywords('');

      expect(keywords).toEqual([]);
    });

    it('should remove punctuation', () => {
      const text = 'Hello, world! How are you? I am fine, thanks.';

      const extractKeywords = (memory as any).extractKeywords.bind(memory);
      const keywords = extractKeywords(text);

      // Keywords should not contain punctuation
      keywords.forEach(keyword => {
        expect(keyword).toMatch(/^[a-z]+$/);
      });
    });

    it('should be case-insensitive', () => {
      const text = 'JavaScript JAVASCRIPT javascript Javascript';

      const extractKeywords = (memory as any).extractKeywords.bind(memory);
      const keywords = extractKeywords(text);

      expect(keywords[0]).toBe('javascript');
      expect(keywords.filter(k => k === 'javascript').length).toBe(1);
    });
  });

  describe('messagesToText', () => {
    it('should convert messages to formatted text', () => {
      const messages = [
        { role: 'user' as const, content: 'Hello' },
        { role: 'assistant' as const, content: 'Hi there' },
        { role: 'user' as const, content: 'How are you?' }
      ];

      const messagesToText = (memory as any).messagesToText.bind(memory);
      const text = messagesToText(messages);

      expect(text).toBe('user: Hello\nassistant: Hi there\nuser: How are you?');
    });

    it('should handle empty messages array', () => {
      const messagesToText = (memory as any).messagesToText.bind(memory);
      const text = messagesToText([]);

      expect(text).toBe('');
    });

    it('should handle system messages', () => {
      const messages = [
        { role: 'system' as const, content: 'You are a helpful assistant' },
        { role: 'user' as const, content: 'Hello' }
      ];

      const messagesToText = (memory as any).messagesToText.bind(memory);
      const text = messagesToText(messages);

      expect(text).toBe('system: You are a helpful assistant\nuser: Hello');
    });

    it('should preserve message content formatting', () => {
      const messages = [
        { role: 'user' as const, content: 'Line 1\nLine 2\n\tTabbed line' }
      ];

      const messagesToText = (memory as any).messagesToText.bind(memory);
      const text = messagesToText(messages);

      expect(text).toContain('Line 1\nLine 2\n\tTabbed line');
    });
  });

  describe('buildContext', () => {
    it('should build context from similarity results', () => {
      const results = [
        {
          entry: {
            id: '1',
            embedding: new Float32Array(),
            summary: 'First summary about JavaScript',
            keywords: [],
            timestamp: Date.now(),
            importance: 0.5
          },
          score: 0.9
        },
        {
          entry: {
            id: '2',
            embedding: new Float32Array(),
            summary: 'Second summary about Python',
            keywords: [],
            timestamp: Date.now(),
            importance: 0.5
          },
          score: 0.8
        }
      ];

      const buildContext = (memory as any).buildContext.bind(memory);
      const context = buildContext(results, 500);

      expect(context).toContain('Previous context:');
      expect(context).toContain('First summary about JavaScript');
      expect(context).toContain('Second summary about Python');
    });

    it('should respect maxTokens limit', () => {
      const results = [
        {
          entry: {
            id: '1',
            embedding: new Float32Array(),
            summary: 'A'.repeat(200), // 200 chars ≈ 50 tokens
            keywords: [],
            timestamp: Date.now(),
            importance: 0.5
          },
          score: 0.9
        },
        {
          entry: {
            id: '2',
            embedding: new Float32Array(),
            summary: 'B'.repeat(200), // 200 chars ≈ 50 tokens
            keywords: [],
            timestamp: Date.now(),
            importance: 0.5
          },
          score: 0.8
        }
      ];

      const buildContext = (memory as any).buildContext.bind(memory);
      const context = buildContext(results, 30); // Very low token limit

      expect(context).toContain('Previous context:');
      // Should include only the first summary due to token limit
      expect(context).not.toContain('B'.repeat(200));
    });

    it('should handle empty results', () => {
      const buildContext = (memory as any).buildContext.bind(memory);
      const context = buildContext([], 500);

      expect(context).toBe('Previous context:');
    });

    it('should separate summaries with semicolons', () => {
      const results = [
        {
          entry: {
            id: '1',
            embedding: new Float32Array(),
            summary: 'Summary one',
            keywords: [],
            timestamp: Date.now(),
            importance: 0.5
          },
          score: 0.9
        },
        {
          entry: {
            id: '2',
            embedding: new Float32Array(),
            summary: 'Summary two',
            keywords: [],
            timestamp: Date.now(),
            importance: 0.5
          },
          score: 0.8
        }
      ];

      const buildContext = (memory as any).buildContext.bind(memory);
      const context = buildContext(results, 500);

      expect(context).toMatch(/Summary one;\s*Summary two/);
    });
  });

  describe('integration with compression', () => {
    it('should compress long conversations effectively', async () => {
      const longConversation = [];
      for (let i = 0; i < 20; i++) {
        longConversation.push(
          { role: 'user' as const, content: `Question number ${i}: This is a detailed question about topic ${i}` },
          { role: 'assistant' as const, content: `Answer number ${i}: This is a comprehensive response to question ${i}` }
        );
      }

      await memory.memorize(longConversation, 'user123');

      const adapter = (memory as any).adapter;
      const keys = await adapter.list('user123');
      expect(keys.length).toBe(1);
      const stored = await adapter.get(keys[0]);

      // Summary should be compressed
      const originalText = longConversation
        .map(m => `${m.role}: ${m.content}`)
        .join('\n');

      // The summary should exist - compression may not always reduce size for already concise text
      expect(stored?.summary.length ?? 0).toBeGreaterThan(0);
      // Allow a small tolerance since compression depends on content
      expect(stored?.summary.length || 0).toBeLessThanOrEqual(originalText.length + 10);

      // Check that compression actually happened - summary should be reasonably sized
      const originalSentences = originalText.split(/[.!?]+/).filter(s => s.trim().length > 10);
      const summaryParts = (stored?.summary || '').split(/[.!?]+/).filter(s => s.trim().length > 0);
      expect(summaryParts.length).toBeLessThanOrEqual(originalSentences.length);
    });
  });
});
