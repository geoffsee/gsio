/**
 * Chat store for managing messages and conversations
 */

import { types, flow, Instance, SnapshotIn, getRoot } from 'mobx-state-tree';
import { MessageModel, IMessage, createUserMessage, createAssistantMessage } from '../models/MessageModel';
import { withLoadingState, withHistory } from '../models/base/mixins';

/**
 * Input state model for managing user input
 */
export const InputState = types.model('InputState', {
  text: types.optional(types.string, ''),
  cursor: types.optional(types.number, 0),
  // History navigation
  history: types.optional(types.array(types.string), []),
  historyIndex: types.maybeNull(types.number),
  draftBeforeHistory: types.optional(types.string, '')
})
.views((self) => ({
  get isEmpty() {
    return self.text.length === 0;
  },
  get length() {
    return self.text.length;
  },
  get hasHistory() {
    return self.history.length > 0;
  },
  get isNavigatingHistory() {
    return self.historyIndex !== null;
  }
}))
.actions((self) => ({
  setText(text: string) {
    self.text = text;
    self.cursor = Math.min(self.cursor, text.length);
  },

  setCursor(position: number) {
    self.cursor = Math.max(0, Math.min(position, self.text.length));
  },

  moveCursorLeft() {
    this.setCursor(self.cursor - 1);
  },

  moveCursorRight() {
    this.setCursor(self.cursor + 1);
  },

  moveCursorToStart() {
    this.setCursor(0);
  },

  moveCursorToEnd() {
    this.setCursor(self.text.length);
  },

  insertAtCursor(text: string) {
    const before = self.text.slice(0, self.cursor);
    const after = self.text.slice(self.cursor);
    self.text = before + text + after;
    self.cursor += text.length;
  },

  deleteAtCursor() {
    if (self.cursor > 0) {
      const before = self.text.slice(0, self.cursor - 1);
      const after = self.text.slice(self.cursor);
      self.text = before + after;
      self.cursor--;
    }
  },

  clear() {
    self.text = '';
    self.cursor = 0;
    self.historyIndex = null;
    self.draftBeforeHistory = '';
  },

  addToHistory(text: string) {
    if (text.trim() && text !== self.history[self.history.length - 1]) {
      self.history.push(text);
      // Keep history size manageable
      if (self.history.length > 100) {
        self.history.shift();
      }
    }
  },

  navigateHistoryUp() {
    if (!self.hasHistory) return;

    if (self.historyIndex === null) {
      // Save current draft
      self.draftBeforeHistory = self.text;
      self.historyIndex = self.history.length - 1;
    } else if (self.historyIndex > 0) {
      self.historyIndex--;
    }

    if (self.historyIndex !== null) {
      self.text = self.history[self.historyIndex];
      self.cursor = self.text.length;
    }
  },

  navigateHistoryDown() {
    if (self.historyIndex === null) return;

    if (self.historyIndex < self.history.length - 1) {
      self.historyIndex++;
      self.text = self.history[self.historyIndex];
    } else {
      // Restore draft
      self.text = self.draftBeforeHistory;
      self.historyIndex = null;
      self.draftBeforeHistory = '';
    }
    self.cursor = self.text.length;
  }
}));

/**
 * Streaming response state
 */
export const StreamingState = types.model('StreamingState', {
  isStreaming: types.optional(types.boolean, false),
  buffer: types.optional(types.string, ''),
  phase: types.optional(
    types.enumeration(['idle', 'planning', 'guidance', 'execution']),
    'idle'
  ),
  streamStartTime: types.maybe(types.number),
  tokenCount: types.optional(types.number, 0)
})
.views((self) => ({
  get streamDuration() {
    if (!self.streamStartTime) return 0;
    return Date.now() - self.streamStartTime;
  },
  get tokensPerSecond() {
    const seconds = this.streamDuration / 1000;
    return seconds > 0 ? self.tokenCount / seconds : 0;
  }
}))
.actions((self) => ({
  startStreaming(phase: 'planning' | 'guidance' | 'execution' = 'execution') {
    self.isStreaming = true;
    self.phase = phase;
    self.buffer = '';
    self.streamStartTime = Date.now();
    self.tokenCount = 0;
  },

  appendDelta(delta: string) {
    self.buffer += delta;
    self.tokenCount++;
  },

  stopStreaming() {
    self.isStreaming = false;
    self.phase = 'idle';
    const content = self.buffer;
    self.buffer = '';
    self.streamStartTime = undefined;
    self.tokenCount = 0;
    return content;
  },

  setPhase(phase: 'idle' | 'planning' | 'guidance' | 'execution') {
    self.phase = phase;
  }
}));

/**
 * Main Chat Store
 */
export const ChatStore = types.compose(
  'ChatStore',
  withLoadingState,
  types.model({
    messages: types.optional(types.array(MessageModel), []),
    input: types.optional(InputState, {}),
    streaming: types.optional(StreamingState, {}),
    maxMessages: types.optional(types.number, 1000),
    // Current active message being streamed
    activeMessage: types.maybeNull(types.reference(MessageModel))
  })
)
.views((self) => ({
  get messageCount() {
    return self.messages.length;
  },

  get hasMessages() {
    return self.messages.length > 0;
  },

  get lastMessage() {
    return self.messages[self.messages.length - 1];
  },

  get lastUserMessage() {
    for (let i = self.messages.length - 1; i >= 0; i--) {
      if (self.messages[i].isUser) {
        return self.messages[i];
      }
    }
    return null;
  },

  get lastAssistantMessage() {
    for (let i = self.messages.length - 1; i >= 0; i--) {
      if (self.messages[i].isAssistant) {
        return self.messages[i];
      }
    }
    return null;
  },

  get userMessages() {
    return self.messages.filter(m => m.isUser);
  },

  get assistantMessages() {
    return self.messages.filter(m => m.isAssistant);
  },

  get recentMessages() {
    return self.messages.slice(-10);
  },

  get conversationPairs() {
    const pairs: Array<{ user: IMessage; assistant: IMessage | null }> = [];
    let pendingUser: IMessage | null = null;

    for (const message of self.messages) {
      if (message.isUser) {
        if (pendingUser) {
          pairs.push({ user: pendingUser, assistant: null });
        }
        pendingUser = message;
      } else if (message.isAssistant && pendingUser) {
        pairs.push({ user: pendingUser, assistant: message });
        pendingUser = null;
      }
    }

    if (pendingUser) {
      pairs.push({ user: pendingUser, assistant: null });
    }

    return pairs;
  },

  getMessageById(id: string) {
    return self.messages.find(m => m.id === id);
  },

  getMessagesInRange(start: number, end: number) {
    return self.messages.slice(start, end);
  },

  get totalWordCount() {
    return self.messages.reduce((sum, m) => sum + m.wordCount, 0);
  },

  get totalCharacterCount() {
    return self.messages.reduce((sum, m) => sum + m.characterCount, 0);
  }
}))
.actions((self) => ({
  /**
   * Add a message to the chat
   */
  addMessage(message: Instance<typeof MessageModel>) {
    self.messages.push(message);

    // Trim old messages if exceeding max
    while (self.messages.length > self.maxMessages) {
      self.messages.shift();
    }
  },

  /**
   * Send a user message
   */
  sendUserMessage(content: string): IMessage {
    const message = createUserMessage(content);
    this.addMessage(message);
    self.input.addToHistory(content);
    self.input.clear();
    return message;
  },

  /**
   * Add an assistant message
   */
  addAssistantMessage(content: string, modelId?: string): IMessage {
    const message = createAssistantMessage(content, modelId);
    this.addMessage(message);
    return message;
  },

  /**
   * Start streaming a response
   */
  startStreamingResponse(modelId?: string): IMessage {
    const message = createAssistantMessage('', modelId);
    message.startStreaming();
    this.addMessage(message);
    self.activeMessage = message as any;
    self.streaming.startStreaming();
    return message;
  },

  /**
   * Append to streaming response
   */
  appendStreamDelta(delta: string) {
    if (self.activeMessage) {
      self.activeMessage.appendStreamDelta(delta);
    }
    self.streaming.appendDelta(delta);
  },

  /**
   * Finish streaming response
   */
  finishStreaming() {
    if (self.activeMessage) {
      self.activeMessage.finishStreaming();
      self.activeMessage = null;
    }
    const content = self.streaming.stopStreaming();
    return content;
  },

  /**
   * Remove a message
   */
  removeMessage(id: string) {
    const index = self.messages.findIndex(m => m.id === id);
    if (index !== -1) {
      self.messages.splice(index, 1);
    }
  },

  /**
   * Clear all messages
   */
  clearMessages() {
    self.messages.clear();
    self.activeMessage = null;
  },

  /**
   * Edit a message
   */
  editMessage(id: string, newContent: string) {
    const message = self.messages.find(m => m.id === id);
    if (message) {
      message.setContent(newContent);
    }
  },

  /**
   * Get messages for context (e.g., for API calls)
   */
  getContextMessages(limit: number = 20): Array<{ role: string; content: string }> {
    const messages = self.messages.slice(-limit);
    return messages.map(m => ({
      role: m.role,
      content: m.content
    }));
  },

  /**
   * Stream a multi-phase response (planning, guidance, execution)
   */
  streamMultiPhaseResponse: flow(function* (
    prompt: string,
    onPhaseChange?: (phase: string) => void
  ) {
    self.setLoading(true);
    self.streaming.startStreaming('planning');

    try {
      // Send user message
      const userMessage = self.sendUserMessage(prompt);

      // Phase 1: Planning
      if (onPhaseChange) onPhaseChange('planning');
      self.streaming.setPhase('planning');
      const planningMessage = self.startStreamingResponse();
      // ... streaming logic would go here
      yield new Promise(resolve => setTimeout(resolve, 100)); // Placeholder

      // Phase 2: Guidance
      if (onPhaseChange) onPhaseChange('guidance');
      self.streaming.setPhase('guidance');
      // ... streaming logic would go here
      yield new Promise(resolve => setTimeout(resolve, 100)); // Placeholder

      // Phase 3: Execution
      if (onPhaseChange) onPhaseChange('execution');
      self.streaming.setPhase('execution');
      // ... streaming logic would go here
      yield new Promise(resolve => setTimeout(resolve, 100)); // Placeholder

      self.finishStreaming();
      self.setLoading(false);
    } catch (error: any) {
      self.setError(error.message);
      self.finishStreaming();
    }
  }),

  /**
   * Import messages from JSON
   */
  importMessages(messages: Array<{ role: string; content: string }>) {
    self.messages.clear();
    for (const msg of messages) {
      if (msg.role === 'user') {
        this.addMessage(createUserMessage(msg.content));
      } else if (msg.role === 'assistant') {
        this.addMessage(createAssistantMessage(msg.content));
      }
    }
  },

  /**
   * Export messages to JSON
   */
  exportMessages() {
    return self.messages.map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
      timestamp: m.createdAt.toISOString(),
      metadata: m.metadata
    }));
  }
}));

// Type exports
export interface IChatStore extends Instance<typeof ChatStore> {}
export interface IChatStoreSnapshot extends SnapshotIn<typeof ChatStore> {}
export interface IInputState extends Instance<typeof InputState> {}
export interface IStreamingState extends Instance<typeof StreamingState> {}

// Factory function
export function createChatStore(): IChatStore {
  return ChatStore.create({});
}