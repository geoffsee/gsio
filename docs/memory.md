# GSIO Memory System

The terminal chat keeps a lightweight long‑term memory so it can recall
context from earlier sessions. This document explains how it works, how to
configure it, and what to expect while using the agent.

## Overview

GSIO wraps a custom `llm-memory` package which is a high-level abstraction over the
`unstorage`-backed adapter.
For projects that need richer instrumentation or prefer observable state, there is also
an MST-based reference implementation in `packages/llm-memory-mst` that models the
same behavior with explicit state machines, making it easier to inspect what the
memory subsystem is doing at runtime.
Unstorage is a node API that allows for interfacing many storage backends via KV interface, allowing this to be executed in various environments with different constraints, regulatory or otherwise. For instance, for a healthcare usecase, you might use a specific type of cloud storage to remain HIPAA-compliant, which you can target by modifying the storage driver from FS to whatever you need. With minimal changes, any data source can be supported by creating an adapter class for the persistence backend (Postgres, MySQL, DuckDB). By using the native unstorage driver, we eliminate all external runtime dependencies and instead only rely on the filesystem. Unstorage handles the rest.
This means we can effectively run this anywhere with a node runtime with zero config.

When memory is enabled the chat loop:

1. **Recalls** – Before sending your latest prompt, GSIO queries stored
   conversations for relevant summaries and prepends them to the model input.
2. **Memorises** – After the assistant replies, the latest exchange is compressed,
   summarised, and written to storage for future runs.

Only non-empty user/assistant messages are considered. Each entry includes:
summaries, extracted keywords, an importance score, and (for short exchanges)
the raw text.

## Storage

By default GSIO creates a `.gsio-memory/` directory in the current working
directory and mounts Unstorage’s filesystem driver. Every conversation is stored
under the `chat:` prefix. You can safely delete the directory to clear history.

If you prefer a different path, change `memory.storageDir` in the config (see
below) before starting a session.

## Configuration

Run `gsio config` or edit `.gsio-config.json` to control the following settings:

| Field | Description |
| ----- | ----------- |
| `memory.enabled` | Toggle the memory system on/off (default `true`). |
| `memory.userId` | Logical user identifier written into every entry. Useful if multiple people share the same workspace. |
| `memory.maxEntries` | Upper bound on stored entries. Older/low-importance memories are pruned once the cap is reached (default `500`). |
| `memory.storageDir` | Relative path to the storage root (default `.gsio-memory`). |
| `memory.embeddingModel` | Describes the embedding model you expect to pair with GSIO (e.g. `text-embedding-3-small`). Included in agent instructions and UI to keep you aware of the target embedding space. |

Changes made in the config menu take effect the next time GSIO loads the
configuration (typically on the next keystroke or restart).

## UI Signals

When memory is enabled the chat header shows the current status:

- `Memory: active (model: text-embedding-3-small)` – normal operation.
- `Memory: disabled` – memory switched off in the config.
- `Memory: error: …` – storage or recall failed; check the event log panel
  (`Option/Alt+E` to toggle debug mode or inspect the right-hand log panel)
  for more detail.

Memory events such as `memory_ready`, `memory_recall`, or `memory_memorized`
are also appended to the event log so you can trace when GSIO used stored
context.

## Clearing or Resetting Memory

- **Clear everything:** delete the storage directory (`rm -rf .gsio-memory` by
  default) while GSIO is not running.
- **Disable temporarily:** toggle `memory.enabled` to `false` via
  `gsio config`. Re-enable later to resume storing new conversations.

## Troubleshooting

- **Permission errors** – Ensure the configured storage directory is writable.
- **Unexpected content** – Memory stores compressed summaries. If you need raw
  text retention, keep conversations short (under ~500 characters) so they are
  preserved in the `raw` field.
- **Too much recall** – Lower `memory.maxEntries` or raise the similarity
  threshold in code (`src/chat.tsx`) if you want stricter matches.

That’s it! With memory enabled GSIO will steadily build a knowledge base of your
terminal sessions, helping the agent stay consistent across long-running projects.
