import { describe, it, expect, mock } from "bun:test";

describe("summarizeAudioContext", () => {
	it("updates the rolling summary using OpenAI configuration", async () => {
		mock.restore();
		const loadConfigMock = mock(() =>
			Promise.resolve({
				ai: {
					provider: "openai",
					model: "gpt-4o-mini",
					baseUrl: "",
					apiKey: "sk-test",
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
		const ctorMock = mock((options: any) => options);
		const createMock = mock(() =>
			Promise.resolve({
				choices: [{ message: { content: " Fresh summary " } }],
			})
		);

		mock.module("../src/config", () => ({ loadConfig: loadConfigMock }));
		mock.module("openai", () => ({
			default: class FakeOpenAI {
				chat = {
					completions: {
						create: (...args: any[]) => createMock(...args),
					},
				};
				constructor(options: any) {
					ctorMock(options);
				}
			},
		}));

		const { summarizeAudioContext } = await import(
			`../src/summarizer?case=success-${Date.now()}`
		);
		const result = await summarizeAudioContext("Existing summary", "New info");

		expect(result).toBe("Fresh summary");
		expect(loadConfigMock.mock.calls.length).toBe(1);
		expect(ctorMock.mock.calls[0][0]).toMatchObject({
			apiKey: "sk-test",
			baseURL: undefined,
		});
		const request = createMock.mock.calls[0][0];
		expect(request.model).toBe("gpt-4o-mini");
		expect(request.messages[0].role).toBe("system");
		expect(request.messages[1].content).toContain("Existing summary");
		expect(request.messages[1].content).toContain("New info");
	});

	it("appends /v1 to Ollama base URLs and surfaces API errors", async () => {
		mock.restore();
		const loadConfigMock = mock(() =>
			Promise.resolve({
				ai: {
					provider: "ollama",
					model: "",
					baseUrl: "http://localhost:11434",
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
		const ctorMock = mock((options: any) => options);
		const apiError = Object.assign(new Error("bad request"), {
			status: 401,
			response: { data: { error: { message: "invalid" } } },
		});
		const createMock = mock(() => {
			throw apiError;
		});

		mock.module("../src/config", () => ({ loadConfig: loadConfigMock }));
		mock.module("openai", () => ({
			default: class FakeOpenAI {
				chat = {
					completions: {
						create: (...args: any[]) => createMock(...args),
					},
				};
				constructor(options: any) {
					ctorMock(options);
				}
			},
		}));

		const warnOriginal = console.warn;
		const errorOriginal = console.error;
		const warnMock = mock((..._args: any[]) => {});
		const errorMock = mock((..._args: any[]) => {});
		console.warn = warnMock as unknown as typeof console.warn;
		console.error = errorMock as unknown as typeof console.error;

		const { summarizeAudioContext } = await import(
			`../src/summarizer?case=error-${Date.now()}`
		);

		await expect(
			summarizeAudioContext("", "Problematic input")
		).rejects.toThrow(/status=401/);

		expect(warnMock.mock.calls.length).toBeGreaterThan(0);
		expect(ctorMock.mock.calls[0][0]).toMatchObject({
			baseURL: "http://localhost:11434/v1",
		});
		expect(createMock.mock.calls.length).toBe(1);
		expect(errorMock.mock.calls.length).toBeGreaterThan(0);

		console.warn = warnOriginal;
		console.error = errorOriginal;
	});
});
