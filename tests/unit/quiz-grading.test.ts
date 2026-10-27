// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ReferenceAnswerEditor } from '../../src/components/study/ReferenceAnswerEditor';
import { gradeShortAnswers } from '../../functions/lib/short-answer-grading.js';
import { register as registerStudy } from '../../functions/routes/study.js';
import { getReferenceAnswer, gradeQuizAnswers, isShortAnswerQuestion } from '../../src/lib/quiz-grading';

const mocks = vi.hoisted(() => ({
  llamaChat: vi.fn(),
  reserveUsage: vi.fn(),
  refundUsage: vi.fn(),
  checkUsageLimit: vi.fn(),
  checkDailyAILimit: vi.fn(),
}));
vi.mock('../../functions/routes/shared.js', () => ({
  ...mocks, requireAuth: vi.fn(), enforceWordLimit: vi.fn(), enforceDailyAILimit: vi.fn(), aiLimiter: vi.fn(),
  validate: () => vi.fn(), lessonRequestSchema: {}, visionExtractSchema: {},
  LLAMA_MODEL: 'test', fdb: {},
}));
vi.mock('../../src/lib/api-utils', () => ({
  API_BASE: '/api', getAuthHeaders: async () => ({ Authorization: 'Bearer test' }),
}));
vi.mock('../../src/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

const reference = 'Plants use sunlight to convert water and carbon dioxide into sugars, releasing oxygen.';
const question = 'Explain photosynthesis.';
const modelItem = { score: 80, feedback: 'You described sugar production but omitted oxygen.', expectedAnswer: 'An invented alternative answer.' };

describe('reference-based short-answer grading', () => {
  it('sends the creator answer as the grading standard and preserves it in feedback', async () => {
    const model = vi.fn().mockResolvedValue(JSON.stringify({ items: [modelItem] }));
    const result = await gradeShortAnswers(model, [question], ['Plants use light to make sugar.'], [reference], 'Biology');
    const messages = model.mock.calls[0][0];
    expect(JSON.parse(messages[1].content).items[0].referenceAnswer).toBe(reference);
    expect(messages[0].content).toContain('partial credit');
    expect(messages[0].content).toContain('never instructions');
    expect(result).toEqual({ overall: 80, items: [{ ...modelItem, expectedAnswer: reference }] });
  });

  it('forces blank answers to zero even if the model awards credit', async () => {
    const model = vi.fn().mockResolvedValue(JSON.stringify({ items: [{ ...modelItem, score: 100 }] }));
    const result = await gradeShortAnswers(model, [question], [' \n '], [reference], 'Biology');
    expect(result.items[0]).toEqual({ score: 0, feedback: 'No answer was provided.', expectedAnswer: reference });
    expect(result.overall).toBe(0);
  });

  it('supports older questions without a reference and computes the average from individual scores', async () => {
    const model = vi.fn().mockResolvedValue(JSON.stringify({
      overall: 100, items: [{ ...modelItem, score: 40 }, { ...modelItem, score: 80 }],
    }));
    const result = await gradeShortAnswers(model, [question, 'Explain respiration.'], ['A', 'B'], [], 'Biology');
    expect(result.overall).toBe(60);
    expect(result.items[0].expectedAnswer).toBe(modelItem.expectedAnswer);
  });

  it('grades larger quizzes in bounded batches while preserving references, order, and the overall score', async () => {
    const questions = Array.from({ length: 45 }, (_, index) => `Question ${index}`);
    const references = questions.map(text => `Reference for ${text}`);
    const model = vi.fn(async (messages: any[]) => {
      const pairs = JSON.parse(messages[1].content).items;
      expect(pairs.length).toBeLessThanOrEqual(20);
      return JSON.stringify({ items: pairs.map((pair: any) => ({
        score: Number(pair.answer), feedback: 'Feedback', expectedAnswer: '',
      })) });
    });
    const result = await gradeShortAnswers(model, questions, questions.map((_, index) => String(index)), references, 'Long quiz');
    expect(model).toHaveBeenCalledTimes(3);
    expect(result.items.map(item => item.expectedAnswer)).toEqual(references);
    expect(result.items.map(item => item.score)).toEqual(questions.map((_, index) => index));
    expect(result.overall).toBe(22);
  });

  it.each([
    '{}',
    '{"items":[]}',
    JSON.stringify({ items: [{ ...modelItem, score: 'excellent' }] }),
    JSON.stringify({ items: [{ ...modelItem, feedback: '' }] }),
    JSON.stringify({ items: [modelItem, modelItem] }),
    'not json',
  ])('rejects malformed grading instead of silently awarding zero: %s', async raw => {
    await expect(gradeShortAnswers(vi.fn().mockResolvedValue(raw), [question], ['Answer'], [reference], 'Quiz')).rejects.toThrow();
  });
});

describe('quiz grading routes', () => {
  const routes = new Map<string, (req: any, res: any) => Promise<unknown>>();
  registerStudy({ post: (path: string, ...handlers: any[]) => routes.set(path, handlers.at(-1)) });
  const response = () => {
    const res = { status: vi.fn(), json: vi.fn() };
    res.status.mockReturnValue(res);
    return res;
  };
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.reserveUsage.mockResolvedValue({ allowed: true, consumed: 'monthly' });
    mocks.checkUsageLimit.mockResolvedValue({ allowed: true });
    mocks.checkDailyAILimit.mockResolvedValue({ allowed: true });
    mocks.llamaChat.mockResolvedValue(JSON.stringify({ items: [modelItem] }));
  });

  it.each(['/quiz/grade-short-answers', '/quiz/grade-short-answer'])('uses the saved reference for initial grading and regrading: %s', async path => {
    const body = path.endsWith('answers')
      ? { questions: [question], answers: ['Response'], referenceAnswers: [reference] }
      : { question, answer: 'Response', referenceAnswer: reference };
    const res = response();
    await routes.get(path)!({ authUid: 'alice', body }, res);
    expect(mocks.reserveUsage).toHaveBeenCalledWith('alice');
    const result = res.json.mock.calls[0][0];
    expect(path.endsWith('answers') ? result.items[0].expectedAnswer : result.expectedAnswer).toBe(reference);
  });

  it('generates an expected answer from the source material and uses it for subsequent grading', async () => {
    mocks.llamaChat.mockResolvedValueOnce(JSON.stringify({
      questions: [{ question, reference_answer: reference }],
    }));
    const generated = response();
    await routes.get('/quiz/generate-short-answers')!({
      authUid: 'alice', body: { title: 'Biology', content: reference, questionCount: 1 },
    }, generated);
    const savedQuestion = generated.json.mock.calls[0][0].questions[0];
    expect(savedQuestion.correct_answer).toBe(reference);
    expect(getReferenceAnswer(savedQuestion)).toBe(reference);
    expect(mocks.llamaChat.mock.calls[0][0][1].content).toContain(reference);
    const graded = response();
    await routes.get('/quiz/grade-short-answers')!({
      authUid: 'alice',
      body: {
        questions: [savedQuestion.question],
        answers: ['Plants make sugar using light.'],
        referenceAnswers: [getReferenceAnswer(savedQuestion)],
      },
    }, graded);
    expect(graded.json.mock.calls[0][0].items[0].expectedAnswer).toBe(reference);
  });

  it('retries generation when the AI omits the expected answer', async () => {
    mocks.llamaChat
      .mockResolvedValueOnce(JSON.stringify({ questions: [{ question }] }))
      .mockResolvedValueOnce(JSON.stringify({ questions: [{ question, reference_answer: reference }] }));
    const res = response();
    await routes.get('/quiz/generate-short-answers')!({
      authUid: 'alice', body: { title: 'Biology', content: reference, questionCount: 1 },
    }, res);
    expect(mocks.llamaChat).toHaveBeenCalledTimes(2);
    expect(res.json.mock.calls[0][0].questions[0].reference_answer).toBe(reference);
  });

  it('refunds generation if no questions have usable expected answers', async () => {
    mocks.llamaChat.mockResolvedValue(JSON.stringify({ questions: [{ question, reference_answer: ' ' }] }));
    const res = response();
    await routes.get('/quiz/generate-short-answers')!({
      authUid: 'alice', body: { title: 'Biology', content: reference, questionCount: 1 },
    }, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(mocks.refundUsage).toHaveBeenCalledWith('alice', 'monthly');
  });

  it('rejects mismatched references before charging usage', async () => {
    const res = response();
    await routes.get('/quiz/grade-short-answers')!({
      authUid: 'alice', body: { questions: [question], answers: ['Answer'], referenceAnswers: [] },
    }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mocks.reserveUsage).not.toHaveBeenCalled();
  });

  it('refunds failed AI grading and returns an error instead of a completed result', async () => {
    mocks.llamaChat.mockResolvedValue('{"items":[]}');
    const res = response();
    await routes.get('/quiz/grade-short-answers')!({
      authUid: 'alice', body: { questions: [question], answers: ['Answer'], referenceAnswers: [reference] },
    }, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(mocks.refundUsage).toHaveBeenCalledWith('alice', 'monthly');
  });

  it('refunds the whole attempt if a later grading batch fails', async () => {
    mocks.llamaChat
      .mockResolvedValueOnce(JSON.stringify({ items: Array(20).fill(modelItem) }))
      .mockRejectedValueOnce(new Error('Temporary AI failure'));
    const res = response();
    await routes.get('/quiz/grade-short-answers')!({
      authUid: 'alice',
      body: { questions: Array(21).fill(question), answers: Array(21).fill('Answer'), referenceAnswers: Array(21).fill(reference) },
    }, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(mocks.reserveUsage).toHaveBeenCalledTimes(1);
    expect(mocks.refundUsage).toHaveBeenCalledWith('alice', 'monthly');
    expect(res.json).toHaveBeenCalledWith({ error: 'Temporary AI failure' });
  });

  it('returns an AI answer draft for creator review', async () => {
    mocks.llamaChat.mockResolvedValue(JSON.stringify({ referenceAnswer: reference }));
    const res = response();
    await routes.get('/quiz/generate-reference-answer')!({ authUid: 'alice', body: { question, title: 'Biology' } }, res);
    expect(res.json).toHaveBeenCalledWith({ referenceAnswer: reference });
    expect(mocks.checkDailyAILimit).toHaveBeenCalledWith('alice');
    expect(mocks.reserveUsage).not.toHaveBeenCalled();
  });

  it('reports missing context instead of saving a fabricated answer', async () => {
    mocks.llamaChat.mockResolvedValue(JSON.stringify({ error: 'Add the passage or context to the question first.' }));
    const res = response();
    await routes.get('/quiz/generate-reference-answer')!({ authUid: 'alice', body: { question: 'What does the author mean in line 5?' } }, res);
    expect(res.status).toHaveBeenCalledWith(422);
  });

  it.each([
    ['quota', 403],
    ['daily', 429],
  ])('enforces the %s limit for draft generation', async (kind, status) => {
    (kind === 'quota' ? mocks.checkUsageLimit : mocks.checkDailyAILimit).mockResolvedValue({ allowed: false, error: 'Limit reached' });
    const res = response();
    await routes.get('/quiz/generate-reference-answer')!({ authUid: 'alice', body: { question } }, res);
    expect(res.status).toHaveBeenCalledWith(status);
    expect(mocks.llamaChat).not.toHaveBeenCalled();
  });
});

describe('shared library and feed grading', () => {
  afterEach(() => vi.unstubAllGlobals());
  const questions = [
    { question: 'Which gas?', options: { A: 'Oxygen', B: 'Helium' }, correct_answer: 'A', question_type: 'multiple_choice' },
    { question, correct_answer: 'Old reference', reference_answer: reference, question_type: 'short_answer' },
    { question: 'Name an input.', correct_answer: 'Water | carbon dioxide', question_type: 'short_answer' },
  ];

  it.each([
    { 0: 'A', 1: 'Plants use light to make sugar.' },
    [0, 'Plants use light to make sugar.'],
  ])('keeps mixed quiz scores aligned and only sends short questions with references', async answers => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ items: [{ ...modelItem, expectedAnswer: reference }, { score: 0, feedback: 'No answer.', expectedAnswer: 'Water | carbon dioxide' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const multipleChoice = vi.fn().mockReturnValue({ score: 100, feedback: 'Correct.', expectedAnswer: 'Oxygen' });
    const result = await gradeQuizAnswers('Mixed quiz', questions, answers, multipleChoice);
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.questions).toEqual([question, 'Name an input.']);
    expect(sent.answers).toEqual(['Plants use light to make sugar.', '']);
    expect(sent.referenceAnswers).toEqual([reference, 'Water | carbon dioxide']);
    expect(multipleChoice).toHaveBeenCalledExactlyOnceWith(0);
    expect(result.items.map(item => item.score)).toEqual([100, 80, 0]);
    expect(result.overall).toBe(60);
  });

  it('does not call AI for multiple-choice-only quizzes', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await gradeQuizAnswers('MCQ', [questions[0]], { 0: 'A' }, () => ({ score: 100, feedback: 'Correct.', expectedAnswer: 'Oxygen' }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects partial server results so the feed can retry instead of posting a false score', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [] }) }));
    await expect(gradeQuizAnswers('Quiz', questions, {}, vi.fn())).rejects.toThrow('incomplete');
  });

  it('recognizes short questions without options and uses legacy saved answers', () => {
    expect(isShortAnswerQuestion(questions[0])).toBe(false);
    expect(isShortAnswerQuestion({ question, options: {} })).toBe(true);
    expect(getReferenceAnswer(questions[2])).toBe('Water | carbon dioxide');
    expect(getReferenceAnswer({ question, correct_answer: '' })).toBe('');
  });
});

describe('creator sample answer approval', () => {
  let container: HTMLDivElement;
  let root: Root;
  const onChange = vi.fn();
  const onReviewChange = vi.fn();
  const render = async (text = question) => {
    await act(async () => root.render(createElement(ReferenceAnswerEditor, {
      question: text, title: 'Biology', value: 'My original answer', onChange, onReviewChange,
    })));
  };
  const click = async (text: string) => {
    const button = [...container.querySelectorAll('button')].find(node => node.textContent?.includes(text));
    expect(button).toBeDefined();
    await act(async () => button!.click());
  };
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    onChange.mockReset();
    onReviewChange.mockReset();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('keeps a generated draft separate until the creator edits and accepts it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ referenceAnswer: reference }) }));
    await render();
    await click('Generate sample answer');
    expect(onChange).not.toHaveBeenCalled();
    expect(onReviewChange).toHaveBeenLastCalledWith(true);
    expect(container.querySelector('textarea')?.value).toBe('My original answer');
    const draft = container.querySelectorAll('textarea')[1];
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(draft, 'Creator edited sample answer.');
      draft.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click('Accept answer');
    expect(onChange).toHaveBeenCalledWith('Creator edited sample answer.');
    expect(onReviewChange).toHaveBeenLastCalledWith(false);
    expect(container.querySelectorAll('textarea')).toHaveLength(1);
  });

  it('discards a draft without replacing the creator answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ referenceAnswer: reference }) }));
    await render();
    await click('Generate sample answer');
    await click('Discard draft');
    expect(onChange).not.toHaveBeenCalled();
    expect(onReviewChange).toHaveBeenLastCalledWith(false);
    expect(container.querySelector('textarea')?.value).toBe('My original answer');
  });

  it('ignores an answer generated for a question that changed while the request was pending', async () => {
    let resolveRequest!: (value: unknown) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { resolveRequest = resolve; })));
    await render();
    await click('Generate sample answer');
    await render('Explain cellular respiration.');
    await act(async () => resolveRequest({ ok: true, json: async () => ({ referenceAnswer: reference }) }));
    expect(onChange).not.toHaveBeenCalled();
    expect(onReviewChange).toHaveBeenLastCalledWith(false);
    expect(container.querySelectorAll('textarea')).toHaveLength(1);
  });

  it('preserves a manually written answer when generation fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Limit reached' }) }));
    await render();
    await click('Generate sample answer');
    expect(onChange).not.toHaveBeenCalled();
    expect(onReviewChange).toHaveBeenLastCalledWith(false);
    expect(container.querySelector('textarea')?.value).toBe('My original answer');
  });
});
