// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { StudyQuiz } from '../../src/components/study/StudyQuiz';
import { ChallengePopup } from '../../src/components/study/ChallengePopup';

const state = vi.hoisted(() => ({
  documents: new Map<string, any>(),
  toast: vi.fn(),
  setDoc: vi.fn(),
  addDoc: vi.fn(),
  sequence: 0,
}));
vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: { uid: 'learner' } } }));
vi.mock('../../src/lib/api-utils', () => ({
  API_BASE: '/api', getAuthHeaders: async () => ({ Authorization: 'Bearer test' }),
}));
vi.mock('../../src/hooks/use-toast', () => ({ toast: state.toast, useToast: () => ({ toast: state.toast }) }));
vi.mock('next-themes', () => ({ useTheme: () => ({ theme: 'light' }) }));
vi.mock('../../src/contexts/UserDataContext', () => ({
  useUserData: () => ({ plan: 'pro', profile: { word_limit: 20000, monthly_quota: 500 }, counters: {} }),
}));
vi.mock('../../src/hooks/use-plan-gate', () => ({
  usePlanGate: () => ({ loading: false, quizAccess: true, plan: 'pro' }),
}));
vi.mock('../../src/lib/extractTextFromFile', () => ({ extractTextFromFile: vi.fn() }));
vi.mock('../../src/lib/achievements', () => ({
  awardAchievement: vi.fn(), incrementCounterAndMaybeAward: vi.fn(),
  incrementCounterAndAwardOn: vi.fn(), addXP: vi.fn(), awardActionXP: vi.fn(),
  incrementCounter: vi.fn(),
}));
vi.mock('../../src/lib/session', () => ({ startToolSession: vi.fn(), endToolSession: vi.fn() }));
vi.mock('../../src/lib/usage', () => ({ incrementMonthlyUsage: vi.fn() }));
vi.mock('../../src/components/CrossCreatePicker', () => ({ CrossCreatePicker: () => null }));
vi.mock('../../src/components/LoadingOverlay', () => ({ default: () => null }));
vi.mock('../../src/components/FlashcardViewer', () => ({ FlashcardViewer: () => null }));
vi.mock('../../src/components/ui/usage-animation', () => ({
  UsageAnimation: () => null, useUsageAnimation: () => ({ triggerAnimation: vi.fn(), showAnimation: false }),
}));
// Keep the real page logic; replace the portal-based select with native controls
// so these tests focus on saved data and grading rather than pointer geometry.
vi.mock('../../src/components/ui/select', () => ({
  Select: ({ children, value, onValueChange, disabled }: any) => createElement('select', {
    value, disabled, onChange: (event: any) => onValueChange(event.target.value),
  }, children),
  SelectItem: ({ children, value }: any) => createElement('option', { value }, children),
  SelectContent: ({ children }: { children: ReactNode }) => children,
  SelectTrigger: () => null,
  SelectValue: () => null,
}));
vi.mock('firebase/firestore', () => {
  const ref = (...args: any[]) => {
    const first = args.shift();
    const path = [first?.path, ...args].filter(Boolean).join('/');
    return { path, id: path.split('/').at(-1) };
  };
  const snapshot = (reference: any) => ({
    id: reference.id, ref: reference,
    exists: () => state.documents.has(reference.path),
    data: () => state.documents.get(reference.path),
  });
  return {
    doc: ref, collection: ref, query: (reference: any) => reference,
    where: vi.fn(), orderBy: vi.fn(), limit: vi.fn(),
    serverTimestamp: () => ({ seconds: 100 }),
    getDoc: async (reference: any) => snapshot(reference),
    getDocs: async (reference: any) => ({
      docs: [...state.documents.keys()]
        .filter(path => path.startsWith(`${reference.path}/`) && path.split('/').length === reference.path.split('/').length + 1)
        .map(path => snapshot({ path, id: path.split('/').at(-1) })),
    }),
    setDoc: state.setDoc, addDoc: state.addDoc, updateDoc: vi.fn(),
    deleteDoc: vi.fn(), writeBatch: vi.fn(), onSnapshot: () => () => {},
    increment: (amount: number) => amount,
  };
});

const reference = 'Plants use sunlight to convert water and carbon dioxide into sugar, releasing oxygen.';
let root: Root;
let container: HTMLDivElement;
const render = async (element: ReactElement) => {
  await act(async () => root.render(element));
};
const button = (text: string, scope: ParentNode = document) => {
  const matches = [...scope.querySelectorAll('button')].filter(node => node.textContent?.trim() === text);
  expect(matches.length, `button "${text}"`).toBeGreaterThan(0);
  return matches[0];
};
const click = async (node: HTMLElement) => { await act(async () => node.click()); };
const input = async (node: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) => {
  expect(node).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(node), 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
};
const quizzes = () => [...state.documents.entries()].filter(([path]) => /^users\/learner\/quizzes\/[^/]+$/.test(path));
const attempts = () => [...state.documents.entries()].filter(([path]) => path.includes('/quiz_attempts/'));
const gradingResponse = { items: [{ score: 80, feedback: 'Correct idea, but oxygen is missing.', expectedAnswer: reference }] };

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  state.documents.clear();
  state.toast.mockReset();
  state.setDoc.mockReset().mockImplementation(async (ref, data, options) => {
    state.documents.set(ref.path, options?.merge ? { ...state.documents.get(ref.path), ...data } : structuredClone(data));
  });
  state.addDoc.mockReset().mockImplementation(async (ref, data) => {
    const id = `record-${++state.sequence}`;
    state.documents.set(`${ref.path}/${id}`, structuredClone(data));
    return { id };
  });
  localStorage.clear();
  sessionStorage.clear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('quiz creation, persistence, and submission', () => {
  const prepareManual = async () => {
    await render(createElement(StudyQuiz, { userId: 'learner' }));
    await click(button('Create manually'));
    await input(container.querySelector('#manual-title')!, 'Manual Biology');
    await input(container.querySelector('input[placeholder="Type the question"]')!, 'Explain photosynthesis.');
    await input(container.querySelector('select')!, 'short_answer');
  };

  it('saves a written reference and uses it when submitting a manual quiz', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => gradingResponse });
    vi.stubGlobal('fetch', fetchMock);
    await prepareManual();
    await input(container.querySelector('textarea')!, reference);
    await click(button('Save & Start'));
    expect(quizzes()[0][1].questions[0].reference_answer).toBe(reference);
    await input(container.querySelector('textarea[placeholder="Type your answer..."]')!, 'Plants use light to make sugar.');
    await click(button('Submit Quiz'));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).referenceAnswers).toEqual([reference]);
    expect(attempts()[0][1]).toMatchObject({ score: 80, short_scores: [80], expected_answers: [reference] });
    expect(container.textContent).toContain(reference);
  });

  it('blocks saving an unaccepted draft and persists the creator edit after acceptance', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ referenceAnswer: reference }) }));
    await prepareManual();
    await click(button('Generate sample answer'));
    expect(button('Save & Start').disabled).toBe(true);
    expect(quizzes()).toHaveLength(0);
    await input(container.querySelectorAll('textarea')[1], 'My reviewed sample answer.');
    await click(button('Accept answer'));
    await input(container.querySelector('textarea')!, 'My final edited sample answer.');
    await click(button('Save & Start'));
    expect(quizzes()[0][1].questions[0].reference_answer).toBe('My final edited sample answer.');
  });

  it('keeps incomplete manual questions in the builder instead of silently dropping them', async () => {
    await prepareManual();
    await click(button('Save & Start'));
    expect(quizzes()).toHaveLength(0);
    expect(state.toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Complete every question' }));
  });

  it('grades a manual multiple-choice quiz locally without making an AI request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await render(createElement(StudyQuiz, { userId: 'learner' }));
    await click(button('Create manually'));
    await input(container.querySelector('#manual-title')!, 'Manual choice quiz');
    await input(container.querySelector('input[placeholder="Type the question"]')!, 'Which gas is released?');
    await input(container.querySelector('input[placeholder="Answer A"]')!, 'Oxygen');
    await input(container.querySelector('input[placeholder="Answer B"]')!, 'Helium');
    await click(button('Save & Start'));
    await click(container.querySelector('input[type="radio"]')!);
    await click(button('Submit Quiz'));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(attempts()[0][1]).toMatchObject({ score: 1, total_questions: 1 });
  });

  it('locks the submitted answer during grading and preserves it for retry after a failure', async () => {
    let finishGrading!: (value: unknown) => void;
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise(resolve => { finishGrading = resolve; }))
      .mockResolvedValueOnce({ ok: true, json: async () => gradingResponse });
    vi.stubGlobal('fetch', fetchMock);
    await prepareManual();
    await input(container.querySelector('textarea')!, reference);
    await click(button('Save & Start'));
    const answer = container.querySelector<HTMLTextAreaElement>('textarea[placeholder="Type your answer..."]')!;
    await input(answer, 'Plants use light to make sugar.');
    await click(button('Submit Quiz'));
    expect(answer.disabled).toBe(true);
    expect(button('Retake').disabled).toBe(true);
    await act(async () => finishGrading({ ok: false, json: async () => ({ error: 'Please retry' }) }));
    expect(answer.disabled).toBe(false);
    expect(answer.value).toBe('Plants use light to make sugar.');
    expect(attempts()).toHaveLength(0);
    await click(button('Submit Quiz'));
    expect(attempts()[0][1].answers[0]).toBe('Plants use light to make sugar.');
  });

  it('automatically saves generated references and uses them immediately and after reloading', async () => {
    const generated = Array.from({ length: 5 }, (_, index) => ({
      question: `Explain photosynthesis step ${index + 1}.`,
      question_type: 'short_answer', correct_answer: reference, reference_answer: reference,
    }));
    const fetchMock = vi.fn().mockImplementation(async (url: string) => ({
      ok: true, json: async () => url.endsWith('/quiz/generate-short-answers')
        ? { questions: generated }
        : { items: generated.map(() => gradingResponse.items[0]) },
    }));
    vi.stubGlobal('fetch', fetchMock);
    await render(createElement(StudyQuiz, { userId: 'learner' }));
    const mode = [...container.querySelectorAll('select')].find(node => [...node.options].some(option => option.value === 'short'))!;
    await input(mode, 'short');
    await input(container.querySelector('#quiz-title')!, 'Automatic Biology');
    await input(container.querySelector('#content')!, reference);
    await click(container.querySelector('[data-tour="quiz-generate"]')!);
    expect(quizzes()).toHaveLength(1);
    expect(quizzes()[0][1].questions.map((q: any) => q.reference_answer)).toEqual(Array(5).fill(reference));
    for (const reload of [false, true]) {
      if (reload) {
        await render(createElement('div'));
        await render(createElement(StudyQuiz, { userId: 'learner' }));
        await click(container.querySelector('[title="Automatic Biology"]')!.closest<HTMLElement>('[role="button"]')!);
      }
      for (let index = 0; index < 5; index++) {
        await input(container.querySelector('textarea[placeholder="Type your answer..."]')!, 'Plants use light to make sugar.');
        await click(button(index === 4 ? 'Submit Quiz' : 'Next'));
      }
    }
    const requests = fetchMock.mock.calls.filter(([url]) => url.endsWith('/quiz/grade-short-answers'));
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(JSON.parse(request[1].body)).toMatchObject({ title: 'Automatic Biology', referenceAnswers: Array(5).fill(reference) });
    }
    expect(attempts().map(([, data]) => data.score)).toEqual([80, 80]);
  });

  it('opens the AI generator by default and remembers when the creator prefers the manual builder', async () => {
    await render(createElement(StudyQuiz, { userId: 'learner' }));
    expect(container.querySelector('#quiz-title')).toBeTruthy();
    expect(container.querySelector('#manual-title')).toBeNull();
    await click(button('Create manually'));
    expect(container.querySelector('#manual-title')).toBeTruthy();
    expect(localStorage.getItem('quiz_manual_builder_open')).toBe('true');
    expect(localStorage.getItem('quiz_ai_generator_open')).toBe('false');
    await render(createElement('div'));
    await render(createElement(StudyQuiz, { userId: 'learner' }));
    expect(container.querySelector('#manual-title')).toBeTruthy();
    expect(container.querySelector('#quiz-title')).toBeNull();
    await click(button('Open'));
    expect(localStorage.getItem('quiz_ai_generator_open')).toBe('true');
    expect(localStorage.getItem('quiz_manual_builder_open')).toBe('false');
  });
});

describe('feed quizzes', () => {
  const questions = [
    { id: 'choice', question: 'Which gas is released?', question_type: 'multiple_choice', options: { A: 'Oxygen', B: 'Helium' }, correct_answer: 'A' },
    { id: 'short', question: 'Explain photosynthesis.', question_type: 'short_answer', reference_answer: reference, correct_answer: reference },
  ];
  const openFeed = async () => {
    state.documents.set('feed_posts/post', { ownerId: 'creator', sourceRef: { type: 'quiz', docId: 'quiz' } });
    state.documents.set('users/creator/quizzes/quiz', { title: 'Shared Biology', questions, mode: 'mixed' });
    await render(createElement(ChallengePopup, {
      isOpen: true, onClose: vi.fn(), challenge: { id: 'post', type: 'quiz', title: 'Shared Biology', ownerId: 'creator' },
      userId: 'learner', username: 'Learner', onSaveToLibrary: vi.fn(), onScoreUpdate: vi.fn(), onOpenProfile: vi.fn(),
    }));
    await click(button('Oxygen'));
    await click(button('Next Question'));
    await input(document.querySelector('textarea[placeholder="Type your answer here..."]')!, 'Plants use light to make sugar.');
  };

  it('loads the creator reference from the shared quiz and combines choice and AI scores', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => gradingResponse });
    vi.stubGlobal('fetch', fetchMock);
    await openFeed();
    await click(button('Finish Quiz'));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      questions: ['Explain photosynthesis.'], referenceAnswers: [reference],
    });
    expect(state.documents.get('feed_posts/post/runs/learner').score).toBe(90);
    expect(document.body.textContent).toContain('Quiz Complete!');
    expect(document.body.textContent).toContain(reference);
  });

  it('preserves answers and allows retry without saving a score when AI grading fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Grading unavailable' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => gradingResponse });
    vi.stubGlobal('fetch', fetchMock);
    await openFeed();
    await click(button('Finish Quiz'));
    expect(state.documents.has('feed_posts/post/runs/learner')).toBe(false);
    expect(document.body.textContent).not.toContain('Quiz Complete!');
    expect(document.querySelector('textarea')?.value).toBe('Plants use light to make sugar.');
    await click(button('Finish Quiz'));
    expect(state.documents.get('feed_posts/post/runs/learner').score).toBe(90);
  });

  it('ignores delayed grading from a challenge that has been replaced', async () => {
    let finishGrading!: (value: unknown) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { finishGrading = resolve; })));
    await openFeed();
    await click(button('Finish Quiz'));
    await render(createElement(ChallengePopup, {
      isOpen: true, onClose: vi.fn(),
      challenge: { id: 'other-post', type: 'quiz', title: 'Another quiz', content: { questions } },
      userId: 'learner', username: 'Learner', onSaveToLibrary: vi.fn(), onScoreUpdate: vi.fn(), onOpenProfile: vi.fn(),
    }));
    await act(async () => finishGrading({ ok: true, json: async () => gradingResponse }));
    expect(state.documents.has('feed_posts/post/runs/learner')).toBe(false);
    expect(state.documents.has('feed_posts/other-post/runs/learner')).toBe(false);
    expect(document.body.textContent).not.toContain('Quiz Complete!');
    expect(button('Oxygen').disabled).toBe(false);
  });
});
