export const EXAM_TIMEZONE = 'Asia/Kolkata';

let clock: () => Date = () => new Date();

/** The single source of "now" for window checks; tests can replace it. */
export const now = (): Date => clock();
export function setClock(fn: (() => Date) | null): void {
  clock = fn ?? (() => new Date());
}

/** Wall-clock ISO ("2026-10-19T09:15:00") of an instant in the given timezone. */
export function wallClockIso(date: Date, timeZone = EXAM_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const p = (type: string) => parts.find((x) => x.type === type)!.value;
  return `${p('year')}-${p('month')}-${p('day')}T${p('hour')}:${p('minute')}:${p('second')}`;
}

export type WindowState = 'BEFORE' | 'OPEN' | 'CLOSED';

export interface ExamWindow {
  opensAt: Date;
  closesAt: Date;
  state: WindowState;
}

export function examWindow(
  exam: { starts_at: Date | string; release_lead_min: number; close_after_min: number },
  at: Date = now(),
): ExamWindow {
  const start = new Date(exam.starts_at).getTime();
  const opensAt = new Date(start - exam.release_lead_min * 60_000);
  const closesAt = new Date(start + exam.close_after_min * 60_000);
  const state: WindowState = at < opensAt ? 'BEFORE' : at > closesAt ? 'CLOSED' : 'OPEN';
  return { opensAt, closesAt, state };
}

export const releaseScheduleName = (examId: string) => `leaktrace-release-${examId}`;
export const closeScheduleName = (examId: string) => `leaktrace-close-${examId}`;
