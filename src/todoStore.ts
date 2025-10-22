import fs from 'node:fs/promises';
import path from 'node:path';

export type TodoStatus = 'todo' | 'in_progress' | 'blocked' | 'done';

export type Todo = {
  id: number;
  text: string;
  // deprecated fields kept for migration
  completed?: boolean;
  createdAt: string;
  completedAt?: string;
  // new fields
  status: TodoStatus;
  priority: 1 | 2 | 3 | 4 | 5; // 1 is highest
  dependsOn: number[];
  notes: string[];
  blockedReason?: string;
};

export type TodoStore = {
  lastId: number;
  items: Todo[];
  focusedId?: number | null;
};

const FILE_NAME = '.gsio-todos.json';

export function getTodoPath(cwd = process.cwd()) {
  return path.resolve(cwd, FILE_NAME);
}

async function readJson(file: string): Promise<any | undefined> {
  try {
    const data = await fs.readFile(file, 'utf8');
    return JSON.parse(data);
  } catch (err: any) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return undefined;
    throw err;
  }
}

export async function loadStore(): Promise<TodoStore> {
  const file = getTodoPath();
  const data = await readJson(file);
  if (!data || typeof data !== 'object') {
    return { lastId: 0, items: [], focusedId: null };
  }
  const items: Todo[] = (Array.isArray(data.items) ? data.items : []).map((raw: any): Todo => {
    const status: TodoStatus = raw.status
      ? raw.status
      : raw.completed
        ? 'done'
        : 'todo';
    return {
      id: Number(raw.id),
      text: String(raw.text ?? ''),
      createdAt: String(raw.createdAt ?? new Date().toISOString()),
      completedAt: raw.completedAt ? String(raw.completedAt) : undefined,
      status,
      priority: [1,2,3,4,5].includes(Number(raw.priority)) ? Number(raw.priority) as any : 3,
      dependsOn: Array.isArray(raw.dependsOn) ? raw.dependsOn.filter((n: any) => Number.isInteger(n)).map((n: any)=>Number(n)) : [],
      notes: Array.isArray(raw.notes) ? raw.notes.map((s: any)=>String(s)) : [],
      blockedReason: raw.blockedReason ? String(raw.blockedReason) : undefined,
    };
  });
  const lastId = typeof data.lastId === 'number' ? data.lastId : 0;
  const focusedId = typeof data.focusedId === 'number' ? data.focusedId : null;
  return { lastId, items, focusedId };
}

export async function saveStore(store: TodoStore): Promise<void> {
  const file = getTodoPath();
  const json = JSON.stringify(store, null, 2);
  await fs.writeFile(file, json, 'utf8');
}

export async function addTodo(text: string): Promise<Todo> {
  const store = await loadStore();
  const id = store.lastId + 1;
  const todo: Todo = {
    id,
    text: text.trim(),
    status: 'todo',
    priority: 3,
    dependsOn: [],
    notes: [],
    createdAt: new Date().toISOString(),
  };
  store.lastId = id;
  store.items.push(todo);
  await saveStore(store);
  return todo;
}

export async function listTodos(includeCompleted = true): Promise<Todo[]> {
  const store = await loadStore();
  const items = includeCompleted ? store.items : store.items.filter(t => t.status !== 'done');
  // sort by status and priority: in_progress -> blocked -> todo -> done; then priority asc; then id asc
  const order: Record<TodoStatus, number> = { in_progress: 0, blocked: 1, todo: 2, done: 3 };
  return [...items].sort((a, b) => {
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    if (a.priority !== b.priority) return a.priority - b.priority; // 1 before 5
    return a.id - b.id;
  });
}

export async function completeTodo(id: number): Promise<Todo | undefined> {
  const store = await loadStore();
  const todo = store.items.find(t => t.id === id);
  if (!todo) return undefined;
  todo.status = 'done';
  todo.completedAt = new Date().toISOString();
  if (store.focusedId === id) store.focusedId = null;
  await saveStore(store);
  return todo;
}

export async function removeTodo(id: number): Promise<Todo | undefined> {
  const store = await loadStore();
  const idx = store.items.findIndex(t => t.id === id);
  if (idx === -1) return undefined;
  const [removed] = store.items.splice(idx, 1);
  if (store.focusedId === id) store.focusedId = null;
  await saveStore(store);
  return removed;
}

export async function clearTodos(): Promise<number> {
  const store = await loadStore();
  const count = store.items.length;
  store.items = [];
  store.focusedId = null;
  await saveStore(store);
  return count;
}

export async function updateTodo(id: number, text: string): Promise<Todo | undefined> {
  const store = await loadStore();
  const todo = store.items.find(t => t.id === id);
  if (!todo) return undefined;
  todo.text = text.trim();
  await saveStore(store);
  return todo;
}

export async function setStatus(id: number, status: TodoStatus, blockedReason?: string): Promise<Todo | undefined> {
  const store = await loadStore();
  const todo = store.items.find(t => t.id === id);
  if (!todo) return undefined;
  todo.status = status;
  todo.blockedReason = status === 'blocked' ? (blockedReason || 'unspecified') : undefined;
  if (status === 'done') todo.completedAt = new Date().toISOString();
  await saveStore(store);
  return todo;
}

export async function setPriority(id: number, priority: 1|2|3|4|5): Promise<Todo | undefined> {
  const store = await loadStore();
  const todo = store.items.find(t => t.id === id);
  if (!todo) return undefined;
  todo.priority = priority;
  await saveStore(store);
  return todo;
}

export async function addNoteToTodo(id: number, note: string): Promise<Todo | undefined> {
  const store = await loadStore();
  const todo = store.items.find(t => t.id === id);
  if (!todo) return undefined;
  todo.notes.push(note.trim());
  await saveStore(store);
  return todo;
}

export async function linkDependency(id: number, dependsOnId: number): Promise<Todo | undefined> {
  const store = await loadStore();
  const todo = store.items.find(t => t.id === id);
  if (!todo) return undefined;
  if (!store.items.find(t => t.id === dependsOnId)) return undefined;
  const set = new Set<number>(todo.dependsOn);
  set.add(dependsOnId);
  todo.dependsOn = Array.from(set);
  await saveStore(store);
  return todo;
}

export async function unlinkDependency(id: number, dependsOnId: number): Promise<Todo | undefined> {
  const store = await loadStore();
  const todo = store.items.find(t => t.id === id);
  if (!todo) return undefined;
  todo.dependsOn = todo.dependsOn.filter(d => d !== dependsOnId);
  await saveStore(store);
  return todo;
}

export async function setFocus(id: number | null): Promise<number | null> {
  const store = await loadStore();
  if (id !== null && !store.items.find(t => t.id === id)) return store.focusedId ?? null;
  store.focusedId = id;
  await saveStore(store);
  return store.focusedId ?? null;
}

export async function getFocus(): Promise<number | null> {
  const store = await loadStore();
  return store.focusedId ?? null;
}

export function formatTodos(todos: Todo[]): string {
  if (todos.length === 0) return 'No todos.';
  const statusIcon: Record<TodoStatus, string> = {
    todo: '[ ]',
    in_progress: '[>]',
    blocked: '[!]',
    done: '[x]',
  };
  return todos
    .map((t) => {
      const deps = t.dependsOn.length ? ` deps:${t.dependsOn.join(',')}` : '';
      const prio = ` P${t.priority}`;
      const block = t.status === 'blocked' && t.blockedReason ? ` reason:${t.blockedReason}` : '';
      return `${statusIcon[t.status]} #${t.id}${prio}${deps} ${t.text}${block}`;
    })
    .join('\n');
}

export function shortList(todos: Todo[], n = 5): string {
  return formatTodos(todos.slice(0, n));
}
