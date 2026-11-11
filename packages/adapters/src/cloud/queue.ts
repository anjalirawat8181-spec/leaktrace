import type { Queue, QueueMessage, QueueName } from '../interfaces';
import type { ActivityGate } from './activity';


export class GatedQueue implements Queue {
  private waiters: Array<() => void> = [];

  constructor(private readonly inner: Queue, private readonly gate: ActivityGate) {}

  async send(queue: QueueName, body: unknown): Promise<void> {
    this.gate.touch();
    await this.inner.send(queue, body);
    const waiting = this.waiters;
    this.waiters = [];
    for (const wake of waiting) wake();
  }

  async receive<T = any>(queue: QueueName, opts: { max?: number; waitSec?: number } = {}): Promise<QueueMessage<T>[]> {
    if (this.gate.isActive()) return this.inner.receive<T>(queue, opts);
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, Math.min(opts.waitSec ?? 5, 5) * 1000);
      this.waiters.push(() => { clearTimeout(timer); resolve(); });
    });
    return [];
  }

  delete(queue: QueueName, receiptHandle: string): Promise<void> {
    return this.inner.delete(queue, receiptHandle);
  }

  depth(queue: QueueName): Promise<number> {
    return this.inner.depth(queue);
  }
}


