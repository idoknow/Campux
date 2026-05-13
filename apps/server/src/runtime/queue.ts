import type { FastifyBaseLogger } from "fastify";

export type RuntimeJobName =
  | "notifyNewPost"
  | "notifyPostCancelled"
  | "notifyReviewResult"
  | "publishPost";

export type RuntimeJob = {
  id: string;
  name: RuntimeJobName;
  tenantId: string;
  payload: Record<string, unknown>;
  runAt: Date;
};

export type RuntimeQueue = {
  start(): Promise<void>;
  stop(): Promise<void>;
  enqueue(job: Omit<RuntimeJob, "id">): RuntimeJob;
  registerHandler(name: RuntimeJobName, handler: (job: RuntimeJob) => Promise<void>): void;
  snapshot(): {
    running: boolean;
    queued: number;
    processing: number;
    failed: number;
    lastError: string | null;
  };
};

type RuntimeQueueOptions = {
  logger: FastifyBaseLogger;
};

export function createRuntimeQueue(options: RuntimeQueueOptions): RuntimeQueue {
  const jobs: RuntimeJob[] = [];
  const handlers = new Map<RuntimeJobName, (job: RuntimeJob) => Promise<void>>();
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
    const now = Date.now();
    const ready = jobs
      .filter((job) => job.runAt.getTime() <= now)
      .sort((left, right) => left.runAt.getTime() - right.runAt.getTime());

    try {
      for (const job of ready) {
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
          continue;
        }

        processing += 1;
        try {
          await handler(job);
        } catch (error) {
          failed += 1;
          lastError = error instanceof Error ? error.message : "runtime job failed";
          options.logger.error({ error, jobId: job.id, jobName: job.name }, "runtime job handler failed");
        } finally {
          processing -= 1;
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
      }, 1_000);

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

    registerHandler(name, handler) {
      handlers.set(name, handler);
    },

    snapshot() {
      return {
        running,
        queued: jobs.length,
        processing,
        failed,
        lastError,
      };
    },
  };
}
