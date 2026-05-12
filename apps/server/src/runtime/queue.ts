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
  snapshot(): {
    running: boolean;
    queued: number;
  };
};

type RuntimeQueueOptions = {
  logger: FastifyBaseLogger;
};

export function createRuntimeQueue(options: RuntimeQueueOptions): RuntimeQueue {
  const jobs: RuntimeJob[] = [];
  let running = false;
  let timer: Timer | undefined;

  const tick = async () => {
    const now = Date.now();
    const ready = jobs
      .filter((job) => job.runAt.getTime() <= now)
      .sort((left, right) => left.runAt.getTime() - right.runAt.getTime());

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

    snapshot() {
      return {
        running,
        queued: jobs.length,
      };
    },
  };
}
