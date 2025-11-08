/**
 * Todo model for task management
 */

import { types, Instance, SnapshotIn, SnapshotOut } from 'mobx-state-tree';
import { withNumericId, withTimestamps, withPriority, withSerialization } from './base/mixins';
import { TodoStatus, TodoPriority } from './base/types';

/**
 * Note model for todo items
 */
export const TodoNote = types.model('TodoNote', {
  id: types.identifier,
  text: types.string,
  createdAt: types.optional(types.Date, () => new Date())
});

/**
 * Main Todo model
 */
export const TodoModel = types.compose(
  'TodoModel',
  withNumericId,
  withTimestamps,
  withPriority,
  withSerialization,
  types.model({
    text: types.string,
    status: types.optional(
      types.enumeration<TodoStatus>(['todo', 'in_progress', 'blocked', 'done']),
      'todo'
    ),
    // Legacy field for backward compatibility
    completed: types.maybe(types.boolean),
    completedAt: types.maybe(types.Date),
    blockedReason: types.maybe(types.string),
    dependsOn: types.optional(types.array(types.number), []),
    notes: types.optional(types.array(TodoNote), []),
    // Additional metadata
    category: types.optional(types.string, ''),
    dueDate: types.maybe(types.Date),
    estimatedTime: types.maybe(types.number), // in minutes
    actualTime: types.maybe(types.number) // in minutes
  })
)
.views((self) => ({
  get isTodo() {
    return self.status === 'todo';
  },
  get isInProgress() {
    return self.status === 'in_progress';
  },
  get isBlocked() {
    return self.status === 'blocked';
  },
  get isDone() {
    return self.status === 'done' || self.completed === true;
  },
  get isComplete() {
    return this.isDone;
  },
  get isPending() {
    return !this.isDone;
  },
  get hasDependencies() {
    return self.dependsOn.length > 0;
  },
  get dependencyCount() {
    return self.dependsOn.length;
  },
  get hasNotes() {
    return self.notes.length > 0;
  },
  get noteCount() {
    return self.notes.length;
  },
  get isOverdue() {
    if (!self.dueDate) return false;
    return new Date() > self.dueDate && !this.isDone;
  },
  get daysUntilDue() {
    if (!self.dueDate) return null;
    const now = new Date();
    const diff = self.dueDate.getTime() - now.getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  },
  get timeTracking() {
    return {
      estimated: self.estimatedTime,
      actual: self.actualTime,
      variance: self.estimatedTime && self.actualTime
        ? self.actualTime - self.estimatedTime
        : null,
      efficiency: self.estimatedTime && self.actualTime
        ? (self.estimatedTime / self.actualTime) * 100
        : null
    };
  },
  get summary() {
    const statusIcon = {
      'todo': '○',
      'in_progress': '◐',
      'blocked': '⊗',
      'done': '●'
    }[self.status];

    const priorityIcon = '!'.repeat(6 - self.priority);

    return `${statusIcon} ${self.text} ${priorityIcon}`.trim();
  },
  canTransitionTo(status: TodoStatus): boolean {
    // Define valid status transitions
    const transitions: Record<TodoStatus, TodoStatus[]> = {
      'todo': ['in_progress', 'blocked', 'done'],
      'in_progress': ['todo', 'blocked', 'done'],
      'blocked': ['todo', 'in_progress', 'done'],
      'done': ['todo'] // Can only reopen to todo
    };

    return transitions[self.status].includes(status);
  }
}))
.actions((self) => ({
  setText(text: string) {
    self.text = text;
    self.updateTimestamp();
  },

  setStatus(status: TodoStatus, reason?: string) {
    if (!self.canTransitionTo(status)) {
      throw new Error(`Cannot transition from ${self.status} to ${status}`);
    }

    self.status = status;

    // Handle blocked status
    if (status === 'blocked') {
      self.blockedReason = reason || 'No reason provided';
    } else {
      self.blockedReason = undefined;
    }

    // Handle completion
    if (status === 'done') {
      self.completed = true;
      self.completedAt = new Date();
      if (!self.actualTime) {
        // Auto-calculate actual time if not set
        const start = self.createdAt;
        const end = new Date();
        self.actualTime = Math.floor((end.getTime() - start.getTime()) / 60000);
      }
    } else {
      self.completed = false;
      self.completedAt = undefined;
    }

    self.updateTimestamp();
  },

  markAsDone() {
    this.setStatus('done');
  },

  markAsInProgress() {
    this.setStatus('in_progress');
  },

  markAsBlocked(reason: string) {
    this.setStatus('blocked', reason);
  },

  markAsTodo() {
    this.setStatus('todo');
  },

  toggleComplete() {
    if (self.isDone) {
      this.setStatus('todo');
    } else {
      this.setStatus('done');
    }
  },

  setCategory(category: string) {
    self.category = category;
    self.updateTimestamp();
  },

  setDueDate(date: Date | null) {
    self.dueDate = date || undefined;
    self.updateTimestamp();
  },

  setEstimatedTime(minutes: number | null) {
    self.estimatedTime = minutes || undefined;
    self.updateTimestamp();
  },

  setActualTime(minutes: number | null) {
    self.actualTime = minutes || undefined;
    self.updateTimestamp();
  },

  addDependency(todoId: number) {
    if (!self.dependsOn.includes(todoId) && todoId !== self.id) {
      self.dependsOn.push(todoId);
      self.updateTimestamp();
    }
  },

  removeDependency(todoId: number) {
    const index = self.dependsOn.indexOf(todoId);
    if (index !== -1) {
      self.dependsOn.splice(index, 1);
      self.updateTimestamp();
    }
  },

  clearDependencies() {
    self.dependsOn.clear();
    self.updateTimestamp();
  },

  addNote(text: string) {
    const note = TodoNote.create({
      id: `note-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      text
    });
    self.notes.push(note);
    self.updateTimestamp();
    return note;
  },

  removeNote(noteId: string) {
    const index = self.notes.findIndex(n => n.id === noteId);
    if (index !== -1) {
      self.notes.splice(index, 1);
      self.updateTimestamp();
    }
  },

  clearNotes() {
    self.notes.clear();
    self.updateTimestamp();
  },

  clone(): Instance<typeof TodoModel> {
    return TodoModel.create({
      id: self.id,
      text: self.text,
      status: self.status,
      priority: self.priority,
      completed: self.completed,
      completedAt: self.completedAt,
      blockedReason: self.blockedReason,
      dependsOn: [...self.dependsOn],
      notes: self.notes.map(n => ({
        id: n.id,
        text: n.text,
        createdAt: n.createdAt
      })),
      category: self.category,
      dueDate: self.dueDate,
      estimatedTime: self.estimatedTime,
      actualTime: self.actualTime,
      createdAt: self.createdAt,
      updatedAt: self.updatedAt
    });
  },

  /**
   * Update from legacy format
   */
  migrateLegacyFields() {
    if (self.completed !== undefined) {
      if (self.completed && self.status !== 'done') {
        self.status = 'done';
        if (!self.completedAt) {
          self.completedAt = self.updatedAt;
        }
      } else if (!self.completed && self.status === 'done') {
        self.status = 'todo';
        self.completedAt = undefined;
      }
    }
  }
}));

// Type exports
export interface ITodo extends Instance<typeof TodoModel> {}
export interface ITodoSnapshot extends SnapshotIn<typeof TodoModel> {}
export interface ITodoOutput extends SnapshotOut<typeof TodoModel> {}
export interface ITodoNote extends Instance<typeof TodoNote> {}

// Factory functions
export function createTodo(
  id: number,
  text: string,
  status: TodoStatus = 'todo',
  priority: TodoPriority = 3
): ITodo {
  return TodoModel.create({
    id,
    text,
    status,
    priority
  });
}

export function createTodoFromText(id: number, text: string): ITodo {
  // Parse priority from text (e.g., "!!! High priority task")
  let priority: TodoPriority = 3;
  let cleanText = text;

  const priorityMatch = text.match(/^(!+)\s*/);
  if (priorityMatch) {
    const exclamations = priorityMatch[1].length;
    priority = Math.max(1, Math.min(5, 6 - exclamations)) as TodoPriority;
    cleanText = text.replace(priorityMatch[0], '');
  }

  // Parse status from text (e.g., "[in_progress] Working on this")
  let status: TodoStatus = 'todo';
  const statusMatch = cleanText.match(/^\[(todo|in_progress|blocked|done)\]\s*/i);
  if (statusMatch) {
    status = statusMatch[1].toLowerCase() as TodoStatus;
    cleanText = cleanText.replace(statusMatch[0], '');
  }

  return createTodo(id, cleanText, status, priority);
}