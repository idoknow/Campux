import type { FastifyBaseLogger } from "fastify";

export type RuntimeJobName =
  | "notifyNewPost"
  | "notifyPostCancelled"
  | "notifyReviewResult"
  | "publishPost"
  | "refreshQZonePostMetric";

export type RuntimeJob = {
  id: string;
  name: RuntimeJobName;
  tenantId: string;
  payload: Record<string, unknown>;
  runAt: Date;
  dedupeKey?: string;
};

export type RuntimeQueue = {
  start(): Promise<void>;
  stop(): Promise<void>;
  enqueue(job: Omit<RuntimeJob, "id" | "dedupeKey">): RuntimeJob;
  enqueueUnique(job: Omit<RuntimeJob, "id" | "dedupeKey">, dedupeKey: string): RuntimeJob | null;
  rescheduleCurrent(job: RuntimeJob, runAt: Date): void;
  registerHandler(name: RuntimeJobName, handler: (job: RuntimeJob) => Promise<void>): void;
  snapshot(): {
    running: boolean;
    queued: number;
    ready: number;
    processing: number;
    queuedByName: Partial<Record<RuntimeJobName, number>>;
    processingByName: Partial<Record<RuntimeJobName, number>>;
    failed: number;
    lastError: string | null;
  };
};

type RuntimeQueueOptions = {
  logger: FastifyBaseLogger;
  tickIntervalMs?: number;
  maxConsecutivePriorityJobs?: number;
};

const runtimeJobPriorities: Record<RuntimeJobName, number> = {
  publishPost: 0,
  notifyNewPost: 1,
  notifyPostCancelled: 1,
  notifyReviewResult: 1,
  refreshQZonePostMetric: 2,
};

export function compareRuntimeJobs(left: RuntimeJob, right: RuntimeJob) {
  return runtimeJobPriorities[left.name] - runtimeJobPriorities[right.name]
    || left.runAt.getTime() - right.runAt.getTime();
}

export function createRuntimeQueue(options: RuntimeQueueOptions): RuntimeQueue {
  const jobs: RuntimeJob[] = [];
  const dedupeKeys = new Set<string>();
  const handlers = new Map<RuntimeJobName, (job: RuntimeJob) => Promise<void>>();
  const processingByName = new Map<RuntimeJobName, number>();
  const rescheduledJobIds = new Set<string>();
  const maxConsecutivePriorityJobs = options.maxConsecutivePriorityJobs ?? 20;
  let consecutiveBestPriority = -1;
  let consecutiveBestPriorityCount = 0;
  let running = false;
  let ticking = false;
  let processing = 0;
  let failed = 0;
  let lastError: string | null = null;
  let timer: Timer | undefined;

  const tick = async () => {
    if (ticking) {
      return;
    }

    ticking = true;
    try {
      while (true) {
        // Recompute after every handler so a newly queued publish can preempt a
        // backlog of lower-priority metric jobs. After a bounded burst, select
        // the oldest ready lower-priority job so notifications/metrics cannot
        // starve forever under sustained publishing load.
        const readyJobs = jobs
          .filter((candidate) => candidate.runAt.getTime() <= Date.now())
          .sort(compareRuntimeJobs);
        const bestJob = readyJobs[0];
        const bestPriority = bestJob ? runtimeJobPriorities[bestJob.name] : -1;
        const lowerPriorityJob = consecutiveBestPriority === bestPriority
          && consecutiveBestPriorityCount >= maxConsecutivePriorityJobs
          ? readyJobs
              .filter((candidate) => runtimeJobPriorities[candidate.name] > bestPriority)
              .sort((left, right) => left.runAt.getTime() - right.runAt.getTime())[0]
          : undefined;
        const job = lowerPriorityJob ?? bestJob;
        if (!job) {
          break;
        }

        if (job === bestJob) {
          if (consecutiveBestPriority === bestPriority) {
            consecutiveBestPriorityCount += 1;
          } else {
            consecutiveBestPriority = bestPriority;
            consecutiveBestPriorityCount = 1;
          }
        } else {
          consecutiveBestPriority = -1;
          consecutiveBestPriorityCount = 0;
        }

        const index = jobs.findIndex((candidate) => candidate.id === job.id);
        if (index >= 0) {
          jobs.splice(index, 1);
        }

        options.logger.info(
          {
            jobId: job.id,
            jobName: job.name,
            tenantId: job.tenantId,
          },
          "runtime job dispatched",
        );

        const handler = handlers.get(job.name);
        if (!handler) {
          if (job.dedupeKey) {
            dedupeKeys.delete(job.dedupeKey);
          }
          continue;
        }

        processing += 1;
        processingByName.set(job.name, (processingByName.get(job.name) ?? 0) + 1);
        try {
          await handler(job);
        } catch (error) {
          failed += 1;
          lastError = error instanceof Error ? error.message : "runtime job failed";
          options.logger.error({ error, jobId: job.id, jobName: job.name }, "runtime job handler failed");
        } finally {
          processing -= 1;
          const remaining = (processingByName.get(job.name) ?? 1) - 1;
          if (remaining > 0) {
            processingByName.set(job.name, remaining);
          } else {
            processingByName.delete(job.name);
          }
          const rescheduled = rescheduledJobIds.delete(job.id);
          if (job.dedupeKey && !rescheduled) {
            dedupeKeys.delete(job.dedupeKey);
          }
        }
      }
    } finally {
      ticking = false;
    }
  };

  return {
    async start() {
      if (running) {
        return;
      }

      running = true;
      timer = setInterval(() => {
        tick().catch((error) => {
          options.logger.error({ error }, "runtime queue tick failed");
        });
      }, options.tickIntervalMs ?? 1_000);

      options.logger.info("runtime queue started");
    },

    async stop() {
      if (timer) {
        clearInterval(timer);
      }

      running = false;
      options.logger.info("runtime queue stopped");
    },

    enqueue(job) {
      const queuedJob: RuntimeJob = {
        ...job,
        id: crypto.randomUUID(),
      };

      jobs.push(queuedJob);
      return queuedJob;
    },

    enqueueUnique(job, dedupeKey) {
      if (dedupeKeys.has(dedupeKey)) {
        return null;
      }
      const queuedJob: RuntimeJob = {
        ...job,
        id: crypto.randomUUID(),
        dedupeKey,
      };
      dedupeKeys.add(dedupeKey);
      jobs.push(queuedJob);
      return queuedJob;
    },

    rescheduleCurrent(job, runAt) {
      job.runAt = runAt;
      if (!rescheduledJobIds.has(job.id)) {
        jobs.push(job);
        rescheduledJobIds.add(job.id);
      }
    },

    registerHandler(name, handler) {
      handlers.set(name, handler);
    },

    snapshot() {
      const now = Date.now();
      const queuedByName: Partial<Record<RuntimeJobName, number>> = {};
      let ready = 0;
      for (const job of jobs) {
        queuedByName[job.name] = (queuedByName[job.name] ?? 0) + 1;
        if (job.runAt.getTime() <= now) {
          ready += 1;
        }
      }
      return {
        running,
        queued: jobs.length,
        ready,
        processing,
        queuedByName,
        processingByName: Object.fromEntries(processingByName),
        failed,
        lastError,
      };
    },
  };
}
