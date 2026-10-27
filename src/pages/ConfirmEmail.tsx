import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { functions as fbFunctions, auth } from "../../firebase";
import { httpsCallable } from "firebase/functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import MetaStudyLogo from "@/assets/metastudy-icon.png";

/**
 * Page mounted at /auth/confirm. Reads ?t=TOKEN, calls confirmInstitutionEmail,
 * shows a success state, then auto-redirects to /study after 3 seconds.
 *
 * Works whether the user is signed in (most common: they signed up minutes ago
 * in this browser) or not (clicked the link from a different device).
 */
const ConfirmEmail = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState<string>("");
  const [countdown, setCountdown] = useState<number>(3);
  const calledRef = useRef(false);

  const token = (new URLSearchParams(location.search).get("t") || "").trim();

  useEffect(() => {
    if (calledRef.current) return; // guard against StrictMode double-invoke
    calledRef.current = true;

    if (!token) {
      setStatus("error");
      setMessage("Missing confirmation token. Please open the link from your email again.");
      return;
    }

    (async () => {
      try {
        const confirm = httpsCallable(fbFunctions, "confirmInstitutionEmail");
        await confirm({ token });
        // If the user is signed in in this tab, refresh their auth user so any
        // Firebase-emailVerified-dependent UI updates too.
        try { await auth.currentUser?.reload(); } catch {}
        setStatus("success");
      } catch (e: any) {
        console.error("Email confirmation failed:", e);
        setStatus("error");
        setMessage(
          e?.message ||
            "This confirmation link is invalid or has expired. Please request a new one from the app."
        );
      }
    })();
  }, [token]);

  // Auto-redirect after success
  useEffect(() => {
    if (status !== "success") return;
    setCountdown(3);
    const tick = window.setInterval(() => {
      setCountdown((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    const to = window.setTimeout(() => {
      const destination = auth.currentUser ? "/study" : "/auth";
      navigate(destination, { replace: true });
    }, 3000);
    return () => {
      window.clearInterval(tick);
      window.clearTimeout(to);
    };
  }, [status, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md p-8 text-center">
        <div className="flex justify-center mb-5">
          <img
            src={MetaStudyLogo}
            alt="MetaStudy"
            className="h-16 w-16 rounded-xl"
          />
        </div>

        {status === "loading" && (
          <>
            <div className="flex justify-center mb-3">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
            <h1 className="text-xl font-bold mb-2">Confirming your email...</h1>
            <p className="text-sm text-muted-foreground">
              Hang tight. This takes just a second.
            </p>
          </>
        )}

        {status === "success" && (
          <>
            <div className="flex justify-center mb-3">
              <div className="rounded-full bg-green-100 dark:bg-green-900/30 p-3">
                <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400" />
              </div>
            </div>
            <h1 className="text-xl font-bold mb-2">Email confirmed!</h1>
            <p className="text-sm text-muted-foreground mb-4">
              Your account is now active. Redirecting you in {countdown}s...
            </p>
            <Button
              onClick={() => navigate(auth.currentUser ? "/study" : "/auth", { replace: true })}
              className="w-full"
            >
              Continue now
            </Button>
          </>
        )}

        {status === "error" && (
          <>
            <div className="flex justify-center mb-3">
              <div className="rounded-full bg-destructive/10 p-3">
                <AlertTriangle className="h-8 w-8 text-destructive" />
              </div>
            </div>
            <h1 className="text-xl font-bold mb-2">Could not confirm email</h1>
            <p className="text-sm text-muted-foreground mb-5">{message}</p>
            <div className="flex flex-col gap-2">
              <Button onClick={() => navigate("/study", { replace: true })} className="w-full">
                Go to app
              </Button>
              <Button
                onClick={() => navigate("/auth", { replace: true })}
                variant="outline"
                className="w-full"
              >
                Sign in
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
};

export default ConfirmEmail;
