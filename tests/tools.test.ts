import { describe, it, expect } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import {
	calculatorTool,
	readFileAsText,
	listFilesTool,
} from "../src/tools";
import { withTempCwd } from "./helpers/tempWorkspace";

describe("calculator tool", () => {
	it("evaluates arithmetic expressions safely", async () => {
		await withTempCwd(async () => {
			const result = await calculatorTool.invoke(
				{} as any,
				JSON.stringify({ expression: "1 + 2 * (3 + 4)" })
			);
			expect(result).toBe("15");
		}, "gsio-tools-");
	});

	it("rejects expressions with invalid characters", async () => {
		await withTempCwd(async () => {
			const result = await calculatorTool.invoke(
				{} as any,
				JSON.stringify({ expression: "2 + sin(1)" })
			);
			expect(result).toContain("Invalid characters in expression.");
		}, "gsio-tools-");
	});
});

describe("readFileAsText", () => {
	it("reads relative text files within the working directory", async () => {
		await withTempCwd(async () => {
			await fs.writeFile("notes.txt", "hello world\nline two", "utf8");
			const text = await readFileAsText("notes.txt", 10_000);
			expect(text).toBe("hello world\nline two");
		}, "gsio-tools-");
	});

	it("throws when accessing files outside of the working directory", async () => {
		await withTempCwd(async (dir) => {
			const outside = path.resolve(dir, "..", "outside.txt");
			await fs.writeFile(outside, "nope", "utf8");
			await expect(
				readFileAsText(outside, 10_000)
			).rejects.toThrow("Access outside the working directory is not allowed.");
		}, "gsio-tools-");
	});
});

describe("listFilesTool", () => {
	it("lists files relative to the provided directory", async () => {
		await withTempCwd(async () => {
			await fs.mkdir("sub", { recursive: true });
			await fs.writeFile(path.join("sub", "file.txt"), "content", "utf8");

			const output = await listFilesTool.invoke(
				{} as any,
				JSON.stringify({ dir: "sub" })
			);
			expect(output.split("\n")).toContain("f\tsub/file.txt");
		}, "gsio-tools-");
	});
});
