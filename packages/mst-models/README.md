# @gsio/mst-models

A comprehensive MobX-State-Tree (MST) state management package for the GSIO AI application. This package provides type-safe, reactive state management with dependency injection for easy testing and development.

## Features

- 🎯 **Type-safe state management** with MobX-State-Tree
- 💉 **Dependency injection** for services and external dependencies
- 🧪 **Fully testable** with mock services
- ⚛️ **React hooks** for easy integration
- 🔄 **Reactive updates** with MobX observables
- 💾 **Persistence support** with pluggable storage
- 🎨 **Modular architecture** with separate models and stores

## Installation

```bash
# Using npm
npm install @gsio/mst-models

# Using bun
bun add @gsio/mst-models

# Using yarn
yarn add @gsio/mst-models
```

## Quick Start

### Basic Usage

```typescript
import { createRootStore, createMockServices } from '@gsio/mst-models';

// Create root store with mock services (for development)
const services = createMockServices();
const rootStore = createRootStore(services);

// Initialize the application
await rootStore.initialize();

// Access stores
const { chat, todos, config, audio } = rootStore;

// Add a todo
const todo = todos.addTodo('Build awesome features');
todo.setStatus('in_progress');

// Send a chat message
await chat.sendUserMessage('Hello, AI!');
```

### React Integration

```tsx
import { RootStoreProvider, useRootStore, observer, useTodoStore } from '@gsio/mst-models';
import { createRootStore } from '@gsio/mst-models';

// Create and initialize store
const rootStore = createRootStore();

// Provide store to React app
function App() {
  return (
    <RootStoreProvider value={rootStore}>
      <TodoList />
    </RootStoreProvider>
  );
}

// Use store in components
const TodoList = observer(() => {
  const todoStore = useTodoStore();

  return (
    <div>
      {todoStore.filteredTodos.map(todo => (
        <div key={todo.id}>
          <input
            type="checkbox"
            checked={todo.isDone}
            onChange={() => todoStore.toggleTodo(todo.id)}
          />
          {todo.text}
        </div>
      ))}
    </div>
  );
});
```

## Architecture

### Models

Models define the shape and behavior of individual entities:

- **MessageModel** - Chat messages with role, content, and metadata
- **TodoModel** - Tasks with status, priority, dependencies, and notes
- **ConfigModel** - Application configuration
- **MemoryModel** - Memory entries with embeddings

### Stores

Stores manage collections and business logic:

- **ChatStore** - Message management, streaming, and chat operations
- **TodoStore** - Todo CRUD, filtering, and persistence
- **ConfigStore** - Configuration management and validation
- **AudioStore** - Audio capture and transcription state
- **RootStore** - Combines all stores and manages services

### Services

Services handle external dependencies through interfaces:

- **IStorageService** - File system and persistence
- **IMemoryService** - Semantic memory and embeddings
- **IAudioService** - Audio capture and transcription
- **IAgentService** - AI model interactions
- **IEventService** - Event pub/sub system

## Testing

The package includes comprehensive testing utilities with dependency injection:

```typescript
import { describe, test, expect } from 'bun:test';
import { createRootStore, createMockServices } from '@gsio/mst-models';

describe('TodoStore', () => {
  test('should add and complete todos', async () => {
    // Create store with mock services
    const services = createMockServices();
    const rootStore = createRootStore(services);

    // Test todo operations
    const todo = rootStore.todos.addTodo('Test task');
    expect(todo.status).toBe('todo');

    rootStore.todos.completeTodo(todo.id);
    expect(todo.isDone).toBe(true);

    // Test persistence
    await rootStore.todos.save();
    const storage = services.storage;
    const saved = await storage.loadTodos();
    expect(saved.items.length).toBe(1);
  });
});
```

## API Documentation

### RootStore

```typescript
interface IRootStore {
  // Stores
  chat: IChatStore;
  todos: ITodoStore;
  config: IConfigStore;
  audio: IAudioStore;

  // Methods
  initialize(services?: IServices): Promise<void>;
  sendMessage(content: string): Promise<void>;
  reset(): Promise<void>;
  cleanup(): Promise<void>;
}
```

### TodoStore

```typescript
interface ITodoStore {
  // Properties
  items: ITodo[];
  count: number;
  activeTodos: ITodo[];
  completedTodos: ITodo[];

  // Actions
  addTodo(text: string): ITodo;
  completeTodo(id: number): void;
  removeTodo(id: number): void;
  setTodoStatus(id: number, status: TodoStatus): void;
  linkDependency(todoId: number, dependsOnId: number): void;

  // Persistence
  save(): Promise<void>;
  load(): Promise<void>;
}
```

### React Hooks

```typescript
// Store hooks
useRootStore(): IRootStore;
useChatStore(): IChatStore;
useTodoStore(): ITodoStore;
useConfigStore(): IConfigStore;
useAudioStore(): IAudioStore;

// Data hooks
useChatMessages(): IMessage[];
useFilteredTodos(): ITodo[];
useTodoStats(): TodoStatistics;
useStreamingState(): StreamingState;

// Utility hooks
useObservable<T>(getValue: () => T): T;
useReaction<T>(expression: () => T, effect: (value: T) => void): void;
useAutoSaveConfig(delay?: number): void;
```

## Advanced Features

### Dependency Management

Todos can have dependencies on other todos:

```typescript
const task1 = todos.addTodo('Setup database');
const task2 = todos.addTodo('Create API endpoints');
const task3 = todos.addTodo('Build frontend');

// task2 depends on task1
todos.linkDependency(task2.id, task1.id);
// task3 depends on task2
todos.linkDependency(task3.id, task2.id);

// Check which todos can be started
const startable = todos.getTodosWithResolvedDependencies();
```

### Multi-Phase Chat Workflow

The chat system supports multi-phase responses:

```typescript
await chat.streamMultiPhaseResponse(
  'Complex request',
  (phase) => {
    console.log(`Current phase: ${phase}`);
    // Phases: planning -> guidance -> execution
  }
);
```

### Memory Integration

Store and recall semantic memories:

```typescript
// Store exchange in memory
const memoryService = rootStore.getService('memory');
await memoryService.store({
  summary: 'Discussion about project architecture',
  embedding: await memoryService.createEmbedding(text),
  keywords: ['architecture', 'design', 'patterns']
});

// Recall relevant memories
const memories = await memoryService.search('design patterns', {
  maxResults: 5,
  threshold: 0.7
});
```

## Configuration

The package supports extensive configuration:

```typescript
// Apply configuration presets
config.applyPreset('advanced'); // Enables all features

// Or configure individually
config.setProvider('openai');
config.setModel('gpt-4o');
config.toggleMemory();
config.setReasoningEffort('high');
config.toggleAudioCapture();
```

## Development

```bash
# Install dependencies
bun install

# Run tests
bun test

# Build package
bun run build

# Watch mode
bun run dev
```

## Migration Guide

### From Legacy State Management

```typescript
// Before: Direct state manipulation
const todos = loadTodosFromFile();
todos.push({ id: 1, text: 'Task' });
saveTodosToFile(todos);

// After: Using MST stores
const todoStore = rootStore.todos;
await todoStore.load();
todoStore.addTodo('Task');
await todoStore.save(); // Automatic with autoSave
```

### Custom Services

Implement custom services for production:

```typescript
class ProductionStorageService implements IStorageService {
  async loadConfig(path: string) {
    // Load from actual file system
    return await fs.readJSON(path);
  }

  async saveConfig(path: string, config: any) {
    // Save to actual file system
    await fs.writeJSON(path, config);
  }
  // ... other methods
}

const services = {
  storage: new ProductionStorageService(),
  // ... other services
};

const rootStore = createRootStore(services);
```

## Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch
3. Write tests for your changes
4. Ensure all tests pass
5. Submit a pull request

## License

MIT

## Support

For issues and questions:
- GitHub Issues: [Report issues](https://github.com/yourusername/gsio-ai/issues)
- Documentation: [Full docs](https://docs.gsio.ai)