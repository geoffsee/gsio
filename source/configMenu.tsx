import React, {useEffect, useState} from 'react';
import {Box, Text, Newline, useApp, useInput} from 'ink';
import {loadConfig, saveConfig, type AppConfig} from './config.js';

type Mode = 'browse' | 'editAllow' | 'message';

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
    if (mode === 'editAllow') {
      if (key.return) {
        const val = input.trim();
        setInput('');
        setMode('browse');
        if (val.length > 0) {
          const next = {...cfg, shell: {...cfg.shell, extraAllowlist: [...cfg.shell.extraAllowlist, val]}};
          setCfg(next);
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
    if ((ch === 'd' || ch === 'D') && items[index]?.kind === 'allow') {
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
      <Text color="gray">↑/↓ select • Space toggle • ←/→ adjust • a add allow • d delete • s save • Esc exit</Text>
      <Newline />
      {items.map((it, i) => (
        <Text key={`${it.key}-${i}`} color={i === index ? 'magenta' : undefined}>
          {i === index ? '› ' : '  '}
          {renderItem(it)}
        </Text>
      ))}
      {mode === 'editAllow' && (
        <>
          <Newline />
          <Text color="yellow">Add allowlist command: {input}_</Text>
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
      key: 'dangerous',
      label: 'Shell: allow dangerous commands',
      value: c.shell.allowDangerous,
      toggle: () => setCfg({...c, shell: {...c.shell, allowDangerous: !c.shell.allowDangerous}}),
      kind: 'toggle',
    });
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
    return out;
  }
};

function renderItem(it: any) {
  if (it.kind === 'toggle') return `${it.label}: ${it.value ? 'ON' : 'OFF'}`;
  if (it.kind === 'number') return it.label;
  return it.label;
}

