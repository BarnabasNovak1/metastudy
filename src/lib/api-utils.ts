// ==================== AUTH HEADERS ====================
// Centralized auth header helper - attaches Firebase ID token to every API call
import { auth } from '../../firebase';

// Single source of truth for the API base URL. Falls back to '/api', which is
// served by the Firebase Hosting rewrite -> `api` function.
export const API_BASE: string = (import.meta.env.VITE_API_BASE?.trim() || '/api').replace(/\/+$/, '');

export async function getAuthHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...extra };
  try {
    const user = auth.currentUser;
    if (user) {
      const token = await user.getIdToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;
    }
  } catch {}
  return headers;
}
