import { describe, it, beforeEach, afterEach, expect } from "bun:test";
import path from "node:path";
import fs from "node:fs/promises";
import {
	loadStore,
	addTodo,
	listTodos,
	saveStore,
	setStatus,
	getTodoPath,
	completeTodo,
	removeTodo,
	clearTodos,
	updateTodo,
	setPriority,
	addNoteToTodo,
	linkDependency,
	unlinkDependency,
	setFocus,
	getFocus,
	formatTodos,
	shortList,
	type Todo,
} from "../src/todoStore";
import { acquireTempCwd, type TempCwdHandle } from "./helpers/tempWorkspace";

let tempDir: string;
let tempHandle: TempCwdHandle;

beforeEach(async () => {
	tempHandle = await acquireTempCwd("gsio-todo-");
	tempDir = tempHandle.dir;
});

afterEach(async () => {
	await tempHandle.release();
});

describe("todoStore persistence", () => {
	it("initializes an empty store when no data exists", async () => {
		const store = await loadStore();
		expect(store.lastId).toBe(0);
		expect(store.items.length).toBe(0);
		expect(store.focusedId).toBeNull();
	});

	it("adds todos incrementally and persists data to disk", async () => {
		const first = await addTodo("first task");
		const second = await addTodo("second task");
		expect(first.id).toBe(1);
		expect(second.id).toBe(2);

		const store = await loadStore();
		expect(store.lastId).toBe(2);
		expect(store.items.map((t) => t.text)).toEqual([
			"first task",
			"second task",
		]);
	});

	it("sorts todos by status and priority when listing", async () => {
		const now = new Date().toISOString();
		await saveStore({
			lastId: 6,
			focusedId: null,
			items: [
				{
					id: 1,
					text: "backlog item",
					status: "todo",
					priority: 3,
					dependsOn: [],
					notes: [],
					createdAt: now,
				},
				{
					id: 2,
					text: "slow progress",
					status: "in_progress",
					priority: 4,
					dependsOn: [],
					notes: [],
					createdAt: now,
				},
				{
					id: 3,
					text: "blocked on review",
					status: "blocked",
					priority: 2,
					dependsOn: [],
					notes: [],
					blockedReason: "waiting on review",
					createdAt: now,
				},
				{
					id: 4,
					text: "critical in progress",
					status: "in_progress",
					priority: 1,
					dependsOn: [],
					notes: [],
					createdAt: now,
				},
				{
					id: 5,
					text: "finished work",
					status: "done",
					priority: 5,
					dependsOn: [],
					notes: [],
					completedAt: now,
					createdAt: now,
				} as Todo,
				{
					id: 6,
					text: "blocked backlog",
					status: "blocked",
					priority: 5,
					dependsOn: [],
					notes: [],
					blockedReason: "needs dependency",
					createdAt: now,
				},
			],
		});

		const ordering = (await listTodos()).map((t) => t.id);
		expect(ordering).toEqual([4, 2, 3, 6, 1, 5]);
	});

	it("updates status with a blocked reason and persists the change", async () => {
		await addTodo("verify blocking");
		const updated = await setStatus(1, "blocked", "waiting on assets");
		expect(updated?.status).toBe("blocked");
		expect(updated?.blockedReason).toBe("waiting on assets");

		const store = await loadStore();
		expect(store.items[0].status).toBe("blocked");
		expect(store.items[0].blockedReason).toBe("waiting on assets");
	});
});

describe("todoStore operations", () => {
	it("resolves the todo file path inside the current working directory", () => {
		expect(getTodoPath()).toBe(
			path.resolve(process.cwd(), ".gsio-todos.json")
		);
	});

	it("migrates legacy records when loading from disk", async () => {
		const legacy = {
			lastId: 3,
			focusedId: 2,
			items: [
				{
					id: "1",
					text: "legacy item",
					completed: true,
					priority: 42,
					dependsOn: ["x", 5],
					notes: ["n1", 2],
					createdAt: "2020-01-01T00:00:00.000Z",
				},
			],
		};
		await fs.writeFile(getTodoPath(), JSON.stringify(legacy, null, 2), "utf8");

		const store = await loadStore();
		expect(store.lastId).toBe(3);
		expect(store.focusedId).toBe(2);
		expect(store.items).toHaveLength(1);
		const [todo] = store.items;
		expect(todo.id).toBe(1);
		expect(todo.status).toBe("done");
		expect(todo.priority).toBe(3);
		expect(todo.dependsOn).toEqual([5]);
		expect(todo.notes).toEqual(["n1", "2"]);
	});

	it("completes todos, stamps completion time, and clears focus", async () => {
		const todo = await addTodo("mark complete");
		await setFocus(todo.id);

		const completed = await completeTodo(todo.id);
		expect(completed?.status).toBe("done");
		expect(completed?.completedAt).toBeDefined();

		const store = await loadStore();
		expect(store.items[0].status).toBe("done");
		expect(store.focusedId).toBeNull();
	});

	it("removes todos and clears focus when deleting the focused item", async () => {
		await addTodo("keep me");
		const toRemove = await addTodo("remove me");
		await setFocus(toRemove.id);

		const removed = await removeTodo(toRemove.id);
		expect(removed?.text).toBe("remove me");

		const store = await loadStore();
		expect(store.items.map((t) => t.text)).toEqual(["keep me"]);
		expect(store.focusedId).toBeNull();
	});

	it("clears all todos and returns the number removed", async () => {
		await addTodo("one");
		await addTodo("two");

		const cleared = await clearTodos();
		expect(cleared).toBe(2);

		const store = await loadStore();
		expect(store.items.length).toBe(0);
		expect(store.focusedId).toBeNull();
	});

	it("updates text and priority while preserving persistence", async () => {
		const todo = await addTodo("original");

		const updated = await updateTodo(todo.id, "  updated text  ");
		expect(updated?.text).toBe("updated text");

		const prioritized = await setPriority(todo.id, 1);
		expect(prioritized?.priority).toBe(1);

		const store = await loadStore();
		expect(store.items[0].text).toBe("updated text");
		expect(store.items[0].priority).toBe(1);
	});

	it("filters completed todos when requested", async () => {
		const active = await addTodo("active");
		const done = await addTodo("completed");
		await completeTodo(done.id);

		const all = await listTodos();
		const activeOnly = await listTodos(false);

		expect(all.map((t) => t.id)).toEqual([active.id, done.id]);
		expect(activeOnly.map((t) => t.id)).toEqual([active.id]);
	});

	it("adds trimmed notes to a todo", async () => {
		const todo = await addTodo("note target");
		const result = await addNoteToTodo(todo.id, "  remember this  ");
		expect(result?.notes).toEqual(["remember this"]);

		const store = await loadStore();
		expect(store.items[0].notes).toEqual(["remember this"]);
	});

	it("links dependencies once and ignores missing targets", async () => {
		const parent = await addTodo("upstream");
		const child = await addTodo("downstream");

		const linked = await linkDependency(child.id, parent.id);
		expect(linked?.dependsOn).toEqual([parent.id]);

		const relinked = await linkDependency(child.id, parent.id);
		expect(relinked?.dependsOn).toEqual([parent.id]);

		const missing = await linkDependency(child.id, 999);
		expect(missing).toBeUndefined();
	});

	it("unlinks dependencies from todos", async () => {
		const parent = await addTodo("dependency");
		const child = await addTodo("dependent");
		await linkDependency(child.id, parent.id);

		const unlinked = await unlinkDependency(child.id, parent.id);
		expect(unlinked?.dependsOn).toEqual([]);
	});

	it("tracks focus and preserves the previous focus when setting an invalid id", async () => {
		const todo = await addTodo("focus here");
		const firstFocus = await setFocus(todo.id);
		expect(firstFocus).toBe(todo.id);

		const unchanged = await setFocus(999);
		expect(unchanged).toBe(todo.id);
		expect(await getFocus()).toBe(todo.id);
	});
});

describe("todoStore formatting helpers", () => {
	const sampleTodo = (overrides: Partial<Todo>): Todo => ({
		id: 99,
		text: "placeholder",
		status: "todo",
		priority: 3,
		dependsOn: [],
		notes: [],
		createdAt: new Date().toISOString(),
		...overrides,
	});

	it("formats todos with status icons, dependencies, and reasons", () => {
		const formatted = formatTodos([
			sampleTodo({ id: 1, text: "write docs", status: "todo", priority: 2 }),
			sampleTodo({
				id: 2,
				text: "integrate api",
				status: "blocked",
				priority: 1,
				dependsOn: [1],
				blockedReason: "waiting for review",
			}),
			sampleTodo({
				id: 3,
				text: "ship release",
				status: "done",
				priority: 4,
			}),
		]);

		expect(formatted).toBe(
			"[ ] #1 P2 write docs\n[!] #2 P1 deps:1 integrate api reason:waiting for review\n[x] #3 P4 ship release"
		);
	});

	it("shortList limits the number of results shown", () => {
		const todos = Array.from({ length: 6 }).map((_, idx) =>
			sampleTodo({ id: idx + 1, text: `task ${idx + 1}` })
		);
		const output = shortList(todos, 3);
		expect(output.split("\n")).toHaveLength(3);
		expect(output).toContain("task 1");
		expect(output).not.toContain("task 4");
	});
});
