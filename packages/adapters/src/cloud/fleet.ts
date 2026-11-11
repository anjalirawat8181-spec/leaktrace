import type { WorkerFleet } from '../interfaces';

export class InProcessFleet implements WorkerFleet {
  private running = false;

  setRunning(value: boolean): void {
    this.running = value;
  }

  async status() {
    return { desired: 1, inService: this.running ? 1 : 0 };
  }
}
