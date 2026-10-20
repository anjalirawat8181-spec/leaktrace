import {
  DeleteMessageCommand, GetQueueAttributesCommand, ReceiveMessageCommand, SendMessageCommand, SQSClient,
} from '@aws-sdk/client-sqs';
import type { Queue, QueueMessage, QueueName } from '../interfaces';

export class SqsQueue implements Queue {
  private readonly client: SQSClient;

  constructor(region: string, private readonly urls: Record<string, string>) {
    this.client = new SQSClient({ region });
  }

  private urlFor(queue: QueueName): string | undefined {
    return this.urls[queue as string];
  }

  async send(queue: QueueName, body: unknown): Promise<void> {
    const url = this.urlFor(queue);
    if (!url) throw new Error(`No SQS queue URL configured for "${queue}"`);
    await this.client.send(new SendMessageCommand({ QueueUrl: url, MessageBody: JSON.stringify(body) }));
  }

  async receive<T = any>(queue: QueueName, opts: { max?: number; waitSec?: number } = {}): Promise<QueueMessage<T>[]> {
    const url = this.urlFor(queue);
    if (!url) throw new Error(`No SQS queue URL configured for "${queue}"`);
    const res = await this.client.send(new ReceiveMessageCommand({
      QueueUrl: url,
      MaxNumberOfMessages: Math.min(Math.max(opts.max ?? 1, 1), 10),
      WaitTimeSeconds: Math.min(Math.max(opts.waitSec ?? 0, 0), 20),
      MessageSystemAttributeNames: ['ApproximateReceiveCount'],
    }));
    return (res.Messages ?? []).map((m) => ({
      id: m.MessageId ?? '',
      body: JSON.parse(m.Body ?? 'null') as T,
      receiptHandle: m.ReceiptHandle ?? '',
      receiveCount: Number(m.Attributes?.ApproximateReceiveCount ?? 1),
    }));
  }

  async delete(queue: QueueName, receiptHandle: string): Promise<void> {
    const url = this.urlFor(queue);
    if (!url) return;
    await this.client.send(new DeleteMessageCommand({ QueueUrl: url, ReceiptHandle: receiptHandle }));
  }

  async depth(queue: QueueName): Promise<number> {
    const url = this.urlFor(queue);
    if (!url) return 0;
    const res = await this.client.send(new GetQueueAttributesCommand({
      QueueUrl: url, AttributeNames: ['ApproximateNumberOfMessages'],
    }));
    return Number(res.Attributes?.ApproximateNumberOfMessages ?? 0);
  }
}
