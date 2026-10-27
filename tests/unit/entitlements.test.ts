import { describe, it, expect } from 'vitest';
import { ENTITLEMENTS, type PlanKey } from '@/lib/entitlements';

const PLANS: PlanKey[] = ['free', 'basic', 'advanced', 'pro'];

describe('plan entitlements', () => {
  it('defines every plan tier', () => {
    for (const plan of PLANS) {
      expect(ENTITLEMENTS[plan]).toBeDefined();
    }
  });

  it('free tier cannot access AI features', () => {
    const free = ENTITLEMENTS.free;
    expect(free.quizAccess).toBe(false);
    expect(free.careerAccess).toBe(false);
    expect(free.studyPlans).toBe(false);
    expect(free.askTheText).toBe(false);
    expect(free.lessonBuilder).toBe(false);
  });

  it('entitlements never shrink as plan tier increases', () => {
    const order: PlanKey[] = ['free', 'basic', 'advanced', 'pro'];
    for (let i = 1; i < order.length; i++) {
      const prev = ENTITLEMENTS[order[i - 1]];
      const curr = ENTITLEMENTS[order[i]];
      for (const key of Object.keys(prev) as (keyof typeof prev)[]) {
        if (prev[key]) expect(curr[key], `${key} lost going ${order[i - 1]} -> ${order[i]}`).toBe(true);
      }
    }
  });

  it('pro has access to every feature', () => {
    for (const value of Object.values(ENTITLEMENTS.pro)) {
      expect(value).toBe(true);
    }
  });
});
