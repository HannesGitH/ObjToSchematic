import { EAppEvent, EventManager } from './event';
import { ASSERT } from './util/error_util';
import { LOG, TIME_END, TIME_START } from './util/log_util';
import { TFromWorkerMessage, TToWorkerMessage } from './worker_types';

export type TWorkerJob = {
    id: string,
    payload: TToWorkerMessage,
    callback?: (payload: TFromWorkerMessage) => void, // Called with the payload of the next message received by the worker
}

export class WorkerController {
    private _worker: Worker;
    private _jobQueue: TWorkerJob[];
    private _jobPending: TWorkerJob | undefined;

    public constructor(scriptURL: string, options?: WorkerOptions) {
        this._worker = new Worker(scriptURL, options);
        this._worker.onmessage = this._onWorkerMessage.bind(this);

        this._jobQueue = [];
    }

    public addJob(newJob: TWorkerJob): boolean {
        const isJobAlreadyQueued = this._jobQueue.some((queuedJob) => { return queuedJob.id === newJob.id; });
        if (isJobAlreadyQueued) {
            LOG('[WorkerController]: Job already queued with ID', newJob.id);
            return false;
        }

        this._jobQueue.push(newJob);
        this._tryStartNextJob();

        return true;
    }

    public isBusy() {
        return this._jobPending !== undefined;
    }

    private _onWorkerMessage(payload: MessageEvent<TFromWorkerMessage>) {
        ASSERT(this._jobPending !== undefined, `Received worker message when no job is pending`);

        if (payload.data.action === 'Progress') {
            switch (payload.data.payload.type) {
                case 'Started':
                    EventManager.Get.broadcast(EAppEvent.onTaskStart, payload.data.payload.taskId);
                    break;
                case 'Progress':
                    EventManager.Get.broadcast(EAppEvent.onTaskProgress, payload.data.payload.taskId, payload.data.payload.percentage);
                    break;
                case 'Finished':
                    EventManager.Get.broadcast(EAppEvent.onTaskEnd, payload.data.payload.taskId);
                    break;
            }
            return;
        }

        TIME_END(this._jobPending.id);
        LOG(`[WorkerController]: Job '${this._jobPending.id}' finished:`);

        if (this._jobPending.callback) {
            this._jobPending.callback(payload.data);
        }
        this._jobPending = undefined;

        this._tryStartNextJob();
    }

    private _tryStartNextJob() {
        if (this.isBusy()) {
            return;
        }

        this._jobPending = this._jobQueue.shift();
        if (this._jobPending === undefined) {
            return;
        }

        LOG('[WorkerController]: Starting Job', this._jobPending.id, `(${this._jobQueue.length} remaining)`);
        TIME_START(this._jobPending.id);
        this._worker.postMessage(this._jobPending.payload);
    }
}
