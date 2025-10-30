import React from "react";
import chalk from "chalk";
import test from "ava";
import { render } from "ink-testing-library";
import App from "./src/app.tsx";

test("greet unknown user", (t) => {
	const { lastFrame } = render(<App name={undefined} />);
	const frame = lastFrame();
	t.true(frame.includes(`Hello, ${chalk.green("Stranger")}`));
});

test("greet user with a name", (t) => {
	const { lastFrame } = render(<App name="Jane" />);
	const frame = lastFrame();
	t.true(frame.includes(`Hello, ${chalk.green("Jane")}`));
});
