import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Brain, ShieldCheck, Lock, ExternalLink } from "lucide-react";
const privacyUrl = "/privacy";

const AI_CONSENT_KEY = "ms_ai_data_consent";

export function getAIConsent(): boolean {
  try {
    return localStorage.getItem(AI_CONSENT_KEY) === "accepted";
  } catch {}
  return false;
}

export function setAIConsent() {
  try {
    localStorage.setItem(AI_CONSENT_KEY, "accepted");
  } catch {}
}

/**
 * Hook that checks AI consent and returns a function to call before any AI feature.
 * If consent hasn't been given, it triggers the disclosure modal.
 * Usage:
 *   const { checkAIConsent } = useAIConsent();
 *   // Before calling AI: if (!checkAIConsent()) return;
 */
export function useAIConsent() {
  const [needsConsent, setNeedsConsent] = useState(false);

  const checkAIConsent = useCallback((): boolean => {
    if (getAIConsent()) return true;
    setNeedsConsent(true);
    return false;
  }, []);

  const onAccept = useCallback(() => {
    setAIConsent();
    setNeedsConsent(false);
  }, []);

  const onDismiss = useCallback(() => {
    setNeedsConsent(false);
  }, []);

  return { needsConsent, checkAIConsent, onAccept, onDismiss };
}

/**
 * Global one-time AI disclosure that shows on the first AI-powered page visit.
 * Renders inside App.tsx - listens for a custom event dispatched by AI pages.
 */
export function AIDisclosure() {
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    // Show on first visit to any AI-powered page if not yet consented
    if (getAIConsent()) return;

    const handler = () => {
      if (!getAIConsent()) {
        setVisible(true);
      }
    };

    window.addEventListener("ms:ai-page-visit", handler);
    return () => window.removeEventListener("ms:ai-page-visit", handler);
  }, []);

  const handleAccept = () => {
    setAIConsent();
    setExiting(true);
    setTimeout(() => setVisible(false), 400);
  };

  if (!visible) return null;

  return (
    <div
      className={`fixed inset-0 z-[10000] flex items-center justify-center p-4 transition-all duration-300 ${
        exiting ? "opacity-0" : "opacity-100 animate-in fade-in"
      }`}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Modal */}
      <div
        className={`relative w-full max-w-md rounded-2xl border border-border/60 bg-background shadow-2xl shadow-black/30 transition-all duration-300 ${
          exiting ? "scale-95 opacity-0" : "scale-100 opacity-100 animate-in zoom-in-95"
        }`}
      >
        {/* Header gradient accent */}
        <div className="absolute top-0 left-0 right-0 h-1 rounded-t-2xl bg-primary" />

        <div className="p-6 pt-7">
          {/* Icon */}
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent border-2 border-foreground">
            <Brain className="h-7 w-7 text-primary" />
          </div>

          {/* Title */}
          <h2 className="text-center text-lg font-semibold text-foreground">
            AI-Powered Features
          </h2>
          <p className="mt-1 text-center text-xs text-muted-foreground">
            One-time notice about how we handle your data
          </p>

          {/* Info cards */}
          <div className="mt-5 space-y-3">
            <div className="flex items-start gap-3 rounded-xl bg-muted/50 p-3">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
              <div>
                <p className="text-xs font-medium text-foreground">Your data stays private</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                  Content you submit (notes, essays, resumes) is processed by Meta's 
                  Llama models to generate results.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-xl bg-muted/50 p-3">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
              <div>
                <p className="text-xs font-medium text-foreground">Secure processing</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                  All requests are encrypted in transit. Your content is only used to generate 
                  your requested output and is not stored by the AI provider beyond temporary 
                  processing.
                </p>
              </div>
            </div>
          </div>

          {/* Privacy link */}
          <div className="mt-4 text-center">
            <a
              href={privacyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Read our full Privacy Policy
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>

          {/* Button */}
          <Button
            onClick={handleAccept}
            className="mt-5 w-full bg-primary text-primary-foreground border-2 border-foreground hover:opacity-90 transition-all duration-200 font-bold"
          >
            I understand, continue
          </Button>

          <p className="mt-3 text-center text-[10px] text-muted-foreground/70">
            This notice is shown once. You can review it anytime in your account settings.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Call this function when an AI-powered page/component mounts.
 * It dispatches a custom event that AIDisclosure listens for.
 */
export function notifyAIPageVisit() {
  if (!getAIConsent()) {
    window.dispatchEvent(new CustomEvent("ms:ai-page-visit"));
  }
}
