import { z } from 'zod';

export const ROLES = ['CONTROLLER', 'SUPERINTENDENT', 'AUDITOR'] as const;
export type Role = (typeof ROLES)[number];

export const EXAM_STATUSES = [
  'DRAFT', 'GENERATING', 'READY', 'SCHEDULED', 'RELEASED', 'CLOSED',
] as const;
export type ExamStatus = (typeof EXAM_STATUSES)[number];

export const loginSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
});

export const centreSchema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(120),
  city: z.string().min(1).max(120),
});

export const roomSchema = z.object({
  name: z.string().min(1).max(60),
  seats: z.number().int().min(1).max(20),
  invigilatorName: z.string().min(1).max(120),
});

export const examSchema = z.object({
  title: z.string().min(1).max(200),
  subject: z.string().min(1).max(120),
  startsAt: z.string().datetime({ offset: true }),
  durationMin: z.number().int().min(1).max(600),
  releaseLeadMin: z.number().int().min(0).max(240).default(15),
  closeAfterMin: z.number().int().min(0).max(240).default(30),
});

export const templateSchema = z.object({
  source: z.string().min(1).max(100_000),
});

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  centreId: string | null;
}
