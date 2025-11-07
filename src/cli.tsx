#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import meow from "meow";
import App from "./app";
import { Chat } from "./chat";
import { ConfigMenu } from "./configMenu";
import { setConfigPathOverride } from "./config";
import { configureLLM } from "./llm";

const cli = meow(
	`
	Usage
	  $ gsio

	Description
	  Start an interactive AI chat in your terminal. Type and press Enter to send. The assistant can use tools (calculator, file read/list, HTTP GET).

	Environment
	  Requires OPENAI_API_KEY to be set in your environment.

	Options
	  --name  Optional greeting name (shown at the top)
	  --debug Enable input debugging (logs key info)
	  --config, -c  Path to config file or directory (defaults to CWD/.gsio-config.json)

	Examples
	  $ gsio
	  $ OPENAI_API_KEY=sk-...
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
            config: {
                type: "string",
                shortFlag: "c",
            },
		},
	}
);

const subcommand = cli.input[0];

// If provided, set config path override before any config loads
if (typeof cli.flags.config === "string" && cli.flags.config.trim().length > 0) {
    setConfigPathOverride(cli.flags.config);
    // Also expose via env for child processes if any
    process.env["GSIO_CONFIG"] = cli.flags.config;
}

await configureLLM();

render(
	<>
		{subcommand === "config" ? (
			<ConfigMenu />
		) : (
			<Chat debug={Boolean(cli.flags.debug)} />
		)}
		<App name={cli.flags.name} />
	</>
);
