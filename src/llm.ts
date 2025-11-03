import { loadConfig } from "./config";
import { setOpenAIAPI, setDefaultOpenAIKey } from "@openai/agents-openai";

// Configure the global LLM provider (OpenAI cloud or local Ollama via OpenAI-compatible API)
export async function configureLLM(): Promise<void> {
	const cfg = await loadConfig();
	const provider = cfg.ai?.provider ?? "openai";
	const executionModel =
		(cfg.ai?.models?.execution ?? cfg.ai?.model ?? "").trim() ||
		(provider === "ollama" ? "llama3.1:8b" : "gpt-4o-mini");
	const baseUrl =
		(cfg.ai?.baseUrl ?? "").trim() ||
		(provider === "ollama" ? "http://localhost:11434/v1" : "");
	const apiKey = (cfg.ai?.apiKey ?? "").trim();

	// Ensure downstream code sees envs consistently (summarizer/audio use OpenAI client directly)
	if (executionModel) process.env["OPENAI_DEFAULT_MODEL"] = executionModel;

	if (provider === "ollama") {
		// Chat Completions mode works with Ollama's OpenAI-compatible endpoint
		setOpenAIAPI("chat_completions" as any);
		const key = apiKey || process.env["OPENAI_API_KEY"] || "ollama";
		setDefaultOpenAIKey(key);
		process.env["OPENAI_API_KEY"] = key;
		process.env["OPENAI_BASE_URL"] = baseUrl;
	} else {
		// Prefer Responses API with OpenAI; respect optional overrides
		setOpenAIAPI("responses" as any);
		if (apiKey) {
			setDefaultOpenAIKey(apiKey);
			process.env["OPENAI_API_KEY"] = apiKey;
		}
		if (baseUrl) {
			process.env["OPENAI_BASE_URL"] = baseUrl;
		}
	}
}
