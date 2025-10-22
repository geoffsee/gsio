#!/usr/bin/env node
import React from 'react';
import {render} from 'ink';
import meow from 'meow';
import App from './app.js';
import {Chat} from './chat.js';
import {ConfigMenu} from './configMenu.js';

const cli = meow(
	`
	Usage
	  $ gsio-ai

	Description
	  Start an interactive AI chat in your terminal. Type and press Enter to send. The assistant can use tools (calculator, file read/list, HTTP GET).

	Environment
	  Requires OPENAI_API_KEY to be set in your environment.

	Options
	  --name  Optional greeting name (shown at the top)
	  --debug Enable input debugging (logs key info)

	Examples
	  $ gsio-ai
	  $ OPENAI_API_KEY=sk-... gsio-ai
`,
	{
		importMeta: import.meta,
		flags: {
			name: {
				type: 'string',
			},
			debug: {
				type: 'boolean',
				default: false,
			},
		},
	},
);

const subcommand = cli.input[0];

render(
	<>
		{subcommand === 'config' ? (
			<ConfigMenu />
		) : (
			<Chat debug={Boolean(cli.flags.debug)} />
		)}
		<App name={cli.flags.name} />
	</>,
);
