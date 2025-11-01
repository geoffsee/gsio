import { describe, it, expect } from "bun:test";
import fs from "node:fs/promises";
import { withTempCwd } from "./helpers/tempWorkspace";

const configModule = await import("../src/config?config-tests");
const { loadConfig, saveConfig, getConfigPath } = configModule;
type AppConfig = import("../src/config").AppConfig;

describe("config module", () => {
	it("returns defaults when config file is missing", async () => {
		await withTempCwd(async () => {
			const cfg = await loadConfig();
			expect(cfg.ai.provider).toBe("openai");
			expect(cfg.panel.maxItems).toBe(5);
			expect(cfg.tools.requireApproval).toContain("shell_exec");
			expect(cfg.linger.enabled).toBe(false);
		}, "gsio-config-");
	});

	it("normalizes legacy or malformed configuration values", async () => {
		await withTempCwd(async () => {
			const legacy = {
				ai: {
					provider: "ollama",
					model: "",
					baseUrl: "http://localhost:11434",
					apiKey: "",
				},
				panel: { todoShowCompleted: "nope", maxItems: 100 },
				shell: { allowDangerous: "yes", extraAllowlist: [123, "npm run"] },
				audio: {
					captureEnabled: "true",
					sttProvider: "whisper",
					whisper: {
						command: "",
						model: "",
						language: "",
						extraArgs: ["--foo", 42],
					},
				},
				linger: { enabled: "yes", behavior: "", minIntervalSec: 2 },
				tools: { requireApproval: ["custom_tool", "shell_exec", ""] },
				memory: {
					enabled: false,
					userId: "   user-123   ",
					maxEntries: 10000,
					storageDir: "",
					embeddingModel: " ",
				},
			};
			await fs.writeFile(
				getConfigPath(),
				JSON.stringify(legacy, null, 2),
				"utf8"
			);

			const cfg = await loadConfig();
			expect(cfg.ai.provider).toBe("ollama");
			expect(cfg.ai.model).toBe("llama3.1:8b");
			expect(cfg.ai.baseUrl).toBe("http://localhost:11434");
			expect(cfg.panel.maxItems).toBe(20);
			expect(cfg.audio.whisper.command).toBe("whisper-cpp");
			expect(cfg.audio.whisper.extraArgs).toEqual(["--foo"]);
			expect(cfg.tools.requireApproval).toEqual(["custom_tool", "shell_exec"]);
			expect(cfg.memory.enabled).toBe(false);
			expect(cfg.memory.maxEntries).toBe(5000);
			expect(cfg.memory.userId).toBe("user-123");
			expect(cfg.memory.storageDir).toBe(".gsio-memory");
			expect(cfg.linger.enabled).toBe(true);
			expect(cfg.linger.minIntervalSec).toBe(5);
		}, "gsio-config-");
	});

	it("persists normalized values when saving configuration", async () => {
		await withTempCwd(async () => {
			const cfg: AppConfig = {
				ai: { provider: "openai", model: "  ", baseUrl: "", apiKey: "" },
				shell: { allowDangerous: true, extraAllowlist: ["ls", ""] },
				panel: { todoShowCompleted: false, maxItems: 0 },
				audio: {
					captureEnabled: true,
					sttProvider: "openai",
					whisper: {
						command: "whisper-cpp",
						model: "",
						language: "",
						extraArgs: [],
					},
					openaiTranscribeModel: "",
					openaiBaseUrl: "",
					openaiApiKey: "",
				},
				linger: { enabled: true, behavior: "   ", minIntervalSec: 9999 },
				tools: {
					requireApproval: ["custom_tool", "shell_exec", "custom_tool"],
				},
				memory: {
					enabled: true,
					userId: "  person ",
					maxEntries: 40,
					storageDir: "",
					embeddingModel: "",
				},
			};

			await saveConfig(cfg);
			const stored = JSON.parse(await fs.readFile(getConfigPath(), "utf8"));
			expect(stored.ai.model).toBe("gpt-4o-mini");
			expect(stored.panel.maxItems).toBe(1);
			expect(stored.tools.requireApproval).toEqual([
				"custom_tool",
				"shell_exec",
			]);
			expect(stored.memory.maxEntries).toBe(50);
			expect(stored.memory.userId).toBe("person");
			expect(stored.linger.minIntervalSec).toBe(600);
		}, "gsio-config-");
	});
});
