/**
 * Reusable mixins for MST models
 */

import { types, Instance } from 'mobx-state-tree';
import { v4 as uuidv4 } from 'uuid';

/**
 * Adds a unique identifier to the model
 */
export const withIdentifier = types.model('WithIdentifier', {
  id: types.optional(types.identifier, () => uuidv4())
});

/**
 * Adds numeric identifier with auto-increment capability
 */
export const withNumericId = types.model('WithNumericId', {
  id: types.identifierNumber
});

/**
 * Adds timestamp fields to track creation and updates
 */
export const withTimestamps = types
  .model('WithTimestamps', {
    createdAt: types.optional(types.Date, () => new Date()),
    updatedAt: types.optional(types.Date, () => new Date())
  })
  .actions((self) => ({
    updateTimestamp() {
      self.updatedAt = new Date();
    }
  }));

/**
 * Adds soft delete capability
 */
export const withSoftDelete = types
  .model('WithSoftDelete', {
    deletedAt: types.maybeNull(types.Date),
  })
  .views((self) => ({
    get isDeleted() {
      return self.deletedAt !== null;
    }
  }))
  .actions((self) => ({
    softDelete() {
      self.deletedAt = new Date();
    },
    restore() {
      self.deletedAt = null;
    }
  }));

/**
 * Adds loading state tracking
 */
export const withLoadingState = types
  .model('WithLoadingState', {
    isLoading: types.optional(types.boolean, false),
    error: types.maybeNull(types.string)
  })
  .actions((self) => ({
    setLoading(loading: boolean) {
      self.isLoading = loading;
      if (loading) {
        self.error = null;
      }
    },
    setError(error: string | null) {
      self.error = error;
      self.isLoading = false;
    },
    clearError() {
      self.error = null;
    }
  }));

/**
 * Adds serialization capability
 */
export const withSerialization = types
  .model('WithSerialization')
  .views((self) => ({
    toJSON() {
      const snapshot = JSON.parse(JSON.stringify(self));
      // Remove MST internal properties
      delete snapshot.$treenode;
      return snapshot;
    }
  }));

/**
 * Adds validation capability
 */
export const withValidation = types
  .model('WithValidation')
  .volatile(() => ({
    validationErrors: [] as string[]
  }))
  .views((self) => ({
    get isValid() {
      return self.validationErrors.length === 0;
    },
    get hasErrors() {
      return self.validationErrors.length > 0;
    }
  }))
  .actions((self) => ({
    addValidationError(error: string) {
      self.validationErrors.push(error);
    },
    clearValidationErrors() {
      self.validationErrors = [];
    },
    validate(): boolean {
      // Override in derived models
      return true;
    }
  }));

/**
 * Adds metadata storage capability
 */
export const withMetadata = types
  .model('WithMetadata', {
    metadata: types.optional(types.frozen(), {} as Record<string, any>)
  })
  .actions((self) => ({
    setMetadata(key: string, value: any) {
      self.metadata = {
        ...self.metadata,
        [key]: value
      };
    },
    removeMetadata(key: string) {
      const newMetadata = { ...self.metadata };
      delete newMetadata[key];
      self.metadata = newMetadata;
    },
    clearMetadata() {
      self.metadata = {};
    }
  }))
  .views((self) => ({
    getMetadata(key: string) {
      return self.metadata[key];
    },
    hasMetadata(key: string) {
      return key in self.metadata;
    }
  }));

/**
 * Adds priority capability
 */
export const withPriority = types
  .model('WithPriority', {
    priority: types.optional(
      types.refinement('Priority', types.number, (value) => [1, 2, 3, 4, 5].includes(value as any)),
      3
    )
  })
  .actions((self) => ({
    setPriority(priority: 1 | 2 | 3 | 4 | 5) {
      self.priority = priority;
    },
    increasePriority() {
      if (self.priority > 1) {
        self.priority = (self.priority - 1) as 1 | 2 | 3 | 4 | 5;
      }
    },
    decreasePriority() {
      if (self.priority < 5) {
        self.priority = (self.priority + 1) as 1 | 2 | 3 | 4 | 5;
      }
    }
  }));

/**
 * Adds status tracking capability
 */
export function withStatus<T extends string>(statuses: readonly T[]) {
  return types
    .model('WithStatus', {
      status: types.enumeration<T>(statuses as T[])
    })
    .actions((self) => ({
      setStatus(status: T) {
        self.status = status;
      }
    }));
}

/**
 * Adds history tracking capability
 */
export const withHistory = <T>(itemType: any) => types
  .model('WithHistory', {
    history: types.optional(types.array(itemType), []),
    maxHistorySize: types.optional(types.number, 100)
  })
  .actions((self) => ({
    addToHistory(item: Instance<typeof itemType>) {
      self.history.push(item);
      if (self.history.length > self.maxHistorySize) {
        self.history.shift();
      }
    },
    clearHistory() {
      self.history.clear();
    },
    setMaxHistorySize(size: number) {
      self.maxHistorySize = size;
      while (self.history.length > size) {
        self.history.shift();
      }
    }
  }))
  .views((self) => ({
    get historySize() {
      return self.history.length;
    },
    getHistoryItem(index: number) {
      return self.history[index];
    },
    get lastHistoryItem() {
      return self.history[self.history.length - 1];
    }
  }));

/**
 * Export a helper to compose multiple mixins
 */
export function composeMixins(...mixins: any[]) {
  return mixins.reduce((acc, mixin) => types.compose(acc, mixin));
}