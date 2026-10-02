import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { createUsageCache } from "../extensions/subscription-usage/cache.ts";

async function fixture(t: TestContext) {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pi-pulse-cache-"));
	t.after(() => fs.rm(directory, { recursive: true, force: true }));
	const cachePath = path.join(directory, "agent", "usage.json");
	return { directory, cachePath, cache: createUsageCache(cachePath) };
}

const usage = { windows: { weekly: 42 } };

test("cache creates its directory and persists normalized usage with freshness", async (t) => {
	const { cache, cachePath } = await fixture(t);
	assert.deepEqual(await cache.read(), {});
	const before = Date.now();
	await cache.write("codex", {
		windows: { weekly: 150, daily: -5 },
		plan: " plus ",
	});
	const result = await createUsageCache(cachePath).read();
	assert.deepEqual(result.codex.data, {
		windows: { weekly: 100, daily: 0 },
		plan: "plus",
	});
	assert.ok(result.codex.fetchedAt >= before);
	assert.ok(result.codex.fetchedAt <= Date.now());
	assert.deepEqual(await fs.readdir(path.dirname(cachePath)), ["usage.json"]);
});

test("cache serializes overlapping updates without losing providers or write order", async (t) => {
	const { cache, cachePath } = await fixture(t);
	await Promise.all([
		cache.write("codex", usage),
		cache.write("deepseek", { windows: {}, balance: { currency: "usd", total: 12 } }),
		cache.write("codex", { windows: { weekly: 65 } }),
	]);
	const result = await createUsageCache(cachePath).read();
	assert.deepEqual(Object.keys(result).sort(), ["codex", "deepseek"]);
	assert.deepEqual(result.codex.data, { windows: { weekly: 65 } });
	assert.deepEqual(result.deepseek.data.balance, { currency: "USD", total: 12 });
});

test("cache validates disk records before exposing them", async (t) => {
	const { cache, cachePath } = await fixture(t);
	await fs.mkdir(path.dirname(cachePath), { recursive: true });
	await fs.writeFile(cachePath, JSON.stringify({
		good: { data: { windows: { weekly: 120, bad: "wrong" } }, fetchedAt: 10 },
		negativeTime: { data: usage, fetchedAt: -1 },
		wrongTime: { data: usage, fetchedAt: "yesterday" },
		missingData: { fetchedAt: 10 },
		emptyData: { data: { windows: {} }, fetchedAt: 10 },
		array: [],
	}));
	assert.deepEqual(await cache.read(), {
		good: { data: { windows: { weekly: 100 } }, fetchedAt: 10 },
	});
});

test("cache retains its last snapshot on malformed or missing files and accepts recovery", async (t) => {
	const { cache, cachePath } = await fixture(t);
	await cache.write("codex", usage);
	const snapshot = await cache.read();
	await fs.writeFile(cachePath, '{"partial":');
	assert.deepEqual(await cache.read(), snapshot);
	await fs.unlink(cachePath);
	assert.deepEqual(await cache.read(), snapshot);
	await fs.writeFile(cachePath, "{}");
	assert.deepEqual(await cache.read(), {});
});

test("cache reads external updates and merges them into subsequent writes", async (t) => {
	const { cache, cachePath } = await fixture(t);
	await cache.write("codex", usage);
	const other = createUsageCache(cachePath);
	await other.write("deepseek", usage);
	assert.ok((await cache.read()).deepseek);
	await cache.write("opencode", usage);
	assert.deepEqual(Object.keys(await other.read()).sort(), ["codex", "deepseek", "opencode"]);
});

test("cache write failure is best-effort and does not poison subsequent writes", async (t) => {
	const { cache, cachePath } = await fixture(t);
	const errors = t.mock.method(console, "error", () => undefined);
	// A regular file where the parent directory belongs reliably fails even as root.
	await fs.writeFile(path.dirname(cachePath), "blocked");
	await cache.write("codex", usage);
	assert.equal(errors.mock.callCount(), 1);
	await fs.unlink(path.dirname(cachePath));
	await cache.write("deepseek", usage);
	assert.deepEqual((await createUsageCache(cachePath).read()).deepseek.data, usage);
});

test("cache falls back when rename cannot replace the target and removes temporary files", async (t) => {
	const { cache, cachePath } = await fixture(t);
	t.mock.method(fs, "rename", async () => { throw new Error("replacement unavailable"); });
	await cache.write("codex", usage);
	assert.deepEqual((await createUsageCache(cachePath).read()).codex.data, usage);
	assert.deepEqual(await fs.readdir(path.dirname(cachePath)), ["usage.json"]);
});

test("cache snapshots are scoped to each path rather than shared globally", async (t) => {
	const { cache, directory, cachePath } = await fixture(t);
	await cache.write("codex", usage);
	const empty = createUsageCache(path.join(directory, "missing.json"));
	assert.deepEqual(await empty.read(), {});
	await fs.unlink(cachePath);
	assert.ok((await cache.read()).codex);
});
