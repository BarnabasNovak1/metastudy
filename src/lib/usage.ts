import { auth } from "../../firebase";
import { recordDailyVisit } from "./achievements";
import { API_BASE, getAuthHeaders } from "./api-utils";

export interface UsageCheckOptions {
  inputWords?: number;
  inputChars?: number;
  cachedProfile?: unknown;
  cachedCounters?: unknown;
}

export interface UsageResult {
  plan: "free" | "basic" | "advanced" | "pro";
  usesThisMonth: number;
  monthlyQuota: number;
  extraUsesBalance: number;
  wordLimit: number;
  consumedFromExtra: boolean;
  evaluatedWords?: number;
}

// AI endpoints reserve their own usage. This helper is for existing non-AI
// actions that explicitly consume a use; clients never write billing counters.
export async function incrementMonthlyUsage(userId: string, opts: UsageCheckOptions = {}): Promise<UsageResult | void> {
  if (!userId) return;
  if (auth.currentUser?.uid !== userId) throw new Error("Please sign in again.");
  const inputWords = opts.inputWords ?? (opts.inputChars === undefined ? undefined : Math.ceil(opts.inputChars / 5));
  const response = await fetch(`${API_BASE}/usage/consume`, {
    method: "POST",
    headers: await getAuthHeaders(),
    body: JSON.stringify({ inputWords }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Could not record usage. Please try again.");
  try { await recordDailyVisit(userId); } catch {}
  return { ...result, evaluatedWords: inputWords };
}
