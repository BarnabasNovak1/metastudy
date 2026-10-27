import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { auth, functions as fbFunctions } from "../../firebase";
import { httpsCallable } from "firebase/functions";
import { signOut } from "firebase/auth";
import { useUserData } from "@/contexts/UserDataContext";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2, MailCheck, LogOut } from "lucide-react";
import MetaStudyLogo from "@/assets/metastudy-icon.png";

/**
 * Full-screen gate that blocks institution users whose email is not yet
 * confirmed via our custom token system. Confirmation status is driven by
 * `profile.emailConfirmedAt` in Firestore, which is updated by the
 * confirmInstitutionEmail callable. The UserDataContext profile listener will
 * push the new value here automatically, so the gate clears the moment
 * confirmation lands (no polling needed).
 */
const EmailVerificationGate = () => {
  const { uid, profile } = useUserData();
  const { toast } = useToast();
  const location = useLocation();
  const [resending, setResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState<number>(0);

  const institutionId = String((profile as any)?.institutionId || "").trim();
  const isInstitutionUser = !!institutionId;
  const emailConfirmed = !!(profile as any)?.emailConfirmedAt;

  // Routes where the gate should not appear (auth/landing/legal/confirm page)
  const allowList = useMemo(
    () => new Set([
      "/",
      "/auth",
      "/auth/confirm",
      "/reset-password",
      "/faq",
      "/pricing",
    ]),
    []
  );
  const onAllowedRoute = allowList.has(location.pathname);

  // Tick down the resend cooldown
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const id = window.setInterval(() => {
      setResendCooldown((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => window.clearInterval(id);
  }, [resendCooldown]);

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    setResending(true);
    try {
      const sendVerify = httpsCallable(fbFunctions, "sendInstitutionVerificationEmail");
      const res = (await sendVerify({})) as any;
      if (res?.data?.alreadyVerified) {
        toast({ title: "Email already confirmed", description: "Welcome aboard!" });
        return;
      }
      // Start 60s cooldown to prevent rate-limit errors from Firebase Auth
      setResendCooldown(60);
      toast({
        title: "Email sent",
        description: `We sent a new confirmation link to ${auth.currentUser?.email || "your inbox"}. Check spam if you don't see it.`,
      });
    } catch (e: any) {
      console.error("Resend verification failed:", e);
      const code = String(e?.code || "");
      if (code.includes("resource-exhausted")) {
        setResendCooldown(60);
      }
      toast({
        title: "Could not resend email",
        description: e?.message || "Please try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setResending(false);
    }
  };

  const handleSignOut = async () => {
    try { await signOut(auth); } catch {}
  };

  // Visibility rules
  if (!uid) return null;
  if (!isInstitutionUser) return null;
  if (emailConfirmed) return null;
  if (onAllowedRoute) return null;

  const email = auth.currentUser?.email || "";

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-background/95 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border bg-card shadow-xl p-6 text-center">
        <div className="flex justify-center mb-4">
          <img
            src={MetaStudyLogo}
            alt="MetaStudy"
            className="h-14 w-14 rounded-xl"
          />
        </div>
        <div className="flex justify-center mb-3">
          <div className="rounded-full bg-primary/10 p-2">
            <MailCheck className="h-5 w-5 text-primary" />
          </div>
        </div>
        <h2 className="text-xl font-bold mb-2">Confirm your email</h2>
        <p className="text-sm text-muted-foreground mb-1">
          We sent a confirmation link to:
        </p>
        <p className="text-sm font-medium mb-5 break-all">{email}</p>
        <p className="text-xs text-muted-foreground mb-6">
          Click the link in that email to activate your institution account. This page will unlock automatically once you confirm.
        </p>

        <div className="flex flex-col gap-2">
          <Button
            onClick={handleResend}
            disabled={resending || resendCooldown > 0}
            className="w-full"
          >
            {resending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Resending...
              </>
            ) : resendCooldown > 0 ? (
              `Resend available in ${resendCooldown}s`
            ) : (
              "Resend confirmation email"
            )}
          </Button>
          <Button onClick={handleSignOut} variant="ghost" className="w-full text-muted-foreground">
            <LogOut className="h-4 w-4 mr-2" /> Sign out
          </Button>
        </div>

        <p className="text-[11px] text-muted-foreground mt-5">
          Didn't get it? Check your spam folder or try resending.
        </p>
      </div>
    </div>
  );
};

export default EmailVerificationGate;
