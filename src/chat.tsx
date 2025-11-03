import React, { useState } from "react";
import { Box, Newline, Text, useInput, useStdout } from "ink";
import {
	Agent,
	run,
	user,
	assistant,
	system,
	type StreamedRunResult,
	type RunStreamEvent,
	type RunToolApprovalItem,
	type RunState,
	type AgentInputItem,
	type ModelSettings,
} from "@openai/agents";
import { defaultTools } from "./tools";
import {
	listTodos,
	shortList,
	getFocus,
	completeAndRemoveOutstandingTodos,
} from "./todoStore";
import { loadConfig, saveConfig, type AppConfig } from "./config";
import { startContinuousCapture, type CaptureMetrics } from "./audio";
import { summarizeAudioContext } from "./summarizer";
import { UserInput } from "./userInput";
import { Markdown } from "./markdown";
import LLMMemory, {
	type Message as MemoryMessage,
} from "llm-memory";
import { createStorage } from "unstorage";
import fsDriver from "unstorage/drivers/fs";
import fs from "node:fs/promises";
import path from "node:path";

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

type MemorySettings = {
	enabled: boolean;
	userId: string;
	maxEntries: number;
	storageDir: string;
	embeddingModel: string;
};

type ReasoningEffort = AppConfig["loops"]["reasoning"]["effort"];
type ReasoningSummary = AppConfig["loops"]["reasoning"]["summary"];
type ThinkingVerbosity = AppConfig["loops"]["thinking"]["verbosity"];
type PromptContext = {
	prompt: string;
	memoryContext: string | null;
};

function buildSocraticReasoningSummary(args: {
	userPrompt: string;
	planText: string;
	guidanceText: string;
}): string {
	const { userPrompt, planText, guidanceText } = args;
	const cleanPlan = planText
		.replace(/^Plan:\s*/i, "")
		.trim();
	const steps = cleanPlan
		.split(/\n+/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	if (steps.length === 0) return "";

	const qaPairs: string[] = [];
	for (let i = 0; i < steps.length; i++) {
		const step = steps[i].replace(/^\d+[\).\-\:]\s*/, "").trim();
		if (!step) continue;
		const question = `Q${i + 1}: Why is step ${i + 1} necessary?`;
		const answer = `A${i + 1}: ${step}.`;
		qaPairs.push(`${question} ${answer}`);
	}

	let guidanceNotes = "";
	const condensedGuidance = guidanceText
		.replace(/^Implementation Guidance:\s*/i, "")
		.trim();
	if (condensedGuidance) {
		const sentences = condensedGuidance
			.split(/(?<=[.?!])\s+/)
			.map((s) => s.trim())
			.filter(Boolean)
			.slice(0, 3);
		if (sentences.length > 0) {
			guidanceNotes = `Follow-up prompts:\n${sentences
				.map((s, idx) => `• Clarify ${idx + 1}: ${s}`)
				.join("\n")}`;
		}
	}

	const closing = `Conclusion: This plan addresses "${userPrompt.trim()}" by progressing through the numbered inquiries above.`;

	return [qaPairs.join("\n"), guidanceNotes, closing]
		.filter(Boolean)
		.join("\n\n");
}

function isReasoningAccessError(text: string | null | undefined): boolean {
	if (!text) return false;
	const normalized = text.toLowerCase();
	return normalized.includes(
		"your organization must be verified to generate reasoning summaries"
	);
}

const TODO_TOOL_INSTRUCTIONS = [
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
] as const;

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
	const memoryRef = React.useRef<LLMMemory | null>(null);
	const memorySettingsRef = React.useRef<MemorySettings | null>(null);
	const memoryUserIdRef = React.useRef<string>("local_user");
	const [memoryEnabled, setMemoryEnabled] = useState<boolean>(false);
	const [memoryStatusText, setMemoryStatusText] = useState<string>("disabled");
	const [memoryHasError, setMemoryHasError] = useState<boolean>(false);
	const [memoryEmbeddingModel, setMemoryEmbeddingModel] =
		useState<string>("text-embedding-3-small");
	const [reasoningEffort, setReasoningEffort] =
		useState<ReasoningEffort>("medium");
	const [reasoningSummary, setReasoningSummary] =
		useState<ReasoningSummary>("concise");
	const [thinkingEnabled, setThinkingEnabled] = useState<boolean>(false);
	const [thinkingVerbosity, setThinkingVerbosity] =
		useState<ThinkingVerbosity>("medium");
	const [allowReasoningSummary, setAllowReasoningSummary] =
		useState<boolean>(true);
	const allowReasoningSummaryRef = React.useRef<boolean>(true);
	const reasoningNoticePostedRef = React.useRef<boolean>(false);
	const [reasoningModel, setReasoningModel] = useState<string>("o4-mini");
	const [guidanceModel, setGuidanceModel] = useState<string>("gpt-4o");
	const [executionModel, setExecutionModel] =
		useState<string>("gpt-4o-mini");

	React.useEffect(() => {
		allowReasoningSummaryRef.current = allowReasoningSummary;
	}, [allowReasoningSummary]);

	const planningAgent = React.useMemo(() => {
		const audioLine = audioEnabled
			? "Audio context capture is enabled; prefer incorporating relevant auditory information if provided."
			: "";
		const memoryLine = memoryEnabled
			? `Long-term memory is available; prioritize consistency with recalled context. Embedding model: ${memoryEmbeddingModel}.`
			: "";
		const summaryLine = audioSummary
			? `Recent audio context summary: ${audioSummary}`
			: "";
		const modelSettings: ModelSettings = { toolChoice: "none" };
		const includeReasoningSettings =
			allowReasoningSummary && reasoningModel.startsWith("o4");
		if (includeReasoningSettings) {
			modelSettings.reasoning = {
				effort: reasoningEffort,
				summary: reasoningSummary,
			};
		}
		if (thinkingEnabled) {
			modelSettings.text = { verbosity: thinkingVerbosity };
		}
		const instructions = [
			"You are the planning specialist. Break down the latest user request into a concise, numbered plan before any work begins.",
			"Capture dependencies, data that must be gathered, and TODO updates when relevant. Do not execute tasks or modify files—only plan.",
			allowReasoningSummary
				? ""
				: "Reasoning summaries are currently disabled; produce a clear plan without them.",
			audioLine,
			memoryLine,
			summaryLine,
			...TODO_TOOL_INSTRUCTIONS,
		]
			.filter(Boolean)
			.join("\n");
		const modelChoice = allowReasoningSummary ? reasoningModel : guidanceModel;
		return new Agent({
			name: "Planner",
			instructions,
			tools: defaultTools,
			model: modelChoice,
			modelSettings,
		});
	}, [
		audioEnabled,
		audioSummary,
		memoryEnabled,
			memoryEmbeddingModel,
			reasoningEffort,
			reasoningSummary,
			thinkingEnabled,
			thinkingVerbosity,
			allowReasoningSummary,
			reasoningModel,
		]);

	const guidanceAgent = React.useMemo(() => {
		const audioLine = audioEnabled
			? "Audio context capture is enabled; incorporate relevant auditory information if provided."
			: "";
		const memoryLine = memoryEnabled
			? `Long-term memory is available; keep guidance consistent with recalled context. Embedding model: ${memoryEmbeddingModel}.`
			: "";
		const summaryLine = audioSummary
			? `Recent audio context summary: ${audioSummary}`
			: "";
		const modelSettings: ModelSettings = {
			toolChoice: "none",
		};
		if (thinkingEnabled) {
			modelSettings.text = { verbosity: thinkingVerbosity };
		}
		const instructions = [
			"You are the implementation guide. Review the latest plan in this conversation and provide actionable guidance for carrying it out.",
			"Highlight best practices, sequencing, potential pitfalls, validation steps, and recommended tool/TODO usage. Do not perform the work—respond with guidance only.",
			audioLine,
			memoryLine,
			summaryLine,
			...TODO_TOOL_INSTRUCTIONS,
		]
			.filter(Boolean)
			.join("\n");
		return new Agent({
			name: "Guide",
			instructions,
			tools: defaultTools,
			model: guidanceModel,
			modelSettings,
		});
	}, [
		audioEnabled,
		audioSummary,
		memoryEnabled,
		memoryEmbeddingModel,
		thinkingEnabled,
		thinkingVerbosity,
		guidanceModel,
	]);

	const executionAgent = React.useMemo(() => {
		const audioLine = audioEnabled
			? "Audio context capture is enabled; prefer incorporating relevant auditory information if provided."
			: "";
		const memoryLine = memoryEnabled
			? `Long-term memory is available; prioritize consistency with recalled context. Embedding model: ${memoryEmbeddingModel}.`
			: "";
		const summaryLine = audioSummary
			? `Recent audio context summary: ${audioSummary}`
			: "";
		const includeReasoningSettings =
			allowReasoningSummary && executionModel.startsWith("o4");
		const reasoningLine = includeReasoningSettings
			? `Reasoning loop is mandatory (effort: ${reasoningEffort}, summary: ${reasoningSummary}). Run a structured reasoning pass before finalizing answers.`
			: "Use deliberate internal reflection to check your work before finalizing; external reasoning summaries are not available.";
		const thinkingLine = thinkingEnabled
			? `Thinking loop is enabled (verbosity: ${thinkingVerbosity}). When tasks are complex or ambiguous, take an additional thinking pass before responding.`
			: "Thinking loop is disabled unless deeper reflection is explicitly requested.";
		const planReminder =
			"Before responding, review the most recent plan and implementation guidance produced earlier in this turn. Follow them unless there is a compelling reason to adjust (and explain any adjustments).";
		const instructions = [
			"You are a helpful assistant. Use tools when helpful. Prefer concise answers.",
			planReminder,
			"Use the TODO tools to navigate multi-step tasks: create a plan, set priorities, track status (todo/in_progress/blocked/done), mark focus, and add notes. Keep the list updated as you work.",
			reasoningLine,
			thinkingLine,
			allowReasoningSummary
				? ""
				: "Reasoning summaries are temporarily disabled; continue executing without them.",
			audioLine,
			memoryLine,
			summaryLine,
			...TODO_TOOL_INSTRUCTIONS,
		]
			.filter(Boolean)
			.join("\n");
		const modelSettings: ModelSettings = {};
		if (includeReasoningSettings) {
			modelSettings.reasoning = {
				effort: reasoningEffort,
				summary: reasoningSummary,
			};
		}
		if (thinkingEnabled) {
			modelSettings.text = { verbosity: thinkingVerbosity };
		}
		return new Agent({
			name: "Assistant",
			instructions,
			tools: defaultTools,
			model: executionModel,
			modelSettings,
		});
	}, [
		audioEnabled,
		audioSummary,
		memoryEnabled,
		memoryEmbeddingModel,
		reasoningEffort,
			reasoningSummary,
			thinkingEnabled,
			thinkingVerbosity,
			allowReasoningSummary,
			executionModel,
		]);

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

	const toMemoryMessages = React.useCallback(
		(msgs: Message[]): MemoryMessage[] =>
			msgs.map((msg) => ({ role: msg.role, content: msg.content })),
		[]
	);

	const ensureMemory = React.useCallback(
		async (cfg: AppConfig) => {
		const settings: MemorySettings = {
			enabled: cfg.memory?.enabled ?? false,
			userId: cfg.memory?.userId ?? "local_user",
			maxEntries: cfg.memory?.maxEntries ?? 500,
			storageDir: cfg.memory?.storageDir ?? ".gsio-memory",
			embeddingModel: cfg.memory?.embeddingModel ?? "text-embedding-3-small",
		};
		memoryUserIdRef.current = settings.userId;
		setMemoryEmbeddingModel(settings.embeddingModel);
		if (!settings.enabled) {
			memoryRef.current = null;
			memorySettingsRef.current = settings;
			setMemoryEnabled(false);
			setMemoryStatusText("disabled");
			setMemoryHasError(false);
			return;
		}

		const prev = memorySettingsRef.current;
		if (
			prev &&
			prev.enabled &&
			prev.userId === settings.userId &&
			prev.maxEntries === settings.maxEntries &&
			prev.storageDir === settings.storageDir &&
			prev.embeddingModel === settings.embeddingModel &&
			memoryRef.current
		) {
			setMemoryEnabled(true);
			setMemoryStatusText("active");
			setMemoryHasError(false);
			return;
		}

		try {
				const base = path.resolve(process.cwd(), settings.storageDir);
			await fs.mkdir(base, { recursive: true });
			const storage = createStorage({ driver: fsDriver({ base }) });
			memoryRef.current = new LLMMemory({
				storage,
				prefix: "chat:",
				maxEntries: settings.maxEntries,
			});
			memorySettingsRef.current = settings;
			setMemoryEnabled(true);
			setMemoryStatusText("active");
			setMemoryHasError(false);
			appendEventLog(
				"chat",
				`memory_ready dir=${settings.storageDir} model=${settings.embeddingModel}`
			);
		} catch (err: any) {
			const msg = err?.message || String(err);
			memoryRef.current = null;
			memorySettingsRef.current = { ...settings, enabled: false };
			setMemoryEnabled(false);
			setMemoryStatusText(`error: ${msg}`);
			setMemoryHasError(true);
			appendEventLog("chat", `memory_error ${msg}`);
		}
		},
		[appendEventLog]
	);

	const preparePromptContext = React.useCallback(
		async (
			history: Message[],
			prompt: string,
			source: "chat" | "linger"
		): Promise<PromptContext> => {
			const memory = memoryRef.current;
			if (!memory) return { prompt, memoryContext: null };
			const usable = history.filter(
				(msg) => msg.content && msg.content.trim().length > 0
			);
			if (usable.length === 0) return { prompt, memoryContext: null };
			try {
				const recall = await memory.recall(toMemoryMessages(usable), {
					topK: 3,
					minSimilarity: 0.3,
					maxTokens: 600,
				});
				if (!recall || recall.trim().length === 0) {
					return { prompt, memoryContext: null };
				}
				setMemoryHasError(false);
				setMemoryStatusText("active");
				appendEventLog(
					source,
					`memory_recall ${Math.max(1, Math.round(recall.length / 4))} tokens`
				);
				return {
					prompt,
					memoryContext: `Relevant memory:\n${recall}`,
				};
			} catch (err: any) {
				const msg = err?.message || String(err);
				setMemoryHasError(true);
				setMemoryStatusText(`error: ${msg}`);
				appendEventLog(source, `memory_recall_error ${msg}`);
				return { prompt, memoryContext: null };
			}
		},
		[appendEventLog, toMemoryMessages]
	);

	const buildRunInput = React.useCallback(
		async (
			history: Message[],
			prompt: string,
			source: "chat" | "linger"
		): Promise<{ inputItems: AgentInputItem[]; normalizedPrompt: string }> => {
			const { prompt: normalizedPrompt, memoryContext } =
				await preparePromptContext(history, prompt, source);
			const items: AgentInputItem[] = [];
			if (memoryContext && memoryContext.trim().length > 0) {
				items.push(
					system(
						`${memoryContext.trim()}\nUse this alongside the latest conversation turns.`
					)
				);
			}
			const contextMessages = history.slice(Math.max(0, history.length - 2));
			for (const msg of contextMessages) {
				const content = (msg.content ?? "").trim();
				if (!content) continue;
				if (msg.role === "user") {
					items.push(user(content));
				} else {
					items.push(assistant(content));
				}
			}
			const lastContext = contextMessages[contextMessages.length - 1];
			const trimmedPrompt = normalizedPrompt.trim();
			if (trimmedPrompt.length > 0) {
				const lastContent = (lastContext?.content ?? "").trim();
				if (!lastContext || lastContext.role !== "user" || lastContent !== trimmedPrompt) {
					items.push(user(trimmedPrompt));
				}
			}
			if (items.length === 0 && trimmedPrompt.length > 0) {
				items.push(user(trimmedPrompt));
			}
			return { inputItems: items, normalizedPrompt };
		},
		[preparePromptContext]
	);

	const extractErrorMessage = React.useCallback((err: any): string => {
		return (
			err?.message ||
			err?.response?.data?.error?.message ||
			err?.response?.data?.error?.error?.message ||
			String(err)
		);
	}, []);

	const handleReasoningSummaryError = React.useCallback(
		(err: any, source: "chat" | "linger") => {
			if (!allowReasoningSummaryRef.current) return false;
			const msg = extractErrorMessage(err);
			if (
				typeof msg === "string" &&
				msg
					.toLowerCase()
					.includes(
						"your organization must be verified to generate reasoning summaries"
					)
			) {
				allowReasoningSummaryRef.current = false;
				setAllowReasoningSummary(false);
				appendEventLog(
					source,
					"reasoning_summary_disabled (org not verified; retrying without summaries)"
				);
				if (!reasoningNoticePostedRef.current) {
					reasoningNoticePostedRef.current = true;
					setMessages((prev) => [
						...prev,
						{
							role: "assistant",
							content:
								"(Reasoning summaries unavailable: switching to internal reflection until verification completes.)",
						},
					]);
				}
				return true;
			}
			return false;
		},
		[appendEventLog, extractErrorMessage, setMessages]
	);

	const memorizeExchange = React.useCallback(
		async (history: Message[], source: "chat" | "linger") => {
			const memory = memoryRef.current;
			if (!memory) return;
			const usable = history.filter(
				(msg) => msg.content && msg.content.trim().length > 0
			);
			if (usable.length === 0) return;
			const window = usable.slice(-6);
			try {
				await memory.memorize(
					toMemoryMessages(window),
					memoryUserIdRef.current
				);
				setMemoryHasError(false);
				setMemoryStatusText("active");
				appendEventLog(
					source,
					`memory_memorized ${window.length} msgs`
				);
			} catch (err: any) {
				const msg = err?.message || String(err);
				setMemoryHasError(true);
				setMemoryStatusText(`error: ${msg}`);
				appendEventLog(source, `memory_mem_error ${msg}`);
			}
		},
		[appendEventLog, toMemoryMessages]
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
		async (
			stream: StreamedRunResult<any, any>,
			source: "chat" | "linger",
			options?: { live?: boolean; onUpdate?: (full: string) => void }
		) => {
			const live = options?.live ?? true;
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
						options?.onUpdate?.(full);
						if (live) setResponse(full);
					}
				} else if (
					(event as any).type === "output_text_delta" &&
					(event as any).delta
				) {
					const delta = (event as any).delta as string;
					full += delta;
					options?.onUpdate?.(full);
					if (live) setResponse(full);
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
			const runOptions = { stream: true as const, maxTurns: 30 };
			let retryWithoutSummary = false;
				try {
			stream = await run(executionAgent, state, runOptions);
			const full = await consumeStream(stream, source);
			if (isReasoningAccessError(full)) {
				const err = new Error(full);
				if (handleReasoningSummaryError(err, source)) {
					retryWithoutSummary = true;
					throw err;
				}
			}
					if (stream.interruptions?.length) {
						handleInterruptions(
						source,
						stream.interruptions as RunToolApprovalItem[],
						stream.state
					);
				}
				setMessages((m: Message[]) => {
					const assistantContent =
						(full ?? "").trim().length > 0 ? full : "";
					const nextDisplay = [
						...m,
						{
							role: "assistant",
							content: assistantContent || "(no response)",
						},
					];
					if (assistantContent) {
						void memorizeExchange(
							[
								...m,
								{ role: "assistant", content: assistantContent },
							],
							source
						);
						}
						return nextDisplay;
					});
			} catch (err: any) {
				const msg = extractErrorMessage(err) || "Unknown error";
				const suppressed =
					handleReasoningSummaryError(err, source) ||
					(!allowReasoningSummaryRef.current &&
						isReasoningAccessError(msg));
				if (suppressed) {
					retryWithoutSummary = true;
				} else {
					appendEventLog(source, `error ${msg}`);
					setMessages((m: Message[]) => [
						...m,
						{ role: "assistant", content: `Error: ${msg}` },
					]);
					setResponse(`Error: ${msg}`);
				}
				} finally {
					setIsStreaming(false);
					await cleanupTodosAfterTurn(source);
					if (retryWithoutSummary) {
						setTimeout(() => {
							void resumeStream(state, source);
						}, 0);
						return;
					}
					if (stream?.error) {
						appendEventLog(source, `stream_error ${String(stream.error)}`);
					} else if (stream) {
						appendEventLog(source, "stream_complete");
					}
				}
			},
			[
				executionAgent,
				consumeStream,
				appendEventLog,
				handleInterruptions,
				handleReasoningSummaryError,
				extractErrorMessage,
			]
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

	const isWhitespace = (ch: string) =>
		ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
	const isWordChar = (ch: string) => /[0-9A-Za-z_]/.test(ch);
	const charClass = (ch: string) =>
		isWhitespace(ch) ? "whitespace" : isWordChar(ch) ? "word" : "symbol";

	const prevWordIndex = (s: string, pos: number) => {
		let i = Math.max(0, Math.min(pos, s.length));
		if (i === 0) return 0;
		i--;
		while (i >= 0 && isWhitespace(s[i])) i--;
		if (i < 0) return 0;
		const target = charClass(s[i]);
		while (i >= 0 && charClass(s[i]) === target) i--;
		return i + 1;
	};

	const nextWordIndex = (s: string, pos: number) => {
		let i = Math.max(0, Math.min(pos, s.length));
		const { length } = s;
		if (i >= length) return length;
		if (isWhitespace(s[i])) {
			while (i < length && isWhitespace(s[i])) i++;
			return i;
		}
		const target = charClass(s[i]);
		while (i < length && charClass(s[i]) === target) i++;
		while (i < length && isWhitespace(s[i])) i++;
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
		(key.backspace ||
			key.delete ||
			(key.ctrl && (inputKey === "h" || inputKey === "H")));
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

	// Stream response through planning → guidance → execution phases
	const streamResponse = async (chatHistory: Message[]) => {
		setIsStreaming(true);
		setResponse("");

		const runOptions = { stream: true as const, maxTurns: 30 };
		let planningStream: StreamedRunResult<any, any> | null = null;
		let guidanceStream: StreamedRunResult<any, any> | null = null;
		let executionStream: StreamedRunResult<any, any> | null = null;
		let retryWithoutSummary = false;
		let lastPlanText = "";
		let lastGuidanceText = "";

		let workingHistory: Message[] = [...chatHistory];
		const userPrompt = chatHistory[chatHistory.length - 1]?.content || "";

		try {
			if (!allowReasoningSummaryRef.current) {
				const internalNotice: Message = {
					role: "assistant",
					content:
						"(Internal reasoning: executing without shared summaries…) ",
				};
				const interimHistory = [...chatHistory, internalNotice];
				setMessages(interimHistory);
				const executionInput = await buildRunInput(
					interimHistory,
					userPrompt,
					"chat"
				);
				executionStream = await run(
					executionAgent,
					executionInput.inputItems,
					runOptions
				);
				const fullResponse = await consumeStream(executionStream, "chat");
				const assistantContent =
					(fullResponse ?? "").trim().length > 0 ? fullResponse : "";
				const displayMessages: Message[] = [
					...interimHistory,
					{
						role: "assistant",
						content: assistantContent || "(no response)",
					},
				];
				setMessages(displayMessages);
				if (assistantContent) {
					await memorizeExchange(displayMessages, "chat");
				}
				appendEventLog(
					"chat",
					"reasoning_plan_skipped (summaries unavailable)"
				);
				return;
			}

			// Planning phase (reasoning model)
			const planInput = await buildRunInput(workingHistory, userPrompt, "chat");
			planningStream = await run(planningAgent, planInput.inputItems, runOptions);
			let planText = await consumeStream(planningStream, "chat", {
				live: false,
			});
			if (isReasoningAccessError(planText)) {
				const err = new Error(planText);
				if (handleReasoningSummaryError(err, "chat")) {
					retryWithoutSummary = true;
					throw err;
				}
			}
			if (planningStream.interruptions?.length) {
				handleInterruptions(
					"chat",
					planningStream.interruptions as RunToolApprovalItem[],
					planningStream.state
				);
				return;
			}
				planText = planText.trim();
				if (planText) {
					const planMessage: Message = {
						role: "assistant",
						content: `Plan:\n${planText}`,
					};
					workingHistory = [...workingHistory, planMessage];
					setMessages(workingHistory);
					lastPlanText = planText;
				}

				// Guidance phase (large model)
				const guidancePrompt =
					"Provide implementation guidance that elaborates on the plan above. Outline sequencing, key considerations, validations, and recommended tool/TODO usage. Do not perform the work.";
			const guidanceHistory = [
				...workingHistory,
				{ role: "user" as const, content: guidancePrompt },
			];
			const guidanceInput = await buildRunInput(
				guidanceHistory,
				guidancePrompt,
				"chat"
			);
			guidanceStream = await run(
				guidanceAgent,
				guidanceInput.inputItems,
				runOptions
			);
			let guidanceText = await consumeStream(guidanceStream, "chat", {
				live: false,
			});
			if (isReasoningAccessError(guidanceText)) {
				const err = new Error(guidanceText);
				if (handleReasoningSummaryError(err, "chat")) {
					retryWithoutSummary = true;
					throw err;
				}
			}
			if (guidanceStream.interruptions?.length) {
				handleInterruptions(
					"chat",
					guidanceStream.interruptions as RunToolApprovalItem[],
					guidanceStream.state
				);
				return;
			}
				guidanceText = guidanceText.trim();
				if (guidanceText) {
					const guidanceMessage: Message = {
						role: "assistant",
						content: `Implementation Guidance:\n${guidanceText}`,
					};
					workingHistory = [...workingHistory, guidanceMessage];
					setMessages(workingHistory);
					lastGuidanceText = guidanceText;
				}

				if (!allowReasoningSummaryRef.current && lastPlanText) {
					const polyfill = buildSocraticReasoningSummary({
						userPrompt,
						planText: lastPlanText,
						guidanceText: lastGuidanceText,
					});
					if (polyfill.trim().length > 0) {
						const reasoningMessage: Message = {
							role: "assistant",
							content: `Reasoning (Socratic polyfill):\n${polyfill}`,
						};
						workingHistory = [...workingHistory, reasoningMessage];
						setMessages(workingHistory);
						appendEventLog(
							"chat",
							"reasoning_polyfill_created (socratic)"
						);
					}
				}

				// Execution phase (small model)
				const executionInput = await buildRunInput(
					workingHistory,
				userPrompt,
				"chat"
			);
			executionStream = await run(
				executionAgent,
				executionInput.inputItems,
				runOptions
			);
			const fullResponse = await consumeStream(executionStream, "chat");
			if (isReasoningAccessError(fullResponse)) {
				const err = new Error(fullResponse);
				if (handleReasoningSummaryError(err, "chat")) {
					retryWithoutSummary = true;
					throw err;
				}
			}
			if (executionStream.interruptions?.length) {
				handleInterruptions(
					"chat",
					executionStream.interruptions as RunToolApprovalItem[],
					executionStream.state
				);
			}
			const assistantContent =
				(fullResponse ?? "").trim().length > 0 ? fullResponse : "";
			const displayMessages: Message[] = [
				...workingHistory,
				{
					role: "assistant",
					content: assistantContent || "(no response)",
				},
			];
			workingHistory = displayMessages;
			setMessages(displayMessages);
			if (assistantContent) {
				await memorizeExchange(displayMessages, "chat");
			}
		} catch (err: any) {
			const msg = extractErrorMessage(err) || "Unknown error";
			const suppressed = handleReasoningSummaryError(err, "chat") ||
				(!allowReasoningSummaryRef.current && isReasoningAccessError(msg));
			if (suppressed) {
				retryWithoutSummary = true;
			} else {
				const errorMessage: Message = {
					role: "assistant",
					content: `Error: ${msg}`,
				};
				workingHistory = [...workingHistory, errorMessage];
				setMessages(workingHistory);
				setResponse(`Error: ${msg}`);
				appendEventLog("chat", `error ${msg}`);
			}
		} finally {
			setIsStreaming(false);
			await cleanupTodosAfterTurn("chat");
			if (retryWithoutSummary) {
				setTimeout(() => {
					void streamResponse(chatHistory);
				}, 0);
				return;
			}
			if (executionStream?.error) {
				appendEventLog("chat", `stream_error ${String(executionStream.error)}`);
			} else if (executionStream) {
				appendEventLog("chat", "stream_complete");
			}
		}
	};

	async function refreshTodos() {
		try {
			const cfg = await loadConfig();
			await ensureMemory(cfg);
			const items = await listTodos(cfg.panel.todoShowCompleted);
			const head = shortList(items, cfg.panel.maxItems);
			const f = await getFocus();
			setTodoPanel(head);
			setFocused(f);
			setAudioEnabled(!!cfg.audio.captureEnabled);
			setLingerEnabled(!!cfg.linger.enabled);
			setLingerBehavior(cfg.linger.behavior || "");
			setLingerIntervalSec(cfg.linger.minIntervalSec || 20);
			setReasoningEffort(cfg.loops.reasoning.effort);
			setReasoningSummary(cfg.loops.reasoning.summary);
			setThinkingEnabled(!!cfg.loops.thinking.enabled);
			setThinkingVerbosity(cfg.loops.thinking.verbosity);
			setReasoningModel(
				cfg.ai.models?.reasoning || cfg.ai.model || "o4-mini"
			);
			setGuidanceModel(
				cfg.ai.models?.guidance || cfg.ai.model || "gpt-4o"
			);
			setExecutionModel(
				cfg.ai.models?.execution || cfg.ai.model || "gpt-4o-mini"
			);
		} catch {
			// ignore
		}
	}

	async function cleanupTodosAfterTurn(source: "chat" | "linger") {
		try {
			const resolved = await completeAndRemoveOutstandingTodos();
			if (resolved.length > 0) {
				const ids = resolved.map((todo) => `#${todo.id}`).join(", ");
				appendEventLog(source, `todos_autoresolved ${ids}`);
			}
		} catch (err: any) {
			const msg = err?.message || String(err);
			appendEventLog(source, `todos_autoresolve_error ${msg}`);
		} finally {
			try {
				await refreshTodos();
			} catch {
				// ignore
			}
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
		let retryWithoutSummary = false;
			const runOptions = { stream: true as const, maxTurns: 30 };
			try {
			const { inputItems } = await buildRunInput(
				newMessages,
				instruction,
				"linger"
			);
			stream = await run(executionAgent, inputItems, runOptions);
			const full = await consumeStream(stream, "linger");
			if (isReasoningAccessError(full)) {
				const err = new Error(full);
				if (handleReasoningSummaryError(err, "linger")) {
					retryWithoutSummary = true;
					throw err;
				}
			}
			if (stream.interruptions?.length) {
				handleInterruptions(
					"linger",
					stream.interruptions as RunToolApprovalItem[],
					stream.state
				);
			}
			setMessages((m: Message[]) => {
				const assistantContent =
					(full ?? "").trim().length > 0 ? full : "";
				const nextDisplay = [
					...m,
					{
						role: "assistant",
						content: assistantContent || "(no response)",
					},
				];
				if (assistantContent) {
					void memorizeExchange(
						[
							...m,
							{ role: "assistant", content: assistantContent },
						],
						"linger"
					);
				}
				return nextDisplay;
			});
		} catch (err: any) {
			const msg = extractErrorMessage(err) || "Unknown error";
			const suppressed =
				handleReasoningSummaryError(err, "linger") ||
				(!allowReasoningSummaryRef.current && isReasoningAccessError(msg));
			if (suppressed) {
				retryWithoutSummary = true;
			} else {
				appendEventLog("linger", `error ${msg}`);
				setMessages((m: Message[]) => [
					...m,
					{ role: "assistant", content: `Linger error: ${msg}` },
				]);
				setResponse(`Error: ${msg}`);
			}
		} finally {
			setIsStreaming(false);
			await cleanupTodosAfterTurn("linger");
			if (retryWithoutSummary) {
				setTimeout(() => {
							void runLinger(latestUtterance);
						}, 0);
						return;
					}
					if (stream?.error) {
				appendEventLog("linger", `stream_error ${String(stream.error)}`);
			} else if (stream) {
				appendEventLog("linger", "stream_complete");
			}
		}
	}

	const streamingContent = response ?? "";
	const hasStreamingContent = streamingContent.trim().length > 0;

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
					<Text color={memoryHasError ? "red" : "gray"}>
						Memory:{" "}
						{memoryEnabled
							? memoryHasError
								? memoryStatusText
								: `${memoryStatusText} (model: ${memoryEmbeddingModel})`
							: "disabled"}
					</Text>
					<Newline />
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
					{messages.map((msg, i) => {
						const color = msg.role === "user" ? "green" : "yellow";
						const label = msg.role === "user" ? "You" : "AI";
						const hasContent = msg.content?.trim().length > 0;
						return (
							<Box key={i} flexDirection="column" marginBottom={1}>
								<Text color={color} bold>
									{label}:
								</Text>
								<Box marginLeft={2} flexDirection="column">
									{hasContent ? (
										<Markdown content={msg.content} color={color} />
									) : (
										<Text color={color} dimColor>
											(no content)
										</Text>
									)}
								</Box>
							</Box>
						);
					})}

					{isStreaming && (
						<Box flexDirection="column" marginBottom={1}>
							<Text color="yellow" bold>
								AI (typing):
							</Text>
							<Box marginLeft={2} flexDirection="column">
								{hasStreamingContent ? (
									<Markdown content={streamingContent} color="yellow" />
								) : (
									<Text color="yellow" dimColor>
										…
									</Text>
								)}
							</Box>
						</Box>
					)}
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
