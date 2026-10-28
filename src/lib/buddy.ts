// Study Buddy client: half-credit companion chat + shared personality list.
import { API_BASE, getAuthHeaders } from '@/lib/api-utils';

export interface BuddySuggestion { label: string; path: string }
export interface BuddyHistoryMessage { role: 'user' | 'assistant'; content: string }
export interface BuddySendResponse { reply: string; suggestion?: BuddySuggestion; sessionId?: string }

// Mirrors the AI Chat personality ids; prompts live server-side so the
// buddy's voice can't be tampered with from the client.
export const BUDDY_PERSONALITIES = [
  { id: 'studybuddy', name: 'Friend', description: 'Supportive, trustworthy friend' },
  { id: 'normal', name: 'Normal', description: 'Helpful and knowledgeable' },
  { id: 'professor', name: 'Professor', description: 'Academic expert with deep knowledge' },
  { id: 'k12teacher', name: 'K-12 Teacher', description: 'Friendly teacher for younger students' },
  { id: 'jokester', name: 'Jokester', description: 'Funny and entertaining' },
  { id: 'sherlock', name: 'Sherlock Holmes', description: 'Master detective with sharp observation' },
  { id: 'yoda', name: 'Yoda', description: 'Wise Jedi Master with unique speech' },
  { id: 'scoobydoo', name: 'Scooby-Doo', description: 'Scared but loyal mystery solver' },
] as const;

export type BuddyPersonalityId = (typeof BUDDY_PERSONALITIES)[number]['id'];

export async function sendBuddyMessage(body: {
  message: string;
  history: BuddyHistoryMessage[];
  requestId: string;
}): Promise<BuddySendResponse> {
  const resp = await fetch(`${API_BASE}/buddy`, {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error((data as any)?.error || `Request failed (${resp.status})`);
  return data as BuddySendResponse;
}
