import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import MetaStudyLogo from "@/assets/metastudy-icon.png";

type Payload = { kind: 'achievement' | 'levelup'; id?: string; title?: string; description?: string };

export const AchievementToast = () => {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [show, setShow] = useState(false);
  const hideTimer = useRef<number | null>(null);
  const queueRef = useRef<Payload[]>([]);
  const busyRef = useRef(false);
  const navigate = useNavigate();

  const playNext = () => {
    if (busyRef.current) return;
    const next = queueRef.current.shift();
    if (!next) return;
    busyRef.current = true;
    setPayload(next);
    setShow(true);
    try { window.dispatchEvent(new CustomEvent('achievement-toast-show')); } catch {}
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      setShow(false);
      try { window.dispatchEvent(new CustomEvent('achievement-toast-hide')); } catch {}
      // allow exit animation then play next
      window.setTimeout(() => {
        busyRef.current = false;
        playNext();
      }, 350);
    }, 5000);
  };

  useEffect(() => {
    const onAch = (e: Event) => {
      const d = (e as CustomEvent)?.detail as { id: string; title?: string; description?: string };
      if (!d || !d.id) return;
      queueRef.current.push({ kind: 'achievement', ...d });
      playNext();
    };
    window.addEventListener("achievement-earned", onAch as any);
    return () => {
      window.removeEventListener("achievement-earned", onAch as any);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, []);

  if (!payload) return null;

  const header = 'Achievement Unlocked';

  return (
    <div className="pointer-events-none fixed top-4 left-1/2 z-[60] -translate-x-1/2 flex justify-center px-2">
      <div
        className={`pointer-events-auto transition-all duration-500 ${show ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-4"}`}
        onClick={() => { navigate("/account?tab=achievements"); }}
        role="button"
        aria-label="View achievements"
      >
        <Card className="mx-auto flex items-center gap-3 rounded-xl border-primary/40 bg-card/95 px-4 py-3 shadow-lg backdrop-blur-md hover:border-primary cursor-pointer">
          <>
            <img src={MetaStudyLogo} alt="Logo" className="h-16 w-16 rounded hidden dark:block" />
            <img src={MetaStudyLogo} alt="Logo" className="h-16 w-16 rounded dark:hidden" />
          </>
          <div>
            <div className="text-sm text-muted-foreground">{header}</div>
            <div className="text-base font-semibold leading-tight truncate max-w-[60vw]">{payload.title || payload.id}</div>
            {payload.description ? (
              <div className="text-xs text-muted-foreground truncate max-w-[60vw]">{payload.description}</div>
            ) : null}
          </div>
        </Card>
      </div>
    </div>
  );
};

export default AchievementToast;
