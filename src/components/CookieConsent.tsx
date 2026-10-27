import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Cookie, Shield } from "lucide-react";

const COOKIE_CONSENT_KEY = "ms_cookie_consent";
// Analytics IDs come from env — empty means no analytics are ever loaded.
const GA_ID = import.meta.env.VITE_GA_ID || "";
const ADS_ID = import.meta.env.VITE_ADS_ID || "";

export type CookieConsentValue = "accepted" | "declined" | null;

// Injects the Google tag (GA4 + Ads conversion) ONLY when the user has accepted
// cookies. Ad personalization is always disabled. Idempotent.
export function loadGoogleTags() {
  try {
    if (!GA_ID && !ADS_ID) return;
    if (getCookieConsent() !== "accepted") return;
    const w = window as any;
    if (GA_ID) w[`ga-disable-${GA_ID}`] = false;
    if (ADS_ID) w[`ga-disable-${ADS_ID}`] = false;
    if (document.getElementById("gtag-base")) return;
    w.dataLayer = w.dataLayer || [];
    if (!w.gtag) {
      w.gtag = function gtag() {
        w.dataLayer.push(arguments);
      };
    }
    const s = document.createElement("script");
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID || ADS_ID}`;
    s.id = "gtag-base";
    document.head.appendChild(s);
    w.gtag("js", new Date());
    if (GA_ID) w.gtag("config", GA_ID, { allow_ad_personalization_signals: false });
    if (ADS_ID) w.gtag("config", ADS_ID, { allow_ad_personalization_signals: false });
  } catch {}
}

// Disables and removes both the GA4 and Ads tags.
export function unloadGoogleTags() {
  try {
    const w = window as any;
    if (GA_ID) w[`ga-disable-${GA_ID}`] = true;
    if (ADS_ID) w[`ga-disable-${ADS_ID}`] = true;
    ["gtag-base", "ga4-base", "ga4-init"].forEach((id) => {
      document.getElementById(id)?.remove();
    });
  } catch {}
}

export function getCookieConsent(): CookieConsentValue {
  try {
    const v = localStorage.getItem(COOKIE_CONSENT_KEY);
    if (v === "accepted" || v === "declined") return v;
  } catch {}
  return null;
}

export function setCookieConsent(value: "accepted" | "declined") {
  try {
    localStorage.setItem(COOKIE_CONSENT_KEY, value);
  } catch {}
}

export function CookieConsent() {
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const consent = getCookieConsent();
    if (!consent) {
      // Small delay so it slides in after page load
      const timer = setTimeout(() => setVisible(true), 1200);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleChoice = (choice: "accepted" | "declined") => {
    setCookieConsent(choice);
    setExiting(true);
    setTimeout(() => setVisible(false), 400);

    if (choice === "declined") {
      // Remove GA scripts if they were loaded and disable both GA4 and Ads tags
      unloadGoogleTags();
    } else {
      loadGoogleTags();
    }
  };

  if (!visible) return null;

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 z-[9999] p-4 transition-all duration-400 ${
        exiting
          ? "translate-y-full opacity-0"
          : "translate-y-0 opacity-100 animate-in slide-in-from-bottom-full"
      }`}
    >
      <div className="mx-auto max-w-2xl rounded-2xl border border-border/60 bg-background/95 backdrop-blur-xl shadow-2xl shadow-black/20">
        <div className="p-5">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
              <Cookie className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-foreground">
                We value your privacy
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                We use cookies and analytics to improve your experience and understand how our app is used. 
                No personal study content is tracked, only anonymous usage patterns. You can decline 
                without losing any features.
              </p>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleChoice("declined")}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Decline
            </Button>
            <Button
              size="sm"
              onClick={() => handleChoice("accepted")}
              className="text-xs bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg px-5"
            >
              <Shield className="mr-1.5 h-3.5 w-3.5" />
              Accept cookies
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
