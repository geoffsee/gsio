import React, { useState } from "react";
import { Box, Newline, Text, useInput, useStdout } from "ink";
import {
	Agent,
	run,
	type StreamedRunResult,
	type RunStreamEvent,
	type RunToolApprovalItem,
	type RunState,
} from "@openai/agents";
import { defaultTools } from "./tools.js";
import { listTodos, shortList, getFocus } from "./todoStore.js";
import { loadConfig, saveConfig } from "./config.js";
import { startContinuousCapture, type CaptureMetrics } from "./audio.js";
import { summarizeAudioContext } from "./summarizer.js";
import { UserInput } from "./userInput.js";

// Agent instantiated inside component based on config (e.g., audio flag)

type Message = {
	role: "user" | "assistant";
	content: string;
};

type PendingInterruption = {
	id: string;
	toolName: string;
	summary: string | null;
	source: "chat" | "linger";
	state: RunState<any, any>;
	item: RunToolApprovalItem;
};

type ChatProps = { debug?: boolean };

export const Chat = ({ debug = false }: ChatProps) => {
	const { stdout } = useStdout();
	const rightMargin = 2;
	const initRightWidth = (() => {
		const termCols = Number((stdout as any)?.columns ?? 80);
		const halfCols = Math.max(0, Math.floor(termCols / 2));
		return Math.max(24, Math.min(48, Math.max(10, halfCols - rightMargin)));
	})();
	const rightWidthRef = React.useRef<number>(initRightWidth);
	const rightWidth = rightWidthRef.current;
	const LOGS_HEIGHT = 12; // fixed-height logs viewport
	const APPROVALS_HEIGHT = 6;
	const EVENT_LOGS_HEIGHT = 10;
	const [messages, setMessages] = useState<Message[]>([]);
	const [input, setInput] = useState("");
	const [cursor, setCursor] = useState(0);
	const [response, setResponse] = useState<string | null>(null);
	const [isStreaming, setIsStreaming] = useState(false);
	const [history, setHistory] = useState<string[]>([]);
	const [historyIndex, setHistoryIndex] = useState<number | null>(null);
	const [draftBeforeHistory, setDraftBeforeHistory] = useState<string>("");
	const [lastInput, setLastInput] = useState<string>("");
	const [lastFlags, setLastFlags] = useState<string>("");
	const [lastAction, setLastAction] = useState<string>("");
	const [todoPanel, setTodoPanel] = useState<string>("");
	const [focused, setFocused] = useState<number | null>(null);
	const [audioEnabled, setAudioEnabled] = useState<boolean>(false);
	const [audioSummary, setAudioSummary] = useState<string>("");
	const [audioLogs, setAudioLogs] = useState<string[]>([]);
	const [audioStatus, setAudioStatus] = useState<string>("idle");
	const [audioMetrics, setAudioMetrics] = useState<CaptureMetrics | null>(null);
	const [eventLogs, setEventLogs] = useState<string[]>([]);
	const [pendingInterruptions, setPendingInterruptions] = useState<
		PendingInterruption[]
	>([]);
	const [pendingIndex, setPendingIndex] = useState<number>(0);
	const stopAudioRef = React.useRef<null | (() => void)>(null);
	const [lingerEnabled, setLingerEnabled] = useState<boolean>(false);
	const [lingerBehavior, setLingerBehavior] = useState<string>("");
	const [lingerIntervalSec, setLingerIntervalSec] = useState<number>(20);
	const lastLingerRef = React.useRef<number>(0);

	const agent = React.useMemo(() => {
		const audioLine = audioEnabled
			? "Audio context capture is enabled; prefer incorporating relevant auditory information if provided."
			: "";
		return new Agent({
			name: "Assistant",
			instructions: [
				"You are a helpful assistant. Use tools when helpful. Prefer concise answers.",
				"Use the TODO tools to navigate multi-step tasks: create a plan, set priorities, track status (todo/in_progress/blocked/done), mark focus, and add notes. Keep the list updated as you work.",
				audioLine,
				audioSummary ? `Recent audio context summary: ${audioSummary}` : "",
				"You can manage a persistent todo list stored in the current working directory using tools:",
				"- todo_add(text): Add a new todo",
				"- todo_list(includeCompleted=true): List todos",
				"- todo_complete(id): Mark a todo done",
				"- todo_remove(id): Remove a todo",
				"- todo_update(id, text): Update todo text",
				"- todo_clear_all(): Remove all todos",
				"- todo_set_status(id, status, blockedReason?): Set status",
				"- todo_set_priority(id, priority 1..5): Set priority",
				"- todo_add_note(id, note): Append a note",
				"- todo_link_dep(id, dependsOnId) / todo_unlink_dep(id, dependsOnId): Dependencies",
				"- todo_focus(id|0): Focus a todo or clear focus",
				"- todo_plan(steps[]): Bulk-add steps for planning",
				"Keep responses short and show the resulting list when appropriate.",
				"For files, stay within the working directory.",
			]
				.filter(Boolean)
				.join("\n"),
			tools: defaultTools,
		});
	}, [audioEnabled, audioSummary]);

	const appendAudioLog = React.useCallback((msg: string) => {
		const ts = new Date().toLocaleTimeString();
		setAudioLogs((logs) => [...logs, `${ts} — ${msg}`].slice(-100));
	}, []);

	const appendEventLog = React.useCallback(
		(source: "chat" | "linger", detail: string) => {
			const ts = new Date().toLocaleTimeString();
			setEventLogs((logs) =>
				[...logs, `${ts} [${source}] ${detail}`].slice(-200)
			);
		},
		[]
	);

	const pendingRef = React.useRef<PendingInterruption[]>([]);
	React.useEffect(() => {
		pendingRef.current = pendingInterruptions;
	}, [pendingInterruptions]);

	const prevPendingCountRef = React.useRef<number>(0);
	React.useEffect(() => {
		const prev = prevPendingCountRef.current;
		const cur = pendingInterruptions.length;
		if (prev === 0 && cur > 0) {
			setPendingIndex(0);
		} else if (cur === 0 && pendingIndex !== 0) {
			setPendingIndex(0);
		} else if (cur > 0 && pendingIndex >= cur) {
			setPendingIndex(cur - 1);
		}
		prevPendingCountRef.current = cur;
	}, [pendingInterruptions, pendingIndex]);

	const logStreamEvent = React.useCallback(
		(source: "chat" | "linger", event: RunStreamEvent) => {
			if (event.type === "run_item_stream_event") {
				const { name } = event;
				const item: any = event.item;
				const raw: any = item?.rawItem;
				const agentName: string | undefined = item?.agent?.name;
				const actorPrefix = agentName ? `${agentName}: ` : "";
				if (name === "tool_called") {
					const toolName = raw?.name ?? raw?.action?.type ?? "unknown_tool";
					const args = formatEventArgs(raw);
					appendEventLog(
						source,
						`${actorPrefix}tool_called ${toolName}${
							args ? ` args=${args}` : ""
						}`
					);
					return;
				}
				if (name === "tool_output") {
					const toolName = raw?.name ?? raw?.action?.type ?? "unknown_tool";
					const output = formatEventOutput(raw);
					appendEventLog(
						source,
						`${actorPrefix}tool_output ${toolName}${
							output ? ` → ${output}` : ""
						}`
					);
					return;
				}
				if (name === "tool_approval_requested") {
					const toolName = raw?.name ?? raw?.action?.type ?? "unknown_tool";
					appendEventLog(
						source,
						`${actorPrefix}tool_approval_requested ${toolName}`
					);
					return;
				}
				if (name === "handoff_requested") {
					appendEventLog(source, `${actorPrefix}handoff_requested`);
					return;
				}
				if (name === "handoff_occurred") {
					appendEventLog(source, `${actorPrefix}handoff_occurred`);
					return;
				}
				if (name === "reasoning_item_created") {
					appendEventLog(source, `${actorPrefix}reasoning_item_created`);
					return;
				}
				if (name === "message_output_created") {
					appendEventLog(source, `${actorPrefix}message_output_created`);
					return;
				}
			} else if (event.type === "agent_updated_stream_event") {
				appendEventLog(
					source,
					`agent_updated ${event.agent?.name ?? "unknown_agent"}`
				);
			} else if (event.type === "raw_model_stream_event") {
				const kind = (event.data as any)?.type;
				if (kind && kind !== "output_text_delta") {
					appendEventLog(source, `raw_model_event ${kind}`);
				}
			}
		},
		[appendEventLog]
	);

	const consumeStream = React.useCallback(
		async (stream: StreamedRunResult<any, any>, source: "chat" | "linger") => {
			let full = "";
			for await (const event of stream) {
				logStreamEvent(source, event);
				if (
					event.type === "raw_model_stream_event" &&
					event.data?.type === "output_text_delta"
				) {
					const delta = event.data.delta;
					if (delta) {
						full += delta;
						setResponse(full);
					}
				} else if (
					(event as any).type === "output_text_delta" &&
					(event as any).delta
				) {
					const delta = (event as any).delta as string;
					full += delta;
					setResponse(full);
				}
			}
			return full;
		},
		[logStreamEvent]
	);

	const handleInterruptions = React.useCallback(
		(
			source: "chat" | "linger",
			interruptions: RunToolApprovalItem[] | undefined,
			state: RunState<any, any>
		) => {
			if (!interruptions || interruptions.length === 0) return;
			const entries: PendingInterruption[] = interruptions.map((item) => {
				const raw: any = item?.rawItem;
				const toolName = raw?.name ?? raw?.action?.type ?? "unknown_tool";
				const summary = formatEventArgs(raw) ?? formatEventOutput(raw);
				const idSeed =
					raw?.callId ??
					raw?.id ??
					`${toolName}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
				return {
					id: String(idSeed),
					toolName,
					summary: summary ?? null,
					source,
					state,
					item,
				};
			});
			setPendingInterruptions((prev) => [...prev, ...entries]);
			appendEventLog(
				source,
				`interruption_pending ${entries.map((e) => e.toolName).join(", ")}`
			);
		},
		[appendEventLog]
	);

	const resumeStream = React.useCallback(
		async (state: RunState<any, any>, source: "chat" | "linger") => {
			setIsStreaming(true);
			setResponse("");
			let stream: StreamedRunResult<any, any> | null = null;
			try {
				stream = await run(agent, state, { stream: true });
				const full = await consumeStream(stream, source);
				if (stream.interruptions?.length) {
					handleInterruptions(
						source,
						stream.interruptions as RunToolApprovalItem[],
						stream.state
					);
				}
				setMessages((m: Message[]) => [
					...m,
					{ role: "assistant", content: full || "(no response)" },
				]);
			} catch (err: any) {
				const msg = err?.message || "Unknown error";
				appendEventLog(source, `error ${msg}`);
				setMessages((m: Message[]) => [
					...m,
					{ role: "assistant", content: `Error: ${msg}` },
				]);
				setResponse(`Error: ${msg}`);
			} finally {
				setIsStreaming(false);
				refreshTodos().catch(() => {});
				if (stream?.error) {
					appendEventLog(source, `stream_error ${String(stream.error)}`);
				} else if (stream) {
					appendEventLog(source, "stream_complete");
				}
			}
		},
		[agent, consumeStream, appendEventLog, handleInterruptions]
	);

	const handlePendingDecision = React.useCallback(
		async (action: "approve" | "reject", always: boolean) => {
			if (pendingInterruptions.length === 0) return;
			const idx = Math.max(
				0,
				Math.min(pendingIndex, pendingInterruptions.length - 1)
			);
			const target = pendingInterruptions[idx];
			if (!target) return;

			try {
				if (action === "approve") {
					target.state.approve(target.item, { alwaysApprove: always });
					setMessages((m: Message[]) => [
						...m,
						{
							role: "user",
							content: `[approval] Approved ${target.toolName}${
								always ? " (always)" : ""
							}`,
						},
					]);
					appendEventLog(
						target.source,
						`approval_granted ${target.toolName}${always ? " (always)" : ""}`
					);
				} else {
					target.state.reject(target.item, { alwaysReject: always });
					setMessages((m: Message[]) => [
						...m,
						{
							role: "user",
							content: `[approval] Rejected ${target.toolName}${
								always ? " (always)" : ""
							}`,
						},
					]);
					appendEventLog(
						target.source,
						`approval_rejected ${target.toolName}${always ? " (always)" : ""}`
					);
				}
			} catch (err: any) {
				const msg = err?.message || String(err);
				appendEventLog(target.source, `approval_error ${msg}`);
				setMessages((m: Message[]) => [
					...m,
					{ role: "assistant", content: `Approval error: ${msg}` },
				]);
				return;
			}

			const nextList = pendingInterruptions.filter((_, i) => i !== idx);
			setPendingInterruptions(nextList);
			setPendingIndex((prev) => {
				if (nextList.length === 0) return 0;
				return Math.max(0, Math.min(prev, nextList.length - 1));
			});

			const stillPendingForState = nextList.some(
				(entry) => entry.state === target.state
			);
			if (!stillPendingForState) {
				await resumeStream(target.state, target.source);
			}
		},
		[appendEventLog, pendingInterruptions, pendingIndex, resumeStream]
	);

	const clampCursor = (pos: number, s: string = input) =>
		Math.max(0, Math.min(pos, s.length));

	const setInputAndCursor = (s: string, pos?: number) => {
		setInput(s);
		setCursor(clampCursor(pos ?? s.length, s));
	};

	const prevWordIndex = (s: string, pos: number) => {
		let i = Math.max(0, Math.min(pos, s.length));
		if (i === 0) return 0;
		i--; // start left of cursor
		while (i > 0 && s[i] === " ") i--;
		while (i > 0 && s[i] !== " " && s[i] !== "\n" && s[i] !== "\t") i--;
		if (i > 0 && (s[i] === " " || s[i] === "\n" || s[i] === "\t")) i++;
		return i;
	};

	const nextWordIndex = (s: string, pos: number) => {
		let i = Math.max(0, Math.min(pos, s.length));
		while (i < s.length && s[i] === " ") i++;
		while (i < s.length && s[i] !== " " && s[i] !== "\n" && s[i] !== "\t") i++;
		return i;
	};

	// Helper to detect printable text (single chars or pasted strings), excluding control/escape sequences
	const isPrintable = (s: string) => {
		if (!s) return false;
		// reject pure escape sequences
		if (s.includes("\u001b")) return false;
		// allow multi-line paste; disallow other C0 controls and DEL
		return /[\u0020-\u007E\n\r\t]/.test(s);
	};

	// Handle keyboard input with editing features
	useInput((inputKey, key) => {
		// record raw input and flags for debugging
		if (debug) {
			setLastInput(
				inputKey === undefined
					? "undefined"
					: `${JSON.stringify(inputKey)} (len=${
							inputKey.length
					  }) codes=[${Array.from(inputKey)
							.map((c) => c.codePointAt(0)?.toString(16))
							.join(" ")}]`
			);
			const flags: Record<string, boolean> = {
				leftArrow: key.leftArrow,
				rightArrow: key.rightArrow,
				upArrow: key.upArrow,
				downArrow: key.downArrow,
				return: key.return,
				escape: key.escape,
				ctrl: key.ctrl,
				shift: key.shift,
				tab: key.tab,
				backspace: key.backspace,
				delete: key.delete,
				pageDown: key.pageDown,
				pageUp: key.pageUp,
				meta: key.meta,
			};
			setLastFlags(
				Object.entries(flags)
					.filter(([, v]) => v)
					.map(([k]) => k)
					.join(", ") || "(none)"
			);
			setLastAction("(none)");
		}
		if (key.meta && pendingInterruptions.length > 0) {
			if (inputKey === "[" || inputKey === "{") {
				setPendingIndex((prev) => Math.max(0, prev - 1));
				if (debug) setLastAction("pending: prev");
				return;
			}
			if (inputKey === "]" || inputKey === "}") {
				setPendingIndex((prev) =>
					Math.min(pendingInterruptions.length - 1, prev + 1)
				);
				if (debug) setLastAction("pending: next");
				return;
			}
			if (inputKey === "y" || inputKey === "Y") {
				handlePendingDecision("approve", key.shift || inputKey === "Y").catch(
					() => {}
				);
				if (debug) setLastAction("pending: approve");
				return;
			}
			if (inputKey === "n" || inputKey === "N") {
				handlePendingDecision("reject", key.shift || inputKey === "N").catch(
					() => {}
				);
				if (debug) setLastAction("pending: reject");
				return;
			}
		}
		// Toggle audio capture: Option/Alt (Meta) + A
		if (key.meta && (inputKey === "a" || inputKey === "A")) {
			(async () => {
				try {
					const cfg = await loadConfig();
					const next = !audioEnabled;
					setAudioEnabled(next);
					await saveConfig({
						...cfg,
						audio: { ...cfg.audio, captureEnabled: next },
					});
					setMessages((m: Message[]) => [
						...m,
						{
							role: "assistant",
							content: `Audio context ${next ? "enabled" : "disabled"}.`,
						},
					]);
					appendAudioLog(`Audio ${next ? "enabled" : "disabled"}`);
					setAudioStatus(next ? "enabled" : "disabled");
					if (debug) setLastAction(`audio: ${next ? "enabled" : "disabled"}`);
				} catch (e: any) {
					setMessages((m: Message[]) => [
						...m,
						{
							role: "assistant",
							content: `Error toggling audio: ${e?.message || e}`,
						},
					]);
				}
			})();
			return;
		}
		// Submit / newline
		if (key.return) {
			if (key.shift) {
				// Insert newline
				const s = input.slice(0, cursor) + "\n" + input.slice(cursor);
				setInputAndCursor(s, cursor + 1);
				return;
			}
			if (input.trim().length === 0 || isStreaming) return;
			const content = input;
			const newMessages = [...messages, { role: "user", content }];
			setMessages(newMessages as any);
			// update history
			setHistory((h) => (content.length > 0 ? [...h, content] : h));
			setHistoryIndex(null);
			setDraftBeforeHistory("");
			setInputAndCursor("");
			// stream
			// @ts-ignore
			streamResponse(newMessages);
			if (debug) setLastAction("submit");
			return;
		}

		// History navigation
		if (key.upArrow && !isStreaming) {
			if (history.length === 0) return;
			if (historyIndex === null) {
				setDraftBeforeHistory(input);
				const idx = history.length - 1;
				setHistoryIndex(idx);
				const s = history[idx] ?? "";
				setInputAndCursor(s);
			} else if (historyIndex > 0) {
				const idx = historyIndex - 1;
				setHistoryIndex(idx);
				const s = history[idx] ?? "";
				setInputAndCursor(s);
			}
			if (debug) setLastAction("history: up");
			return;
		}
		if (key.downArrow && !isStreaming) {
			if (historyIndex === null) return;
			if (historyIndex < history.length - 1) {
				const idx = historyIndex + 1;
				setHistoryIndex(idx);
				const s = history[idx] ?? "";
				setInputAndCursor(s);
			} else {
				setHistoryIndex(null);
				setInputAndCursor(draftBeforeHistory);
			}
			if (debug) setLastAction("history: down");
			return;
		}

		// Cursor movement
		if (key.leftArrow) {
			if (key.meta)
				setCursor((prev) => clampCursor(prevWordIndex(input, prev)));
			else setCursor((prev) => clampCursor(prev - 1));
			if (debug) setLastAction(key.meta ? "cursor: word-left" : "cursor: left");
			return;
		}
		if (key.rightArrow) {
			if (key.meta)
				setCursor((prev) => clampCursor(nextWordIndex(input, prev)));
			else setCursor((prev) => clampCursor(prev + 1));
			if (debug)
				setLastAction(key.meta ? "cursor: word-right" : "cursor: right");
			return;
		}

		// Home/End via Ctrl+A / Ctrl+E
		if (key.ctrl && (inputKey === "a" || inputKey === "A")) {
			setCursor(0);
			if (debug) setLastAction("cursor: home");
			return;
		}
		if (key.ctrl && (inputKey === "e" || inputKey === "E")) {
			setCursor(input.length);
			if (debug) setLastAction("cursor: end");
			return;
		}

		// Kill line: Ctrl+U (to start), Ctrl+K (to end)
		if (key.ctrl && (inputKey === "u" || inputKey === "U")) {
			setInputAndCursor(input.slice(cursor), 0);
			if (debug) setLastAction("kill: to-start");
			return;
		}
		if (key.ctrl && (inputKey === "k" || inputKey === "K")) {
			setInputAndCursor(input.slice(0, cursor), cursor);
			if (debug) setLastAction("kill: to-end");
			return;
		}

		// Word nav via Meta+B / Meta+F
		if (key.meta && (inputKey === "b" || inputKey === "B")) {
			setCursor((prev) => clampCursor(prevWordIndex(input, prev)));
			return;
		}
		if (key.meta && (inputKey === "f" || inputKey === "F")) {
			setCursor((prev) => clampCursor(nextWordIndex(input, prev)));
			return;
		}

		// Some terminals report Backspace as Delete (Ink sets only delete flag).
		// Infer backspace when delete is pressed with no modifiers and no printable input, and there is no char to the right.
		const deleteMeansBackspace =
			key.delete &&
			!key.ctrl &&
			!key.meta &&
			!key.shift &&
			(!inputKey || inputKey.length === 0) &&
			cursor > 0;
		// Backspace handling: rely on Ink key flags; also support Ctrl+H
		const isBackspaceKey =
			key.backspace ||
			deleteMeansBackspace ||
			(key.ctrl && (inputKey === "h" || inputKey === "H"));
		const isMetaBackspace =
			key.meta &&
			(key.backspace || (key.ctrl && (inputKey === "h" || inputKey === "H")));
		if (isBackspaceKey || isMetaBackspace) {
			if (cursor === 0) return;
			if (isMetaBackspace) {
				const start = prevWordIndex(input, cursor);
				setInputAndCursor(input.slice(0, start) + input.slice(cursor), start);
			} else {
				setInputAndCursor(
					input.slice(0, cursor - 1) + input.slice(cursor),
					cursor - 1
				);
			}
			if (debug)
				setLastAction(
					isMetaBackspace
						? "backspace: word"
						: deleteMeansBackspace
						? "backspace: inferred-from-delete"
						: "backspace: char"
				);
			return;
		}

		// Forward delete: rely on Ink key flag; also support Ctrl+D
		if (
			(key.delete && !deleteMeansBackspace) ||
			(key.ctrl && (inputKey === "d" || inputKey === "D"))
		) {
			if (cursor >= input.length) return;
			setInputAndCursor(
				input.slice(0, cursor) + input.slice(cursor + 1),
				cursor
			);
			if (debug) setLastAction("delete: forward");
			return;
		}

		// Printable input / paste (Ink may pass multi-char on paste)
		if (!key.ctrl && !key.meta && isPrintable(inputKey)) {
			const s = input.slice(0, cursor) + inputKey + input.slice(cursor);
			setInputAndCursor(s, cursor + inputKey.length);
			if (debug) setLastAction(`insert: ${inputKey.length} char(s)`);
		}
	});

	// Stream response from OpenAI
	const streamResponse = async (chatHistory: Message[]) => {
		setIsStreaming(true);
		setResponse("");

		const lastMessage = chatHistory[chatHistory.length - 1]?.content || "";
		let stream: StreamedRunResult<any, any> | null = null;

		try {
			stream = await run(agent, lastMessage, { stream: true });
			const fullResponse = await consumeStream(stream, "chat");
			if (stream.interruptions?.length) {
				handleInterruptions(
					"chat",
					stream.interruptions as RunToolApprovalItem[],
					stream.state
				);
			}
			setMessages([
				...chatHistory,
				{ role: "assistant", content: fullResponse || "(no response)" },
			] as any);
		} catch (err: any) {
			const msg = err?.message || "Unknown error";
			setMessages([
				...chatHistory,
				{ role: "assistant", content: `Error: ${msg}` },
			]);
			setResponse(`Error: ${msg}`);
			appendEventLog("chat", `error ${msg}`);
		} finally {
			setIsStreaming(false);
			refreshTodos().catch(() => {});
			if (stream?.error) {
				appendEventLog("chat", `stream_error ${String(stream.error)}`);
			} else if (stream) {
				appendEventLog("chat", "stream_complete");
			}
		}
	};

	async function refreshTodos() {
		try {
			const cfg = await loadConfig();
			const items = await listTodos(cfg.panel.todoShowCompleted);
			const head = shortList(items, cfg.panel.maxItems);
			const f = await getFocus();
			setTodoPanel(head);
			setFocused(f);
			setAudioEnabled(!!cfg.audio.captureEnabled);
			setLingerEnabled(!!cfg.linger.enabled);
			setLingerBehavior(cfg.linger.behavior || "");
			setLingerIntervalSec(cfg.linger.minIntervalSec || 20);
		} catch {
			// ignore
		}
	}

	// Refresh TODO panel when messages change (likely after tool runs)
	React.useEffect(() => {
		refreshTodos();
	}, [messages.length]);

	// Start/stop continuous audio capture when toggled
	React.useEffect(() => {
		if (!audioEnabled) {
			stopAudioRef.current?.();
			stopAudioRef.current = null;
			// Note: keep existing logs on disable for context
			setAudioMetrics(null);
			return;
		}
		stopAudioRef.current?.();
		stopAudioRef.current = startContinuousCapture({
			onTranscript: async (text) => {
				setMessages((m: Message[]) => [
					...m,
					{ role: "assistant", content: `(heard) ${text}` },
				]);
				appendAudioLog(`heard: ${text}`);
				try {
					const next = await summarizeAudioContext(audioSummary, text);
					setAudioSummary(next);
				} catch (e: any) {
					const errMsg = e?.message || String(e);
					appendAudioLog(`summarizer error: ${errMsg}`);
					setMessages((m: Message[]) => [
						...m,
						{ role: "assistant", content: `Audio summarize error: ${errMsg}` },
					]);
				}

				// Linger mode: autonomously act based on audio context
				if (lingerEnabled) {
					const now = Date.now();
					if (
						!isStreaming &&
						now - (lastLingerRef.current || 0) >= lingerIntervalSec * 1000
					) {
						lastLingerRef.current = now;
						await runLinger(text).catch((e) =>
							setMessages((m: Message[]) => [
								...m,
								{
									role: "assistant",
									content: `Linger error: ${e?.message || e}`,
								},
							])
						);
					}
				}
			},
			onStatus: (s) => {
				setLastAction(`audio: ${s}`);
				appendAudioLog(s);
				setAudioStatus(s);
			},
			onError: (e) => {
				appendAudioLog(`Error: ${e}`);
				setMessages((m: Message[]) => [
					...m,
					{ role: "assistant", content: `Audio error: ${e}` },
				]);
			},
			onMetrics: (m) => setAudioMetrics(m),
		});
		return () => {
			stopAudioRef.current?.();
			stopAudioRef.current = null;
		};
	}, [audioEnabled, audioSummary]);

	// Heartbeat: every 3s append current audio status to logs while enabled
	React.useEffect(() => {
		if (!audioEnabled) return;
		const id = setInterval(() => {
			appendAudioLog(audioStatus);
		}, 3000);
		return () => clearInterval(id);
	}, [audioEnabled, audioStatus, appendAudioLog]);

	async function runLinger(latestUtterance: string) {
		const instruction = `Linger mode is enabled. Behavior directive from user: ${lingerBehavior}\n\nRecent audio summary: ${
			audioSummary || "(none)"
		}\nLatest utterance: ${latestUtterance}\n\nDecide if any helpful action is warranted. If yes, act concisely (use tools when needed) and keep changes minimal and safe. If no action is valuable, reply briefly or remain silent.`;
		const newMessages = [
			...messages,
			{ role: "user" as const, content: instruction },
		];
		setMessages(newMessages as any);
		setIsStreaming(true);
		setResponse("");

		let stream: StreamedRunResult<any, any> | null = null;
		try {
			stream = await run(agent, instruction, { stream: true });
			const full = await consumeStream(stream, "linger");
			if (stream.interruptions?.length) {
				handleInterruptions(
					"linger",
					stream.interruptions as RunToolApprovalItem[],
					stream.state
				);
			}
			setMessages((m: Message[]) => [
				...m,
				{ role: "assistant", content: full || "(no response)" },
			]);
		} catch (err: any) {
			const msg = err?.message || "Unknown error";
			appendEventLog("linger", `error ${msg}`);
			setMessages((m: Message[]) => [
				...m,
				{ role: "assistant", content: `Linger error: ${msg}` },
			]);
			setResponse(`Error: ${msg}`);
		} finally {
			setIsStreaming(false);
			refreshTodos().catch(() => {});
			if (stream?.error) {
				appendEventLog("linger", `stream_error ${String(stream.error)}`);
			} else if (stream) {
				appendEventLog("linger", "stream_complete");
			}
		}
	}

	return (
		<Box flexDirection="row">
			<Box flexDirection="column" flexGrow={1}>
				<Box flexDirection="column" flexShrink={0} marginBottom={1}>
					<Text color="cyan">
						🧠 GSIO (Enter: send, Shift+Enter: newline, Option/Alt+A: audio)
					</Text>
					<Newline />
					{todoPanel && (
						<>
							<Text color="gray">
								TODOs {focused ? `(focus: #${focused})` : ""}
							</Text>
							<Text color="gray">{todoPanel}</Text>
							<Newline />
						</>
					)}
					{audioEnabled && (
						<>
							<Text color="gray">
								Audio context: enabled{audioSummary ? " — summarized" : ""}{" "}
								{lingerEnabled ? "• Linger on" : ""}
							</Text>
							<Newline />
						</>
					)}
				</Box>
				<Box flexDirection="column" flexGrow={1}>
					{messages.map((msg, i) => (
						<Box key={i} flexDirection="column" marginBottom={1}>
							<Text color={msg.role === "user" ? "green" : "yellow"}>
								{msg.role === "user" ? "You: " : "AI: "}
								{msg.content}
							</Text>
						</Box>
					))}

					{isStreaming && <Text color="yellow">{response}</Text>}
				</Box>
				<UserInput
					value={input}
					cursor={cursor}
					debug={debug}
					lastInput={lastInput}
					lastFlags={lastFlags}
					lastAction={lastAction}
				/>
			</Box>
			<Box flexDirection="column" width={rightWidth} marginLeft={rightMargin}>
				{audioEnabled && (
					<>
						<Text color="gray">Audio Logs</Text>
						<Box flexDirection="column" height={LOGS_HEIGHT} flexShrink={0}>
							{(() => {
								if (audioLogs.length === 0)
									return <Text color="gray">(no logs yet)</Text>;
								const maxLines = LOGS_HEIGHT;
								const omitted = Math.max(0, audioLogs.length - maxLines);
								const visible = audioLogs.slice(
									-Math.max(0, maxLines - (omitted > 0 ? 1 : 0))
								);
								return (
									<>
										{omitted > 0 && <Text color="gray">… {omitted} more</Text>}
										{visible.map((line, idx) => (
											<Text key={idx} color="gray">
												- {truncateForPanel(line, rightWidth)}
											</Text>
										))}
									</>
								);
							})()}
						</Box>
						<Newline />
						<Text color="gray">Metrics</Text>
						{audioMetrics ? (
							<>
								<Text color="gray">
									- Feed: {audioMetrics.feedActive ? "active" : "inactive"}
								</Text>
								<Text color="gray">
									- Sample rate: {audioMetrics.sampleRate} Hz
								</Text>
								<Text color="gray">
									- Bytes: {formatBytes(audioMetrics.bytesReceived)}
								</Text>
								<Text color="gray">
									- Audio:{" "}
									{formatSeconds(
										audioMetrics.totalSamples / audioMetrics.sampleRate
									)}{" "}
									processed
								</Text>
								<Text color="gray">
									- Frames: {audioMetrics.framesProcessed}
								</Text>
								<Text color="gray">
									- Segments: {audioMetrics.segmentsEmitted} (last{" "}
									{formatSeconds(
										audioMetrics.lastSegmentSamples / audioMetrics.sampleRate
									)}
									)
								</Text>
								<Text color="gray">
									- Transcripts: {audioMetrics.transcriptsEmitted}
								</Text>
								<Text color="gray">
									- VAD: {audioMetrics.vadStarts} starts /{" "}
									{audioMetrics.vadEnds} ends (
									{audioMetrics.vadActive ? "speech" : "silence"})
								</Text>
								<Text color="gray">- Errors: {audioMetrics.errors}</Text>
							</>
						) : (
							<Text color="gray">(no metrics yet)</Text>
						)}
						<Newline />
					</>
				)}
				{pendingInterruptions.length > 0 && (
					<>
						<Text color="gray">
							Pending Approvals (Option/Alt+[ / Option/Alt+] select,
							Option/Alt+Y approve, Option/Alt+Shift+Y always, Option/Alt+N
							reject, Option/Alt+Shift+N always)
						</Text>
						<Box
							flexDirection="column"
							height={APPROVALS_HEIGHT}
							flexShrink={0}
						>
							{(() => {
								const maxLines = APPROVALS_HEIGHT;
								const omitted = Math.max(
									0,
									pendingInterruptions.length - maxLines
								);
								const visible = pendingInterruptions.slice(
									-Math.max(0, maxLines - (omitted > 0 ? 1 : 0))
								);
								return (
									<>
										{omitted > 0 && <Text color="gray">… {omitted} more</Text>}
										{visible.map((entry, idx) => {
											const startIndex =
												pendingInterruptions.length - visible.length;
											const absoluteIdx = startIndex + idx;
											const isSelected = pendingIndex === absoluteIdx;
											const prefix = isSelected ? "» " : "  ";
											const summary = entry.summary
												? ` — ${entry.summary}`
												: "";
											const text = `${entry.toolName}${summary} (${entry.source})`;
											return (
												<Text
													key={`${entry.id}-${idx}`}
													color={isSelected ? "magenta" : "gray"}
												>
													{prefix}
													{truncateForPanel(text, rightWidth)}
												</Text>
											);
										})}
									</>
								);
							})()}
						</Box>
						<Newline />
					</>
				)}
				<Text color="gray">Run Events</Text>
				<Box flexDirection="column" height={EVENT_LOGS_HEIGHT} flexShrink={0}>
					{(() => {
						if (eventLogs.length === 0)
							return <Text color="gray">(no events yet)</Text>;
						const maxLines = EVENT_LOGS_HEIGHT;
						const omitted = Math.max(0, eventLogs.length - maxLines);
						const visible = eventLogs.slice(
							-Math.max(0, maxLines - (omitted > 0 ? 1 : 0))
						);
						return (
							<>
								{omitted > 0 && <Text color="gray">… {omitted} more</Text>}
								{visible.map((line, idx) => (
									<Text key={idx} color="gray">
										- {truncateForPanel(line, rightWidth)}
									</Text>
								))}
							</>
						);
					})()}
				</Box>
				<Newline />
				<Text color="gray">Tokens</Text>
				<Text color="gray">- Input: ~{estimateTokens(input)}</Text>
				<Text color="gray">
					- Messages: ~
					{messages.reduce((sum, m) => sum + estimateTokens(m.content), 0)}
				</Text>
			</Box>
		</Box>
	);
};

function formatBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	const kb = n / 1024;
	if (kb < 1024) return `${kb.toFixed(1)} KB`;
	const mb = kb / 1024;
	if (mb < 1024) return `${mb.toFixed(1)} MB`;
	const gb = mb / 1024;
	return `${gb.toFixed(2)} GB`;
}

function formatSeconds(sec: number): string {
	if (!isFinite(sec)) return "0s";
	if (sec < 60) return `${sec.toFixed(1)}s`;
	const m = Math.floor(sec / 60);
	const s = Math.floor(sec % 60);
	return `${m}m ${s}s`;
}

function estimateTokens(text: string): number {
	if (!text) return 0;
	// rough heuristic: ~4 characters per token for English text
	const chars = text.replace(/\s+/g, " ").trim().length;
	if (chars === 0) return 0;
	return Math.max(1, Math.ceil(chars / 4));
}

function formatEventArgs(raw: any): string | null {
	if (!raw) return null;
	const value =
		typeof raw.arguments === "string"
			? raw.arguments
			: raw.arguments
			? JSON.stringify(raw.arguments)
			: raw.action
			? JSON.stringify(raw.action)
			: undefined;
	if (!value) return null;
	return truncateText(value);
}

function formatEventOutput(raw: any): string | null {
	if (!raw) return null;
	const output = raw.output ?? raw.providerData?.output;
	if (!output) return null;
	if (typeof output === "string") {
		return truncateText(output);
	}
	if (typeof output === "object") {
		if (typeof output.text === "string") {
			return truncateText(output.text);
		}
		if (typeof output.data === "string") {
			return `[data ${output.data.length}b]`;
		}
	}
	return truncateText(JSON.stringify(output));
}

function truncateText(s: string, max = 80): string {
	if (!s) return "";
	const normalized = s.replace(/\s+/g, " ").trim();
	if (normalized.length <= max) return normalized;
	return `${normalized.slice(0, max - 1)}…`;
}

function truncateForPanel(s: string, width: number): string {
	// Reserve 2 chars for list marker and a small margin
	const max = Math.max(5, width - 4);
	if (s.length <= max) return s;
	return s.slice(0, max - 1) + "…";
}
