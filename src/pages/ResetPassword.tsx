import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { verifyPasswordResetCode, confirmPasswordReset } from "firebase/auth";
import { auth, functions as fbFunctions } from "../../firebase";
import { httpsCallable } from "firebase/functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Moon, Sun, ArrowLeft, Loader2 } from "lucide-react";
import MetaStudyLogo from "@/assets/metastudy-icon.png";

const ResetPassword = () => {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [mode, setMode] = useState<string | null>(null);
  const [oobCode, setOobCode] = useState<string | null>(null);
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetDone, setResetDone] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();
  const version = import.meta.env.VITE_APP_VERSION || "";

  useEffect(() => {
    const saved = localStorage.getItem("theme");
    const initialDark = saved !== "light";
    document.documentElement.classList.toggle("dark", initialDark);
  }, []);

  // Parse password reset link state
  useEffect(() => {
    const url = new URL(window.location.href);
    const m = url.searchParams.get('mode');
    const code = url.searchParams.get('oobCode');
    setMode(m);
    setOobCode(code);
    if (m === 'resetPassword' && code) {
      // Verify the out-of-band code and fetch the email
      (async () => {
        try {
          const mail = await verifyPasswordResetCode(auth, code);
          setVerifiedEmail(mail || null);
        } catch (e: any) {
          toast({ title: 'Invalid or expired link', description: e?.message || 'Please request a new password reset link.', variant: 'destructive' });
        }
      })();
    }
  }, []);

  const toggleTheme = () => {
    const isDark = document.documentElement.classList.contains("dark");
    const next = !isDark;
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setLoading(true);
    try {
      const send = httpsCallable(fbFunctions, 'sendBrandedPasswordResetEmail');
      await send({ email: email.trim().toLowerCase() });
      setSent(true);
      toast({ title: "Check your inbox", description: "We sent a password reset email if the address exists." });
    } catch (error: any) {
      toast({ title: "Unable to send reset", description: error.message || "Try again in a moment.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const onConfirmReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!oobCode) return;
    if (!newPassword || newPassword.length < 8) {
      toast({ title: 'Password too short', description: 'Use at least 8 characters.', variant: 'destructive' });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: 'Passwords do not match', description: 'Please confirm your new password.', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      await confirmPasswordReset(auth, oobCode, newPassword);
      setResetDone(true);
      // Clear query params
      const url = new URL(window.location.href);
      url.searchParams.delete('mode');
      url.searchParams.delete('oobCode');
      url.searchParams.delete('apiKey');
      window.history.replaceState({}, '', url.toString());
      toast({ title: 'Password updated', description: 'Your password has been reset successfully.' });
    } catch (e: any) {
      toast({ title: 'Reset failed', description: e?.message || 'Please try again or request a new link.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[image:var(--gradient-hero)] p-4 pt-14">
      <div className="fixed top-0 left-0 right-0 z-20 backdrop-blur supports-[backdrop-filter]:bg-background/70 border-b">
        <div className="max-w-7xl mx-auto flex items-center justify-between px-4 py-2">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate("/")} className="inline-flex items-center">
              <img src={MetaStudyLogo} alt="Logo" className="w-16 h-16 object-contain hidden dark:block" />
              <img src={MetaStudyLogo} alt="Logo" className="w-16 h-16 object-contain dark:hidden" />
            </button>
            <Button variant="outline" size="sm" onClick={() => navigate("/auth")}> 
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back to Sign in
            </Button>
            <div className="text-xs text-muted-foreground">{version ? `v${version}` : ""}</div>
          </div>
          <Button variant="outline" size="sm" onClick={toggleTheme} aria-label="Toggle theme">
            <Sun className="w-4 h-4 hidden dark:block" />
            <Moon className="w-4 h-4 dark:hidden" />
          </Button>
        </div>
      </div>

      <div className="absolute inset-0 bg-grid-pattern opacity-[0.02]" />

      <Card className="w-full max-w-sm relative z-10">
        {mode === 'resetPassword' && oobCode && verifiedEmail && !resetDone ? (
          <>
            <CardHeader className="text-center">
              <div className="flex justify-center mb-4">
                <img src={MetaStudyLogo} alt="Logo" className="w-24 h-24 object-contain hidden dark:block" />
                <img src={MetaStudyLogo} alt="Logo" className="w-24 h-24 object-contain dark:hidden" />
              </div>
              <CardTitle className="text-2xl">Set new password</CardTitle>
              <CardDescription>for {verifiedEmail}</CardDescription>
            </CardHeader>
            <form onSubmit={onConfirmReset}>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="password">New password</Label>
                  <Input id="password" type="password" value={newPassword} onChange={(e)=>setNewPassword(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm">Confirm password</Label>
                  <Input id="confirm" type="password" value={confirmPassword} onChange={(e)=>setConfirmPassword(e.target.value)} required />
                </div>
              </CardContent>
              <CardFooter className="flex gap-2">
                <Button type="submit" className="ml-auto" disabled={loading}>{loading ? <><Loader2 className='w-4 h-4 mr-2 animate-spin' />Updating...</> : 'Update password'}</Button>
              </CardFooter>
            </form>
          </>
        ) : resetDone ? (
          <>
            <CardHeader className="text-center">
              <CardTitle className="text-2xl">Password reset</CardTitle>
              <CardDescription>Your password has been updated successfully.</CardDescription>
            </CardHeader>
            <CardFooter className="flex justify-center">
              <Button onClick={()=>navigate('/auth')}>Back to Sign in</Button>
            </CardFooter>
          </>
        ) : (
          <>
            <CardHeader className="text-center">
              <div className="flex justify-center mb-4">
                <img src={MetaStudyLogo} alt="Logo" className="w-24 h-24 object-contain hidden dark:block" />
                <img src={MetaStudyLogo} alt="Logo" className="w-24 h-24 object-contain dark:hidden" />
              </div>
              <CardTitle className="text-2xl">Reset password</CardTitle>
              <CardDescription>Enter your account email and well send a reset link</CardDescription>
            </CardHeader>
            <form onSubmit={onSubmit}>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                {sent && (
                  <div className="text-xs text-green-600">If the email exists, a password reset link has been sent.</div>
                )}
              </CardContent>
              <CardFooter className="flex gap-2">
                <Button type="submit" size="sm" className="ml-auto h-8 px-3" disabled={loading}>
                  {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Sending...</> : "Send reset email"}
                </Button>
              </CardFooter>
            </form>
          </>
        )}
      </Card>
    </div>
  );
};

export default ResetPassword;
