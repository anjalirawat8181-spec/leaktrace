import type { ActivityGate } from '@leaktrace/adapters';

let gate: ActivityGate | undefined;

export function setActivityGate(value: ActivityGate | undefined): void {
  gate = value;
}

export function touchActivity(): void {
  gate?.touch();
}
