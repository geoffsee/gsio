/**
 * Message model for chat messages
 */

import { types, Instance, SnapshotIn, SnapshotOut } from 'mobx-state-tree';
import { withIdentifier, withTimestamps, withMetadata, withSerialization } from './base/mixins';
import { MessageRole, IToolCall } from './base/types';

/**
 * Tool call model
 */
export const ToolCall = types.model('ToolCall', {
  id: types.identifier,
  name: types.string,
  arguments: types.frozen<Record<string, any>>(),
  result: types.maybeNull(types.frozen<any>())
})
.actions((self) => ({
  setResult(result: any) {
    self.result = result;
  }
}));

/**
 * Message metadata model
 */
export const MessageMetadata = types.model('MessageMetadata', {
  modelId: types.maybe(types.string),
  toolCalls: types.optional(types.array(ToolCall), []),
  reasoning: types.maybe(types.string),
  timestamp: types.optional(types.number, () => Date.now())
})
.actions((self) => ({
  addToolCall(toolCall: SnapshotIn<typeof ToolCall>) {
    self.toolCalls.push(toolCall);
  },
  setReasoning(reasoning: string) {
    self.reasoning = reasoning;
  },
  setModelId(modelId: string) {
    self.modelId = modelId;
  }
}));

/**
 * Main Message model
 */
export const MessageModel = types.compose(
  'MessageModel',
  withIdentifier,
  withTimestamps,
  withMetadata,
  withSerialization,
  types.model({
    role: types.enumeration<MessageRole>(['user', 'assistant', 'system']),
    content: types.string,
    metadata: types.optional(MessageMetadata, {}),
    // For streaming responses
    isStreaming: types.optional(types.boolean, false),
    streamBuffer: types.optional(types.string, '')
  })
)
.views((self) => ({
  get isUser() {
    return self.role === 'user';
  },
  get isAssistant() {
    return self.role === 'assistant';
  },
  get isSystem() {
    return self.role === 'system';
  },
  get hasToolCalls() {
    return self.metadata.toolCalls.length > 0;
  },
  get toolCallCount() {
    return self.metadata.toolCalls.length;
  },
  get displayContent() {
    return self.isStreaming ? self.streamBuffer : self.content;
  },
  get wordCount() {
    return self.content.split(/\s+/).filter(word => word.length > 0).length;
  },
  get characterCount() {
    return self.content.length;
  },
  get summary() {
    if (self.content.length <= 100) {
      return self.content;
    }
    return self.content.substring(0, 97) + '...';
  }
}))
.actions((self) => ({
  setContent(content: string) {
    self.content = content;
    self.updateTimestamp();
  },

  appendContent(delta: string) {
    self.content += delta;
    self.updateTimestamp();
  },

  startStreaming() {
    self.isStreaming = true;
    self.streamBuffer = '';
  },

  appendStreamDelta(delta: string) {
    if (!self.isStreaming) {
      self.startStreaming();
    }
    self.streamBuffer += delta;
    self.updateTimestamp();
  },

  finishStreaming() {
    if (self.isStreaming) {
      self.content = self.streamBuffer;
      self.streamBuffer = '';
      self.isStreaming = false;
      self.updateTimestamp();
    }
  },

  addToolCall(toolCall: SnapshotIn<typeof ToolCall>) {
    self.metadata.addToolCall(toolCall);
    self.updateTimestamp();
  },

  setReasoning(reasoning: string) {
    self.metadata.setReasoning(reasoning);
    self.updateTimestamp();
  },

  setModelId(modelId: string) {
    self.metadata.setModelId(modelId);
    self.updateTimestamp();
  },

  updateMetadata(updates: Partial<SnapshotIn<typeof MessageMetadata>>) {
    if (updates.modelId !== undefined) {
      self.metadata.modelId = updates.modelId;
    }
    if (updates.reasoning !== undefined) {
      self.metadata.reasoning = updates.reasoning;
    }
    if (updates.toolCalls !== undefined) {
      self.metadata.toolCalls.clear();
      updates.toolCalls.forEach(tc => self.metadata.addToolCall(tc));
    }
    self.updateTimestamp();
  },

  clone(): Instance<typeof MessageModel> {
    return MessageModel.create({
      role: self.role,
      content: self.content,
      metadata: {
        modelId: self.metadata.modelId,
        reasoning: self.metadata.reasoning,
        toolCalls: self.metadata.toolCalls.map(tc => ({
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments,
          result: tc.result
        }))
      }
    });
  }
}));

// Type exports for external usage
export interface IMessage extends Instance<typeof MessageModel> {}
export interface IMessageSnapshot extends SnapshotIn<typeof MessageModel> {}
export interface IMessageOutput extends SnapshotOut<typeof MessageModel> {}
export interface IToolCall extends Instance<typeof ToolCall> {}

// Factory functions
export function createMessage(
  role: MessageRole,
  content: string,
  metadata?: Partial<SnapshotIn<typeof MessageMetadata>>
): IMessage {
  return MessageModel.create({
    role,
    content,
    metadata
  });
}

export function createUserMessage(content: string): IMessage {
  return createMessage('user', content);
}

export function createAssistantMessage(
  content: string,
  modelId?: string
): IMessage {
  return createMessage('assistant', content, { modelId });
}

export function createSystemMessage(content: string): IMessage {
  return createMessage('system', content);
}