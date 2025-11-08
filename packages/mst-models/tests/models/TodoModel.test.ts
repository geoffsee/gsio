/**
 * Unit tests for TodoModel
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { TodoModel, createTodo, createTodoFromText } from '../../src/models/TodoModel';

describe('TodoModel', () => {
  describe('Basic Operations', () => {
    test('should create a todo with default values', () => {
      const todo = createTodo(1, 'Test task');

      expect(todo.id).toBe(1);
      expect(todo.text).toBe('Test task');
      expect(todo.status).toBe('todo');
      expect(todo.priority).toBe(3);
      expect(todo.isDone).toBe(false);
    });

    test('should create a todo with custom values', () => {
      const todo = createTodo(2, 'Important task', 'in_progress', 1);

      expect(todo.id).toBe(2);
      expect(todo.text).toBe('Important task');
      expect(todo.status).toBe('in_progress');
      expect(todo.priority).toBe(1);
      expect(todo.isInProgress).toBe(true);
    });

    test('should update todo text', () => {
      const todo = createTodo(1, 'Original text');
      todo.setText('Updated text');

      expect(todo.text).toBe('Updated text');
    });
  });

  describe('Status Management', () => {
    let todo: any;

    beforeEach(() => {
      todo = createTodo(1, 'Test task');
    });

    test('should change status to in_progress', () => {
      todo.setStatus('in_progress');
      expect(todo.status).toBe('in_progress');
      expect(todo.isInProgress).toBe(true);
    });

    test('should change status to done', () => {
      todo.setStatus('done');
      expect(todo.status).toBe('done');
      expect(todo.isDone).toBe(true);
      expect(todo.completed).toBe(true);
      expect(todo.completedAt).toBeTruthy();
    });

    test('should change status to blocked with reason', () => {
      todo.setStatus('blocked', 'Waiting for approval');
      expect(todo.status).toBe('blocked');
      expect(todo.isBlocked).toBe(true);
      expect(todo.blockedReason).toBe('Waiting for approval');
    });

    test('should toggle completion', () => {
      expect(todo.isDone).toBe(false);

      todo.toggleComplete();
      expect(todo.isDone).toBe(true);

      todo.toggleComplete();
      expect(todo.isDone).toBe(false);
    });

    test('should validate status transitions', () => {
      expect(todo.canTransitionTo('in_progress')).toBe(true);
      expect(todo.canTransitionTo('blocked')).toBe(true);
      expect(todo.canTransitionTo('done')).toBe(true);

      todo.setStatus('done');
      expect(todo.canTransitionTo('todo')).toBe(true);
      expect(todo.canTransitionTo('in_progress')).toBe(false);
    });

    test('should throw error on invalid transition', () => {
      todo.setStatus('done');
      expect(() => todo.setStatus('in_progress')).toThrow();
    });
  });

  describe('Priority Management', () => {
    test('should set priority', () => {
      const todo = createTodo(1, 'Test task');

      todo.setPriority(1);
      expect(todo.priority).toBe(1);

      todo.setPriority(5);
      expect(todo.priority).toBe(5);
    });

    test('should increase priority', () => {
      const todo = createTodo(1, 'Test task', 'todo', 3);

      todo.increasePriority();
      expect(todo.priority).toBe(2);

      todo.increasePriority();
      expect(todo.priority).toBe(1);

      // Should not go below 1
      todo.increasePriority();
      expect(todo.priority).toBe(1);
    });

    test('should decrease priority', () => {
      const todo = createTodo(1, 'Test task', 'todo', 3);

      todo.decreasePriority();
      expect(todo.priority).toBe(4);

      todo.decreasePriority();
      expect(todo.priority).toBe(5);

      // Should not go above 5
      todo.decreasePriority();
      expect(todo.priority).toBe(5);
    });
  });

  describe('Dependencies', () => {
    let todo: any;

    beforeEach(() => {
      todo = createTodo(1, 'Test task');
    });

    test('should add dependencies', () => {
      todo.addDependency(2);
      todo.addDependency(3);

      expect(todo.hasDependencies).toBe(true);
      expect(todo.dependencyCount).toBe(2);
      expect(todo.dependsOn).toContain(2);
      expect(todo.dependsOn).toContain(3);
    });

    test('should not add duplicate dependencies', () => {
      todo.addDependency(2);
      todo.addDependency(2);

      expect(todo.dependencyCount).toBe(1);
    });

    test('should not add self as dependency', () => {
      todo.addDependency(1);

      expect(todo.dependencyCount).toBe(0);
    });

    test('should remove dependencies', () => {
      todo.addDependency(2);
      todo.addDependency(3);

      todo.removeDependency(2);

      expect(todo.dependencyCount).toBe(1);
      expect(todo.dependsOn).not.toContain(2);
      expect(todo.dependsOn).toContain(3);
    });

    test('should clear all dependencies', () => {
      todo.addDependency(2);
      todo.addDependency(3);

      todo.clearDependencies();

      expect(todo.hasDependencies).toBe(false);
      expect(todo.dependencyCount).toBe(0);
    });
  });

  describe('Notes', () => {
    let todo: any;

    beforeEach(() => {
      todo = createTodo(1, 'Test task');
    });

    test('should add notes', () => {
      const note1 = todo.addNote('First note');
      const note2 = todo.addNote('Second note');

      expect(todo.hasNotes).toBe(true);
      expect(todo.noteCount).toBe(2);
      expect(todo.notes[0].text).toBe('First note');
      expect(todo.notes[1].text).toBe('Second note');
    });

    test('should remove notes', () => {
      const note1 = todo.addNote('First note');
      const note2 = todo.addNote('Second note');

      todo.removeNote(note1.id);

      expect(todo.noteCount).toBe(1);
      expect(todo.notes[0].text).toBe('Second note');
    });

    test('should clear all notes', () => {
      todo.addNote('First note');
      todo.addNote('Second note');

      todo.clearNotes();

      expect(todo.hasNotes).toBe(false);
      expect(todo.noteCount).toBe(0);
    });
  });

  describe('Due Dates and Time Tracking', () => {
    test('should set due date', () => {
      const todo = createTodo(1, 'Test task');
      const dueDate = new Date('2024-12-31');

      todo.setDueDate(dueDate);

      expect(todo.dueDate).toEqual(dueDate);
    });

    test('should identify overdue todos', () => {
      const todo = createTodo(1, 'Test task');
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);

      todo.setDueDate(pastDate);

      expect(todo.isOverdue).toBe(true);

      // Complete the todo
      todo.setStatus('done');
      expect(todo.isOverdue).toBe(false);
    });

    test('should calculate days until due', () => {
      const todo = createTodo(1, 'Test task');
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 7);

      todo.setDueDate(futureDate);

      expect(todo.daysUntilDue).toBe(7);
    });

    test('should track estimated and actual time', () => {
      const todo = createTodo(1, 'Test task');

      todo.setEstimatedTime(60); // 60 minutes
      todo.setActualTime(75); // 75 minutes

      expect(todo.timeTracking.estimated).toBe(60);
      expect(todo.timeTracking.actual).toBe(75);
      expect(todo.timeTracking.variance).toBe(15);
      expect(todo.timeTracking.efficiency).toBeCloseTo(80, 1); // 60/75 * 100
    });
  });

  describe('Text Parsing', () => {
    test('should parse priority from text', () => {
      const todo1 = createTodoFromText(1, '!!! High priority task');
      expect(todo1.priority).toBe(3); // 6 - 3 = 3
      expect(todo1.text).toBe('High priority task');

      const todo2 = createTodoFromText(2, '!!!!! Urgent task');
      expect(todo2.priority).toBe(1); // 6 - 5 = 1
      expect(todo2.text).toBe('Urgent task');
    });

    test('should parse status from text', () => {
      const todo1 = createTodoFromText(1, '[in_progress] Working on this');
      expect(todo1.status).toBe('in_progress');
      expect(todo1.text).toBe('Working on this');

      const todo2 = createTodoFromText(2, '[done] Completed task');
      expect(todo2.status).toBe('done');
      expect(todo2.text).toBe('Completed task');
    });

    test('should parse both priority and status', () => {
      const todo = createTodoFromText(1, '!! [blocked] Important blocked task');
      expect(todo.priority).toBe(4); // 6 - 2 = 4
      expect(todo.status).toBe('blocked');
      expect(todo.text).toBe('Important blocked task');
    });
  });

  describe('Views and Computed Properties', () => {
    test('should generate summary', () => {
      const todo = createTodo(1, 'Test task', 'in_progress', 2);
      const summary = todo.summary;

      expect(summary).toContain('◐'); // in_progress icon
      expect(summary).toContain('Test task');
      expect(summary).toContain('!!!!'); // priority 2 = 4 exclamations
    });

    test('should handle legacy fields migration', () => {
      const todo = TodoModel.create({
        id: 1,
        text: 'Test task',
        completed: true,
        status: 'todo'
      });

      todo.migrateLegacyFields();

      expect(todo.status).toBe('done');
      expect(todo.completedAt).toBeTruthy();
    });
  });

  describe('Cloning', () => {
    test('should create a deep clone', () => {
      const original = createTodo(1, 'Original task', 'in_progress', 2);
      original.addDependency(2);
      original.addNote('Test note');
      original.setCategory('work');

      const clone = original.clone();

      expect(clone.id).toBe(original.id);
      expect(clone.text).toBe(original.text);
      expect(clone.status).toBe(original.status);
      expect(clone.priority).toBe(original.priority);
      expect(clone.dependsOn).toEqual(original.dependsOn);
      expect(clone.notes.length).toBe(original.notes.length);
      expect(clone.category).toBe(original.category);

      // Verify it's a deep clone
      clone.setText('Modified text');
      expect(original.text).toBe('Original task');
      expect(clone.text).toBe('Modified text');
    });
  });
});