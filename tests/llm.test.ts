import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { setOpenAIAPI, setDefaultOpenAIKey } from "@openai/agents-openai";

const baseEnv = { ...process.env };

beforeEach(() => {
	for (const key of Object.keys(process.env)) {
		delete process.env[key];
	}
	Object.assign(process.env, baseEnv);
	delete process.env.OPENAI_API_KEY;
	delete process.env.OPENAI_BASE_URL;
	delete process.env.OPENAI_DEFAULT_MODEL;
	setOpenAIAPI("responses");
	setDefaultOpenAIKey(undefined as any);
	mock.restore();
});

afterEach(() => {
	mock.restore();
});

describe("configureLLM", () => {
	it("configures OpenAI responses mode with provided overrides", async () => {
		const loadConfigMock = mock(() =>
			Promise.resolve({
				ai: {
					provider: "openai",
					model: "custom-model",
					baseUrl: "https://example.test",
					apiKey: "api-key",
				},
				shell: { allowDangerous: false, extraAllowlist: [] },
				panel: { todoShowCompleted: true, maxItems: 5 },
				audio: {
					captureEnabled: false,
					sttProvider: "openai",
					whisper: {
						command: "whisper-cpp",
						model: "",
						language: "en",
						extraArgs: [],
					},
					openaiTranscribeModel: "gpt-4o-transcribe",
					openaiBaseUrl: "",
					openaiApiKey: "",
				},
				linger: { enabled: false, behavior: "", minIntervalSec: 20 },
				tools: { requireApproval: ["shell_exec"] },
				memory: {
					enabled: false,
					userId: "local_user",
					maxEntries: 500,
					storageDir: ".gsio-memory",
					embeddingModel: "text-embedding-3-small",
				},
			})
		);

		mock.module("../src/config", () => ({ loadConfig: loadConfigMock }));

		const { configureLLM } = await import(`../src/llm?scenario=openai-${Date.now()}`);
		await configureLLM();

		expect(loadConfigMock.mock.calls.length).toBe(1);
		expect(process.env.OPENAI_API_KEY).toBe("api-key");
		expect(process.env.OPENAI_BASE_URL).toBe("https://example.test");
		expect(process.env.OPENAI_DEFAULT_MODEL).toBe("custom-model");
	});

	it("configures Ollama chat completions fallback with default key", async () => {
		const loadConfigMock = mock(() =>
			Promise.resolve({
				ai: {
					provider: "ollama",
					model: "",
					baseUrl: "",
					apiKey: "",
				},
				shell: { allowDangerous: false, extraAllowlist: [] },
				panel: { todoShowCompleted: true, maxItems: 5 },
				audio: {
					captureEnabled: false,
					sttProvider: "openai",
					whisper: {
						command: "whisper-cpp",
						model: "",
						language: "en",
						extraArgs: [],
					},
					openaiTranscribeModel: "gpt-4o-transcribe",
					openaiBaseUrl: "",
					openaiApiKey: "",
				},
				linger: { enabled: false, behavior: "", minIntervalSec: 20 },
				tools: { requireApproval: ["shell_exec"] },
				memory: {
					enabled: false,
					userId: "local_user",
					maxEntries: 500,
					storageDir: ".gsio-memory",
					embeddingModel: "text-embedding-3-small",
				},
			})
		);

		mock.module("../src/config", () => ({ loadConfig: loadConfigMock }));

		const { configureLLM } = await import(`../src/llm?scenario=ollama-${Date.now()}`);
		await configureLLM();

		expect(loadConfigMock.mock.calls.length).toBe(1);
		expect(process.env.OPENAI_API_KEY).toBe("ollama");
		expect(process.env.OPENAI_BASE_URL).toBe("http://localhost:11434/v1");
		expect(process.env.OPENAI_DEFAULT_MODEL).toBe("llama3.1:8b");
	});
});
