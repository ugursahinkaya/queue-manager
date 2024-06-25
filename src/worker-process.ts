import { WorkerQueue, WorkerPayload, WorkerResolve, WorkerReject } from './worker-manager';
export type ProcessResolve = (payload: WorkerPayload) => void;
export type ProcessReject = (err: string, payload: WorkerPayload) => void;
export type ProcessPayload = {
  name: string;
  message: unknown;
  sender: string;
  priority?: number;
  timeout?: number;
};
export class Process {
  requestId: string;
  timeout: number;
  priority: number;
  error?: string;
  constructor(
    private queue: WorkerQueue,
    public name: string,
    public key: string,
    public payload: ProcessPayload,
    public resolve: WorkerResolve,
    public reject: WorkerReject,
    priority?: number,
    requestId?: string,
    timeout?: number
  ) {
    this.timeout = timeout ?? 1000;
    this.priority = priority ?? 0;
    this.requestId = requestId ?? self.crypto.randomUUID();
  }
  start() {
    const promiseId = self.crypto.randomUUID();
    new Promise<WorkerPayload>((resolve, reject) => {
      const interval = setTimeout(() => {
        this.kill('timeout');
        clearInterval(interval);
      }, this.timeout);

      this.queue.addProcess({
        process: this,
        resolve,
        reject
      });
    })
      .then((response) => {
        this.queue.resolveRequest(this.requestId, response);
      })
      .catch((error) => {
        this.error = error;
      })
      .finally(() => {
        this.kill();
      });
    this.queue.postMessage({
      process: this.name,
      message: this.payload.message,
      promiseId
    });
  }

  kill(reason?: string) {
    this.queue.removeProcess(this.key);
    if (reason) {
      this.queue.rejectRequest(this.requestId, reason, this.payload);
    }
    this.queue.removeRequest(this.requestId);
  }
}
