import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { auth, db, functions as fbFunctions } from "../../firebase";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, getAdditionalUserInfo, signOut } from "firebase/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Moon, Sun, ArrowLeft, Loader2, GraduationCap } from "lucide-react";
import MetaStudyLogo from "@/assets/metastudy-icon.png";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { FadeIn } from "@/components/PageTransition";
import { Capacitor } from '@capacitor/core';

// Bump when ToS/Privacy Policy materially change so consent records stay accurate
const TOS_VERSION = "2026-08-16";

const Auth = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [unameSuggestions, setUnameSuggestions] = useState<string[]>([]);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [loading, setLoading] = useState(false);
  const [acceptTos, setAcceptTos] = useState(false);
  const [tab, setTab] = useState<string>("signin");
  const [institutions, setInstitutions] = useState<Array<{ id: string; name: string; emailDomain?: string; planTier?: string }>>([]);
  const [institutionId, setInstitutionId] = useState<string>("");
  const [institutionMode, setInstitutionMode] = useState(false);
  const [googleGateOpen, setGoogleGateOpen] = useState(false);
  const [googleGateUsername, setGoogleGateUsername] = useState("");
  const [googleGateSuggestions, setGoogleGateSuggestions] = useState<string[]>([]);
  const [googleGateAcceptTos, setGoogleGateAcceptTos] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();

  const redirectParam = new URLSearchParams(location.search).get('redirect') || '';
  const postAuthPath = redirectParam.startsWith('/') && !redirectParam.startsWith('//') && !redirectParam.startsWith('/auth')
    ? redirectParam
    : '/study';

  useEffect(() => {
    const saved = localStorage.getItem("theme");
    const initialDark = saved !== "light";
    document.documentElement.classList.toggle("dark", initialDark);
  }, []);

  // Load active institutions for optional signup selection
  // OPTIMIZED: Cache institutions in sessionStorage to avoid repeated reads
  useEffect(() => {
    (async () => {
      try {
        // Check sessionStorage cache first (valid for 1 minute)
        const cacheKey = 'institutions_cache';
        const cacheTimeKey = 'institutions_cache_ts';
        try {
          const cached = sessionStorage.getItem(cacheKey);
          const cachedTs = sessionStorage.getItem(cacheTimeKey);
          if (cached && cachedTs && Date.now() - parseInt(cachedTs) < 60000) {
            setInstitutions(JSON.parse(cached));
            return; // Use cached data, skip Firestore read
          }
        } catch {}
        
        const base = collection(db as any, 'institutions');
        // If rules allow, prefer active==true
        let rows: Array<{ id: string; name: string; emailDomain?: string; planTier?: string }> = [];
        try {
          const q = query(base as any, where('active','==', true));
          const snap = await getDocs(q as any);
          rows = snap.docs.map((d:any) => ({ id: d.id, name: String((d.data() as any)?.name || d.id), emailDomain: (d.data() as any)?.emailDomain, planTier: (d.data() as any)?.planTier }));
        } catch {
          const snap = await getDocs(base as any);
          rows = snap.docs.map((d:any) => ({ id: d.id, name: String((d.data() as any)?.name || d.id), emailDomain: (d.data() as any)?.emailDomain, planTier: (d.data() as any)?.planTier }));
        }
        const sorted = rows.sort((a,b)=>a.name.localeCompare(b.name));
        setInstitutions(sorted);
        
        // Cache for next time
        try {
          sessionStorage.setItem(cacheKey, JSON.stringify(sorted));
          sessionStorage.setItem(cacheTimeKey, String(Date.now()));
        } catch {}
      } catch {}
    })();
  }, []);

  const toggleTheme = () => {
    const isDark = document.documentElement.classList.contains("dark");
    const next = !isDark;
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  };

  const version = import.meta.env.VITE_APP_VERSION || "";

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (!acceptTos) {
        toast({ title: "Accept Terms of Service", description: "Please accept the Terms of Service to create an account.", variant: "destructive" });
        return;
      }

      if (institutionMode && !institutionId) {
        toast({ title: "Select institution", description: "Please select your institution to continue.", variant: "destructive" });
        return;
      }
      // Username validation: 3-20 chars, lowercase letters, numbers, or dot
      const uname = (username || "").trim().toLowerCase();
      const valid = /^[a-z0-9.]{3,20}$/.test(uname);
      if (!valid) {
        toast({ title: "Invalid username", description: "Usernames must be 3-20 characters using lowercase letters, numbers, or a dot.", variant: "destructive" });
        return;
      }
      // Pre-check availability - username must be available to proceed with signup
      try {
        const check = httpsCallable(fbFunctions, 'checkUsername');
        const resp = await check({ username: uname }) as any;
        if (!resp?.data?.available) {
          const sug = Array.isArray(resp?.data?.suggestions) ? resp.data.suggestions : [];
          setUnameSuggestions(sug.slice(0,3));
          toast({ 
            title: "Username not available", 
            description: sug.length 
              ? `"${uname}" is already taken. Try: ${sug.join(', ')}` 
              : `"${uname}" is already taken. Please choose a different username.`, 
            variant: "destructive" 
          });
          setLoading(false);
          return;
        }
      } catch (checkErr: any) {
        // If check fails, don't allow signup - username availability must be verified
        console.error('Username check failed:', checkErr);
        toast({ 
          title: "Could not verify username", 
          description: "Please try again or choose a different username.", 
          variant: "destructive" 
        });
        setLoading(false);
        return;
      }

      await createUserWithEmailAndPassword(auth, email, password);
      if (auth.currentUser && (firstName || lastName)) {
        const displayName = `${firstName} ${lastName}`.trim();
        await updateProfile(auth.currentUser, { displayName });
      }
      
      // OPTIMIZED: Reserve username + save profile fields in ONE cloud function call
      // This reduces writes: username, first_name, last_name, institutionId all saved in one transaction
      // No need to wait for onAuthCreate - reserveUsername uses merge:true
      const selected = institutions.find(i => i.id === institutionId);
      try {
        const reserve = httpsCallable(fbFunctions, 'reserveUsername');
        await reserve({ 
          username: uname,
          first_name: firstName || null,
          last_name: lastName || null,
          institutionId: institutionId || null,
          schoolName: selected?.name || null,
          // Consent record: ToS/Privacy acceptance + 13+ attestation (checkbox required above)
          tosAccepted: acceptTos === true,
          tosVersion: TOS_VERSION,
        });
      } catch (err: any) {
        // Username reservation failed
        console.error('Username reservation failed:', err);
        const suggestions = err?.details?.suggestions || [];
        if (Array.isArray(suggestions) && suggestions.length) setUnameSuggestions(suggestions.slice(0,3));
        toast({ 
          title: "Username could not be set", 
          description: suggestions.length ? `Try: ${suggestions.join(', ')}` : "You can set your username later in Account settings.", 
          variant: "destructive" 
        });
      }

      // Check if user has institution - either selected from dropdown OR detected by email domain
      const emailDomain = email.includes('@') ? email.split('@')[1].toLowerCase() : '';
      const matchedByDomain = institutions.find(i => i.emailDomain?.toLowerCase() === emailDomain);
      const isInstitutionUser = !!(institutionId || matchedByDomain);
      const matchedInstitution = matchedByDomain || institutions.find(i => i.id === institutionId);
      
      // For institution users, verify email domain matches and activate institution plan (no email verification needed)
      console.log('[Institution Signup] isInstitutionUser:', isInstitutionUser, 'emailDomain:', emailDomain, 'matchedByDomain:', matchedByDomain?.id, 'institutionId:', institutionId);
      if (isInstitutionUser && auth.currentUser && matchedInstitution) {
        // Verify email domain matches the institution's domain
        const institutionDomain = matchedInstitution.emailDomain?.toLowerCase();
        if (institutionDomain && emailDomain === institutionDomain) {
          console.log('[Institution Signup] Email domain matches institution, activating plan');
          // Fire both calls in parallel in the background - don't block
          // navigation to /study; toasts still report the outcome.
          const activate = httpsCallable(fbFunctions, 'activateInstitutionPlan');
          const sendVerify = httpsCallable(fbFunctions, 'sendInstitutionVerificationEmail');
          Promise.allSettled([
            activate({ institutionId: matchedInstitution.id }),
            sendVerify({}),
          ]).then(([activateRes, verifyRes]) => {
            if (activateRes.status === 'fulfilled') {
              toast({
                title: "Welcome to " + matchedInstitution.name + "!",
                description: "Your institution account has been activated.",
              });
            } else {
              console.error('[Institution Signup] Failed to activate institution plan:', activateRes.reason);
              toast({
                title: "Account created",
                description: "Institution plan will be activated shortly.",
              });
            }
            if (verifyRes.status === 'fulfilled') {
              toast({
                title: "Confirm your email",
                description: `We sent a confirmation link to ${email}. Please check your inbox.`,
              });
            } else {
              console.error('[Institution Signup] Failed to send verification email:', verifyRes.reason);
              toast({
                title: "Verification email failed",
                description: "We couldn't send the confirmation email. You can resend it from the verification screen.",
                variant: "destructive",
              });
            }
          });
        } else {
          console.log('[Institution Signup] Email domain does not match institution domain');
          toast({
            title: "Email domain mismatch",
            description: `Please use your ${matchedInstitution.name} email address (ending with @${institutionDomain}).`,
            variant: "destructive",
          });
        }
      }
      
      // Set flag for onboarding tutorial to play on first login
      localStorage.setItem('metastudy_just_signed_up', 'true');
      toast({
        title: "Account created!",
        description: isInstitutionUser ? "Welcome! Your institution account is ready." : "You can now sign in to start studying.",
      });
      // Navigate to study page directly after signup
      navigate('/study');
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // Handle redirect result for mobile (Capacitor) Google sign-in
  useEffect(() => {
    const handleRedirectResult = async () => {
      try {
        const result = await getRedirectResult(auth);
        if (!result) return;
        
        const info = getAdditionalUserInfo(result);
        const isNew = !!info?.isNewUser;
        const mode = localStorage.getItem('google_auth_mode') as 'signin' | 'signup' | null;
        localStorage.removeItem('google_auth_mode');

        if (mode === 'signin' && isNew) {
          try {
            const del = httpsCallable(fbFunctions, 'deleteAccountFull');
            await del({});
          } catch {
            try { await auth.currentUser?.delete(); } catch {}
          }
          try { await signOut(auth); } catch {}
          toast({
            title: "No account found",
            description: "No account exists with this Google account. Please sign up to create one.",
            variant: "destructive",
          });
          setTab('signup');
          return;
        }

        if (mode === 'signup' && isNew) {
          setGoogleGateOpen(true);
          setGoogleGateUsername("");
          setGoogleGateSuggestions([]);
          setGoogleGateAcceptTos(false);
          return;
        }

        if (mode === 'signup' && !isNew) {
          toast({
            title: "Account already exists",
            description: "You already have an account. You're signed in now.",
          });
        }

        localStorage.setItem('study_tab', 'chat');
        if (await userNeedsUsername(result.user.uid)) {
          openGoogleGate();
          return;
        }
        navigate(postAuthPath);
      } catch (error: any) {
        console.error('Redirect result error:', error);
      }
    };
    handleRedirectResult();
  }, [navigate, postAuthPath]);

  // A Google account that never finished the username/ToS gate has no
  // username on its user doc — send it back through the gate on any sign-in.
  const userNeedsUsername = async (uid: string) => {
    try {
      const snap = await getDoc(doc(db as any, 'users', uid));
      return !(snap.exists() && (snap.data() as any)?.username);
    } catch {
      return false;
    }
  };

  const openGoogleGate = () => {
    setGoogleGateOpen(true);
    setGoogleGateUsername("");
    setGoogleGateSuggestions([]);
    setGoogleGateAcceptTos(false);
  };

  const handleGoogle = async (mode: 'signin' | 'signup') => {
    setLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      
      // Use redirect for mobile (Capacitor), popup for web
      const isNative = Capacitor.isNativePlatform();
      
      if (isNative) {
        // Store mode for redirect handler
        localStorage.setItem('google_auth_mode', mode);
        await signInWithRedirect(auth, provider);
        return; // Redirect will handle the rest
      }
      
      // Web: use popup
      const result = await signInWithPopup(auth, provider);
      const info = getAdditionalUserInfo(result);
      const isNew = !!info?.isNewUser;

      // SIGN IN must not create accounts - silently roll back and redirect to signup
      if (mode === 'signin' && isNew) {
        try {
          const del = httpsCallable(fbFunctions, 'deleteAccountFull');
          await del({});
        } catch {
          try { await auth.currentUser?.delete(); } catch {}
        }
        try { await signOut(auth); } catch {}

        toast({
          title: "No account found",
          description: "No account exists with this Google account. Please sign up to create one.",
          variant: "destructive",
        });

        setTab('signup');
        setInstitutionMode(false);
        return;
      }

      // SIGN UP: for first-time users, require ToS + username before entering app.
      if (mode === 'signup' && isNew) {
        openGoogleGate();
        return;
      }

      // SIGN UP flow: if they already had an account, treat it as sign-in.
      if (mode === 'signup' && !isNew) {
        toast({
          title: "Account already exists",
          description: "You already have an account. You're signed in now.",
        });
      }

      // Account exists (or signup-mode with an existing account): if setup was
      // never finished, send them back through the gate instead of the app.
      if (await userNeedsUsername(result.user.uid)) {
        openGoogleGate();
        return;
      }

      // Reset to chat tab on login and navigate
      localStorage.setItem('study_tab', 'chat');
      navigate(postAuthPath);
    } catch (error: any) {
      const code = String(error?.code || '');
      // Silently ignore if user closed popup
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        return;
      }
      console.error('Google sign-in error:', error);
      toast({ title: "Sign in failed", description: "Could not sign in with Google. Please try again.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const parseDisplayName = (raw: string | null | undefined) => {
    const name = String(raw || '').trim();
    if (!name) return { first: null as string | null, last: null as string | null };
    const parts = name.split(/\s+/).filter(Boolean);
    const first = parts[0] || null;
    const last = parts.length > 1 ? parts.slice(1).join(' ') : null;
    return { first, last };
  };

  // Cancel keeps the Google account — the gate simply re-opens on the next
  // sign-in so setup can be finished then. Only the session is ended.
  const cancelGoogleGate = async () => {
    setGoogleGateOpen(false);
    setGoogleGateUsername("");
    setGoogleGateSuggestions([]);
    setGoogleGateAcceptTos(false);
    try { await signOut(auth); } catch {}
    setTab('signup');
    toast({
      title: 'Signup paused',
      description: 'Your account is saved. Finish choosing a username the next time you sign in.',
    });
  };

  const completeGoogleGate = async () => {
    const uname = (googleGateUsername || '').trim().toLowerCase();
    const valid = /^[a-z0-9.]{3,20}$/.test(uname);
    if (!googleGateAcceptTos) {
      toast({ title: 'Accept Terms of Service', description: 'Please accept the Terms of Service to continue.', variant: 'destructive' });
      return;
    }
    if (!valid) {
      toast({ title: 'Invalid username', description: 'Usernames must be 3-20 characters using lowercase letters, numbers, or a dot.', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      // Check availability
      const check = httpsCallable(fbFunctions, 'checkUsername');
      const resp = await check({ username: uname }) as any;
      if (!resp?.data?.available) {
        const sug = Array.isArray(resp?.data?.suggestions) ? resp.data.suggestions : [];
        setGoogleGateSuggestions(sug.slice(0, 3));
        toast({
          title: 'Username not available',
          description: sug.length ? `Try: ${sug.join(', ')}` : 'Please choose a different username.',
          variant: 'destructive',
        });
        return;
      }

      const { first, last } = parseDisplayName(auth.currentUser?.displayName);
      const reserve = httpsCallable(fbFunctions, 'reserveUsername');
      await reserve({
        username: uname,
        first_name: first,
        last_name: last,
        institutionId: null,
        schoolName: null,
        // Consent record: ToS/Privacy acceptance + 13+ attestation (checkbox required above)
        tosAccepted: googleGateAcceptTos === true,
        tosVersion: TOS_VERSION,
      });

      // Google users can belong to an institution via email domain - the server
      // verifies the domain match before applying any plan/status.
      const gDomain = (auth.currentUser?.email || '').split('@')[1]?.toLowerCase() || '';
      const gMatch = gDomain ? institutions.find(i => i.emailDomain?.toLowerCase() === gDomain) : null;
      if (gMatch) {
        try { await httpsCallable(fbFunctions, 'activateInstitutionPlan')({ institutionId: gMatch.id }); } catch {}
      }

      setGoogleGateOpen(false);
      // Set flags for onboarding tutorial and to prevent username gate from showing again
      localStorage.setItem('metastudy_just_signed_up', 'true');
      localStorage.setItem('metastudy_username_set_at', String(Date.now()));
      toast({ title: 'Welcome!', description: `Username @${uname} created.` });
      // Reset to chat tab on login
      localStorage.setItem('study_tab', 'chat');
      navigate(postAuthPath);
    } catch (e: any) {
      const suggestions = e?.details?.suggestions || [];
      if (Array.isArray(suggestions) && suggestions.length) setGoogleGateSuggestions(suggestions.slice(0, 3));
      toast({ title: 'Could not finish signup', description: e?.message || 'Please try again.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const enforceInstitutionLoginGate = async (uid: string) => {
    const userRef = doc(db as any, 'users', uid);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) return true;

    const userData = userSnap.data() as any;
    if (!userData?.verifiedInstitution) return true;

    if (!institutionMode || !institutionId) {
      try { await signOut(auth); } catch {}
      toast({
        title: 'Institution sign-in required',
        description: 'Please use "Sign in with Institution", select your institution, and sign in with your institution email.',
        variant: 'destructive',
      });
      return false;
    }

    const selectedInst = institutions.find((i) => i.id === institutionId);
    const selectedDomain = String(selectedInst?.emailDomain || '').toLowerCase();
    const userInstitutionId = String(userData?.institutionId || '');
    const signedInEmail = String(auth.currentUser?.email || '').toLowerCase();
    const signedInDomain = signedInEmail.includes('@') ? signedInEmail.split('@')[1] : '';

    const institutionMatches = (userInstitutionId && userInstitutionId === institutionId)
      || (selectedDomain && signedInDomain === selectedDomain);

    if (!institutionMatches) {
      try { await signOut(auth); } catch {}
      toast({
        title: 'Wrong institution selected',
        description: 'Please select your own institution and use your institution email to sign in.',
        variant: 'destructive',
      });
      return false;
    }

    return true;
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (institutionMode && !institutionId) {
        toast({ title: "Select institution", description: "Please select your institution to continue.", variant: "destructive" });
        setLoading(false);
        return;
      }

      let loginInput = (email || '').trim().toLowerCase();
      if (!loginInput.includes('@')) {
        // Non-email input: only the managed demo account supports username login
        try {
          const resolveDemo = httpsCallable(fbFunctions, 'getDemoLoginEmail');
          const res = await resolveDemo({ username: loginInput }) as any;
          loginInput = String(res?.data?.email || '');
        } catch {
          loginInput = '';
        }
        if (!loginInput) {
          toast({
            title: 'Email required',
            description: 'Please sign in with your email address.',
            variant: 'destructive',
          });
          return;
        }
      }

      const cred = await signInWithEmailAndPassword(auth, loginInput, password);
      const allowed = await enforceInstitutionLoginGate(cred.user.uid);
      if (!allowed) return;
      
      // Simply navigate - auth state listeners will handle the rest
      navigate(postAuthPath);
    } catch (error: any) {
      const code = String(error?.code || '');
      // User tried email/password but account uses Google sign-in only
      if (code === 'auth/invalid-credential' || code === 'auth/wrong-password') {
        toast({
          title: 'Sign in failed',
          description: 'Wrong password, or this account uses Google sign-in. Try "Continue with Google" instead.',
          variant: 'destructive',
        });
        return;
      }
      if (code === 'auth/user-not-found') {
        toast({
          title: 'No account found',
          description: 'No account exists with this email. Please sign up first.',
          variant: 'destructive',
        });
        setTab('signup');
        return;
      }
      if (code === 'failed-precondition') {
        toast({
          title: 'Sign in unavailable',
          description: error?.message || 'This account is currently disabled.',
          variant: 'destructive',
        });
        return;
      }
      if (code === 'permission-denied') {
        toast({
          title: 'Sign in failed',
          description: 'Invalid credentials or institution access requirements not met.',
          variant: 'destructive',
        });
        return;
      }
      if (code === 'auth/too-many-requests') {
        toast({
          title: 'Too many attempts',
          description: 'Too many failed login attempts. Please try again later or reset your password.',
          variant: 'destructive',
        });
        return;
      }
      // Generic friendly error for other cases
      toast({
        title: "Sign in failed",
        description: "Please check your login credentials, or try Google sign-in.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[image:var(--gradient-hero)] p-4 pt-20">
      <div className="fixed top-0 left-0 right-0 z-20 bg-background border-b-2 border-foreground">
        <div className="max-w-7xl mx-auto flex items-center justify-between px-4 py-2.5">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate("/")} className="inline-flex items-center gap-2">
              <img src={MetaStudyLogo} alt="Logo" className="w-9 h-9 object-contain border-2 border-foreground" />
              <span className="font-bold tracking-tight hidden sm:inline">MetaStudy</span>
            </button>
            <Button variant="outline" size="sm" className="border-2 border-foreground" onClick={() => navigate("/")}>
              <ArrowLeft className="w-4 h-4 mr-1" />
              Home
            </Button>
            <div className="text-xs text-muted-foreground">{version ? `v${version}` : ""}</div>
          </div>
          <Button variant="outline" size="sm" className="border-2 border-foreground" onClick={toggleTheme} aria-label="Toggle theme">
            <Sun className="w-4 h-4 hidden dark:block" />
            <Moon className="w-4 h-4 dark:hidden" />
          </Button>
        </div>
      </div>
      <div className="absolute inset-0 bg-grid-pattern opacity-60" />

      <FadeIn>
      <Card className="w-full max-w-sm relative z-10 border-2 border-foreground hard-shadow">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-3">
            <img src={MetaStudyLogo} alt="Logo" className="w-14 h-14 object-contain border-2 border-foreground" />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">MetaStudy</CardTitle>
          <CardDescription>Sign in or create an account to start studying</CardDescription>
        </CardHeader>

        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <div className="flex flex-col items-stretch">
            <div className="flex justify-center">
              <TabsList className="inline-flex gap-4">
                <TabsTrigger value="signin" className="px-3 py-1.5 text-sm">Sign In</TabsTrigger>
                <TabsTrigger value="signup" className="px-3 py-1.5 text-sm">Sign Up</TabsTrigger>
              </TabsList>
            </div>
            <div className="mt-4 min-h-[360px]">
              <TabsContent value="signin">
                <div className="px-6">
                  {!institutionMode ? (
                    <>
                      <Button type="button" className="w-full" variant="outline" disabled={loading} onClick={() => handleGoogle('signin')}>
                        {loading ? (
                          <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                        ) : (
                          <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                          </svg>
                        )}
                        {loading ? 'Signing in...' : 'Continue with Google'}
                      </Button>
                      <Button type="button" className="w-full mt-2" variant="outline" disabled={loading} onClick={() => setInstitutionMode(true)}>
                        <GraduationCap className="w-5 h-5 mr-2" />
                        Sign in with Institution
                      </Button>
                      <div className="my-4 h-px w-full bg-border" />
                    </>
                  ) : (
                    <Button type="button" className="w-full mb-4" variant="ghost" size="sm" onClick={() => { setInstitutionMode(false); setInstitutionId(''); }}>
                      ← Back to regular sign in
                    </Button>
                  )}
                </div>
                <form onSubmit={handleSignIn}>
                  <CardContent className="space-y-4">
                    {institutionMode && (
                      <div className="space-y-2">
                        <Label>Institution</Label>
                        <Select value={institutionId} onValueChange={setInstitutionId}>
                          <SelectTrigger>
                            <SelectValue placeholder={institutions.length ? 'Select your institution' : 'Loading institutions…'} />
                          </SelectTrigger>
                          <SelectContent>
                            {institutions.map(inst => (
                              <SelectItem key={inst.id} value={inst.id}>
                                {inst.name}
                              </SelectItem>
                            ))}
                            {institutions.length === 0 && (
                              <SelectItem value="__none__" disabled>No institutions available</SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <div className="space-y-2">
                      <Label htmlFor="signin-email">Email or demo username</Label>
                      <Input
                        id="signin-email"
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="signin-password">Password</Label>
                      <Input
                        id="signin-password"
                        type="password"
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-muted-foreground"></div>
                      <Button
                        type="button"
                        variant="link"
                        className="h-auto p-0 text-xs"
                        onClick={() => navigate('/reset-password')}
                        aria-label="Forgot password"
                      >
                        Forgot password?
                      </Button>
                    </div>
                  </CardContent>
                  <CardFooter>
                    <Button type="submit" size="sm" className="ml-auto h-8 px-3" disabled={loading}>
                      {loading ? (
                        <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Signing in...</>
                      ) : "Sign In"}
                    </Button>
                  </CardFooter>
                </form>
              </TabsContent>
              <TabsContent value="signup">
                <div className="px-6">
                  {!institutionMode ? (
                    <>
                      <Button type="button" className="w-full" variant="outline" disabled={loading} onClick={() => handleGoogle('signup')}>
                        {loading ? (
                          <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                        ) : (
                          <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                          </svg>
                        )}
                        {loading ? 'Creating account...' : 'Continue with Google'}
                      </Button>
                      <Button type="button" className="w-full mt-2" variant="outline" disabled={loading} onClick={() => setInstitutionMode(true)}>
                        <GraduationCap className="w-5 h-5 mr-2" />
                        Sign up with Institution
                      </Button>
                      <div className="my-4 h-px w-full bg-border" />
                    </>
                  ) : (
                    <Button type="button" className="w-full mb-4" variant="ghost" size="sm" onClick={() => { setInstitutionMode(false); setInstitutionId(''); }}>
                      ← Back to regular sign up
                    </Button>
                  )}
                </div>
                <form onSubmit={handleSignUp}>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="signup-username">Username</Label>
                      <Input
                        id="signup-username"
                        type="text"
                        placeholder="your_name"
                        value={username}
                        onChange={(e) => { setUsername(e.target.value.toLowerCase()); setUnameSuggestions([]); }}
                        required
                      />
                      <div className="text-xs text-muted-foreground">3-20 chars, lowercase letters, numbers, or dot</div>
                      {unameSuggestions.length > 0 && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          {unameSuggestions.map(s => (
                            <Button key={s} type="button" variant="outline" size="sm" onClick={() => { setUsername(s); setUnameSuggestions([]); }}>
                              {s}
                            </Button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="signup-first-name">First Name</Label>
                        <Input
                          id="signup-first-name"
                          type="text"
                          placeholder="John"
                          value={firstName}
                          onChange={(e) => setFirstName(e.target.value)}
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="signup-last-name">Last Name</Label>
                        <Input
                          id="signup-last-name"
                          type="text"
                          placeholder="Doe"
                          value={lastName}
                          onChange={(e) => setLastName(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="signup-email">Email</Label>
                      <Input
                        id="signup-email"
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                      />
                    </div>
                    {institutionMode && (
                      <div className="space-y-2">
                        <Label>Institution</Label>
                        <Select value={institutionId} onValueChange={setInstitutionId}>
                          <SelectTrigger>
                            <SelectValue placeholder={institutions.length ? 'Select your institution' : 'Loading institutions…'} />
                          </SelectTrigger>
                          <SelectContent>
                            {institutions.map(inst => (
                              <SelectItem key={inst.id} value={inst.id}>
                                {inst.name}
                              </SelectItem>
                            ))}
                            {institutions.length === 0 && (
                              <SelectItem value="__none__" disabled>No institutions available</SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <div className="space-y-2">
                      <Label htmlFor="signup-password">Password</Label>
                      <Input
                        id="signup-password"
                        type="password"
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        minLength={6}
                      />
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <input id="accept-tos" type="checkbox" checked={acceptTos} onChange={(e)=>setAcceptTos(e.target.checked)} />
                      <label htmlFor="accept-tos" className="select-none">I am at least 13 years old and agree to the <a href="/terms" target="_blank" rel="noopener noreferrer" className="underline">Terms of Service</a> and <a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline">Privacy Policy</a></label>
                    </div>
                  </CardContent>
                  <CardFooter>
                    <Button type="submit" size="sm" className="ml-auto h-8 px-3" disabled={loading || !acceptTos}>
                      {loading ? (
                        <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating account...</>
                      ) : "Create Account"}
                    </Button>
                  </CardFooter>
                </form>
              </TabsContent>
            </div>
          </div>
        </Tabs>
      </Card>
      </FadeIn>

      {googleGateOpen && (
        <div className="fixed inset-0 z-[100]">
          <div className="absolute inset-0 bg-black/70" />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <Card className="w-full max-w-md p-6">
              <div className="space-y-4">
                <div>
                  <div className="text-lg font-semibold">Finish setting up your account</div>
                  <div className="text-sm text-muted-foreground">Accept Terms of Service and choose a username to continue.</div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="google-gate-username">Username</Label>
                  <Input
                    id="google-gate-username"
                    value={googleGateUsername}
                    onChange={(e) => { setGoogleGateUsername(e.target.value.toLowerCase()); setGoogleGateSuggestions([]); }}
                    placeholder="your.name"
                    disabled={loading}
                    autoFocus
                  />
                  <div className="text-xs text-muted-foreground">3-20 chars, lowercase letters, numbers, or dot</div>
                  {googleGateSuggestions.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {googleGateSuggestions.map((s) => (
                        <Button key={s} type="button" variant="outline" size="sm" onClick={() => { setGoogleGateUsername(s); setGoogleGateSuggestions([]); }} disabled={loading}>
                          {s}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input id="google-gate-tos" type="checkbox" checked={googleGateAcceptTos} onChange={(e)=>setGoogleGateAcceptTos(e.target.checked)} />
                  <label htmlFor="google-gate-tos" className="select-none">I am at least 13 years old and agree to the <a href="/terms" target="_blank" rel="noopener noreferrer" className="underline">Terms of Service</a> and <a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline">Privacy Policy</a></label>
                </div>

                <div className="flex gap-2 justify-end">
                  <Button type="button" variant="ghost" onClick={cancelGoogleGate} disabled={loading}>
                    Cancel
                  </Button>
                  <Button type="button" onClick={completeGoogleGate} disabled={loading}>
                    {loading ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</>
                    ) : 'Continue'}
                  </Button>
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
};

export default Auth;
