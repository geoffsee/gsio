import fs from "node:fs/promises";
import path from "node:path";

export type SessionMessage = {
	role: "user" | "assistant";
	content: string;
	createdAt: string;
};

export type SessionData = {
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	messages: SessionMessage[];
};

export type SessionSummary = {
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	messageCount: number;
};

const SESSIONS_DIR = ".gsio-sessions";
const SESSION_EXT = ".json";

export function createSessionId(date = new Date()): string {
	const pad = (value: number) => value.toString().padStart(2, "0");
	const year = date.getFullYear();
	const month = pad(date.getMonth() + 1);
	const day = pad(date.getDate());
	const hours = pad(date.getHours());
	const mins = pad(date.getMinutes());
	const secs = pad(date.getSeconds());
	return `${year}${month}${day}-${hours}${mins}${secs}`;
}

export function getSessionsDir(cwd = process.cwd()): string {
	return path.resolve(cwd, SESSIONS_DIR);
}

export function getSessionPath(id: string, cwd = process.cwd()): string {
	return path.resolve(getSessionsDir(cwd), `${sanitizeId(id)}${SESSION_EXT}`);
}

export async function ensureSessionsDir(cwd = process.cwd()): Promise<void> {
	const dir = getSessionsDir(cwd);
	await fs.mkdir(dir, { recursive: true });
}

export async function saveSession(
	data: SessionData,
	cwd = process.cwd()
): Promise<void> {
	const normalized = normalizeSessionData(data);
	await ensureSessionsDir(cwd);
	const file = getSessionPath(normalized.id, cwd);
	const json = JSON.stringify(normalized, null, 2);
	await fs.writeFile(file, json, "utf8");
}

export async function loadSession(
	id: string,
	cwd = process.cwd()
): Promise<SessionData | undefined> {
	const file = getSessionPath(id, cwd);
	try {
		const raw = await fs.readFile(file, "utf8");
		const parsed = JSON.parse(raw);
		return normalizeSessionData({
			id: parsed?.id ?? id,
			title: parsed?.title ?? deriveTitle(parsed?.messages),
			createdAt:
				typeof parsed?.createdAt === "string"
					? parsed.createdAt
					: new Date().toISOString(),
			updatedAt:
				typeof parsed?.updatedAt === "string"
					? parsed.updatedAt
					: new Date().toISOString(),
			messages: normalizeMessages(parsed?.messages ?? []),
		});
	} catch (err: any) {
		if (err && (err.code === "ENOENT" || err.code === "ENOTDIR")) {
			return undefined;
		}
		throw err;
	}
}

export async function listSessions(
	cwd = process.cwd()
): Promise<SessionSummary[]> {
	const dir = getSessionsDir(cwd);
	let entries: string[];
	try {
		entries = await fs.readdir(dir);
	} catch (err: any) {
		if (err && (err.code === "ENOENT" || err.code === "ENOTDIR")) {
			return [];
		}
		throw err;
	}

	const summaries: SessionSummary[] = [];
	await Promise.all(
		entries.map(async (entry) => {
			if (!entry.endsWith(SESSION_EXT)) return;
			const file = path.join(dir, entry);
			try {
				const raw = await fs.readFile(file, "utf8");
				const parsed = JSON.parse(raw);
				const messages = normalizeMessages(parsed?.messages ?? []);
				const createdAt =
					typeof parsed?.createdAt === "string"
						? parsed.createdAt
						: new Date().toISOString();
				const updatedAt =
					typeof parsed?.updatedAt === "string"
						? parsed.updatedAt
						: createdAt;
				const title =
					typeof parsed?.title === "string" && parsed.title.trim().length > 0
						? parsed.title
						: deriveTitle(messages);
				summaries.push({
					id: parsed?.id ?? stripExtension(entry),
					title,
					createdAt,
					updatedAt,
					messageCount: messages.length,
				});
			} catch {
				// ignore malformed session files
			}
		})
	);

	return summaries.sort(
		(a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
	);
}

function normalizeSessionData(data: SessionData): SessionData {
	const messages = normalizeMessages(data.messages);
	const title =
		typeof data.title === "string" && data.title.trim().length > 0
			? data.title.trim()
			: deriveTitle(messages);
	return {
		id: sanitizeId(data.id),
		title,
		createdAt: sanitizeIsoTimestamp(data.createdAt),
		updatedAt: sanitizeIsoTimestamp(data.updatedAt),
		messages,
	};
}

function normalizeMessages(raw: any[]): SessionMessage[] {
	if (!Array.isArray(raw)) return [];
	return raw
		.map((entry: any) => {
			const role = entry?.role === "assistant" ? "assistant" : "user";
			const content = typeof entry?.content === "string" ? entry.content : "";
			const createdAt =
				typeof entry?.createdAt === "string"
					? sanitizeIsoTimestamp(entry.createdAt)
					: new Date().toISOString();
			return { role, content, createdAt } as SessionMessage;
		})
		.filter((msg) => msg.content.trim().length > 0);
}

function deriveTitle(messages: SessionMessage[]): string {
	const firstUser = messages.find((msg) => msg.role === "user");
	if (!firstUser) return "New Session";
	const stripped = firstUser.content.replace(/\s+/g, " ").trim();
	if (!stripped) return "New Session";
	return stripped.length > 60 ? `${stripped.slice(0, 57)}…` : stripped;
}

function sanitizeId(id: string): string {
	return id.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function sanitizeIsoTimestamp(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return new Date().toISOString();
	}
	return date.toISOString();
}

function stripExtension(name: string): string {
	return name.endsWith(SESSION_EXT)
		? name.slice(0, -SESSION_EXT.length)
		: name;
}
