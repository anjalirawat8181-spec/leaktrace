import type { MetricName, Metrics } from '../interfaces';

export class LoggingMetrics implements Metrics {
  constructor(private readonly log: (o: object) => void = (o) => console.log(JSON.stringify(o))) {}

  count(name: MetricName, value = 1): void {
    this.log({ event: 'METRIC', name, value });
  }
}
