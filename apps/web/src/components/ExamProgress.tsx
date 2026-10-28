import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Card, Icon, LinkButton, cx } from './ui';
import { STEPS, currentStep, nextAction, stepSummary, type ExamLike } from '../lib/steps';

export function StepTrack({ exam, links }: { exam: ExamLike; links?: boolean }) {
  const current = currentStep(exam);
  return (
    <ol aria-label="Exam steps" className="flex items-start">
      {STEPS.map((step, i) => {
        const done = i < current;
        const active = i === current;
        const dot = (
          <span className={cx(
            'grid size-9 place-items-center rounded-full border-2 text-sm font-semibold transition-colors duration-base',
            done ? 'border-ok bg-ok text-on-accent' : active ? 'border-ok bg-ok-tint text-ok ring-4 ring-ok/20' : 'border-line-strong text-fg-muted',
          )}>
            {done ? <Icon name="check" size={18} /> : i + 1}
          </span>
        );
        const label = (
          <span className={cx('mt-2 block text-center text-xs sm:text-sm', active ? 'font-semibold text-fg' : 'text-fg-muted')}>
            {step.label}
          </span>
        );
        return (
          <li key={step.key} aria-current={active ? 'step' : undefined} className="relative flex min-w-0 flex-1 flex-col items-center">
            {i > 0 && <span aria-hidden className={cx('absolute right-1/2 top-[18px] h-0.5 w-full', i <= current ? 'bg-ok' : 'bg-line')} />}
            <span className="relative z-10 flex flex-col items-center">
              {links ? (
                <Link to={step.path(exam.id)} className="flex flex-col items-center rounded-md px-1 py-1" aria-label={`Go to step ${i + 1}: ${step.label}`}>
                  {dot}{label}
                </Link>
              ) : (<>{dot}{label}</>)}
            </span>
            <span className="sr-only">{done ? ' (done)' : active ? ' (current step)' : ' (not yet)'}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function ExamProgress({ exam, canAct, editorAction, showAction = true }: {
  exam: ExamLike; canAct: boolean; editorAction?: ReactNode; showAction?: boolean;
}) {
  const action = canAct && showAction ? nextAction(exam) : null;
  return (
    <Card className="mb-6">
      <StepTrack exam={exam} links={canAct} />
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p className="min-w-0 flex-1 basis-60 text-sm text-fg-muted">{stepSummary(exam)}</p>
        {canAct && showAction && (action
          ? <LinkButton to={action.to} variant="primary" size="lg" icon="check">{action.label}</LinkButton>
          : editorAction)}
      </div>
    </Card>
  );
}
