import React, {useState} from 'react';
import {Box, Newline, Text, useInput} from 'ink';
import {Agent, run, type StreamedRunResult} from '@openai/agents';
import {defaultTools} from './tools.js';
import {listTodos, shortList, getFocus} from './todoStore.js';
import {loadConfig, saveConfig} from './config.js';
import {startContinuousCapture} from './audio.js';
import {summarizeAudioContext} from './summarizer.js';

// Agent instantiated inside component based on config (e.g., audio flag)

type Message = {
	role: 'user' | 'assistant';
	content: string;
};

type ChatProps = { debug?: boolean };

export const Chat = ({debug = false}: ChatProps) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [cursor, setCursor] = useState(0);
  const [response, setResponse] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [draftBeforeHistory, setDraftBeforeHistory] = useState<string>('');
  const [lastInput, setLastInput] = useState<string>('');
  const [lastFlags, setLastFlags] = useState<string>('');
  const [lastAction, setLastAction] = useState<string>('');
  const [todoPanel, setTodoPanel] = useState<string>('');
  const [focused, setFocused] = useState<number | null>(null);
  const [audioEnabled, setAudioEnabled] = useState<boolean>(false);
  const [audioSummary, setAudioSummary] = useState<string>('');
  const stopAudioRef = React.useRef<null | (() => void)>(null);
  const [lingerEnabled, setLingerEnabled] = useState<boolean>(false);
  const [lingerBehavior, setLingerBehavior] = useState<string>('');
  const [lingerIntervalSec, setLingerIntervalSec] = useState<number>(20);
  const lastLingerRef = React.useRef<number>(0);

  // Build agent based on config flags
  const agent = React.useMemo(() => {
    const audioLine = audioEnabled
      ? 'Audio context capture is enabled; prefer incorporating relevant auditory information if provided.'
      : '';
    return new Agent({
      name: 'Assistant',
      instructions: [
        'You are a helpful assistant. Use tools when helpful. Prefer concise answers.',
        'Use the TODO tools to navigate multi-step tasks: create a plan, set priorities, track status (todo/in_progress/blocked/done), mark focus, and add notes. Keep the list updated as you work.',
        audioLine,
        audioSummary ? `Recent audio context summary: ${audioSummary}` : '',
        'You can manage a persistent todo list stored in the current working directory using tools:',
        '- todo_add(text): Add a new todo',
        '- todo_list(includeCompleted=true): List todos',
        '- todo_complete(id): Mark a todo done',
        '- todo_remove(id): Remove a todo',
        '- todo_update(id, text): Update todo text',
        '- todo_clear_all(): Remove all todos',
        '- todo_set_status(id, status, blockedReason?): Set status',
        '- todo_set_priority(id, priority 1..5): Set priority',
        '- todo_add_note(id, note): Append a note',
        '- todo_link_dep(id, dependsOnId) / todo_unlink_dep(id, dependsOnId): Dependencies',
        '- todo_focus(id|0): Focus a todo or clear focus',
        '- todo_plan(steps[]): Bulk-add steps for planning',
        'Keep responses short and show the resulting list when appropriate.',
        'For files, stay within the working directory.',
      ].filter(Boolean).join('\n'),
      tools: defaultTools,
    });
  }, [audioEnabled, audioSummary]);

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
    while (i > 0 && s[i] === ' ') i--;
    while (i > 0 && s[i] !== ' ' && s[i] !== '\n' && s[i] !== '\t') i--;
    if (i > 0 && (s[i] === ' ' || s[i] === '\n' || s[i] === '\t')) i++;
    return i;
  };

  const nextWordIndex = (s: string, pos: number) => {
    let i = Math.max(0, Math.min(pos, s.length));
    while (i < s.length && s[i] === ' ') i++;
    while (i < s.length && s[i] !== ' ' && s[i] !== '\n' && s[i] !== '\t') i++;
    return i;
  };

  // Helper to detect printable text (single chars or pasted strings), excluding control/escape sequences
  const isPrintable = (s: string) => {
    if (!s) return false;
    // reject pure escape sequences
    if (s.includes('\u001b')) return false;
    // allow multi-line paste; disallow other C0 controls and DEL
    return /[\u0020-\u007E\n\r\t]/.test(s);
  };

  // Handle keyboard input with editing features
  useInput((inputKey, key) => {
    // record raw input and flags for debugging
    if (debug) {
      setLastInput(
        inputKey === undefined
          ? 'undefined'
          : `${JSON.stringify(inputKey)} (len=${inputKey.length}) codes=[${Array.from(
              inputKey,
            )
              .map(c => c.codePointAt(0)?.toString(16))
              .join(' ')}]`,
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
          .join(', ') || '(none)'
      );
      setLastAction('(none)');
    }
    // Toggle audio capture: Alt/Meta + A
    if (key.meta && (inputKey === 'a' || inputKey === 'A')) {
      (async () => {
        try {
          const cfg = await loadConfig();
          const next = !audioEnabled;
          setAudioEnabled(next);
          await saveConfig({...cfg, audio: {...cfg.audio, captureEnabled: next}});
          setMessages((m: Message[]) => [
            ...m,
            {role: 'assistant', content: `Audio context ${next ? 'enabled' : 'disabled'}.`},
          ]);
          if (debug) setLastAction(`audio: ${next ? 'enabled' : 'disabled'}`);
        } catch (e: any) {
          setMessages((m: Message[]) => [
            ...m,
            {role: 'assistant', content: `Error toggling audio: ${e?.message || e}`},
          ]);
        }
      })();
      return;
    }
    // Submit / newline
    if (key.return) {
      if (key.shift) {
        // Insert newline
        const s = input.slice(0, cursor) + '\n' + input.slice(cursor);
        setInputAndCursor(s, cursor + 1);
        return;
      }
      if (input.trim().length === 0 || isStreaming) return;
      const content = input;
      const newMessages = [...messages, {role: 'user', content}];
      setMessages(newMessages as any);
      // update history
      setHistory(h => (content.length > 0 ? [...h, content] : h));
      setHistoryIndex(null);
      setDraftBeforeHistory('');
      setInputAndCursor('');
      // stream
      // @ts-ignore
      streamResponse(newMessages);
      if (debug) setLastAction('submit');
      return;
    }

    // History navigation
    if (key.upArrow && !isStreaming) {
      if (history.length === 0) return;
      if (historyIndex === null) {
        setDraftBeforeHistory(input);
        const idx = history.length - 1;
        setHistoryIndex(idx);
        const s = history[idx] ?? '';
        setInputAndCursor(s);
      } else if (historyIndex > 0) {
        const idx = historyIndex - 1;
        setHistoryIndex(idx);
        const s = history[idx] ?? '';
        setInputAndCursor(s);
      }
      if (debug) setLastAction('history: up');
      return;
    }
    if (key.downArrow && !isStreaming) {
      if (historyIndex === null) return;
      if (historyIndex < history.length - 1) {
        const idx = historyIndex + 1;
        setHistoryIndex(idx);
        const s = history[idx] ?? '';
        setInputAndCursor(s);
      } else {
        setHistoryIndex(null);
        setInputAndCursor(draftBeforeHistory);
      }
      if (debug) setLastAction('history: down');
      return;
    }

    // Cursor movement
    if (key.leftArrow) {
      if (key.meta) setCursor(prev => clampCursor(prevWordIndex(input, prev)));
      else setCursor(prev => clampCursor(prev - 1));
      if (debug) setLastAction(key.meta ? 'cursor: word-left' : 'cursor: left');
      return;
    }
    if (key.rightArrow) {
      if (key.meta) setCursor(prev => clampCursor(nextWordIndex(input, prev)));
      else setCursor(prev => clampCursor(prev + 1));
      if (debug) setLastAction(key.meta ? 'cursor: word-right' : 'cursor: right');
      return;
    }

    // Home/End via Ctrl+A / Ctrl+E
    if (key.ctrl && (inputKey === 'a' || inputKey === 'A')) {
      setCursor(0);
      if (debug) setLastAction('cursor: home');
      return;
    }
    if (key.ctrl && (inputKey === 'e' || inputKey === 'E')) {
      setCursor(input.length);
      if (debug) setLastAction('cursor: end');
      return;
    }

    // Kill line: Ctrl+U (to start), Ctrl+K (to end)
    if (key.ctrl && (inputKey === 'u' || inputKey === 'U')) {
      setInputAndCursor(input.slice(cursor), 0);
      if (debug) setLastAction('kill: to-start');
      return;
    }
    if (key.ctrl && (inputKey === 'k' || inputKey === 'K')) {
      setInputAndCursor(input.slice(0, cursor), cursor);
      if (debug) setLastAction('kill: to-end');
      return;
    }

    // Word nav via Meta+B / Meta+F
    if (key.meta && (inputKey === 'b' || inputKey === 'B')) {
      setCursor(prev => clampCursor(prevWordIndex(input, prev)));
      return;
    }
    if (key.meta && (inputKey === 'f' || inputKey === 'F')) {
      setCursor(prev => clampCursor(nextWordIndex(input, prev)));
      return;
    }

    // Some terminals report Backspace as Delete (Ink sets only delete flag).
    // Infer backspace when delete is pressed with no modifiers and no printable input, and there is no char to the right.
    const deleteMeansBackspace =
      key.delete && !key.ctrl && !key.meta && !key.shift && (!inputKey || inputKey.length === 0) && cursor > 0;
    // Backspace handling: rely on Ink key flags; also support Ctrl+H
    const isBackspaceKey = key.backspace || deleteMeansBackspace || (key.ctrl && (inputKey === 'h' || inputKey === 'H'));
    const isMetaBackspace = key.meta && (key.backspace || (key.ctrl && (inputKey === 'h' || inputKey === 'H')));
    if (isBackspaceKey || isMetaBackspace) {
      if (cursor === 0) return;
      if (isMetaBackspace) {
        const start = prevWordIndex(input, cursor);
        setInputAndCursor(input.slice(0, start) + input.slice(cursor), start);
      } else {
        setInputAndCursor(input.slice(0, cursor - 1) + input.slice(cursor), cursor - 1);
      }
      if (debug) setLastAction(isMetaBackspace ? 'backspace: word' : (deleteMeansBackspace ? 'backspace: inferred-from-delete' : 'backspace: char'));
      return;
    }

    // Forward delete: rely on Ink key flag; also support Ctrl+D
    if ((key.delete && !deleteMeansBackspace) || (key.ctrl && (inputKey === 'd' || inputKey === 'D'))) {
      if (cursor >= input.length) return;
      setInputAndCursor(input.slice(0, cursor) + input.slice(cursor + 1), cursor);
      if (debug) setLastAction('delete: forward');
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
		setResponse('');

		// Get the last user message
		const lastMessage = chatHistory[chatHistory.length - 1]?.content || '';

		try {
			const stream: StreamedRunResult<any, any> = await run(agent, lastMessage, {
				stream: true,
			});

			// Iterate through streaming events to collect text in realtime
			let fullResponse = '';
			for await (const event of stream) {
				// Stream model text deltas
				if (
					event.type === 'raw_model_stream_event' &&
					event.data.type === 'output_text_delta'
				) {
					const delta = event.data.delta;
					if (delta) {
						fullResponse += delta;
						setResponse(fullResponse);
					}
				}
			}

			// Add the complete response to message history
			// @ts-ignore
			setMessages([
				...chatHistory,
				{role: 'assistant', content: fullResponse || '(no response)'},
			]);
		} catch (err: any) {
			const msg = err?.message || 'Unknown error';
			// @ts-ignore
			setMessages([...chatHistory, {role: 'assistant', content: `Error: ${msg}`}]);
			setResponse(`Error: ${msg}`);
		} finally {
			setIsStreaming(false);
			refreshTodos().catch(() => {});
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
      setLingerBehavior(cfg.linger.behavior || '');
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
      return;
    }
    stopAudioRef.current?.();
    stopAudioRef.current = startContinuousCapture({
      onTranscript: async (text) => {
        setMessages((m: Message[]) => [...m, {role: 'assistant', content: `(heard) ${text}`}]);
        try {
          const next = await summarizeAudioContext(audioSummary, text);
          setAudioSummary(next);
        } catch (e: any) {
          setMessages((m: Message[]) => [...m, {role: 'assistant', content: `Audio summarize error: ${e?.message || e}`}]);
        }

        // Linger mode: autonomously act based on audio context
        if (lingerEnabled) {
          const now = Date.now();
          if (!isStreaming && now - (lastLingerRef.current || 0) >= lingerIntervalSec * 1000) {
            lastLingerRef.current = now;
            await runLinger(text).catch((e)=> setMessages((m: Message[]) => [...m, {role:'assistant', content: `Linger error: ${e?.message || e}`}]) );
          }
        }
      },
      onStatus: (s) => setLastAction(`audio: ${s}`),
      onError: (e) => setMessages((m: Message[]) => [...m, {role: 'assistant', content: `Audio error: ${e}`}]),
    });
    return () => {
      stopAudioRef.current?.();
      stopAudioRef.current = null;
    };
  }, [audioEnabled, audioSummary]);

  async function runLinger(latestUtterance: string) {
    const instruction = `Linger mode is enabled. Behavior directive from user: ${lingerBehavior}\n\nRecent audio summary: ${audioSummary || '(none)'}\nLatest utterance: ${latestUtterance}\n\nDecide if any helpful action is warranted. If yes, act concisely (use tools when needed) and keep changes minimal and safe. If no action is valuable, reply briefly or remain silent.`;
    const newMessages = [...messages, {role: 'user' as const, content: instruction}];
    // Stream like a normal response
    setMessages(newMessages as any);
    setIsStreaming(true);
    setResponse('');
    try {
      const stream: StreamedRunResult<any, any> = await run(agent, instruction, { stream: true });
      let full = '';
      for await (const event of stream) {
        if (event.type === 'raw_model_stream_event' && event.data.type === 'output_text_delta') {
          const d = event.data.delta;
          if (d) {
            full += d;
            setResponse(full);
          }
        }
      }
      // append assistant output
      setMessages((m: Message[]) => [...m, {role: 'assistant', content: full || '(no response)'}]);
    } finally {
      setIsStreaming(false);
      refreshTodos().catch(()=>{});
    }
  }

  const left = input.slice(0, cursor);
  const right = input.slice(cursor);

  return (
    <Box flexDirection="column">
      <Text color="cyan">🧠 GSIO (Enter: send, Shift+Enter: newline, Alt+A: audio)</Text>
      <Newline />
      {todoPanel && (
        <>
          <Text color="gray">TODOs {focused ? `(focus: #${focused})` : ''}</Text>
          <Text color="gray">{todoPanel}</Text>
          <Newline />
        </>
      )}
      {audioEnabled && (
        <>
          <Text color="gray">Audio context: enabled{audioSummary ? ' — summarized' : ''} {lingerEnabled ? '• Linger on' : ''}</Text>
          <Newline />
        </>
      )}
      {messages.map((msg, i) => (
        <Box key={i} flexDirection="column" marginBottom={1}>
          <Text color={msg.role === 'user' ? 'green' : 'yellow'}>
            {msg.role === 'user' ? 'You: ' : 'AI: '}
            {msg.content}
          </Text>
        </Box>
      ))}

      {isStreaming && <Text color="yellow">{response}</Text>}

      <Newline />
      <Text>
        <Text color="magenta">{'>'}</Text>{' '}
        {left}
        <Text color="magenta">|</Text>
        {right}
      </Text>

      {debug && (
        <>
          <Newline />
          <Text color="gray">[debug] input: {lastInput}</Text>
          <Text color="gray">[debug] flags: {lastFlags}</Text>
          <Text color="gray">[debug] action: {lastAction}</Text>
          <Text color="gray">[debug] cursor: {cursor}/{input.length}</Text>
        </>
      )}
    </Box>
  );
};
