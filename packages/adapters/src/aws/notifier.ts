import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import type { Notifier, NotifyTopic } from '../interfaces';

export class SnsNotifier implements Notifier {
  private readonly client: SNSClient;

  constructor(region: string, private readonly topicArns: Record<NotifyTopic, string | undefined>) {
    this.client = new SNSClient({ region });
  }

  async publish(topic: NotifyTopic, subject: string, body: string): Promise<void> {
    const arn = this.topicArns[topic];
    if (!arn) throw new Error(`No SNS topic ARN configured for "${topic}"`);
    await this.client.send(new PublishCommand({ TopicArn: arn, Subject: subject.slice(0, 100), Message: body }));
  }
}
