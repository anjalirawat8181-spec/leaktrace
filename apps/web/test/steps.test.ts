import { describe, expect, it } from 'vitest';
import { STEPS, currentStep, nextAction, type ExamStatus } from '../src/lib/steps';

const at = (status: ExamStatus, hasTemplate = true) => ({ id: 'e1', status, hasTemplate });

describe('exam steps', () => {
  it('has the five steps in order', () => {
    expect(STEPS.map((s) => s.label)).toEqual(['Template', 'Generate', 'Schedule', 'Released', 'Closed']);
  });

  it('puts every status on the right step', () => {
    expect(currentStep(at('DRAFT', false))).toBe(0);
    expect(currentStep(at('DRAFT', true))).toBe(1);
    expect(currentStep(at('GENERATING'))).toBe(1);
    expect(currentStep(at('READY'))).toBe(2);
    expect(currentStep(at('SCHEDULED'))).toBe(3);
    expect(currentStep(at('RELEASED'))).toBe(3);
    expect(currentStep(at('CLOSED'))).toBe(4);
  });

  it('offers exactly one next action per stage', () => {
    expect(nextAction(at('DRAFT', false))).toBeNull();
    expect(nextAction(at('DRAFT'))).toEqual({ label: 'Generate copies', to: '/exams/e1/generation' });
    expect(nextAction(at('GENERATING'))?.label).toBe('Watch progress');
    expect(nextAction(at('READY'))).toEqual({ label: 'Schedule release', to: '/exams/e1/schedule' });
    expect(nextAction(at('SCHEDULED'))?.label).toBe('Change schedule');
    expect(nextAction(at('RELEASED'))?.to).toBe('/trace');
    expect(nextAction(at('CLOSED'))?.to).toBe('/trace');
  });
});
