export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: any) {
    super(message);
  }
}

export async function api<T = any>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...rest,
    headers: json === undefined ? rest.headers : { 'Content-Type': 'application/json', ...rest.headers },
    body: json === undefined ? rest.body : JSON.stringify(json),
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? res.statusText, body);
  return body as T;
}

export type Role = 'CONTROLLER' | 'SUPERINTENDENT' | 'AUDITOR';
export interface User { id: string; email: string; name: string; role: Role; centreId: string | null }

export interface Exam {
  id: string; title: string; subject: string; startsAt: string; durationMin: number;
  releaseLeadMin: number; closeAfterMin: number;
  status: 'DRAFT' | 'GENERATING' | 'READY' | 'SCHEDULED' | 'RELEASED' | 'CLOSED';
}

export interface Point {
  id: string; idx: number; kind: string; alternatives: string[]; items?: string[];
}

export interface CapacityInfo {
  points: Point[];
  capacityBits: number; requiredBits: number; totalCopies: number;
  plannedCopies: number; maxCopies: number; sufficient: boolean;
}

export interface ExamDetail extends Exam {
  totalCopies: number; maxCopies: number;
  template: ({ source: string; version: number } & CapacityInfo) | null;
}

export interface Room { id: string; name: string; seats: number; invigilatorName: string }
export interface Centre { id: string; code: string; name: string; city: string; rooms: Room[] }
