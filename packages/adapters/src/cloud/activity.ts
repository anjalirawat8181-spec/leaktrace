export class ActivityGate {
  private last = Date.now();

  constructor(private readonly idleMs = 10 * 60_000) {}

  touch(): void {
    this.last = Date.now();
  }

  isActive(): boolean {
    return Date.now() - this.last < this.idleMs;
  }
}
