import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let lock: Promise<void> = Promise.resolve();

async function acquireLock(): Promise<() => void> {
	let release: (() => void) | null = null;
	const next = new Promise<void>((resolve) => {
		release = resolve;
	});
	const previous = lock;
	lock = next;
	await previous;
	return () => release?.();
}

export type TempCwdHandle = {
	dir: string;
	release: () => Promise<void>;
};

export async function acquireTempCwd(prefix = "gsio-test-"): Promise<TempCwdHandle> {
	const releaseLock = await acquireLock();
	const original = process.cwd();
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
	process.chdir(dir);
	let done = false;
	return {
		dir,
		release: async () => {
			if (done) return;
			done = true;
			process.chdir(original);
			await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
			releaseLock();
		},
	};
}

export async function withTempCwd<T>(
	fn: (dir: string) => Promise<T>,
	prefix = "gsio-test-"
): Promise<T> {
	const handle = await acquireTempCwd(prefix);
	try {
		return await fn(handle.dir);
	} finally {
		await handle.release();
	}
}
