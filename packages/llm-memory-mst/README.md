# llm-memory-mst

This package contains a MobX State Tree implementation of the GSIO memory system.
It models memory state explicitly (status, last recalls, loaded users, entries)
so it is straightforward to see what the system is doing and why.

## Usage

```ts
import { createMemorySystem } from "llm-memory-mst";
import { createStorage } from "unstorage";
import fsDriver from "unstorage/drivers/fs";

const storage = createStorage({ driver: fsDriver({ base: ".gsio-memory" }) });
const memory = createMemorySystem({ storage });

await memory.memorize(messages, "user-123");
const context = await memory.recall(messages, { userId: "user-123" });
```

Flows such as `memorize`, `recall`, `search`, `optimize`, and `clear`
are MST `flow`s. This keeps async effects and state transitions in one place,
so observing or testing the memory behavior is much easier than threading
callbacks through loose functions.
```
