import { describe, it, expect, vi } from 'vitest';

// achievements.ts imports the app's firebase singleton - mock it so the pure
// XP/level functions can be tested without firebase config or a DOM.
vi.mock('../../firebase', () => ({ db: {}, auth: null, functions: {}, storage: {} }));

import { computeActionXP, getRankTitle, xpForLevel, getLevelInfo } from '@/lib/achievements';

describe('computeActionXP', () => {
  it('chat always awards 1 XP', () => {
    expect(computeActionXP('chat')).toBe(1);
  });

  it('longer summary types earn more', () => {
    expect(computeActionXP('summary', { summaryType: 'academic' })).toBeGreaterThan(
      computeActionXP('summary', { summaryType: 'brief' })
    );
  });

  it('summary XP scales with word count up to a cap', () => {
    const small = computeActionXP('summary', { summaryType: 'brief', wordCount: 0 });
    const big = computeActionXP('summary', { summaryType: 'brief', wordCount: 5000 });
    expect(big).toBe(small + 4); // bonus caps at +4
  });

  it('quiz XP is capped at 25', () => {
    expect(computeActionXP('quiz', { questionCount: 100, quizMode: 'short', includeEssay: true })).toBe(25);
  });

  it('never returns negative or throws on bad input', () => {
    expect(computeActionXP('quiz', { questionCount: 'abc' })).toBeGreaterThanOrEqual(0);
  });
});

describe('xpForLevel / getLevelInfo', () => {
  it('level thresholds match the documented curve (50, +20/level)', () => {
    expect(xpForLevel(0)).toBe(0);
    expect(xpForLevel(1)).toBe(50);
    expect(xpForLevel(2)).toBe(120); // 50 + 70
    expect(xpForLevel(3)).toBe(210); // +90
  });

  it('getLevelInfo reports correct level and progress', () => {
    expect(getLevelInfo(0).level).toBe(0);
    expect(getLevelInfo(50).level).toBe(1);
    const mid = getLevelInfo(85); // between 50 (L1) and 120 (L2)
    expect(mid.level).toBe(1);
    expect(mid.current).toBe(35);
    expect(mid.required).toBe(70);
    expect(mid.progress).toBeCloseTo(0.5);
  });

  it('progress never exceeds 1 and negative xp clamps to 0', () => {
    expect(getLevelInfo(-100).level).toBe(0);
    expect(getLevelInfo(99999999).progress).toBeLessThanOrEqual(1);
  });
});

describe('getRankTitle', () => {
  it('returns titles for each rank band', () => {
    expect(getRankTitle(0)).toBe('Curious Learner');
    expect(getRankTitle(300)).toBe('Dedicated Student');
    expect(getRankTitle(20000)).toBe('Legendary Scholar');
  });
});
