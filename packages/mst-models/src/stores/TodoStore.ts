/**
 * Todo store for task management
 */

import { types, flow, Instance, SnapshotIn, getRoot, getSnapshot } from 'mobx-state-tree';
import { TodoModel, ITodo, createTodo, createTodoFromText, TodoStatus, TodoPriority } from '../models/TodoModel';
import { withLoadingState } from '../models/base/mixins';

/**
 * Main Todo Store
 */
export const TodoStore = types.compose(
  'TodoStore',
  withLoadingState,
  types.model({
    items: types.optional(types.array(TodoModel), []),
    lastId: types.optional(types.number, 0),
    focusedId: types.maybeNull(types.number),
    // Filtering and display
    showCompleted: types.optional(types.boolean, true),
    filter: types.optional(
      types.enumeration(['all', 'active', 'completed', 'blocked']),
      'all'
    ),
    searchQuery: types.optional(types.string, ''),
    // Persistence
    autoSave: types.optional(types.boolean, true),
    lastSavedAt: types.maybe(types.Date)
  })
)
.views((self) => ({
  get count() {
    return self.items.length;
  },

  get isEmpty() {
    return self.items.length === 0;
  },

  get hasTodos() {
    return self.items.length > 0;
  },

  get focusedTodo() {
    if (self.focusedId === null) return null;
    return self.items.find(t => t.id === self.focusedId) || null;
  },

  getTodoById(id: number) {
    return self.items.find(t => t.id === id);
  },

  getTodosByStatus(status: TodoStatus) {
    return self.items.filter(t => t.status === status);
  },

  getTodosByPriority(priority: TodoPriority) {
    return self.items.filter(t => t.priority === priority);
  },

  get activeTodos() {
    return self.items.filter(t => !t.isDone);
  },

  get completedTodos() {
    return self.items.filter(t => t.isDone);
  },

  get blockedTodos() {
    return self.items.filter(t => t.isBlocked);
  },

  get inProgressTodos() {
    return self.items.filter(t => t.isInProgress);
  },

  get pendingTodos() {
    return self.items.filter(t => t.isTodo);
  },

  get highPriorityTodos() {
    return self.items.filter(t => t.priority <= 2 && !t.isDone);
  },

  get overdueTodos() {
    return self.items.filter(t => t.isOverdue);
  },

  /**
   * Get filtered todos based on current filter settings
   */
  get filteredTodos() {
    let todos = [...self.items];

    // Apply status filter
    switch (self.filter) {
      case 'active':
        todos = todos.filter(t => !t.isDone);
        break;
      case 'completed':
        todos = todos.filter(t => t.isDone);
        break;
      case 'blocked':
        todos = todos.filter(t => t.isBlocked);
        break;
    }

    // Apply search query
    if (self.searchQuery) {
      const query = self.searchQuery.toLowerCase();
      todos = todos.filter(t =>
        t.text.toLowerCase().includes(query) ||
        t.notes.some(n => n.text.toLowerCase().includes(query))
      );
    }

    // Apply show completed filter
    if (!self.showCompleted) {
      todos = todos.filter(t => !t.isDone);
    }

    return todos;
  },

  /**
   * Get todos with resolved dependencies
   */
  getTodosWithResolvedDependencies() {
    return self.items.filter(todo => {
      if (todo.dependsOn.length === 0) return true;
      return todo.dependsOn.every(depId => {
        const dep = this.getTodoById(depId);
        return !dep || dep.isDone;
      });
    });
  },

  /**
   * Get todos blocked by dependencies
   */
  getTodosBlockedByDependencies() {
    return self.items.filter(todo => {
      if (todo.dependsOn.length === 0) return false;
      return todo.dependsOn.some(depId => {
        const dep = this.getTodoById(depId);
        return dep && !dep.isDone;
      });
    });
  },

  /**
   * Check if todo can be started
   */
  canStartTodo(id: number) {
    const todo = this.getTodoById(id);
    if (!todo) return false;

    // Check dependencies
    return todo.dependsOn.every(depId => {
      const dep = this.getTodoById(depId);
      return !dep || dep.isDone;
    });
  },

  /**
   * Get statistics
   */
  get statistics() {
    return {
      total: self.items.length,
      completed: this.completedTodos.length,
      active: this.activeTodos.length,
      blocked: this.blockedTodos.length,
      inProgress: this.inProgressTodos.length,
      pending: this.pendingTodos.length,
      overdue: this.overdueTodos.length,
      completionRate: self.items.length > 0
        ? (this.completedTodos.length / self.items.length) * 100
        : 0
    };
  },

  /**
   * Export todos as plain objects
   */
  exportTodos() {
    return {
      lastId: self.lastId,
      items: self.items.map(todo => getSnapshot(todo))
    };
  }
}))
.actions((self) => ({
  /**
   * Generate next ID
   */
  nextId() {
    self.lastId++;
    return self.lastId;
  },

  /**
   * Add a new todo
   */
  addTodo(text: string, status?: TodoStatus, priority?: TodoPriority): ITodo {
    const id = this.nextId();
    const todo = createTodo(id, text, status, priority);
    self.items.push(todo);
    this.autoSaveIfEnabled();
    return todo;
  },

  /**
   * Add todo from text (parses priority and status)
   */
  addTodoFromText(text: string): ITodo {
    const id = this.nextId();
    const todo = createTodoFromText(id, text);
    self.items.push(todo);
    this.autoSaveIfEnabled();
    return todo;
  },

  /**
   * Add multiple todos at once
   */
  bulkAddTodos(texts: string[]): ITodo[] {
    const todos: ITodo[] = [];
    for (const text of texts) {
      todos.push(this.addTodoFromText(text));
    }
    return todos;
  },

  /**
   * Update todo text
   */
  updateTodo(id: number, text: string) {
    const todo = self.getTodoById(id);
    if (todo) {
      todo.setText(text);
      this.autoSaveIfEnabled();
    }
  },

  /**
   * Remove a todo
   */
  removeTodo(id: number) {
    const index = self.items.findIndex(t => t.id === id);
    if (index !== -1) {
      // Remove dependencies from other todos
      self.items.forEach(todo => {
        todo.removeDependency(id);
      });
      self.items.splice(index, 1);
      this.autoSaveIfEnabled();
    }
  },

  /**
   * Clear all todos
   */
  clearAllTodos() {
    self.items.clear();
    self.lastId = 0;
    self.focusedId = null;
    this.autoSaveIfEnabled();
  },

  /**
   * Clear completed todos
   */
  clearCompletedTodos() {
    const completedIds = self.completedTodos.map(t => t.id);
    completedIds.forEach(id => this.removeTodo(id));
  },

  /**
   * Set todo status
   */
  setTodoStatus(id: number, status: TodoStatus, reason?: string) {
    const todo = self.getTodoById(id);
    if (todo) {
      todo.setStatus(status, reason);
      this.autoSaveIfEnabled();
    }
  },

  /**
   * Complete a todo
   */
  completeTodo(id: number) {
    this.setTodoStatus(id, 'done');
  },

  /**
   * Toggle todo completion
   */
  toggleTodo(id: number) {
    const todo = self.getTodoById(id);
    if (todo) {
      todo.toggleComplete();
      this.autoSaveIfEnabled();
    }
  },

  /**
   * Set todo priority
   */
  setTodoPriority(id: number, priority: TodoPriority) {
    const todo = self.getTodoById(id);
    if (todo) {
      todo.setPriority(priority);
      this.autoSaveIfEnabled();
    }
  },

  /**
   * Add note to todo
   */
  addTodoNote(id: number, note: string) {
    const todo = self.getTodoById(id);
    if (todo) {
      todo.addNote(note);
      this.autoSaveIfEnabled();
    }
  },

  /**
   * Link todo dependency
   */
  linkDependency(todoId: number, dependsOnId: number) {
    if (todoId === dependsOnId) {
      throw new Error('Todo cannot depend on itself');
    }

    const todo = self.getTodoById(todoId);
    const dependency = self.getTodoById(dependsOnId);

    if (todo && dependency) {
      // Check for circular dependencies
      if (this.wouldCreateCircularDependency(todoId, dependsOnId)) {
        throw new Error('This would create a circular dependency');
      }

      todo.addDependency(dependsOnId);
      this.autoSaveIfEnabled();
    }
  },

  /**
   * Unlink todo dependency
   */
  unlinkDependency(todoId: number, dependsOnId: number) {
    const todo = self.getTodoById(todoId);
    if (todo) {
      todo.removeDependency(dependsOnId);
      this.autoSaveIfEnabled();
    }
  },

  /**
   * Check for circular dependencies
   */
  wouldCreateCircularDependency(todoId: number, dependsOnId: number): boolean {
    const visited = new Set<number>();
    const stack = [dependsOnId];

    while (stack.length > 0) {
      const current = stack.pop()!;
      if (current === todoId) return true;
      if (visited.has(current)) continue;

      visited.add(current);
      const todo = self.getTodoById(current);
      if (todo) {
        stack.push(...todo.dependsOn);
      }
    }

    return false;
  },

  /**
   * Set focus on a todo
   */
  setFocus(id: number | null) {
    self.focusedId = id;
  },

  /**
   * Focus next todo
   */
  focusNext() {
    const todos = self.filteredTodos;
    if (todos.length === 0) return;

    if (self.focusedId === null) {
      self.focusedId = todos[0].id;
    } else {
      const currentIndex = todos.findIndex(t => t.id === self.focusedId);
      if (currentIndex !== -1 && currentIndex < todos.length - 1) {
        self.focusedId = todos[currentIndex + 1].id;
      }
    }
  },

  /**
   * Focus previous todo
   */
  focusPrevious() {
    const todos = self.filteredTodos;
    if (todos.length === 0) return;

    if (self.focusedId === null) {
      self.focusedId = todos[todos.length - 1].id;
    } else {
      const currentIndex = todos.findIndex(t => t.id === self.focusedId);
      if (currentIndex > 0) {
        self.focusedId = todos[currentIndex - 1].id;
      }
    }
  },

  /**
   * Complete and remove outstanding todos
   */
  completeAndRemoveOutstandingTodos() {
    const outstandingTodos = self.activeTodos;
    outstandingTodos.forEach(todo => {
      todo.setStatus('done');
      todo.addNote('Auto-completed on session end');
    });
    this.autoSaveIfEnabled();
  },

  /**
   * Set filter
   */
  setFilter(filter: 'all' | 'active' | 'completed' | 'blocked') {
    self.filter = filter;
  },

  /**
   * Set search query
   */
  setSearchQuery(query: string) {
    self.searchQuery = query;
  },

  /**
   * Toggle show completed
   */
  toggleShowCompleted() {
    self.showCompleted = !self.showCompleted;
  },

  /**
   * Auto-save if enabled
   */
  autoSaveIfEnabled() {
    if (self.autoSave) {
      this.save();
    }
  },

  /**
   * Save todos (requires storage service injection)
   */
  save: flow(function* () {
    try {
      self.lastSavedAt = new Date();
      // Storage service will be injected via dependency injection
      const root = getRoot(self) as any;
      if (root.services?.storage) {
        yield root.services.storage.saveTodos(self.exportTodos());
      }
    } catch (error: any) {
      self.setError(`Failed to save todos: ${error.message}`);
    }
  }),

  /**
   * Load todos (requires storage service injection)
   */
  load: flow(function* () {
    try {
      self.setLoading(true);
      const root = getRoot(self) as any;
      if (root.services?.storage) {
        const data = yield root.services.storage.loadTodos();
        if (data) {
          self.lastId = data.lastId || 0;
          self.items.clear();
          data.items.forEach((item: any) => {
            const todo = TodoModel.create(item);
            todo.migrateLegacyFields();
            self.items.push(todo);
          });
        }
      }
      self.setLoading(false);
    } catch (error: any) {
      self.setError(`Failed to load todos: ${error.message}`);
    }
  }),

  /**
   * Import todos from JSON
   */
  importTodos(data: { lastId: number; items: any[] }) {
    self.lastId = data.lastId;
    self.items.clear();
    data.items.forEach(item => {
      self.items.push(TodoModel.create(item));
    });
    this.autoSaveIfEnabled();
  }
}));

// Type exports
export interface ITodoStore extends Instance<typeof TodoStore> {}
export interface ITodoStoreSnapshot extends SnapshotIn<typeof TodoStore> {}

// Factory function
export function createTodoStore(): ITodoStore {
  return TodoStore.create({});
}