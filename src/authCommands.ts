import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const AUTH_VERSION = "1.0.0";
const CONFIG_DIR = path.join(homedir(), ".config", "gsio-cli");
const CONFIG_FILE = path.join(CONFIG_DIR, "auth.json");
const DEFAULT_BASE_URL = "https://geoff.seemueller.io";

type AuthConfig = {
	apiKey?: string;
	baseUrl?: string;
};

type GeneratedKeyResponse = {
	apiKey?: {
		key: string;
		expiresAt?: string;
	};
};

type KeysListResponse = {
	keys?: Array<{
		id: string;
		name: string;
		created: string;
		lastUsed?: string;
		expiresAt?: string;
	}>;
	message?: string;
};

function ensureConfigDir() {
	if (!existsSync(CONFIG_DIR)) {
		mkdirSync(CONFIG_DIR, { recursive: true });
	}
}

function loadConfig(): AuthConfig {
	ensureConfigDir();
	if (!existsSync(CONFIG_FILE)) {
		return {};
	}
	try {
		const content = readFileSync(CONFIG_FILE, "utf8");
		const parsed = JSON.parse(content);
		return typeof parsed === "object" && parsed ? parsed : {};
	} catch (error) {
		console.error("Error reading auth config:", error);
		return {};
	}
}

function saveConfig(config: AuthConfig) {
	ensureConfigDir();
	try {
		writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf8");
	} catch (error) {
		console.error("Error writing auth config:", error);
		process.exit(1);
	}
}

function getBaseUrl(): string {
	const config = loadConfig();
	return (config.baseUrl || "").trim() || DEFAULT_BASE_URL;
}

export function getAuthConfigPath(): string {
	return CONFIG_FILE;
}

export function printAuthHelp() {
	console.log(`
GSIO CLI authentication commands

Usage: gsio <command> [options]

Commands:
  auth login               Authenticate with the GSIO cloud and generate an API key
  auth logout              Remove stored credentials
  auth status              Show authentication status and current base URL
  keys list                List API keys associated with your account
  keys revoke <id>         Revoke an API key by ID
  config set-url <url>     Override the base API URL
  version                  Show auth command version
`);
}

export function printAuthVersion() {
	console.log(`GSIO auth commands v${AUTH_VERSION}`);
}

export function checkAuthStatus() {
	const config = loadConfig();
	const baseUrl = getBaseUrl();

	console.log(`Base URL: ${baseUrl}`);

	if (config.apiKey) {
		console.log("Status: Authenticated (OK)");
		const preview = config.apiKey.length > 24 ? `${config.apiKey.slice(0, 24)}...` : config.apiKey;
		console.log(`API Key: ${preview}`);
		console.log(`Config file: ${CONFIG_FILE}`);
	} else {
		console.log("Status: Not authenticated (missing credentials)");
		console.log("\nRun \"gsio auth login\" to authenticate");
	}
}

export async function login() {
	const baseUrl = getBaseUrl();

	console.log(`Authenticating to ${baseUrl}...\n`);

	const username = await promptInput("Email or username: ");
	if (!username) {
		console.error("Error: Email/username is required");
		process.exit(1);
	}

	const password = await promptPassword("Password: ");
	if (!password) {
		console.error("Error: Password is required");
		process.exit(1);
	}

	try {
		console.log("\nAuthenticating...");
		const loginResponse = await fetch(`${baseUrl}/api/login`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ email: username, password }),
		});

		if (!loginResponse.ok) {
			const errorText = await loginResponse.text();
			console.error(`Authentication failed: ${errorText}`);
			process.exit(1);
		}

		const cookies = loginResponse.headers.get("set-cookie") ?? "";

		console.log("Generating API key...");
		const keyName = `cli-${new Date().toISOString().split("T")[0]}`;
		const generateResponse = await fetch(`${baseUrl}/api/keys/generate`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: cookies,
			},
			body: JSON.stringify({ name: keyName, expiresInDays: 90 }),
		});

		if (!generateResponse.ok) {
			const errorText = await generateResponse.text();
			console.error(`Failed to generate API key: ${errorText}`);
			process.exit(1);
		}

		const result = (await generateResponse.json()) as GeneratedKeyResponse;
		const apiKey = result.apiKey?.key?.trim();

		if (!apiKey) {
			console.error("Failed to generate API key: Invalid response from server");
			process.exit(1);
		}

		const config = loadConfig();
		config.apiKey = apiKey;
		saveConfig(config);

		console.log("\nAuthentication successful!");
		console.log(`API Key: ${apiKey}`);
		console.log(`\nYour API key has been saved to: ${CONFIG_FILE}`);
		console.log("\nWARNING: Keep this key secure and do not share it with others.");
		if (result.apiKey?.expiresAt) {
			const expiresDate = new Date(result.apiKey.expiresAt);
			console.log(`\nKey expires: ${expiresDate.toLocaleDateString()}`);
		}
	} catch (error: any) {
		console.error("Error during authentication:", error?.message ?? error);
		process.exit(1);
	}
}

export function logout() {
	const config = loadConfig();
	if (!config.apiKey) {
		console.log("Already logged out");
		return;
	}

	delete config.apiKey;
	saveConfig(config);
	console.log("Logged out successfully");
}

export async function listKeys() {
	const config = loadConfig();
	const baseUrl = getBaseUrl();

	if (!config.apiKey) {
		console.error('Error: Not authenticated. Run "gsio auth login" first.');
		process.exit(1);
	}

	try {
		const response = await fetch(`${baseUrl}/api/keys`, {
			method: "GET",
			headers: {
				Authorization: `Bearer ${config.apiKey}`,
			},
		});

		if (!response.ok) {
			const errorText = await response.text();
			console.error(`Failed to list keys: ${errorText}`);
			process.exit(1);
		}

		const result = (await response.json()) as KeysListResponse;

		if (!result.keys || result.keys.length === 0) {
			console.log("No API keys found");
			return;
		}

		console.log("\nYour API Keys:\n");
		for (const key of result.keys) {
			console.log(`ID: ${key.id}`);
			console.log(`Name: ${key.name}`);
			console.log(`Created: ${new Date(key.created).toLocaleString()}`);
			if (key.lastUsed) {
				console.log(`Last Used: ${new Date(key.lastUsed).toLocaleString()}`);
			}
			if (key.expiresAt) {
				console.log(`Expires: ${new Date(key.expiresAt).toLocaleString()}`);
			}
			console.log("");
		}
	} catch (error: any) {
		console.error("Error listing keys:", error?.message ?? error);
		process.exit(1);
	}
}

export async function revokeKey(keyId?: string) {
	const config = loadConfig();
	const baseUrl = getBaseUrl();

	if (!config.apiKey) {
		console.error('Error: Not authenticated. Run "gsio auth login" first.');
		process.exit(1);
	}

	if (!keyId) {
		console.error("Error: Key ID is required");
		console.log('Usage: gsio keys revoke <id>');
		process.exit(1);
	}

	try {
		const response = await fetch(`${baseUrl}/api/keys/${keyId}`, {
			method: "DELETE",
			headers: {
				Authorization: `Bearer ${config.apiKey}`,
			},
		});

		if (!response.ok) {
			const errorText = await response.text();
			console.error(`Failed to revoke key: ${errorText}`);
			process.exit(1);
		}

		const result = (await response.json()) as KeysListResponse;
		console.log(result.message || "API key revoked successfully");
	} catch (error: any) {
		console.error("Error revoking key:", error?.message ?? error);
		process.exit(1);
	}
}

export function setBaseUrl(url?: string) {
	if (!url) {
		console.error("Error: URL is required");
		console.log("Usage: gsio config set-url <url>");
		process.exit(1);
	}

	try {
		new URL(url);
	} catch {
		console.error("Error: Invalid URL format");
		process.exit(1);
	}

	const config = loadConfig();
	config.baseUrl = url;
	saveConfig(config);

	console.log(`Base URL set to: ${url}`);
}

function promptInput(prompt: string): Promise<string> {
	process.stdout.write(prompt);
	const stdin = process.stdin;
	stdin.resume();

	return new Promise((resolve) => {
		stdin.once("data", (data: Buffer) => {
			stdin.pause();
			resolve(data.toString().trim());
		});
	});
}

function promptPassword(prompt: string): Promise<string> {
	process.stdout.write(prompt);
	const stdin = process.stdin;

	if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
		stdin.resume();
		return new Promise((resolve) => {
			stdin.once("data", (data: Buffer) => {
				stdin.pause();
				resolve(data.toString().trim());
			});
		});
	}

	const wasRaw = (stdin as any).isRaw === true;
	stdin.setRawMode(true);
	stdin.resume();

	return new Promise((resolve) => {
		let password = "";

		const onData = (char: Buffer) => {
			const byte = char[0];

			if (byte === 13 || byte === 10) {
				stdin.setRawMode(wasRaw);
				stdin.removeListener("data", onData);
				stdin.pause();
				process.stdout.write("\n");
				resolve(password);
				return;
			}

			if (byte === 3) {
				stdin.setRawMode(wasRaw);
				stdin.removeListener("data", onData);
				process.stdout.write("\n");
				process.exit(1);
			}

			if (byte === 127 || byte === 8) {
				if (password.length > 0) {
					password = password.slice(0, -1);
					process.stdout.write("\b \b");
				}
				return;
			}

			password += char.toString();
			process.stdout.write("*");
		};

		stdin.on("data", onData);
	});
}
