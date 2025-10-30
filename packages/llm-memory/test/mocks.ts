import { createStorage, type Storage } from 'unstorage';
import memoryDriver from 'unstorage/drivers/memory';

export function createMockStorage(): Storage {
  return createStorage({ driver: memoryDriver() });
}

export function createThrowingStorage(
  method: 'getItem' | 'setItem' | 'getKeys' | 'removeItem',
  error: Error
): Storage {
  const storage = createMockStorage();
  (storage as any)[method] = async () => {
    throw error;
  };
  return storage;
}
