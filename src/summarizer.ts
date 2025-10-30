import OpenAI from "openai";
import { loadConfig } from "./config";

export async function summarizeAudioContext(
	prevSummary: string,
	newUtterance: string
): Promise<string> {
	const system = `You maintain a concise rolling summary (<= 200 words) of ambient audio context.
Include only information relevant to assisting the user with on-going tasks.
Avoid duplicating content; integrate updates succinctly.`;
	const user = `Previous summary:\n${
		prevSummary || "(none)"
	}\n\nNew utterance:\n${newUtterance}\n\nUpdate the summary.`;
	const cfg = await loadConfig();
	const provider = cfg.ai?.provider ?? "openai";
	const model =
		(cfg.ai?.model ?? "").trim() ||
		(provider === "ollama" ? "llama3.1:8b" : "gpt-4o-mini");
	const rawBaseUrl =
		(cfg.ai?.baseUrl ?? "").trim() ||
		(provider === "ollama" ? "http://localhost:11434/v1" : "");
	const { baseUrl: resolvedBaseUrl, note: baseUrlNote } = normalizeBaseUrl(
		provider,
		rawBaseUrl
	);
	if (baseUrlNote) {
		console.warn(
			`[summarizeAudioContext] ${baseUrlNote} (provider=${provider}, originalBaseUrl=${rawBaseUrl})`
		);
	}
	const apiKey =
		(cfg.ai?.apiKey ?? "").trim() || process.env["OPENAI_API_KEY"] || "";
	const client = new OpenAI({
		apiKey: apiKey || undefined,
		baseURL: resolvedBaseUrl || undefined,
	} as any);
	try {
		const resp = await client.chat.completions.create({
			model,
			messages: [
				{ role: "system", content: system },
				{ role: "user", content: user },
			],
			temperature: 0.2,
		});
		return resp.choices?.[0]?.message?.content?.trim?.() || prevSummary || "";
	} catch (err: any) {
		const status =
			err?.status ??
			err?.statusCode ??
			err?.response?.status ??
			err?.cause?.status ??
			"unknown";
		const responseData =
			err?.response?.data ??
			err?.response?.body ??
			err?.data ??
			err?.cause?.response?.data;
		let responseSnippet = "";
		if (responseData) {
			try {
				if (typeof responseData === "string") {
					responseSnippet = responseData.slice(0, 300);
				} else {
					responseSnippet = JSON.stringify(responseData).slice(0, 300);
				}
			} catch {
				responseSnippet = "[unstringifiable response data]";
			}
		}
		const traceParts = [
			`status=${status}`,
			`provider=${provider}`,
			`model=${model}`,
			`baseUrl=${resolvedBaseUrl || "(default)"}`,
		];
		if (responseSnippet) {
			traceParts.push(`response=${responseSnippet}`);
		}
		const traceMsg = `[summarizeAudioContext] failed (${traceParts.join(
			", "
		)})`;
		console.error(traceMsg, err);
		const errorDetail = err?.message || String(err);
		throw new Error(`${traceMsg}: ${errorDetail}`);
	}
}

function normalizeBaseUrl(
	provider: string,
	raw: string
): { baseUrl: string; note: string | null } {
	const trimmed = (raw || "").trim();
	if (!trimmed) return { baseUrl: "", note: null };
	let cleaned = trimmed.replace(/\/+$/, "");
	if (provider === "ollama") {
		const hasV1 = /\/v1(?:\/|$)/.test(cleaned);
		if (!hasV1) {
			const adjusted = `${cleaned}/v1`;
			return {
				baseUrl: adjusted,
				note: 'Detected Ollama provider without "/v1"; appended automatically',
			};
		}
	}
	return { baseUrl: cleaned, note: null };
}
