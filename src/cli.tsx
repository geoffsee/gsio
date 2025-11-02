#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import meow from "meow";
import { createRequire } from "node:module";
import App from "./app";
import { Chat } from "./chat";
import { ConfigMenu } from "./configMenu";
import { configureLLM } from "./llm";
import {
	checkAuthStatus,
	listKeys as authListKeys,
	login as authLogin,
	logout as authLogout,
	printAuthHelp,
	revokeKey as authRevokeKey,
	setBaseUrl as authSetBaseUrl,
} from "./authCommands";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");
const packageVersion: string = pkg.version ?? "";

const cli = meow(
	`
	Usage
	  $ gsio [command]

	Description
	  Start an interactive AI chat in your terminal, manage authentication for the GSIO cloud API, and configure local settings.

	Commands
	  (none)                 Launch interactive chat
	  config                 Open the interactive configuration menu
	  config set-url <url>   Override the GSIO cloud API base URL
	  auth login             Authenticate and create a new API key
	  auth logout            Remove stored credentials
	  auth status            Show authentication status and base URL
	  keys list              List stored API keys
	  keys revoke <id>       Revoke a specific API key
	  version                Show CLI version information
	  help                   Show this help message

	Environment
	  Requires OPENAI_API_KEY to be set in your environment (unless configured via the menu).

	Options
	  --name  Optional greeting name (shown at the top of the chat UI)
	  --debug Enable input debugging (logs key info)

	Examples
	  $ gsio
	  $ gsio config
	  $ gsio auth login
	  $ gsio keys list
`,
	{
		importMeta: import.meta,
		flags: {
			name: {
				type: "string",
			},
			debug: {
				type: "boolean",
				default: false,
			},
		},
	}
);

async function main() {
	const [command, subcommand, ...rest] = cli.input;

	if (command === "help") {
		cli.showHelp(0);
		return;
	}

	if (command === "version") {
		console.log(`gsio v${packageVersion}`);
		return;
	}

	if (command === "auth") {
		if (!subcommand) {
			printAuthHelp();
			return;
		}

		if (subcommand === "login") {
			await authLogin();
			return;
		}

		if (subcommand === "logout") {
			authLogout();
			return;
		}

		if (subcommand === "status") {
			checkAuthStatus();
			return;
		}

		console.error(`Unknown auth subcommand: ${subcommand}`);
		printAuthHelp();
		process.exit(1);
	}

	if (command === "keys") {
		if (subcommand === "list") {
			await authListKeys();
			return;
		}

		if (subcommand === "revoke") {
			const keyId = rest[0];
			await authRevokeKey(keyId);
			return;
		}

		console.error(`Unknown keys subcommand: ${subcommand ?? "(none)"}`);
		console.log("Available: list, revoke <id>");
		process.exit(1);
	}

	if (command === "config") {
		if (subcommand === "set-url") {
			authSetBaseUrl(rest[0]);
			return;
		}

		if (subcommand) {
			console.error(`Unknown config subcommand: ${subcommand}`);
			console.log("Available: set-url <url>");
			process.exit(1);
		}
	}

	if (
		command &&
		command !== "config" &&
		command !== "auth" &&
		command !== "keys"
	) {
		console.error(`Unknown command: ${command}`);
		cli.showHelp(1);
		return;
	}

	await configureLLM();

	render(
		<>
			{command === "config" ? (
				<ConfigMenu />
			) : (
				<Chat debug={Boolean(cli.flags.debug)} />
			)}
			<App name={cli.flags.name} />
		</>
	);
}

await main();
