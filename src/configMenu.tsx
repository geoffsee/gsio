import React, {useEffect, useState} from 'react';
import {Box, Text, Newline, useApp, useInput} from 'ink';
import {loadConfig, saveConfig, type AppConfig} from './config.js';

type Mode =
  | 'browse'
  | 'editAllow'
  | 'editBehavior'
  | 'editModel'
  | 'editBaseUrl'
  | 'editWhisperCmd'
  | 'editWhisperModel'
  | 'editToolApproval'
  | 'message';

export const ConfigMenu = () => {
  const {exit} = useApp();
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [index, setIndex] = useState(0);
  const [mode, setMode] = useState<Mode>('browse');
  const [input, setInput] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    loadConfig()
      .then(setCfg)
      .catch((e) => {
        setMsg(`Failed to load config: ${e?.message ?? e}`);
        setMode('message');
      });
  }, []);

  const items = cfg ? buildItems(cfg) : [];

  useInput((ch, key) => {
    if (!cfg) return;
    if (mode === 'message') {
      if (key.return || key.escape) exit();
      return;
    }
    if (
      mode === 'editAllow' ||
      mode === 'editBehavior' ||
      mode === 'editModel' ||
      mode === 'editBaseUrl' ||
      mode === 'editWhisperCmd' ||
      mode === 'editWhisperModel' ||
      mode === 'editToolApproval'
    ) {
      if (key.return) {
        const val = input.trim();
        setInput('');
        setMode('browse');
        if (val.length > 0) {
          if (mode === 'editAllow') {
            const next = {...cfg, shell: {...cfg.shell, extraAllowlist: [...cfg.shell.extraAllowlist, val]}};
            setCfg(next);
          } else if (mode === 'editBehavior') {
            const next = {...cfg, linger: {...cfg.linger, behavior: val}};
            setCfg(next);
          } else if (mode === 'editModel') {
            const next = {...cfg, ai: {...cfg.ai, model: val}};
            setCfg(next);
          } else if (mode === 'editBaseUrl') {
            const next = {...cfg, ai: {...cfg.ai, baseUrl: val}};
            setCfg(next);
          } else if (mode === 'editWhisperCmd') {
            const next = {...cfg, audio: {...cfg.audio, whisper: {...cfg.audio.whisper, command: val}}};
            setCfg(next);
          } else if (mode === 'editWhisperModel') {
            const next = {...cfg, audio: {...cfg.audio, whisper: {...cfg.audio.whisper, model: val}}};
            setCfg(next);
          } else if (mode === 'editToolApproval') {
            if (!cfg.tools.requireApproval.includes(val)) {
              const next = {...cfg, tools: {...cfg.tools, requireApproval: [...cfg.tools.requireApproval, val]}};
              setCfg(next);
            }
          }
        }
        return;
      }
      if (key.escape) {
        setMode('browse');
        setInput('');
        return;
      }
      if (key.backspace) {
        setInput((p) => p.slice(0, -1));
        return;
      }
      if (!key.ctrl && !key.meta && ch) setInput((p) => p + ch);
      return;
    }

    // browse mode
    if (key.upArrow) {
      setIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setIndex((i) => Math.min(items.length - 1, i + 1));
      return;
    }
    if (key.escape) {
      // save and exit
      saveConfig(cfg)
        .then(() => exit())
        .catch((e) => {
          setMsg(`Failed to save: ${e?.message ?? e}`);
          setMode('message');
        });
      return;
    }
    if (key.return) {
      const it = items[index];
      if (it?.action) it.action();
      return;
    }
    // shortcuts
    if (ch === ' ') {
      const it = items[index];
      if (it?.toggle) it.toggle();
      return;
    }
    if (ch === 's' || ch === 'S') {
      saveConfig(cfg)
        .then(() => setMsg('Saved. Press Esc to exit.'))
        .catch((e) => setMsg(`Failed to save: ${e?.message ?? e}`))
        .finally(() => setMode('message'));
      return;
    }
    if (ch === 'a' || ch === 'A') {
      setMode('editAllow');
      setInput('');
      return;
    }
    if (ch === 't' || ch === 'T') {
      setMode('editToolApproval');
      setInput('');
      return;
    }
    if (ch === 'e' || ch === 'E') {
      setMode('editBehavior');
      setInput(cfg.linger.behavior);
      return;
    }
    if (ch === 'd' || ch === 'D') {
      const it = items[index];
      if (it?.kind === 'allow') {
        const idx = (items[index] as any).idx as number;
        const next = {
          ...cfg,
          shell: {
            ...cfg.shell,
            extraAllowlist: cfg.shell.extraAllowlist.filter((_, i) => i !== idx),
          },
        };
        setCfg(next);
        return;
      }
      if (it?.kind === 'approval') {
        const idx = (items[index] as any).idx as number;
        const next = {
          ...cfg,
          tools: {
            ...cfg.tools,
            requireApproval: cfg.tools.requireApproval.filter((_, i) => i !== idx),
          },
        };
        setCfg(next);
        return;
      }
    }
    if (key.leftArrow || ch === 'h' || ch === 'H') {
      const it = items[index];
      if (it?.dec) it.dec();
      return;
    }
    if (key.rightArrow || ch === 'l' || ch === 'L') {
      const it = items[index];
      if (it?.inc) it.inc();
      return;
    }
  });

  if (!cfg) return <Text>Loading config…</Text>;

  return (
    <Box flexDirection="column">
      <Text color="cyan">⚙️ GSIO Config</Text>
      <Text color="gray">↑/↓ select • Space toggle • ←/→ adjust • a add allow • t add approval • d delete • e edit behavior • s save • Esc exit</Text>
      <Newline />
      {items.map((it, i) => (
        <Text key={`${it.key}-${i}`} color={i === index ? 'magenta' : undefined}>
          {i === index ? '› ' : '  '}
          {renderItem(it)}
        </Text>
      ))}
      {mode === 'editWhisperCmd' && (
        <>
          <Newline />
          <Text color="yellow">Whisper command (in PATH): {input}_</Text>
        </>
      )}
      {mode === 'editWhisperModel' && (
        <>
          <Newline />
          <Text color="yellow">Whisper model path (.bin): {input}_</Text>
        </>
      )}
      {mode === 'editModel' && (
        <>
          <Newline />
          <Text color="yellow">Edit AI model: {input}_</Text>
        </>
      )}
      {mode === 'editBaseUrl' && (
        <>
          <Newline />
          <Text color="yellow">Edit AI base URL: {input}_</Text>
        </>
      )}
      {mode === 'editAllow' && (
        <>
          <Newline />
          <Text color="yellow">Add allowlist command: {input}_</Text>
        </>
      )}
      {mode === 'editBehavior' && (
        <>
          <Newline />
          <Text color="yellow">Edit linger behavior: {input}_</Text>
        </>
      )}
      {mode === 'editToolApproval' && (
        <>
          <Newline />
          <Text color="yellow">Add tool requiring approval: {input}_</Text>
        </>
      )}
      {mode === 'message' && msg && (
        <>
          <Newline />
          <Text color="yellow">{msg}</Text>
        </>
      )}
    </Box>
  );

  function buildItems(c: AppConfig) {
    const out: any[] = [];
    out.push({
      key: 'ai.provider',
      label: `AI provider: ${c.ai.provider}`,
      toggle: () => setCfg({...c, ai: {...c.ai, provider: c.ai.provider === 'openai' ? 'ollama' : 'openai'}}),
      kind: 'toggle',
    });
    out.push({
      key: 'ai.model',
      label: `AI model: ${c.ai.model}`,
      action: () => { setMode('editModel'); setInput(c.ai.model); },
      kind: 'action',
    });
    out.push({
      key: 'ai.baseUrl',
      label: `AI base URL: ${c.ai.baseUrl || '(default)'}`,
      action: () => { setMode('editBaseUrl'); setInput(c.ai.baseUrl || (c.ai.provider === 'ollama' ? 'http://localhost:11434/v1' : '')); },
      kind: 'action',
    });
    out.push({
      key: 'dangerous',
      label: 'Shell: allow dangerous commands',
      value: c.shell.allowDangerous,
      toggle: () => setCfg({...c, shell: {...c.shell, allowDangerous: !c.shell.allowDangerous}}),
      kind: 'toggle',
    });
    out.push({
      key: 'linger.enabled',
      label: 'Linger: run continuously on audio',
      value: c.linger.enabled,
      toggle: () => setCfg({...c, linger: {...c.linger, enabled: !c.linger.enabled}}),
      kind: 'toggle',
    });
    out.push({
      key: 'linger.behavior',
      label: `Linger behavior: ${truncate(c.linger.behavior, 70)}`,
      action: () => { setMode('editBehavior'); setInput(c.linger.behavior); },
      kind: 'action',
    });
    out.push({
      key: 'linger.interval',
      label: `Linger interval (sec): ${c.linger.minIntervalSec}`,
      inc: () => setCfg({...c, linger: {...c.linger, minIntervalSec: Math.min(600, c.linger.minIntervalSec + 5)}}),
      dec: () => setCfg({...c, linger: {...c.linger, minIntervalSec: Math.max(5, c.linger.minIntervalSec - 5)}}),
      kind: 'number',
    });
    out.push({
      key: 'audio.capture',
      label: 'Audio: capture context from system audio',
      value: c.audio.captureEnabled,
      toggle: () => setCfg({...c, audio: {...c.audio, captureEnabled: !c.audio.captureEnabled}}),
      kind: 'toggle',
    });
    out.push({
      key: 'audio.stt',
      label: `Audio STT provider: ${c.audio.sttProvider}`,
      toggle: () => setCfg({...c, audio: {...c.audio, sttProvider: c.audio.sttProvider === 'openai' ? 'whisper' : 'openai'}}),
      kind: 'toggle',
    });
    if (c.audio.sttProvider === 'whisper') {
      out.push({
        key: 'audio.whisper.cmd',
        label: `Whisper command: ${c.audio.whisper.command || '(set)'}`,
        action: () => { setMode('editWhisperCmd'); setInput(c.audio.whisper.command || 'whisper-cpp'); },
        kind: 'action',
      });
      out.push({
        key: 'audio.whisper.model',
        label: `Whisper model: ${c.audio.whisper.model || '(set path to .bin)'}`,
        action: () => { setMode('editWhisperModel'); setInput(c.audio.whisper.model || ''); },
        kind: 'action',
      });
    }
    out.push({
      key: 'panel.completed',
      label: 'TODO panel: show completed tasks',
      value: c.panel.todoShowCompleted,
      toggle: () => setCfg({...c, panel: {...c.panel, todoShowCompleted: !c.panel.todoShowCompleted}}),
      kind: 'toggle',
    });
    out.push({
      key: 'panel.max',
      label: `TODO panel: max items (${c.panel.maxItems})`,
      inc: () => setCfg({...c, panel: {...c.panel, maxItems: Math.min(20, c.panel.maxItems + 1)}}),
      dec: () => setCfg({...c, panel: {...c.panel, maxItems: Math.max(1, c.panel.maxItems - 1)}}),
      kind: 'number',
    });
    out.push({ key: 'allow.header', label: 'Shell allowlist (press a to add, d to delete)', kind: 'header' });
    for (let i = 0; i < c.shell.extraAllowlist.length; i++) {
      out.push({ key: `allow.${i}`, label: `  - ${c.shell.extraAllowlist[i]}`, kind: 'allow', idx: i });
    }
    out.push({ key: 'approval.header', label: 'Tools requiring approval (press t to add, d to delete)', kind: 'header' });
    for (let i = 0; i < c.tools.requireApproval.length; i++) {
      out.push({ key: `approval.${i}`, label: `  - ${c.tools.requireApproval[i]}`, kind: 'approval', idx: i });
    }
    return out;
  }
};

function renderItem(it: any) {
  if (it.kind === 'toggle') return `${it.label}: ${it.value ? 'ON' : 'OFF'}`;
  if (it.kind === 'number') return it.label;
  return it.label;
}

function truncate(s: string, n: number) {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}
