import { describe, expect, it } from "bun:test";
import type { FastifyBaseLogger } from "fastify";
import { compareRuntimeJobs, createRuntimeQueue, type RuntimeJob } from "./queue";

const logger = {
  info() {},
  error() {},
} as unknown as FastifyBaseLogger;

function job(name: RuntimeJob["name"], runAt = new Date()) {
  return {
    name,
    tenantId: "tenant-1",
    payload: {},
    runAt,
  };
}

async function waitUntil(predicate: () => boolean, timeoutMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await Bun.sleep(5);
  }
  expect(predicate()).toBe(true);
}

describe("RuntimeQueue", () => {
  it("deduplicates queued jobs and reports queue composition", () => {
    const queue = createRuntimeQueue({ logger });
    const first = queue.enqueueUnique(job("refreshQZonePostMetric"), "metric:attempt-1");
    const duplicate = queue.enqueueUnique(job("refreshQZonePostMetric"), "metric:attempt-1");
    queue.enqueue(job("publishPost", new Date(Date.now() + 60_000)));

    expect(first).not.toBeNull();
    expect(duplicate).toBeNull();
    expect(queue.snapshot()).toMatchObject({
      queued: 2,
      ready: 1,
      queuedByName: {
        refreshQZonePostMetric: 1,
        publishPost: 1,
      },
    });
  });

  it("prioritizes publishing over metric jobs with the same due time", () => {
    const now = new Date();
    const publish = { ...job("publishPost", now), id: "publish" };
    const metric = { ...job("refreshQZonePostMetric", now), id: "metric" };
    expect([metric, publish].sort(compareRuntimeJobs).map((item) => item.name)).toEqual([
      "publishPost",
      "refreshQZonePostMetric",
    ]);
  });

  it("recomputes priority after each handler and releases dedupe keys after completion", async () => {
    const events: string[] = [];
    const queue = createRuntimeQueue({ logger, tickIntervalMs: 5 });
    queue.registerHandler("refreshQZonePostMetric", async () => {
      events.push("metric");
      if (events.length === 1) {
        queue.enqueue(job("publishPost"));
      }
    });
    queue.registerHandler("publishPost", async () => {
      events.push("publish");
    });

    queue.enqueueUnique(job("refreshQZonePostMetric"), "metric:attempt-1");
    queue.enqueueUnique(job("refreshQZonePostMetric"), "metric:attempt-2");
    await queue.start();
    try {
      await waitUntil(() => events.length === 3);
      expect(events).toEqual(["metric", "publish", "metric"]);
      expect(queue.enqueueUnique(job("refreshQZonePostMetric"), "metric:attempt-1")).not.toBeNull();
    } finally {
      await queue.stop();
    }
  });

  it("bounds strict-priority bursts so older lower-priority work cannot starve", async () => {
    const events: string[] = [];
    const queue = createRuntimeQueue({ logger, tickIntervalMs: 5, maxConsecutivePriorityJobs: 2 });
    queue.registerHandler("publishPost", async () => { events.push("publish"); });
    queue.registerHandler("refreshQZonePostMetric", async () => { events.push("metric"); });
    queue.enqueue(job("publishPost"));
    queue.enqueue(job("publishPost"));
    queue.enqueue(job("publishPost"));
    queue.enqueue(job("refreshQZonePostMetric", new Date(Date.now() - 60_000)));

    await queue.start();
    try {
      await waitUntil(() => events.length === 4);
      expect(events).toEqual(["publish", "publish", "metric", "publish"]);
    } finally {
      await queue.stop();
    }
  });

  it("does not carry fairness debt across an idle queue", async () => {
    const events: string[] = [];
    const queue = createRuntimeQueue({ logger, tickIntervalMs: 5, maxConsecutivePriorityJobs: 2 });
    queue.registerHandler("publishPost", async () => { events.push("publish"); });
    queue.registerHandler("refreshQZonePostMetric", async () => { events.push("metric"); });

    queue.enqueue(job("publishPost"));
    queue.enqueue(job("publishPost"));
    await queue.start();
    try {
      await waitUntil(() => events.length === 2 && queue.snapshot().processing === 0);

      queue.enqueue(job("refreshQZonePostMetric", new Date(Date.now() - 60_000)));
      queue.enqueue(job("publishPost"));
      await waitUntil(() => events.length === 4);

      expect(events).toEqual(["publish", "publish", "publish", "metric"]);
    } finally {
      await queue.stop();
    }
  });

  it("can defer the running unique job without releasing its dedupe key", async () => {
    const events: string[] = [];
    const queue = createRuntimeQueue({ logger, tickIntervalMs: 5 });
    queue.registerHandler("refreshQZonePostMetric", async (current) => {
      events.push("dispatch");
      if (events.length === 1) {
        queue.rescheduleCurrent(current, new Date(Date.now() + 30));
      }
    });
    queue.enqueueUnique(job("refreshQZonePostMetric"), "metric:attempt-1");

    await queue.start();
    try {
      await waitUntil(() => events.length === 1);
      expect(queue.enqueueUnique(job("refreshQZonePostMetric"), "metric:attempt-1")).toBeNull();
      await waitUntil(() => events.length === 2);
      expect(queue.enqueueUnique(job("refreshQZonePostMetric"), "metric:attempt-1")).not.toBeNull();
    } finally {
      await queue.stop();
    }
  });
});
