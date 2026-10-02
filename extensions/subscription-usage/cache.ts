import fs from "node:fs";
import path from "node:path";
import { asRecord, finiteNumber, normalizeUsageData, type UsageData } from "./data.ts";

export interface UsageCacheRecord {
	data: UsageData;
	fetchedAt: number;
}

type UsageCache = Record<string, UsageCacheRecord>;

function normalizeCache(value: unknown): UsageCache {
	const record = asRecord(value);
	if (!record) return {};
	const entries = Object.entries(record).flatMap(([providerId, candidate]) => {
		const cacheRecord = asRecord(candidate);
		const data = normalizeUsageData(cacheRecord?.data);
		const fetchedAt = finiteNumber(cacheRecord?.fetchedAt);
		return data && fetchedAt !== undefined && fetchedAt >= 0
			? [[providerId, { data, fetchedAt }] as const]
			: [];
	});
	return Object.fromEntries(entries);
}

/**
 * Best-effort shared usage cache. One instance owns one path and its write queue.
 * Reads validate disk data and retain the last valid snapshot on read failure.
 * Writes serialize read/merge/replace within this instance; separate processes
 * can still race (this is not a cross-process lock). Write failures are logged
 * and never prevent later updates. Callers must treat read snapshots as read-only.
 */
export function createUsageCache(cachePath: string) {
	let snapshot: UsageCache = {};
	let writeQueue: Promise<void> = Promise.resolve();

	async function read(): Promise<UsageCache> {
		try {
			const raw = await fs.promises.readFile(cachePath, "utf8");
			snapshot = normalizeCache(JSON.parse(raw) as unknown);
		} catch {
			// Keep the last valid snapshot during a partial read or file collision.
		}
		return snapshot;
	}

	async function persist(cache: UsageCache): Promise<void> {
		await fs.promises.mkdir(path.dirname(cachePath), { recursive: true });
		const contents = JSON.stringify(cache, null, 2);
		const tmp = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
		try {
			await fs.promises.writeFile(tmp, contents, "utf8");
			try {
				await fs.promises.rename(tmp, cachePath);
			} catch {
				// Windows cannot always replace an existing file with rename().
				await fs.promises.writeFile(cachePath, contents, "utf8");
			}
		} finally {
			await fs.promises.unlink(tmp).catch(() => undefined);
		}
	}

	async function write(providerId: string, data: UsageData): Promise<void> {
		const previous = writeQueue;
		const operation = (async () => {
			await previous;
			const existing = await read();
			existing[providerId] = {
				data: normalizeUsageData(data) ?? data,
				fetchedAt: Date.now(),
			};
			await persist(existing);
			snapshot = existing;
		})();
		// Recover the queue separately from reporting this operation's failure.
		writeQueue = operation.then(
			() => undefined,
			() => undefined,
		);
		try {
			await operation;
		} catch (error) {
			console.error("[subscription-usage] failed to write disk cache:", error);
		}
	}

	return { read, write };
}
