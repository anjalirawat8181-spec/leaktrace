import { AutoScalingClient, DescribeAutoScalingGroupsCommand } from '@aws-sdk/client-auto-scaling';
import type { WorkerFleet } from '../interfaces';

export class AsgWorkerFleet implements WorkerFleet {
  private readonly client: AutoScalingClient;

  constructor(region: string, private readonly asgName: string) {
    this.client = new AutoScalingClient({ region });
  }

  async status(): Promise<{ desired: number; inService: number }> {
    const res = await this.client.send(new DescribeAutoScalingGroupsCommand({ AutoScalingGroupNames: [this.asgName] }));
    const group = res.AutoScalingGroups?.[0];
    const inService = (group?.Instances ?? []).filter((i) => i.LifecycleState === 'InService').length;
    return { desired: group?.DesiredCapacity ?? 0, inService };
  }
}
