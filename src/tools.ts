import { tool } from "@openai/agents";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { loadConfig } from "./config";
import OpenAI from "openai";
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
} from "./todoStore";

const needsApprovalFor = (toolName: string) => {
	return async (_ctx?: unknown, _input?: unknown, _callId?: string) => {
		try {
			const cfg = await loadConfig();
			return cfg.tools.requireApproval.includes(toolName);
		} catch {
			return false;
		}
	};
};

const TEXT_EXTENSIONS = new Set([
	".txt",
	".text",
	".md",
	".markdown",
	".json",
	".yaml",
	".yml",
	".csv",
	".tsv",
	".log",
	".xml",
	".html",
	".htm",
	".css",
	".scss",
	".less",
	".js",
	".jsx",
	".ts",
	".tsx",
	".cjs",
	".mjs",
	".c",
	".cpp",
	".h",
	".hpp",
	".py",
	".rb",
	".rs",
	".go",
	".java",
	".php",
	".sh",
	".bash",
	".zsh",
	".fish",
	".ps1",
	".bat",
	".ini",
	".cfg",
	".conf",
	".toml",
	".sql",
	".r",
	".scala",
	".swift",
	".kt",
	".dart",
]);

const PANDOC_EXTENSIONS = new Set([
	".pdf",
	".doc",
	".docx",
	".ppt",
	".pptx",
	".rtf",
	".odt",
	".odp",
	".ods",
	".epub",
]);

const VISION_EXTENSIONS = new Set([
	".pdf",
	".doc",
	".docx",
	".ppt",
	".pptx",
	".rtf",
	".odt",
	".epub",
	".png",
	".jpg",
	".jpeg",
	".gif",
	".bmp",
	".webp",
	".tif",
	".tiff",
	".heic",
	".heif",
]);

const MAX_PANDOC_INPUT_BYTES = 25 * 1024 * 1024; // 25MB
const MAX_VISION_INPUT_BYTES = 10 * 1024 * 1024; // 10MB
const VISION_EXTRACTION_PROMPT =
	"Extract the readable textual content from the attached file. Return plain text that preserves logical structure (headings, paragraphs, lists, and tables) using simple formatting. If the document is primarily images, transcribe any legible text.";

// Calculator tool with simple, safe evaluation
export const calculatorTool = tool({
	name: "calculator",
	description:
		"Safely evaluate basic arithmetic expressions. Supports +, -, *, /, parentheses, and decimals.",
	parameters: z.object({
		expression: z.string().min(1, "expression required"),
	}),
	needsApproval: needsApprovalFor("calculator"),
	async execute({ expression }) {
		const sanitized = expression.replace(/\s+/g, "");
		if (!/^[0-9+\-*/().]+$/.test(sanitized)) {
			throw new Error("Invalid characters in expression.");
		}
		// Very basic evaluator by using new Function on sanitized numeric ops only
		// Note: We avoid variables and non-math tokens by strict regex above
		const result = Function(`"use strict"; return (${sanitized});`)();
		if (typeof result !== "number" || !isFinite(result)) {
			throw new Error("Expression did not evaluate to a finite number.");
		}
		return String(result);
	},
});

export async function readFileAsText(
	p: string,
	maxBytes: number
): Promise<string> {
	if (!p || typeof p !== "string") {
		throw new Error("Path is required.");
	}
	if (
		typeof maxBytes !== "number" ||
		!Number.isFinite(maxBytes) ||
		maxBytes <= 0
	) {
		throw new Error("maxBytes must be a positive integer.");
	}
	const abs = path.resolve(process.cwd(), p);
	if (!withinCwd(abs)) {
		throw new Error("Access outside the working directory is not allowed.");
	}
	let stat: Awaited<ReturnType<typeof fs.stat>>;
	try {
		stat = await fs.stat(abs);
	} catch (err: any) {
		throw new Error(`Unable to access file: ${err?.message || String(err)}`);
	}
	if (!stat.isFile()) {
		throw new Error("Path must reference a file, not a directory.");
	}

	const ext = path.extname(abs).toLowerCase();
	const baseName = path.basename(abs);
	const isTextish = !ext || TEXT_EXTENSIONS.has(ext);
	const pandocCandidate = PANDOC_EXTENSIONS.has(ext);
	const visionCandidate = VISION_EXTENSIONS.has(ext);
	const convertible = pandocCandidate || visionCandidate;

	let directReadIssue: string | null = null;
	if (stat.size <= maxBytes) {
		try {
			const raw = await fs.readFile(abs, "utf8");
			if (isLikelyText(raw)) {
				return truncateUtf8(raw, maxBytes);
			}
			directReadIssue = "content is not recognizable as plain UTF-8 text";
		} catch (err: any) {
			directReadIssue = err?.message || String(err);
		}
	} else if (isTextish && !convertible) {
		throw new Error(
			`File too large: ${formatBytes(stat.size)} (max ${formatBytes(
				maxBytes
			)})`
		);
	}

	if (!convertible) {
		if (directReadIssue) {
			throw new Error(
				`Unsupported binary file format (${ext || "no extension"}): ${
					directReadIssue || "unable to decode as text"
				}`
			);
		}
		throw new Error(
			`Unsupported file type: ${ext || "no extension"}. Provide text input or a convertible document.`
		);
	}

	let pandocError: string | null = null;
	if (pandocCandidate) {
		if (stat.size > MAX_PANDOC_INPUT_BYTES) {
			pandocError = `input exceeds ${formatBytes(
				MAX_PANDOC_INPUT_BYTES
			)} pandoc limit`;
		} else {
			try {
				const converted = await convertWithPandoc(abs, baseName, maxBytes);
				if (converted) {
					return converted;
				}
			} catch (err: any) {
				pandocError = err?.message || String(err);
			}
		}
	}

	let visionError: string | null = null;
	if (visionCandidate || (pandocCandidate && pandocError)) {
		try {
			const converted = await convertWithVision(
				abs,
				baseName,
				maxBytes,
				stat.size
			);
			if (converted) {
				return converted;
			}
		} catch (err: any) {
			visionError = err?.message || String(err);
		}
	}

	const reasonParts = [
		directReadIssue ? `direct read: ${directReadIssue}` : null,
		pandocError ? `pandoc: ${pandocError}` : null,
		visionError ? `vision: ${visionError}` : null,
	].filter(Boolean) as string[];
	const combined =
		reasonParts.length > 0 ? ` (${truncateReason(reasonParts.join("; "))})` : "";
	throw new Error(`Unable to extract text from ${baseName}${combined}`);
}

// Read small text files from within the current working directory
export const readFileTool = tool({
	name: "read_file",
	description:
		"Read a UTF-8 text file or convert supported documents (PDF, Office, images) within the current working directory.",
	parameters: z.object({
		path: z.string().min(1, "path required"),
		maxBytes: z.number().int().positive().max(200_000).default(50_000),
	}),
	needsApproval: needsApprovalFor("read_file"),
	async execute({ path: p, maxBytes }) {
		return await readFileAsText(p, maxBytes);
	},
});

function truncateReason(text: string, limit = 280): string {
	if (text.length <= limit) return text;
	return `${text.slice(0, limit - 3)}...`;
}

function truncateUtf8(text: string, maxBytes: number): string {
	if (!text) return text;
	if (Buffer.byteLength(text, "utf8") <= maxBytes) {
		return text;
	}
	let used = 0;
	let result = "";
	for (const ch of text) {
		const size = Buffer.byteLength(ch, "utf8");
		if (used + size > maxBytes) {
			const note = `\n[truncated to ${formatBytes(maxBytes)}]`;
			return result + note;
		}
		result += ch;
		used += size;
	}
	return result;
}

function isLikelyText(value: string): boolean {
	if (!value) return true;
	if (value.includes("\u0000")) return false;
	let control = 0;
	let replacement = 0;
	let sample = 0;
	const limit = Math.min(value.length, 4000);
	for (let i = 0; i < limit; i++) {
		const code = value.charCodeAt(i);
		if (code === 0xfffd) replacement++;
		if (code < 32 && code !== 9 && code !== 10 && code !== 13) control++;
		sample++;
	}
	if (sample === 0) return true;
	if (replacement / sample > 0.01) return false;
	if (control / sample > 0.02) return false;
	return true;
}

async function convertWithPandoc(
	abs: string,
	baseName: string,
	maxBytes: number
): Promise<string> {
	const { code, stdout, stderr, timedOut, spawnError } = await runCommand(
		"pandoc",
		["--to", "plain", "--wrap=none", baseName],
		{ cwd: path.dirname(abs), timeoutMs: 30_000 }
	);
	if (spawnError) {
		const message = spawnError?.message || "failed to invoke pandoc";
		if (/ENOENT/.test(message)) {
			throw new Error("pandoc not found on PATH");
		}
		throw new Error(message);
	}
	if (timedOut) {
		throw new Error("pandoc timed out");
	}
	if (code !== 0) {
		const err = (stderr || "").trim();
		throw new Error(err ? err.slice(0, 300) : `pandoc exited with code ${code}`);
	}
	const normalized = (stdout || "").replace(/\r\n/g, "\n");
	const meaningful =
		normalized.trim().length > 0 ? normalized.trim() : normalized;
	if (!meaningful.trim().length) {
		throw new Error("pandoc produced no textual output");
	}
	return truncateUtf8(meaningful, maxBytes);
}

async function convertWithVision(
	abs: string,
	baseName: string,
	maxBytes: number,
	fileSize: number
): Promise<string> {
	if (fileSize > MAX_VISION_INPUT_BYTES) {
		throw new Error(
			`input exceeds ${formatBytes(MAX_VISION_INPUT_BYTES)} vision limit`
		);
	}
	const cfg = await loadConfig();
	const provider = cfg.ai?.provider ?? "openai";
	if (provider !== "openai") {
		throw new Error(
			"Vision fallback requires the OpenAI provider. Switch providers in config to enable it."
		);
	}
	const apiKey =
		(cfg.ai?.apiKey ?? "").trim() ||
		(process.env.OPENAI_API_KEY || "").trim();
	if (!apiKey) {
		throw new Error("Missing OPENAI_API_KEY for vision fallback.");
	}
	const model =
		(cfg.ai?.model ?? "").trim().length > 0
			? cfg.ai.model.trim()
			: "gpt-4o-mini";
	const baseUrlRaw =
		(cfg.ai?.baseUrl ?? "").trim() ||
		(process.env.OPENAI_BASE_URL || "").trim();
	const fileData = await fs.readFile(abs);
	const client = new OpenAI({
		apiKey,
		baseURL: baseUrlRaw.length > 0 ? baseUrlRaw : undefined,
	} as any);
	let response;
	try {
		response = await client.responses.create({
			model,
			input: [
				{
					role: "user",
					content: [
						{ type: "input_text", text: VISION_EXTRACTION_PROMPT },
						{
							type: "input_file",
							filename: baseName,
							file_data: fileData.toString("base64"),
						},
					],
				},
			],
			max_output_tokens: computeMaxTokens(maxBytes),
		});
	} catch (err: any) {
		const message =
			err?.message ||
			err?.response?.data?.error?.message ||
			String(err);
		throw new Error(message);
	}
	if (response.error) {
		throw new Error(response.error.message || "vision response failed");
	}
	const output = (response.output_text || "").trim();
	if (!output) {
		throw new Error("vision model returned empty output");
	}
	return truncateUtf8(output, maxBytes);
}

function computeMaxTokens(maxBytes: number): number {
	const approx = Math.ceil(maxBytes / 4);
	const upper = 8192;
	const lower = 512;
	return Math.max(lower, Math.min(upper, approx));
}

function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes)) {
		return String(bytes);
	}
	const units = ["bytes", "KB", "MB", "GB"];
	let value = bytes;
	let idx = 0;
	while (value >= 1024 && idx < units.length - 1) {
		value /= 1024;
		idx++;
	}
	const precision = value >= 10 || idx === 0 ? 0 : 1;
	return `${value.toFixed(precision)} ${units[idx]}`;
}

// List files in a directory relative to cwd
export const listFilesTool = tool({
	name: "list_files",
	description:
		"List files and directories relative to the current working directory.",
	parameters: z.object({
		dir: z.string().default("."),
	}),
	needsApproval: needsApprovalFor("list_files"),
	async execute({ dir }) {
		const abs = path.resolve(process.cwd(), dir);
		if (!abs.startsWith(process.cwd())) {
			throw new Error("Access outside the working directory is not allowed.");
		}
		const entries = await fs.readdir(abs, { withFileTypes: true });
		return entries
			.map((e) => `${e.isDirectory() ? "d" : "f"}\t${path.join(dir, e.name)}`)
			.join("\n");
	},
});

// Basic HTTP GET (requires Node >=18 for global fetch)
export const httpGetTool = tool({
	name: "http_get",
	description: "Fetch a URL over HTTP(S) and return up to 100kB of text.",
	parameters: z.object({
		// Avoid z.string().url() -> produces unsupported JSON Schema 'uri' format
		url: z.string().min(1, "url required").describe("HTTP(S) URL"),
		maxBytes: z.number().int().positive().max(200_000).default(100_000),
	}),
	needsApproval: needsApprovalFor("http_get"),
	async execute({ url, maxBytes }) {
		if (typeof fetch !== "function") {
			throw new Error("fetch is not available in this Node version.");
		}
		// Runtime validation for protocol and basic URL shape
		let parsed: URL;
		try {
			parsed = new URL(url);
		} catch {
			throw new Error("Invalid URL");
		}
		if (!["http:", "https:"].includes(parsed.protocol)) {
			throw new Error("Only http and https URLs are allowed.");
		}
		const res = await fetch(url, { method: "GET" });
		const contentType = res.headers.get("content-type") || "";
		if (!contentType.includes("text") && !contentType.includes("json")) {
			throw new Error(`Unsupported content-type: ${contentType}`);
		}
		const buf = new Uint8Array(await res.arrayBuffer());
		if (buf.byteLength > maxBytes) {
			throw new Error(
				`Response too large: ${buf.byteLength} bytes (max ${maxBytes}).`
			);
		}
		return new TextDecoder().decode(buf);
	},
});

// --- Todo list tools ---

export const todoAddTool = tool({
	name: "todo_add",
	description:
		"Add a todo item to the persistent list in the current directory.",
	parameters: z.object({ text: z.string().min(1, "text required") }),
	needsApproval: needsApprovalFor("todo_add"),
	async execute({ text }) {
		const t = await addTodo(text);
		return `Added todo #${t.id}: ${t.text}`;
	},
});

export const todoListTool = tool({
	name: "todo_list",
	description:
		"List todo items. Set includeCompleted=false to show only pending.",
	parameters: z.object({ includeCompleted: z.boolean().default(true) }),
	needsApproval: needsApprovalFor("todo_list"),
	async execute({ includeCompleted }) {
		const items = await listTodos(includeCompleted);
		return formatTodos(items);
	},
});

export const todoCompleteTool = tool({
	name: "todo_complete",
	description: "Mark a todo as completed by its numeric id.",
	parameters: z.object({ id: z.number().int().positive() }),
	needsApproval: needsApprovalFor("todo_complete"),
	async execute({ id }) {
		const t = await completeTodo(id);
		return t ? `Completed #${t.id}: ${t.text}` : `Todo #${id} not found.`;
	},
});

export const todoRemoveTool = tool({
	name: "todo_remove",
	description: "Remove a todo by its numeric id.",
	parameters: z.object({ id: z.number().int().positive() }),
	needsApproval: needsApprovalFor("todo_remove"),
	async execute({ id }) {
		const t = await removeTodo(id);
		return t ? `Removed #${t.id}: ${t.text}` : `Todo #${id} not found.`;
	},
});

export const todoUpdateTool = tool({
	name: "todo_update",
	description: "Update the text of a todo by id.",
	parameters: z.object({
		id: z.number().int().positive(),
		text: z.string().min(1),
	}),
	needsApproval: needsApprovalFor("todo_update"),
	async execute({ id, text }) {
		const t = await updateTodo(id, text);
		return t ? `Updated #${t.id}: ${t.text}` : `Todo #${id} not found.`;
	},
});

export const todoClearTool = tool({
	name: "todo_clear_all",
	description: "Remove all todos from the list.",
	parameters: z.object({}),
	needsApproval: needsApprovalFor("todo_clear_all"),
	async execute() {
		const count = await clearTodos();
		return `Cleared ${count} todo(s).`;
	},
});

export const todoSetStatusTool = tool({
	name: "todo_set_status",
	description:
		"Set a todo's status: one of 'todo', 'in_progress', 'blocked', 'done'.",
	parameters: z.object({
		id: z.number().int().positive(),
		status: z.enum(["todo", "in_progress", "blocked", "done"]),
		blockedReason: z.string().nullable().default(null),
	}),
	needsApproval: needsApprovalFor("todo_set_status"),
	async execute({ id, status, blockedReason }) {
		const reason = blockedReason === null ? undefined : blockedReason;
		const t = await setStatus(id, status as any, reason);
		return t
			? `Status for #${t.id} -> ${t.status}${
					t.blockedReason ? ` (${t.blockedReason})` : ""
			  }`
			: `Todo #${id} not found.`;
	},
});

export const todoSetPriorityTool = tool({
	name: "todo_set_priority",
	description: "Set a todo's priority from 1 (highest) to 5 (lowest).",
	parameters: z.object({
		id: z.number().int().positive(),
		priority: z.number().int().min(1).max(5),
	}),
	needsApproval: needsApprovalFor("todo_set_priority"),
	async execute({ id, priority }) {
		const t = await setPriority(id, priority as any);
		return t
			? `Priority for #${t.id} -> P${t.priority}`
			: `Todo #${id} not found.`;
	},
});

export const todoAddNoteTool = tool({
	name: "todo_add_note",
	description: "Append a note to a todo.",
	parameters: z.object({
		id: z.number().int().positive(),
		note: z.string().min(1),
	}),
	needsApproval: needsApprovalFor("todo_add_note"),
	async execute({ id, note }) {
		const t = await addNoteToTodo(id, note);
		return t ? `Noted #${t.id}.` : `Todo #${id} not found.`;
	},
});

export const todoLinkDepTool = tool({
	name: "todo_link_dep",
	description: "Add a dependency to a todo (id dependsOn dependsOnId).",
	parameters: z.object({
		id: z.number().int().positive(),
		dependsOnId: z.number().int().positive(),
	}),
	needsApproval: needsApprovalFor("todo_link_dep"),
	async execute({ id, dependsOnId }) {
		const t = await linkDependency(id, dependsOnId);
		return t
			? `#${t.id} now depends on #${dependsOnId}.`
			: `Todo or dependency not found.`;
	},
});

export const todoUnlinkDepTool = tool({
	name: "todo_unlink_dep",
	description:
		"Remove a dependency from a todo (id no longer depends on dependsOnId).",
	parameters: z.object({
		id: z.number().int().positive(),
		dependsOnId: z.number().int().positive(),
	}),
	needsApproval: needsApprovalFor("todo_unlink_dep"),
	async execute({ id, dependsOnId }) {
		const t = await unlinkDependency(id, dependsOnId);
		return t
			? `#${t.id} no longer depends on #${dependsOnId}.`
			: `Todo or dependency not found.`;
	},
});

export const todoFocusTool = tool({
	name: "todo_focus",
	description: "Set or clear the focused todo (pass id, or 0 to clear).",
	parameters: z.object({ id: z.number().int().min(0) }),
	needsApproval: needsApprovalFor("todo_focus"),
	async execute({ id }) {
		const newId = await setFocus(id === 0 ? null : id);
		return newId ? `Focused on #${newId}.` : "Focus cleared.";
	},
});

export const todoPlanTool = tool({
	name: "todo_plan",
	description: "Bulk-add planned steps for a goal. Provide steps in order.",
	parameters: z.object({ steps: z.array(z.string().min(1)).min(1) }),
	needsApproval: needsApprovalFor("todo_plan"),
	async execute({ steps }) {
		const ids: number[] = [];
		for (const s of steps) {
			const t = await addTodo(s);
			ids.push(t.id);
		}
		const list = await listTodos(true);
		return (
			`Added ${ids.length} step(s): ${ids.join(", ")}\n` + formatTodos(list)
		);
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

async function runCommand(
	cmd: string,
	args: string[],
	options: { cwd: string; timeoutMs: number; stdin?: string }
) {
	const start = Date.now();
	const maxBytes = 200_000;
	let out = "";
	let err = "";
	let timedOut = false;

	const add = (acc: string, chunk: Buffer | string) => {
		const s = typeof chunk === "string" ? chunk : chunk.toString("utf8");
		const remaining = Math.max(0, maxBytes - acc.length);
		return acc + s.slice(0, remaining);
	};

	return await new Promise<{
		code: number;
		stdout: string;
		stderr: string;
		timedOut: boolean;
		durationMs: number;
		spawnError?: Error;
	}>((resolve) => {
		const child = spawn(cmd, args, {
			cwd: options.cwd,
			env: process.env,
			shell: false,
		});

		child.stdout.on("data", (d) => {
			out = add(out, d);
		});
		child.stderr.on("data", (d) => {
			err = add(err, d);
		});

		if (options.stdin && options.stdin.length > 0) {
			child.stdin.write(options.stdin);
		}
		child.stdin.end();

		let settled = false;
		const finish = (code: number, spawnError?: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			resolve({
				code,
				stdout: out,
				stderr: err,
				timedOut,
				durationMs: Date.now() - start,
				spawnError,
			});
		};

		const timeout = setTimeout(() => {
			timedOut = true;
			child.kill("SIGKILL");
		}, options.timeoutMs);

		child.once("error", (spawnErr) => {
			err = add(err, `${spawnErr.message}\n`);
			finish(-1, spawnErr);
		});

		child.once("close", (code) => {
			finish(code ?? -1);
		});
	});
}

// --- File system write tools (safe, within CWD) ---

export const mkdirpTool = tool({
	name: "mkdirp",
	description:
		"Create a directory (and all parents) relative to the current working directory.",
	parameters: z.object({ path: z.string().min(1) }),
	needsApproval: needsApprovalFor("mkdirp"),
	async execute({ path: dirPath }) {
		const abs = path.resolve(process.cwd(), dirPath);
		if (!withinCwd(abs)) {
			throw new Error("Path must be within the working directory");
		}
		await fs.mkdir(abs, { recursive: true });
		return `Created directory: ${path.relative(process.cwd(), abs)}`;
	},
});

export const writeFileTool = tool({
	name: "write_file",
	description:
		"Write a UTF-8 text file. Creates parent directories if needed. Provide full content; use append_file to append.",
	parameters: z.object({
		path: z.string().min(1),
		content: z.string().default(""),
		overwrite: z.boolean().default(true),
		maxBytes: z.number().int().positive().max(2_000_000).default(500_000),
	}),
	needsApproval: needsApprovalFor("write_file"),
	async execute({ path: filePath, content, overwrite, maxBytes }) {
		const abs = path.resolve(process.cwd(), filePath);
		if (!withinCwd(abs)) {
			throw new Error("Path must be within the working directory");
		}
		const enc = new TextEncoder();
		const bytes = enc.encode(content ?? "");
		if (bytes.byteLength > maxBytes) {
			throw new Error(`Content too large: ${bytes.byteLength} bytes (max ${maxBytes}).`);
		}
		try {
			const st = await fs.stat(abs);
			if (st.isDirectory()) throw new Error("Target path is a directory");
			if (!overwrite) throw new Error("File exists and overwrite=false");
		} catch {}
		await fs.mkdir(path.dirname(abs), { recursive: true });
		await fs.writeFile(abs, bytes);
		return `Wrote ${bytes.byteLength} bytes to ${path.relative(process.cwd(), abs)}`;
	},
});

export const appendFileTool = tool({
	name: "append_file",
	description: "Append UTF-8 text to a file; creates file and parents if needed.",
	parameters: z.object({
		path: z.string().min(1),
		content: z.string().min(1),
		maxBytes: z.number().int().positive().max(2_000_000).default(500_000),
	}),
	needsApproval: needsApprovalFor("append_file"),
	async execute({ path: filePath, content, maxBytes }) {
		const abs = path.resolve(process.cwd(), filePath);
		if (!withinCwd(abs)) {
			throw new Error("Path must be within the working directory");
		}
		const enc = new TextEncoder();
		const bytes = enc.encode(content);
		if (bytes.byteLength > maxBytes) {
			throw new Error(`Content too large: ${bytes.byteLength} bytes (max ${maxBytes}).`);
		}
		await fs.mkdir(path.dirname(abs), { recursive: true });
		await fs.appendFile(abs, bytes);
		return `Appended ${bytes.byteLength} bytes to ${path.relative(process.cwd(), abs)}`;
	},
});

// register new tools
(defaultTools as any[]).push(mkdirpTool as any);
(defaultTools as any[]).push(writeFileTool as any);
(defaultTools as any[]).push(appendFileTool as any);

export const shellExecTool = tool({
	name: "shell_exec",
	description:
		"Run a system command with built-in safety. By default, only a small allowlist of read-only commands is permitted; set dangerous=true to run any command. Execution is confined to the current working directory and output is truncated.",
	parameters: z.object({
		cmd: z.string().min(1),
		args: z.array(z.string()).default([]),
		cwd: z.string().default("."),
		timeoutMs: z.number().int().min(100).max(60_000).default(10_000),
		stdin: z.string().default(""),
		dangerous: z.boolean().default(false),
	}),
	needsApproval: needsApprovalFor("shell_exec"),
	async execute({ cmd, args, cwd, timeoutMs, stdin, dangerous }) {
		const cfg = await loadConfig();
		const allowed = new Set<string>([
			"ls",
			"cat",
			"pwd",
			"echo",
			"head",
			"tail",
			"wc",
			"stat",
			"rg",
			"find",
			"curl",
			"git",
			"mkdir",
			"bun",
			"pandoc"
		]);
		for (const extra of cfg.shell.extraAllowlist) allowed.add(extra);
		if (!dangerous && !allowed.has(cmd)) {
			throw new Error(`Command not allowed in safe mode: ${cmd}`);
		}
		if (dangerous && !cfg.shell.allowDangerous) {
			throw new Error(
				"Dangerous commands are disabled in config. Enable it via `gsio config`."
			);
		}
		const absCwd = path.resolve(process.cwd(), cwd);
		if (!withinCwd(absCwd)) {
			throw new Error("cwd must be within the working directory");
		}
		const { code, stdout, stderr, timedOut, durationMs, spawnError } =
			await runCommand(cmd, args, { cwd: absCwd, timeoutMs, stdin });
		const meta = `code=${code} timedOut=${timedOut} durationMs=${durationMs}${
			spawnError ? ` spawnError=${spawnError.name}` : ""
		}`;
		const truncated = (s: string) =>
			s.length >= 200000 ? s + "\n[truncated]\n" : s;
		return [
			`> ${cmd} ${args.join(" ")}`,
			meta,
			stdout ? `STDOUT:\n${truncated(stdout)}` : "STDOUT: (empty)",
			stderr ? `STDERR:\n${truncated(stderr)}` : "STDERR: (empty)",
		].join("\n");
	},
});

// Included by default; behavior controlled by project config.
defaultTools.push(shellExecTool as any);
