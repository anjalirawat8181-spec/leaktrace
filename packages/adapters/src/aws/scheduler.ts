import {
  ConflictException, CreateScheduleCommand, CreateScheduleGroupCommand, DeleteScheduleCommand,
  ResourceNotFoundException, SchedulerClient, UpdateScheduleCommand,
} from '@aws-sdk/client-scheduler';
import type { Scheduler } from '../interfaces';

export class EventBridgeScheduler implements Scheduler {
  private readonly client: SchedulerClient;
  private groupReady = false;

  constructor(
    region: string,
    private readonly groupName: string,
    private readonly targetArn: string,
    private readonly roleArn: string,
  ) {
    this.client = new SchedulerClient({ region });
  }

  private async ensureGroup(): Promise<void> {
    if (this.groupReady) return;
    try {
      await this.client.send(new CreateScheduleGroupCommand({ Name: this.groupName }));
    } catch (err) {
      if (!(err instanceof ConflictException)) throw err;
    }
    this.groupReady = true;
  }

  async scheduleOnce(name: string, atLocalISO: string, timezone: string, payload: unknown): Promise<void> {
    await this.ensureGroup();
    const fields = {
      Name: name,
      GroupName: this.groupName,
      ScheduleExpression: `at(${atLocalISO.slice(0, 19)})`,
      ScheduleExpressionTimezone: timezone,
      FlexibleTimeWindow: { Mode: 'OFF' as const },
      ActionAfterCompletion: 'DELETE' as const,
      Target: { Arn: this.targetArn, RoleArn: this.roleArn, Input: JSON.stringify(payload) },
    };
    try {
      await this.client.send(new CreateScheduleCommand(fields));
    } catch (err) {
      if (!(err instanceof ConflictException)) throw err;
      await this.client.send(new UpdateScheduleCommand(fields));
    }
  }

  async cancel(name: string): Promise<void> {
    try {
      await this.client.send(new DeleteScheduleCommand({ Name: name, GroupName: this.groupName }));
    } catch (err) {
      if (!(err instanceof ResourceNotFoundException)) throw err;
    }
  }
}
