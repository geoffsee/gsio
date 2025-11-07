/**
 * Unit tests for TodoStore
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { createRootStore } from '../../src/RootStore';
import { createMockServices, MockStorageService } from '../../src/services/mocks';
import { ITodoStore } from '../../src/stores/TodoStore';
import { IRootStore } from '../../src/RootStore';

describe('TodoStore', () => {
  let rootStore: IRootStore;
  let todoStore: ITodoStore;
  let mockServices: ReturnType<typeof createMockServices>;

  beforeEach(() => {
    mockServices = createMockServices();
    rootStore = createRootStore(mockServices);
    todoStore = rootStore.todos;
  });

  describe('Adding Todos', () => {
    test('should add a new todo', () => {
      const todo = todoStore.addTodo('Test task');

      expect(todo.id).toBe(1);
      expect(todo.text).toBe('Test task');
      expect(todoStore.count).toBe(1);
      expect(todoStore.lastId).toBe(1);
    });

    test('should add multiple todos with incremental IDs', () => {
      const todo1 = todoStore.addTodo('First task');
      const todo2 = todoStore.addTodo('Second task');
      const todo3 = todoStore.addTodo('Third task');

      expect(todo1.id).toBe(1);
      expect(todo2.id).toBe(2);
      expect(todo3.id).toBe(3);
      expect(todoStore.count).toBe(3);
    });

    test('should add todo from text with parsed priority and status', () => {
      const todo = todoStore.addTodoFromText('!!! [in_progress] Important task');

      expect(todo.priority).toBe(3);
      expect(todo.status).toBe('in_progress');
      expect(todo.text).toBe('Important task');
    });

    test('should bulk add todos', () => {
      const texts = ['Task 1', 'Task 2', 'Task 3'];
      const todos = todoStore.bulkAddTodos(texts);

      expect(todos.length).toBe(3);
      expect(todoStore.count).toBe(3);
      expect(todos[0].text).toBe('Task 1');
      expect(todos[2].text).toBe('Task 3');
    });
  });

  describe('Updating Todos', () => {
    beforeEach(() => {
      todoStore.addTodo('Task 1');
      todoStore.addTodo('Task 2');
      todoStore.addTodo('Task 3');
    });

    test('should update todo text', () => {
      todoStore.updateTodo(1, 'Updated task');

      const todo = todoStore.getTodoById(1);
      expect(todo?.text).toBe('Updated task');
    });

    test('should set todo status', () => {
      todoStore.setTodoStatus(1, 'in_progress');

      const todo = todoStore.getTodoById(1);
      expect(todo?.status).toBe('in_progress');
    });

    test('should complete a todo', () => {
      todoStore.completeTodo(1);

      const todo = todoStore.getTodoById(1);
      expect(todo?.isDone).toBe(true);
    });

    test('should toggle todo completion', () => {
      const todo = todoStore.getTodoById(1)!;
      expect(todo.isDone).toBe(false);

      todoStore.toggleTodo(1);
      expect(todo.isDone).toBe(true);

      todoStore.toggleTodo(1);
      expect(todo.isDone).toBe(false);
    });

    test('should set todo priority', () => {
      todoStore.setTodoPriority(1, 1);

      const todo = todoStore.getTodoById(1);
      expect(todo?.priority).toBe(1);
    });

    test('should add note to todo', () => {
      todoStore.addTodoNote(1, 'Important note');

      const todo = todoStore.getTodoById(1);
      expect(todo?.noteCount).toBe(1);
      expect(todo?.notes[0].text).toBe('Important note');
    });
  });

  describe('Removing Todos', () => {
    beforeEach(() => {
      todoStore.addTodo('Task 1');
      todoStore.addTodo('Task 2');
      todoStore.addTodo('Task 3');
    });

    test('should remove a todo', () => {
      todoStore.removeTodo(2);

      expect(todoStore.count).toBe(2);
      expect(todoStore.getTodoById(2)).toBeUndefined();
    });

    test('should clear all todos', () => {
      todoStore.clearAllTodos();

      expect(todoStore.count).toBe(0);
      expect(todoStore.isEmpty).toBe(true);
      expect(todoStore.lastId).toBe(0);
    });

    test('should clear completed todos', () => {
      todoStore.completeTodo(1);
      todoStore.completeTodo(3);

      todoStore.clearCompletedTodos();

      expect(todoStore.count).toBe(1);
      expect(todoStore.getTodoById(2)).toBeDefined();
    });
  });

  describe('Dependencies', () => {
    beforeEach(() => {
      todoStore.addTodo('Task 1');
      todoStore.addTodo('Task 2');
      todoStore.addTodo('Task 3');
    });

    test('should link dependencies', () => {
      todoStore.linkDependency(2, 1);
      todoStore.linkDependency(3, 2);

      const todo2 = todoStore.getTodoById(2)!;
      const todo3 = todoStore.getTodoById(3)!;

      expect(todo2.dependsOn).toContain(1);
      expect(todo3.dependsOn).toContain(2);
    });

    test('should unlink dependencies', () => {
      todoStore.linkDependency(2, 1);
      todoStore.unlinkDependency(2, 1);

      const todo2 = todoStore.getTodoById(2)!;
      expect(todo2.dependsOn).not.toContain(1);
    });

    test('should prevent circular dependencies', () => {
      todoStore.linkDependency(2, 1);
      todoStore.linkDependency(3, 2);

      expect(() => todoStore.linkDependency(1, 3)).toThrow('circular dependency');
    });

    test('should prevent self-dependency', () => {
      expect(() => todoStore.linkDependency(1, 1)).toThrow('cannot depend on itself');
    });

    test('should get todos with resolved dependencies', () => {
      todoStore.linkDependency(2, 1);
      todoStore.linkDependency(3, 2);

      let resolvable = todoStore.getTodosWithResolvedDependencies();
      expect(resolvable.length).toBe(1);
      expect(resolvable[0].id).toBe(1);

      todoStore.completeTodo(1);
      resolvable = todoStore.getTodosWithResolvedDependencies();
      expect(resolvable.length).toBe(2); // 1 (completed) and 2 (now resolvable)
    });

    test('should get todos blocked by dependencies', () => {
      todoStore.linkDependency(2, 1);
      todoStore.linkDependency(3, 2);

      const blocked = todoStore.getTodosBlockedByDependencies();
      expect(blocked.length).toBe(2);
      expect(blocked.map(t => t.id)).toContain(2);
      expect(blocked.map(t => t.id)).toContain(3);
    });

    test('should remove dependencies when todo is deleted', () => {
      todoStore.linkDependency(2, 1);
      todoStore.linkDependency(3, 1);

      todoStore.removeTodo(1);

      const todo2 = todoStore.getTodoById(2)!;
      const todo3 = todoStore.getTodoById(3)!;

      expect(todo2.dependsOn).not.toContain(1);
      expect(todo3.dependsOn).not.toContain(1);
    });
  });

  describe('Filtering and Search', () => {
    beforeEach(() => {
      todoStore.addTodo('Important task', 'todo');
      todoStore.addTodo('Work in progress', 'in_progress');
      todoStore.addTodo('Blocked task', 'blocked', 2);
      todoStore.addTodo('Completed task', 'done');
      todoStore.addTodo('Another done task', 'done');
    });

    test('should filter active todos', () => {
      const active = todoStore.activeTodos;
      expect(active.length).toBe(3);
    });

    test('should filter completed todos', () => {
      const completed = todoStore.completedTodos;
      expect(completed.length).toBe(2);
    });

    test('should filter blocked todos', () => {
      const blocked = todoStore.blockedTodos;
      expect(blocked.length).toBe(1);
    });

    test('should filter in-progress todos', () => {
      const inProgress = todoStore.inProgressTodos;
      expect(inProgress.length).toBe(1);
    });

    test('should filter high priority todos', () => {
      const highPriority = todoStore.highPriorityTodos;
      expect(highPriority.length).toBe(1);
      expect(highPriority[0].text).toBe('Blocked task');
    });

    test('should apply filter setting', () => {
      todoStore.setFilter('active');
      expect(todoStore.filteredTodos.length).toBe(3);

      todoStore.setFilter('completed');
      expect(todoStore.filteredTodos.length).toBe(2);

      todoStore.setFilter('blocked');
      expect(todoStore.filteredTodos.length).toBe(1);

      todoStore.setFilter('all');
      expect(todoStore.filteredTodos.length).toBe(5);
    });

    test('should search todos', () => {
      todoStore.setSearchQuery('task');
      const results = todoStore.filteredTodos;
      expect(results.length).toBe(4); // All except "Work in progress"

      todoStore.setSearchQuery('important');
      expect(todoStore.filteredTodos.length).toBe(1);
    });

    test('should hide completed todos when configured', () => {
      todoStore.toggleShowCompleted();
      expect(todoStore.filteredTodos.length).toBe(3);

      todoStore.toggleShowCompleted();
      expect(todoStore.filteredTodos.length).toBe(5);
    });
  });

  describe('Focus Management', () => {
    beforeEach(() => {
      todoStore.addTodo('Task 1');
      todoStore.addTodo('Task 2');
      todoStore.addTodo('Task 3');
    });

    test('should set focus on todo', () => {
      todoStore.setFocus(2);
      expect(todoStore.focusedId).toBe(2);
      expect(todoStore.focusedTodo?.text).toBe('Task 2');
    });

    test('should focus next todo', () => {
      todoStore.setFocus(1);
      todoStore.focusNext();
      expect(todoStore.focusedId).toBe(2);

      todoStore.focusNext();
      expect(todoStore.focusedId).toBe(3);

      // Should not move past the last todo
      todoStore.focusNext();
      expect(todoStore.focusedId).toBe(3);
    });

    test('should focus previous todo', () => {
      todoStore.setFocus(3);
      todoStore.focusPrevious();
      expect(todoStore.focusedId).toBe(2);

      todoStore.focusPrevious();
      expect(todoStore.focusedId).toBe(1);

      // Should not move before the first todo
      todoStore.focusPrevious();
      expect(todoStore.focusedId).toBe(1);
    });
  });

  describe('Statistics', () => {
    beforeEach(() => {
      todoStore.addTodo('Task 1', 'todo');
      todoStore.addTodo('Task 2', 'in_progress');
      todoStore.addTodo('Task 3', 'blocked');
      todoStore.addTodo('Task 4', 'done');
      todoStore.addTodo('Task 5', 'done');
    });

    test('should calculate statistics', () => {
      const stats = todoStore.statistics;

      expect(stats.total).toBe(5);
      expect(stats.completed).toBe(2);
      expect(stats.active).toBe(3);
      expect(stats.blocked).toBe(1);
      expect(stats.inProgress).toBe(1);
      expect(stats.pending).toBe(1);
      expect(stats.completionRate).toBe(40); // 2/5 * 100
    });
  });

  describe('Persistence with Storage Service', () => {
    test('should save todos through storage service', async () => {
      todoStore.addTodo('Task to save');
      todoStore.addTodo('Another task');

      await todoStore.save();

      const storage = mockServices.storage as MockStorageService;
      const savedData = await storage.loadTodos();

      expect(savedData).toBeDefined();
      expect(savedData?.lastId).toBe(2);
      expect(savedData?.items.length).toBe(2);
    });

    test('should load todos from storage service', async () => {
      const storage = mockServices.storage as MockStorageService;
      await storage.saveTodos({
        lastId: 3,
        items: [
          { id: 1, text: 'Loaded task 1', status: 'todo', priority: 3 },
          { id: 2, text: 'Loaded task 2', status: 'done', priority: 2 },
          { id: 3, text: 'Loaded task 3', status: 'in_progress', priority: 1 }
        ]
      });

      await todoStore.load();

      expect(todoStore.count).toBe(3);
      expect(todoStore.lastId).toBe(3);
      expect(todoStore.getTodoById(1)?.text).toBe('Loaded task 1');
      expect(todoStore.getTodoById(2)?.isDone).toBe(true);
      expect(todoStore.getTodoById(3)?.isInProgress).toBe(true);
    });

    test('should import/export todos', () => {
      todoStore.addTodo('Export task 1');
      todoStore.addTodo('Export task 2');
      todoStore.completeTodo(1);

      const exported = todoStore.exportTodos();

      // Clear and re-import
      todoStore.clearAllTodos();
      expect(todoStore.count).toBe(0);

      todoStore.importTodos(exported);

      expect(todoStore.count).toBe(2);
      expect(todoStore.getTodoById(1)?.text).toBe('Export task 1');
      expect(todoStore.getTodoById(1)?.isDone).toBe(true);
    });
  });
});