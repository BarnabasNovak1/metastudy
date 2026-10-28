// Adaptive Tutor client types + API helpers.
// Rubrics/model answers are never returned by the API until an answer is evaluated.
import { API_BASE, getAuthHeaders } from '@/lib/api-utils';

export type TutorDifficulty = 'easy' | 'medium' | 'hard';
export type MasteryStatus = 'untested' | 'needs_review' | 'developing' | 'demonstrated';

export interface LearningObjective {
  id: string;
  title: string;
  explanation: string;
  keyFacts: string[];
  misconceptions: string[];
}

export interface TutorQuestion {
  id: string;
  conceptId: string;
  conceptTitle: string;
  type: 'mcq' | 'short_text';
  question: string;
  options?: string[];
  difficulty: TutorDifficulty;
}

export interface ConceptMastery {
  conceptId: string;
  title: string;
  masteryScore: number;
  attempts: number;
  status: MasteryStatus;
}

export interface TutorEvaluation {
  verdict: 'correct' | 'partial' | 'incorrect' | 'ambiguous';
  explanation: string;
  misconception: string | null;
  sourceExcerpt: string | null;
  correctAnswer: string;
  nextAction: 'advance' | 'reteach' | 'prerequisite' | 'clarify';
}

export interface TutorSessionListItem {
  id: string;
  title: string;
  topic: string;
  status: 'active' | 'completed' | 'paused';
  answersCount: number;
  sessionLength: number;
  updatedAt: string | null;
}

export interface CreateSessionResponse {
  sessionId: string;
  title: string;
  objectives: LearningObjective[];
  question: TutorQuestion;
  position: { answered: number; total: number };
}

export interface AnswerResponse {
  evaluation: TutorEvaluation;
  nextQuestion: TutorQuestion | null;
  completed: boolean;
  mastery: ConceptMastery[];
  position: { answered: number; total: number };
}

export interface SessionState {
  sessionId: string;
  title: string;
  topic: string;
  difficulty: TutorDifficulty;
  status: 'active' | 'completed' | 'paused';
  objectives: LearningObjective[];
  mastery: ConceptMastery[];
  question: TutorQuestion | null;
  position: { answered: number; total: number };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, { headers: await getAuthHeaders(), ...init });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error((data as any)?.error || `Request failed (${resp.status})`);
  return data as T;
}

export const tutorApi = {
  createSession: (body: {
    topic: string;
    difficulty: TutorDifficulty;
    sessionLength: number;
    text?: string;
    documentIds?: string[];
    lessonIds?: string[];
  }) => request<CreateSessionResponse>('/tutor/session', { method: 'POST', body: JSON.stringify(body) }),

  listSessions: () => request<{ sessions: TutorSessionListItem[] }>('/tutor/sessions'),

  getSession: (id: string) => request<SessionState>(`/tutor/session/${id}`),

  submitAnswer: (sessionId: string, questionId: string, answer: string) =>
    request<AnswerResponse>(`/tutor/session/${sessionId}/answer`, {
      method: 'POST',
      body: JSON.stringify({ questionId, answer }),
    }),

  finishSession: (sessionId: string) =>
    request<{ mastery: ConceptMastery[]; status: string }>(`/tutor/session/${sessionId}/finish`, { method: 'POST' }),

  createReview: (sessionId: string) =>
    request<CreateSessionResponse>(`/tutor/session/${sessionId}/review`, { method: 'POST' }),

  deleteSession: (sessionId: string) =>
    request<{ ok: boolean }>(`/tutor/session/${sessionId}`, { method: 'DELETE' }),
};
