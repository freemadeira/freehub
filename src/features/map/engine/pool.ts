import type { TileId } from "./geo.ts";
import type { BuiltTile, FromWorker, ToWorker } from "./protocol.ts";
import { hash } from "./random.ts";

interface Job {
  resolve: (tile: BuiltTile) => void;
  reject: (error: Error) => void;
}

/**
 * A few workers building tiles. Tiles drawing on the same data go to the same
 * worker, whose cache then already holds the data.
 */
export class WorkerPool {
  private readonly workers: Worker[];
  private readonly jobs = new Map<number, Job>();
  private next = 0;

  constructor(size: number, init: Extract<ToWorker, { type: "init" }>) {
    this.workers = Array.from({ length: size }, () => {
      const worker = new Worker(
        new URL("worker/tile-worker.ts", import.meta.url),
        { name: "map-tiles", type: "module" }
      );
      worker.addEventListener("message", (event: MessageEvent<FromWorker>) =>
        this.receive(event.data)
      );
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a worker, not a window
      worker.postMessage(init);
      return worker;
    });
  }

  private receive(message: FromWorker) {
    if (message.type === "ready") {
      return;
    }
    const job = this.jobs.get(message.job);
    if (!job) {
      return;
    }
    this.jobs.delete(message.job);
    if (message.type === "built") {
      job.resolve(message.tile);
    } else {
      job.reject(new Error(message.error));
    }
  }

  build(tile: TileId, affinity: TileId): Promise<BuiltTile> {
    this.next += 1;
    const job = this.next;
    const index = Math.floor(
      hash(affinity.z, affinity.x, affinity.y) * this.workers.length
    );
    const worker = this.workers[index] ?? this.workers[0];
    const { promise, resolve, reject } = Promise.withResolvers<BuiltTile>();
    this.jobs.set(job, { reject, resolve });
    const message: ToWorker = { job, tile, type: "build" };
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a worker, not a window
    worker?.postMessage(message);
    return promise;
  }

  dispose(): void {
    for (const worker of this.workers) {
      worker.terminate();
    }
    for (const job of this.jobs.values()) {
      job.reject(new Error("Map closed"));
    }
    this.jobs.clear();
  }
}
