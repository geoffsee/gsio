import { describe, it, expect, mock } from "bun:test";

describe("startContinuousCapture", () => {
	it("reports a helpful error when ffmpeg is unavailable", async () => {
		mock.restore();
		const spawnMock = mock(() => {
			throw new Error("spawn failure");
		});
		mock.module("node:child_process", () => ({ spawn: spawnMock }));

		const { startContinuousCapture } = await import(
			`../src/audio?case=no-ffmpeg-${Date.now()}`
		);

		const onError = mock(() => {});
		const stop = startContinuousCapture({ onTranscript: () => {}, onError });

		expect(spawnMock.mock.calls.length).toBe(1);
		expect(onError.mock.calls.length).toBe(1);
		expect(onError.mock.calls[0][0]).toContain("ffmpeg not found");

		stop();
	});
});
