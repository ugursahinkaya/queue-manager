import { Process, ProcessPayload, ProcessResolve, ProcessReject } from './worker-process';

export type WorkerPayload = ProcessPayload & { promiseId: string };
export type WorkerResolve = (payload: WorkerPayload) => void;
export type WorkerReject = (err: string, payload: ProcessPayload) => void;
type ProcessRecord = {
  resolve: ProcessResolve;
  reject: ProcessReject;
  process: Process;
};

export class WorkerQueue {
  private processList: ProcessRecord[] = [];
  private workerRequests = new Map<
    string,
    {
      resolve: WorkerResolve;
      reject: WorkerReject;
      process: Process;
    }
  >();
  constructor(
    private worker: Worker,
    public concurrentProcessCount: number
  ) {
    this.worker.addEventListener('message', (event: MessageEvent<WorkerPayload>) => {
      const payload = event.data;
      const { promiseId } = payload;
      const promise = this.workerRequests.get(promiseId);
      if (promise) {
        promise.resolve(payload);
        promise.process.kill();
      }
    });
  }
  checkQueue() {
    if (this.workerRequests.size < this.concurrentProcessCount && this.processList.length > 0) {
      this.processList.map((processRecord) => {
        processRecord.process.start();
      });
    }
  }
  resolveRequest(requestId: string, response: WorkerPayload) {
    const request = this.workerRequests.get(requestId);
    if (request) {
      request.resolve(response);
    }
  }
  rejectRequest(requestId: string, reason: string, payload: ProcessPayload) {
    const request = this.workerRequests.get(requestId);
    if (request) {
      request.reject(reason, payload);
    }
  }
  addProcess(process: {
    process: Process;
    resolve: (value: WorkerPayload | PromiseLike<WorkerPayload>) => void;
    reject: (reason?: unknown) => void;
  }) {
    this.processList.push(process);
  }
  removeProcess(key: string) {
    const index = this.findQueueRecordIndex(key);
    if (index > -1) this.processList.splice(index, 1);
  }
  removeRequest(requestId: string) {
    this.workerRequests.delete(requestId);
    this.checkQueue();
  }
  sortQueueByPriority() {
    return this.processList.sort((a, b) => a.process.priority - b.process.priority);
  }
  findQueueRecordIndex(key: string) {
    return this.processList.findIndex((p) => p.process.key === key);
  }
  getQueueRecord(key: string) {
    return this.processList.find((p) => p.process.key === key);
  }
  generateUniqueKey(payload: ProcessPayload) {
    let key: string;
    switch (payload.name) {
      case 'randomGenerate':
        const { posX, posZ } = payload.message as {
          posX: string;
          posZ: string;
        };
        key = `${posX}:${posZ}`;
        break;
      default:
        key = payload.sender;
        break;
    }
    return key;
  }
  postMessage(payload: { process: string; message: unknown; promiseId: string }) {
    this.worker.postMessage(payload);
  }
  call(payload: ProcessPayload) {
    let requestId: string | undefined = undefined;
    const { name, priority, timeout } = payload;
    const key = this.generateUniqueKey(payload);
    const oldProcess = this.getQueueRecord(key)?.process;
    if (oldProcess) {
      requestId = oldProcess.requestId;
      oldProcess.kill();
    }
    const result = new Promise((resolve, reject) => {
      const process = new Process(
        this,
        name,
        key,
        payload,
        resolve,
        reject,
        priority,
        requestId,
        timeout
      );
      this.workerRequests.set(process.requestId, {
        resolve,
        reject,
        process
      });
    });
    this.sortQueueByPriority();
    this.checkQueue();
    return result;
  }
}
