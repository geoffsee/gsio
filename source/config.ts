import fs from 'node:fs/promises';
import path from 'node:path';

export type AppConfig = {
  shell: {
    allowDangerous: boolean;
    extraAllowlist: string[];
  };
  panel: {
    todoShowCompleted: boolean;
    maxItems: number; // how many todos to show in panel
  };
};

const DEFAULT_CONFIG: AppConfig = {
  shell: { allowDangerous: false, extraAllowlist: [] },
  panel: { todoShowCompleted: true, maxItems: 5 },
};

const FILE_NAME = '.gsio-config.json';

export function getConfigPath(cwd = process.cwd()) {
  return path.resolve(cwd, FILE_NAME);
}

export async function loadConfig(): Promise<AppConfig> {
  const file = getConfigPath();
  try {
    const raw = await fs.readFile(file, 'utf8');
    const data = JSON.parse(raw);
    return normalizeConfig(data);
  } catch (err: any) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) {
      return DEFAULT_CONFIG;
    }
    throw err;
  }
}

export async function saveConfig(cfg: AppConfig): Promise<void> {
  const file = getConfigPath();
  const data = JSON.stringify(normalizeConfig(cfg), null, 2);
  await fs.writeFile(file, data, 'utf8');
}

function normalizeConfig(input: any): AppConfig {
  const cfg: AppConfig = {
    shell: {
      allowDangerous: !!input?.shell?.allowDangerous,
      extraAllowlist: Array.isArray(input?.shell?.extraAllowlist)
        ? input.shell.extraAllowlist.filter((s: any) => typeof s === 'string' && s.trim().length > 0)
        : [],
    },
    panel: {
      todoShowCompleted: input?.panel?.todoShowCompleted !== false,
      maxItems: clampInt(input?.panel?.maxItems, 1, 20, 5),
    },
  };
  return cfg;
}

function clampInt(v: any, min: number, max: number, def: number): number {
  const n = Number(v);
  if (!Number.isInteger(n)) return def;
  return Math.max(min, Math.min(max, n));
}

