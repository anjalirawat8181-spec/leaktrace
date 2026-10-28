export type ExamStatus = 'DRAFT' | 'GENERATING' | 'READY' | 'SCHEDULED' | 'RELEASED' | 'CLOSED';

export interface StepInfo {
  key: 'template' | 'generate' | 'schedule' | 'released' | 'closed';
  label: string;
  path: (examId: string) => string;
}

export const STEPS: StepInfo[] = [
  { key: 'template', label: 'Template', path: (id) => `/exams/${id}` },
  { key: 'generate', label: 'Generate', path: (id) => `/exams/${id}/generation` },
  { key: 'schedule', label: 'Schedule', path: (id) => `/exams/${id}/schedule` },
  { key: 'released', label: 'Released', path: (id) => `/exams/${id}/schedule` },
  { key: 'closed', label: 'Closed', path: (id) => `/exams/${id}/schedule` },
];

export interface ExamLike {
  id: string;
  status: ExamStatus;
  hasTemplate?: boolean;
}

/** Index (0-4) of the step the exam is on right now. Earlier steps are done. */
export function currentStep(exam: Pick<ExamLike, 'status' | 'hasTemplate'>): number {
  switch (exam.status) {
    case 'DRAFT': return exam.hasTemplate ? 1 : 0;
    case 'GENERATING': return 1;
    case 'READY': return 2;
    case 'SCHEDULED':
    case 'RELEASED': return 3;
    case 'CLOSED': return 4;
  }
}

export const STATUS_WORDS: Record<ExamStatus, string> = {
  DRAFT: 'Draft',
  GENERATING: 'Generating copies',
  READY: 'Ready to schedule',
  SCHEDULED: 'Scheduled',
  RELEASED: 'Released',
  CLOSED: 'Closed',
};

/** One short sentence saying where the exam stands. */
export function stepSummary(exam: Pick<ExamLike, 'status' | 'hasTemplate'>): string {
  switch (exam.status) {
    case 'DRAFT': return exam.hasTemplate ? 'The paper is saved. Next: generate the copies.' : 'Write the paper first.';
    case 'GENERATING': return 'Making one PDF for every seat. This takes a minute or two.';
    case 'READY': return 'All copies are made. Next: choose when centres can download them.';
    case 'SCHEDULED': return 'Release is scheduled. Papers unlock by themselves.';
    case 'RELEASED': return 'Centres can download their papers right now.';
    case 'CLOSED': return 'Downloads are closed. You can still trace a leak.';
  }
}

export interface NextAction {
  label: string;
  to: string;
}

/** The single obvious button for a controller. null means "edit the paper here" (handled by the editor itself). */
export function nextAction(exam: ExamLike): NextAction | null {
  switch (exam.status) {
    case 'DRAFT': return exam.hasTemplate ? { label: 'Generate copies', to: `/exams/${exam.id}/generation` } : null;
    case 'GENERATING': return { label: 'Watch progress', to: `/exams/${exam.id}/generation` };
    case 'READY': return { label: 'Schedule release', to: `/exams/${exam.id}/schedule` };
    case 'SCHEDULED': return { label: 'Change schedule', to: `/exams/${exam.id}/schedule` };
    case 'RELEASED':
    case 'CLOSED': return { label: 'Trace a leak', to: '/trace' };
  }
}
