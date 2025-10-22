import {tool} from '@openai/agents';
import {z} from 'zod';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {loadConfig} from './config.js';
import {
  addTodo,
  listTodos,
  completeTodo,
  removeTodo,
  clearTodos,
  updateTodo,
  formatTodos,
  setStatus,
  setPriority,
  addNoteToTodo,
  linkDependency,
  unlinkDependency,
  setFocus,
} from './todoStore.js';

// Calculator tool with simple, safe evaluation
export const calculatorTool = tool({
  name: 'calculator',
  description:
    'Safely evaluate basic arithmetic expressions. Supports +, -, *, /, parentheses, and decimals.',
  parameters: z.object({
    expression: z.string().min(1, 'expression required'),
  }),
  async execute({expression}) {
    const sanitized = expression.replace(/\s+/g, '');
    if (!/^[0-9+\-*/().]+$/.test(sanitized)) {
      throw new Error('Invalid characters in expression.');
    }
    // Very basic evaluator by using new Function on sanitized numeric ops only
    // Note: We avoid variables and non-math tokens by strict regex above
    const result = Function(`"use strict"; return (${sanitized});`)();
    if (typeof result !== 'number' || !isFinite(result)) {
      throw new Error('Expression did not evaluate to a finite number.');
    }
    return String(result);
  },
});

// Read small text files from within the current working directory
export const readFileTool = tool({
  name: 'read_file',
  description:
    'Read a small UTF-8 text file relative to the current working directory.',
  parameters: z.object({
    path: z.string().min(1, 'path required'),
    maxBytes: z.number().int().positive().max(200_000).default(50_000),
  }),
  async execute({path: p, maxBytes}) {
    const abs = path.resolve(process.cwd(), p);
    if (!abs.startsWith(process.cwd())) {
      throw new Error('Access outside the working directory is not allowed.');
    }
    const stat = await fs.stat(abs);
    if (stat.size > maxBytes) {
      throw new Error(`File too large: ${stat.size} bytes (max ${maxBytes}).`);
    }
    const data = await fs.readFile(abs, 'utf8');
    return data;
  },
});

// List files in a directory relative to cwd
export const listFilesTool = tool({
  name: 'list_files',
  description: 'List files and directories relative to the current working directory.',
  parameters: z.object({
    dir: z.string().default('.'),
  }),
  async execute({dir}) {
    const abs = path.resolve(process.cwd(), dir);
    if (!abs.startsWith(process.cwd())) {
      throw new Error('Access outside the working directory is not allowed.');
    }
    const entries = await fs.readdir(abs, {withFileTypes: true});
    return entries
      .map((e) => `${e.isDirectory() ? 'd' : 'f'}\t${path.join(dir, e.name)}`)
      .join('\n');
  },
});

// Basic HTTP GET (requires Node >=18 for global fetch)
export const httpGetTool = tool({
  name: 'http_get',
  description: 'Fetch a URL over HTTP(S) and return up to 100kB of text.',
  parameters: z.object({
    // Avoid z.string().url() -> produces unsupported JSON Schema 'uri' format
    url: z.string().min(1, 'url required').describe('HTTP(S) URL'),
    maxBytes: z.number().int().positive().max(200_000).default(100_000),
  }),
  async execute({url, maxBytes}) {
    if (typeof fetch !== 'function') {
      throw new Error('fetch is not available in this Node version.');
    }
    // Runtime validation for protocol and basic URL shape
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error('Invalid URL');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Only http and https URLs are allowed.');
    }
    const res = await fetch(url, {method: 'GET'});
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text') && !contentType.includes('json')) {
      throw new Error(`Unsupported content-type: ${contentType}`);
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) {
      throw new Error(`Response too large: ${buf.byteLength} bytes (max ${maxBytes}).`);
    }
    return new TextDecoder().decode(buf);
  },
});

// --- Todo list tools ---

export const todoAddTool = tool({
  name: 'todo_add',
  description: 'Add a todo item to the persistent list in the current directory.',
  parameters: z.object({ text: z.string().min(1, 'text required') }),
  async execute({text}) {
    const t = await addTodo(text);
    return `Added todo #${t.id}: ${t.text}`;
  },
});

export const todoListTool = tool({
  name: 'todo_list',
  description: 'List todo items. Set includeCompleted=false to show only pending.',
  parameters: z.object({ includeCompleted: z.boolean().default(true) }),
  async execute({includeCompleted}) {
    const items = await listTodos(includeCompleted);
    return formatTodos(items);
  },
});

export const todoCompleteTool = tool({
  name: 'todo_complete',
  description: 'Mark a todo as completed by its numeric id.',
  parameters: z.object({ id: z.number().int().positive() }),
  async execute({id}) {
    const t = await completeTodo(id);
    return t ? `Completed #${t.id}: ${t.text}` : `Todo #${id} not found.`;
  },
});

export const todoRemoveTool = tool({
  name: 'todo_remove',
  description: 'Remove a todo by its numeric id.',
  parameters: z.object({ id: z.number().int().positive() }),
  async execute({id}) {
    const t = await removeTodo(id);
    return t ? `Removed #${t.id}: ${t.text}` : `Todo #${id} not found.`;
  },
});

export const todoUpdateTool = tool({
  name: 'todo_update',
  description: 'Update the text of a todo by id.',
  parameters: z.object({ id: z.number().int().positive(), text: z.string().min(1) }),
  async execute({id, text}) {
    const t = await updateTodo(id, text);
    return t ? `Updated #${t.id}: ${t.text}` : `Todo #${id} not found.`;
  },
});

export const todoClearTool = tool({
  name: 'todo_clear_all',
  description: 'Remove all todos from the list.',
  parameters: z.object({}),
  async execute() {
    const count = await clearTodos();
    return `Cleared ${count} todo(s).`;
  },
});

export const todoSetStatusTool = tool({
  name: 'todo_set_status',
  description: "Set a todo's status: one of 'todo', 'in_progress', 'blocked', 'done'.",
  parameters: z.object({ id: z.number().int().positive(), status: z.enum(['todo','in_progress','blocked','done']), blockedReason: z.string().nullable().default(null) }),
  async execute({id, status, blockedReason}) {
    const reason = blockedReason === null ? undefined : blockedReason;
    const t = await setStatus(id, status as any, reason);
    return t ? `Status for #${t.id} -> ${t.status}${t.blockedReason ? ` (${t.blockedReason})` : ''}` : `Todo #${id} not found.`;
  },
});

export const todoSetPriorityTool = tool({
  name: 'todo_set_priority',
  description: "Set a todo's priority from 1 (highest) to 5 (lowest).",
  parameters: z.object({ id: z.number().int().positive(), priority: z.number().int().min(1).max(5) }),
  async execute({id, priority}) {
    const t = await setPriority(id, priority as any);
    return t ? `Priority for #${t.id} -> P${t.priority}` : `Todo #${id} not found.`;
  },
});

export const todoAddNoteTool = tool({
  name: 'todo_add_note',
  description: 'Append a note to a todo.',
  parameters: z.object({ id: z.number().int().positive(), note: z.string().min(1) }),
  async execute({id, note}) {
    const t = await addNoteToTodo(id, note);
    return t ? `Noted #${t.id}.` : `Todo #${id} not found.`;
  },
});

export const todoLinkDepTool = tool({
  name: 'todo_link_dep',
  description: 'Add a dependency to a todo (id dependsOn dependsOnId).',
  parameters: z.object({ id: z.number().int().positive(), dependsOnId: z.number().int().positive() }),
  async execute({id, dependsOnId}) {
    const t = await linkDependency(id, dependsOnId);
    return t ? `#${t.id} now depends on #${dependsOnId}.` : `Todo or dependency not found.`;
  },
});

export const todoUnlinkDepTool = tool({
  name: 'todo_unlink_dep',
  description: 'Remove a dependency from a todo (id no longer depends on dependsOnId).',
  parameters: z.object({ id: z.number().int().positive(), dependsOnId: z.number().int().positive() }),
  async execute({id, dependsOnId}) {
    const t = await unlinkDependency(id, dependsOnId);
    return t ? `#${t.id} no longer depends on #${dependsOnId}.` : `Todo or dependency not found.`;
  },
});

export const todoFocusTool = tool({
  name: 'todo_focus',
  description: 'Set or clear the focused todo (pass id, or 0 to clear).',
  parameters: z.object({ id: z.number().int().min(0) }),
  async execute({id}) {
    const newId = await setFocus(id === 0 ? null : id);
    return newId ? `Focused on #${newId}.` : 'Focus cleared.';
  },
});

export const todoPlanTool = tool({
  name: 'todo_plan',
  description: 'Bulk-add planned steps for a goal. Provide steps in order.',
  parameters: z.object({ steps: z.array(z.string().min(1)).min(1) }),
  async execute({steps}) {
    const ids: number[] = [];
    for (const s of steps) {
      const t = await addTodo(s);
      ids.push(t.id);
    }
    const list = await listTodos(true);
    return `Added ${ids.length} step(s): ${ids.join(', ')}\n` + formatTodos(list);
  },
});

export const defaultTools: any[] = [
  calculatorTool,
  readFileTool,
  listFilesTool,
  httpGetTool,
  // todo tools
  todoAddTool,
  todoListTool,
  todoCompleteTool,
  todoRemoveTool,
  todoUpdateTool,
  todoClearTool,
  todoSetStatusTool,
  todoSetPriorityTool,
  todoAddNoteTool,
  todoLinkDepTool,
  todoUnlinkDepTool,
  todoFocusTool,
  todoPlanTool,
];

// --- System command tool (opt-in) ---

function withinCwd(target: string) {
  const abs = path.resolve(process.cwd(), target);
  return abs.startsWith(process.cwd());
}

async function runCommand(cmd: string, args: string[], options: {cwd: string; timeoutMs: number; stdin?: string}) {
  const start = Date.now();
  const child = spawn(cmd, args, {
    cwd: options.cwd,
    env: process.env,
    shell: false,
  });

  const maxBytes = 200_000;
  let out = '';
  let err = '';
  let timedOut = false;

  const add = (acc: string, chunk: Buffer | string) => {
    const s = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    const remaining = Math.max(0, maxBytes - acc.length);
    return acc + s.slice(0, remaining);
  };

  child.stdout.on('data', (d) => {
    out = add(out, d);
  });
  child.stderr.on('data', (d) => {
    err = add(err, d);
  });

  if (options.stdin && options.stdin.length > 0) {
    child.stdin.write(options.stdin);
  }
  child.stdin.end();

  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, options.timeoutMs);

  const exitCode: number = await new Promise((resolve) => {
    child.on('close', (code) => resolve(code ?? -1));
  });
  clearTimeout(timeout);
  return {code: exitCode, stdout: out, stderr: err, timedOut, durationMs: Date.now() - start};
}

export const shellExecTool = tool({
  name: 'shell_exec',
  description:
    'Run a system command with built-in safety. By default, only a small allowlist of read-only commands is permitted; set dangerous=true to run any command. Execution is confined to the current working directory and output is truncated.',
  parameters: z.object({
    cmd: z.string().min(1),
    args: z.array(z.string()).default([]),
    cwd: z.string().default('.'),
    timeoutMs: z.number().int().min(100).max(60_000).default(10_000),
    stdin: z.string().default(''),
    dangerous: z.boolean().default(false),
  }),
  async execute({cmd, args, cwd, timeoutMs, stdin, dangerous}) {
    const cfg = await loadConfig();
    const allowed = new Set<string>([
      'ls', 'cat', 'pwd', 'echo', 'head', 'tail', 'wc', 'stat', 'rg', 'find'
    ]);
    for (const extra of cfg.shell.extraAllowlist) allowed.add(extra);
    if (!dangerous && !allowed.has(cmd)) {
      throw new Error(`Command not allowed in safe mode: ${cmd}`);
    }
    if (dangerous && !cfg.shell.allowDangerous) {
      throw new Error('Dangerous commands are disabled in config. Enable it via `gsio-ai config`.');
    }
    const absCwd = path.resolve(process.cwd(), cwd);
    if (!withinCwd(absCwd)) {
      throw new Error('cwd must be within the working directory');
    }
    const {code, stdout, stderr, timedOut, durationMs} = await runCommand(cmd, args, {cwd: absCwd, timeoutMs, stdin});
    const meta = `code=${code} timedOut=${timedOut} durationMs=${durationMs}`;
    const truncated = (s: string) => (s.length >= 200000 ? s + '\n[truncated]\n' : s);
    return [
      `> ${cmd} ${args.join(' ')}`,
      meta,
      stdout ? `STDOUT:\n${truncated(stdout)}` : 'STDOUT: (empty)',
      stderr ? `STDERR:\n${truncated(stderr)}` : 'STDERR: (empty)'
    ].join('\n');
  },
});

// Included by default; behavior controlled by project config.
defaultTools.push(shellExecTool as any);
