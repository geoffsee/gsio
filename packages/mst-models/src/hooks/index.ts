/**
 * React hooks for MST store access
 */

import { createContext, useContext, useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { IRootStore } from '../RootStore';
import { IChatStore } from '../stores/ChatStore';
import { ITodoStore } from '../stores/TodoStore';
import { IConfigStore } from '../stores/ConfigStore';
import { IAudioStore } from '../stores/AudioStore';
import { reaction, autorun } from 'mobx';

/**
 * Root store context
 */
const RootStoreContext = createContext<IRootStore | null>(null);

/**
 * Provider component for root store
 */
export const RootStoreProvider = RootStoreContext.Provider;

/**
 * Hook to access the root store
 */
export function useRootStore(): IRootStore {
  const store = useContext(RootStoreContext);
  if (!store) {
    throw new Error('useRootStore must be used within a RootStoreProvider');
  }
  return store;
}

/**
 * Hook to access the chat store
 */
export function useChatStore(): IChatStore {
  const rootStore = useRootStore();
  return rootStore.chat;
}

/**
 * Hook to access the todo store
 */
export function useTodoStore(): ITodoStore {
  const rootStore = useRootStore();
  return rootStore.todos;
}

/**
 * Hook to access the config store
 */
export function useConfigStore(): IConfigStore {
  const rootStore = useRootStore();
  return rootStore.config;
}

/**
 * Hook to access the audio store
 */
export function useAudioStore(): IAudioStore {
  const rootStore = useRootStore();
  return rootStore.audio;
}

/**
 * Hook to access a specific service
 */
export function useService<T extends keyof import('../services/interfaces').IServices>(
  serviceName: T
): import('../services/interfaces').IServices[T] | undefined {
  const rootStore = useRootStore();
  return rootStore.getService(serviceName);
}

/**
 * Hook for reactive values with MobX
 */
export function useObservable<T>(getValue: () => T): T {
  const [value, setValue] = useState(getValue);

  useEffect(() => {
    const dispose = autorun(() => {
      setValue(getValue());
    });
    return dispose;
  }, [getValue]);

  return value;
}

/**
 * Hook for reacting to changes in observable values
 */
export function useReaction<T>(
  expression: () => T,
  effect: (value: T, previousValue: T | undefined) => void,
  deps: any[] = []
) {
  useEffect(() => {
    const dispose = reaction(expression, effect);
    return dispose;
  }, deps);
}

/**
 * Hook for chat messages
 */
export function useChatMessages() {
  const chatStore = useChatStore();
  return useObservable(() => chatStore.messages.slice());
}

/**
 * Hook for filtered todos
 */
export function useFilteredTodos() {
  const todoStore = useTodoStore();
  return useObservable(() => todoStore.filteredTodos);
}

/**
 * Hook for todo statistics
 */
export function useTodoStats() {
  const todoStore = useTodoStore();
  return useObservable(() => todoStore.statistics);
}

/**
 * Hook for audio capture state
 */
export function useAudioCapture() {
  const audioStore = useAudioStore();

  return {
    isCapturing: useObservable(() => audioStore.isCapturing),
    isActive: useObservable(() => audioStore.isActive),
    metrics: useObservable(() => audioStore.metrics),
    transcripts: useObservable(() => audioStore.transcriptBuffer.slice()),
    toggleCapture: () => audioStore.toggleCapture(),
    startCapture: () => audioStore.startCapture(),
    stopCapture: () => audioStore.stopCapture()
  };
}

/**
 * Hook for configuration values
 */
export function useConfig<K extends keyof import('../models/ConfigModel').IConfig['config']>(
  key: K
): import('../models/ConfigModel').IConfig['config'][K] {
  const configStore = useConfigStore();
  return useObservable(() => configStore.config[key]);
}

/**
 * Hook for streaming state
 */
export function useStreamingState() {
  const chatStore = useChatStore();

  return {
    isStreaming: useObservable(() => chatStore.streaming.isStreaming),
    phase: useObservable(() => chatStore.streaming.phase),
    buffer: useObservable(() => chatStore.streaming.buffer),
    tokenCount: useObservable(() => chatStore.streaming.tokenCount),
    tokensPerSecond: useObservable(() => chatStore.streaming.tokensPerSecond)
  };
}

/**
 * Hook for input state
 */
export function useInputState() {
  const chatStore = useChatStore();
  const input = chatStore.input;

  return {
    text: useObservable(() => input.text),
    cursor: useObservable(() => input.cursor),
    isEmpty: useObservable(() => input.isEmpty),
    setText: (text: string) => input.setText(text),
    insertAtCursor: (text: string) => input.insertAtCursor(text),
    clear: () => input.clear(),
    navigateHistoryUp: () => input.navigateHistoryUp(),
    navigateHistoryDown: () => input.navigateHistoryDown()
  };
}

/**
 * Hook for loading states across stores
 */
export function useLoadingStates() {
  const rootStore = useRootStore();

  return {
    chat: useObservable(() => rootStore.chat.isLoading),
    todos: useObservable(() => rootStore.todos.isLoading),
    config: useObservable(() => rootStore.config.isLoading),
    audio: useObservable(() => rootStore.audio.isLoading),
    anyLoading: useObservable(() =>
      rootStore.chat.isLoading ||
      rootStore.todos.isLoading ||
      rootStore.config.isLoading ||
      rootStore.audio.isLoading
    )
  };
}

/**
 * Hook for error states across stores
 */
export function useErrorStates() {
  const rootStore = useRootStore();

  return {
    chat: useObservable(() => rootStore.chat.error),
    todos: useObservable(() => rootStore.todos.error),
    config: useObservable(() => rootStore.config.error),
    audio: useObservable(() => rootStore.audio.error),
    hasErrors: useObservable(() =>
      !!(rootStore.chat.error ||
      rootStore.todos.error ||
      rootStore.config.error ||
      rootStore.audio.error)
    )
  };
}

/**
 * HOC to make components observer components
 */
export { observer };

/**
 * Custom hook for debounced values
 */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

/**
 * Hook for auto-saving configuration
 */
export function useAutoSaveConfig(delay: number = 1000) {
  const configStore = useConfigStore();
  const isDirty = useObservable(() => configStore.isDirty);
  const debouncedIsDirty = useDebouncedValue(isDirty, delay);

  useEffect(() => {
    if (debouncedIsDirty) {
      configStore.save();
    }
  }, [debouncedIsDirty, configStore]);
}