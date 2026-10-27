import { useEffect, useState, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { auth, db, storage, functions as fbFunctions } from "../../firebase";
import { useUserData } from "@/contexts/UserDataContext";
import { doc, getDoc, getDocs, collection, setDoc, query, limit, orderBy, startAt, endAt, deleteDoc, serverTimestamp, getCountFromServer } from "firebase/firestore";
import { batchFetchUserProfiles } from "@/lib/firestore-utils";
import { getDownloadURL, ref, uploadBytesResumable, updateMetadata, deleteObject, listAll } from "firebase/storage";
import { updateProfile, signOut } from "firebase/auth";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Cropper from "react-easy-crop";
import { Slider } from "@/components/ui/slider";
import { Footer } from "@/components/Footer";
import { getAchievements, ALL_ACHIEVEMENTS, getRankTitle, getLevelInfo } from "@/lib/achievements";
import { getAchievementVisual } from "@/lib/achievement-icons";
import { UnifiedProfilePopup } from "@/components/UnifiedProfilePopup";
import { createPortalSession } from "@/lib/billing";
import { Pricing } from "@/components/Pricing";
import MetaStudyLogo from "@/assets/metastudy-icon.png";
import { Moon, Sun, Trophy, Gauge, BarChart3, Users, Search, UserCircle, Loader2, Star, RefreshCw, GraduationCap, Trash2, Ban, AlertCircle, ShieldCheck } from "lucide-react";
import { PrivacyCenter } from "@/components/PrivacyCenter";
import { ReportIssueDialog } from "@/components/ReportIssueDialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { SEO } from "@/components/SEO";
import LoadingOverlay from "@/components/LoadingOverlay";
import { httpsCallable } from "firebase/functions";
import { getRandomFunFact } from "@/lib/funFacts";
import { FeatureHelpButton } from "@/components/OnboardingTour";
import { UserDashboard } from "@/components/UserDashboard";
import { FadeIn } from "@/components/PageTransition";

const Account = () => {
  const userData = useUserData();
  // Check if user is part of an institution (verified institution user)
  const isInstitutionUser = !!(userData.profile as any)?.verifiedInstitution;
  const isDemoUser = !!(userData.profile as any)?.isDemoUser;
  const uid = userData.uid;
  const [isDark, setIsDark] = useState<boolean>(false);
  const [loadingUsage, setLoadingUsage] = useState(true);
  const [loadingAch, setLoadingAch] = useState(true);
  const [usage, setUsage] = useState<any>(null);
  const [achEarned, setAchEarned] = useState<Record<string, { earned_at: string }>>({});
  const [streakCurrent, setStreakCurrent] = useState<number>(0);
  const [streakLongest, setStreakLongest] = useState<number>(0);
  const [daysTotal, setDaysTotal] = useState<number>(0);
  const [xp, setXp] = useState<number>(0);
  const [tab, setTab] = useState<string>("usage");
  const [counters, setCounters] = useState<any>(null);
  const [, setDerivedCounts] = useState<{[k:string]: number}>({});
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState<string>("");
  const [deleteConfirmGlow, setDeleteConfirmGlow] = useState<boolean>(false);
  const [resetSent, setResetSent] = useState(false);
  const [displayName, setDisplayName] = useState<string>('');
  const [photoURL, setPhotoURL] = useState<string | null>(null);
  const [username, setUsername] = useState<string>('');
  const [educationLevel, setEducationLevel] = useState<string>('');
  const [newUsername, setNewUsername] = useState<string>('');
  const [unameSuggestions, setUnameSuggestions] = useState<string[]>([]);
  const [changingUname, setChangingUname] = useState<boolean>(false);
  const [changeUnameOpen, setChangeUnameOpen] = useState<boolean>(false);
  const [cropOpen, setCropOpen] = useState(false);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedArea, setCroppedArea] = useState<any>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const version = import.meta.env.VITE_APP_VERSION || "";
  const { toast } = useToast();
  const [friends, setFriends] = useState<Array<{ id: string; friend_uid: string; favorite?: boolean }>>([]);
  const [friendInfo, setFriendInfo] = useState<Record<string, { username?: string; photo_url?: string | null; education_level?: string }>>({});
  const [findQuery, setFindQuery] = useState("");
  const [findLoading, setFindLoading] = useState(false);
  const [findError, setFindError] = useState("");
  const [findResult, setFindResult] = useState<{ uid: string; username: string; photo_url?: string | null } | null>(null);
  const [findResults, setFindResults] = useState<Array<{ uid: string; username: string; photo_url?: string | null }>>([]);
  const findTimerRef = useRef<number | null>(null);
  const [incomingReqs, setIncomingReqs] = useState<Array<{ id: string; from: string; from_username?: string; from_photo?: string | null }>>([]);
  const [outgoingReqs, setOutgoingReqs] = useState<Array<{ id: string; to: string; to_username?: string }>>([]);
  const [profileOpen, setProfileOpen] = useState(false);
  const [, setProfileLoading] = useState(false);
  const [profileUser, setProfileUser] = useState<{ uid: string; username?: string; photo_url?: string | null } | null>(null);
  const [, setProfileExists] = useState<boolean>(true);
  const [, setProfileXp] = useState<number>(0);
  const [, setProfileCounters] = useState<any>(null);
  const [profileDaysTotal, setProfileDaysTotal] = useState<number>(0);
  const [profileStreakCurrent, setProfileStreakCurrent] = useState<number>(0);
  const [profileStreakLongest, setProfileStreakLongest] = useState<number>(0);
  const [, setProfileLatestFrom] = useState<{ emoji: string; ts: number } | null>(null);
  const [, setProfileLatestSent] = useState<{ emoji: string; ts: number } | null>(null);
  const [blockConfirmOpen, setBlockConfirmOpen] = useState(false);
  const [blockTarget, setBlockTarget] = useState<{ uid: string; username?: string } | null>(null);
  const [deleteFriendOpen, setDeleteFriendOpen] = useState(false);
  const [deleteFriendTarget, setDeleteFriendTarget] = useState<{ uid: string; username?: string } | null>(null);
  const [showBlocked, setShowBlocked] = useState(false);
  const [blocked, setBlocked] = useState<string[]>([]);
  const [blockedInfo, setBlockedInfo] = useState<Record<string, { username?: string; photo_url?: string | null }>>({});
  const [requestInfo, setRequestInfo] = useState<Record<string, { username?: string; photo_url?: string | null }>>({});
  const [funFact, setFunFact] = useState<string | null>(null);
  const cleanupRanRef = useRef<boolean>(false);
  const friendInfoFetchKeyRef = useRef<string>('');
  const [upsellOpen, setUpsellOpen] = useState(false);
  const [upsellMsg] = useState('');
  const [syncingUsage, setSyncingUsage] = useState(false);
  const [syncingRenewal, setSyncingRenewal] = useState(false);
  const [billingLoading, setBillingLoading] = useState(false);
  const [syncingPlan, setSyncingPlan] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const billingOpenedRef = useRef<number>(0);

  // Auto-sync renewal date only when returning from billing portal (within 5 min of opening)
  useEffect(() => {
    const plan = usage?.plan || 'free';
    if (plan === 'free' || !uid) return;

    const handleFocus = async () => {
      // Only sync if billing portal was opened within last 5 minutes
      const now = Date.now();
      if (now - billingOpenedRef.current > 300000 || billingOpenedRef.current === 0) return;
      billingOpenedRef.current = 0; // Reset so it doesn't sync again on next focus

      try {
        const syncRenewsAt = httpsCallable(fbFunctions, 'syncRenewsAtFromStripe');
        await syncRenewsAt();
                  // Context's profile onSnapshot listener auto-updates usage; no extra read needed
      } catch {}
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [uid, usage?.plan]);

  useEffect(() => {
    const saved = localStorage.getItem("theme");
    const initialDark = saved !== "light";
    setIsDark(initialDark);
    document.documentElement.classList.toggle("dark", initialDark);
  }, []);

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  };

  // Toggle favorite on a friend
  const toggleFavorite = async (friendUid: string, next: boolean) => {
    if (!uid) return;
    try {
      await setDoc(doc(db as any, 'users', uid, 'friends', friendUid), { favorite: next }, { merge: true });
      setFriends(prev => prev.map(f => f.friend_uid === friendUid ? { ...f, favorite: next } : f));
    } catch {}
  };

  // Unfriend (remove both directions)
  
  const handleDeleteAccount = async () => {
    if (!uid) return;
    if (isDemoUser) {
      toast({ title: 'Not allowed', description: 'Demo account cannot be deleted. Please sign out instead.', variant: 'destructive' });
      return;
    }
    setDeleting(true);
    try {
      const del = httpsCallable(fbFunctions, 'deleteAccountFull');
      await del({});
      try { await signOut(auth); } catch {}
      // Inform the user and delay navigation 10s
      toast({
        title: 'Account deleted',
        description: 'Your subscription was cancelled and your account and data were deleted. Redirecting in 10 seconds…',
        duration: 10000,
      });
      setDeleteOpen(false);
      setTimeout(() => { window.location.href = '/'; }, 10000);
    } catch (e: any) {
      toast({ title: 'Delete failed', description: e?.message || 'Could not delete account', variant: 'destructive' });
    } finally {
      setDeleting(false);
    }
  };

  // reset confirm field whenever dialog closes
  useEffect(() => {
    if (!deleteOpen) {
      setDeleteConfirmText("");
      setDeleteConfirmGlow(false);
    }
  }, [deleteOpen]);

  // Get blocked list from context
  useEffect(() => {
    setBlocked(userData.blockedUsers);
  }, [userData.blockedUsers]);

  // Fetch profile info for blocked users for display
  useEffect(() => {
    // OPTIMIZED: Use batchFetchUserProfiles with caching
    (async () => {
      const missing = blocked.filter(b => !blockedInfo[b]);
      if (missing.length === 0) return;
      const profiles = await batchFetchUserProfiles(missing);
      const out: Record<string, { username?: string; photo_url?: string | null }> = {};
      profiles.forEach((profile, uid) => {
        out[uid] = { username: profile.username?.toLowerCase(), photo_url: profile.photo_url };
      });
      if (Object.keys(out).length) setBlockedInfo(prev => ({ ...prev, ...out }));
    })();
  }, [blocked]);

  // Sync displayName and photoURL from context (no separate auth listener needed)
  useEffect(() => {
    const u = userData.user;
    if (u) setDisplayName(u.displayName || (u.email || '').split('@')[0] || 'Me');
  }, [userData.user]);

  useEffect(() => {
    if (userData.photoURL) setPhotoURL(userData.photoURL);
  }, [userData.photoURL]);

  // Read tab from query string (?tab=achievements|usage|stats|friends)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const t = params.get('tab');
    if (t === 'achievements' || t === 'usage' || t === 'stats' || t === 'friends' || t === 'privacy') setTab(t);
  }, [location.search]);

  // When opening Friends tab, run a server-side cleanup to remove orphaned friends
  useEffect(() => {
    (async () => {
      if (!uid) return;
      if (tab !== 'friends') return;
      // Lazy-start the friends listener only when the Friends tab is open
      userData.requestFriends();
      if (cleanupRanRef.current) return;
      try {
        const fn = httpsCallable(fbFunctions, 'cleanupMyFriends');
        await fn({});
      } catch {}
      cleanupRanRef.current = true;
    })();
  }, [uid, tab]);

  // Get usage data from context
  useEffect(() => {
    if (!uid) { setLoadingUsage(false); return; }
    setUsage(userData.profile);
    setUsername(userData.username);
    setEducationLevel(userData.profile?.education_level || '');
    setLoadingUsage(false);
  }, [uid, userData.profile, userData.username]);

  // Achievements - use context data + one-time fetch for earned badges
  useEffect(() => {
    if (!uid) { setLoadingAch(false); return; }
    // Use context data for streaks/days (already fetched by UserDataContext)
    setDaysTotal(Number(userData.achievements.days_total || 0));
    setStreakCurrent(Number(userData.achievements.streak_current || 0));
    setStreakLongest(Number(userData.achievements.streak_longest || 0));
    // Use context xp instead of separate Firestore read
    setXp(userData.xp || 0);
    // Fetch earned achievements (not in context by default)
    const loadEarned = async () => {
      try {
        const { data } = await getAchievements(uid);
        setAchEarned(data.earned || {});
      } finally { setLoadingAch(false); }
    };
    loadEarned();
  }, [uid, userData.achievements, userData.xp]);

  // While viewing a friend's profile, load their public stats (one-time read, not real-time)
  useEffect(() => {
    if (!profileOpen || !profileUser?.uid) return;
    const loadAchievements = async () => {
      try {
        // PRIVACY: read the public_profiles mirror (meta/achievements is owner-only)
        const ref = doc(db as any, 'public_profiles', profileUser.uid);
        const snap = await getDoc(ref as any);
        if (!snap.exists()) return;
        const d = snap.data() as any;
        setProfileDaysTotal(Number(d.days_total || 0));
        setProfileStreakCurrent(Number(d.streak_current || 0));
        setProfileStreakLongest(Number(d.streak_longest || 0));
      } catch {}
    };
    loadAchievements();
  }, [profileOpen, profileUser?.uid]);

  // Get counters from context
  useEffect(() => {
    if (!uid) { setCounters(null); return; }
    setCounters(userData.counters);
    setXp(userData.xp);
  }, [uid, userData.counters, userData.xp]);

  // Get friends from context
  useEffect(() => {
    if (!uid) { setFriends([]); return; }
    const list: typeof friends = [];
    userData.friends.forEach(f => {
      list.push({ id: f.friend_uid, friend_uid: f.friend_uid, favorite: f.isFavorite });
    });
    setFriends(list);
  }, [uid, userData.friends]);

  // Friend display info (username, photo) - OPTIMIZED: Batch reads instead of per-friend listeners
  useEffect(() => {
    if (tab !== 'friends') return;
    if (friends.length === 0) {
      setFriendInfo({});
      friendInfoFetchKeyRef.current = '';
      return;
    }

    const friendUids = [...new Set(friends.map(f => f.friend_uid))].sort();
    const fetchKey = friendUids.join('|');
    if (friendInfoFetchKeyRef.current === fetchKey) return;
    friendInfoFetchKeyRef.current = fetchKey;

    const fetchFriendInfo = async () => {
      try {
        if (friendUids.length === 0) return;
        
        // Use cached batch fetch for better performance
        const profiles = await batchFetchUserProfiles(friendUids);
        
        const newFriendInfo: Record<string, any> = {};
        profiles.forEach((profile, uid0) => {
          newFriendInfo[uid0] = {
            username: profile.username,
            photo_url: profile.photo_url,
            // The friend doc itself is authoritative - never hide friends just
            // because their public_profiles mirror doc is missing
            exists: true
          };
        });
        
        setFriendInfo(prev => ({ ...prev, ...newFriendInfo }));
      } catch (error) {
        console.error('Failed to fetch friend info:', error);
      }
    };

    fetchFriendInfo();
  }, [friends, tab]);

  // Get friend requests from context
  useEffect(() => {
    if (!uid) { setIncomingReqs([]); setOutgoingReqs([]); return; }
    const incoming: typeof incomingReqs = [];
    const outgoing: typeof outgoingReqs = [];
    const needLookup = new Set<string>();

    const newRequestInfo: Record<string, { username?: string; photo_url?: string | null }> = {};
    
    userData.friendRequests.forEach(req => {
      const status = req.status || 'pending';
      if (status === 'pending') {
        if (req.to === uid) {
          // Incoming request - I'm the recipient
          const fromUsername = req.fromUsername || (req as any).from_username || '';
          const fromPhoto = req.fromPhotoURL || (req as any).from_photo || null;
          incoming.push({ id: req.id, from: req.from, from_username: fromUsername, from_photo: fromPhoto });
          if (fromUsername) {
            newRequestInfo[req.from] = { username: fromUsername, photo_url: fromPhoto };
          } else {
            needLookup.add(req.from);
          }
        } else {
          // Outgoing request - I'm the sender
          const toUsername = (req as any).to_username || (req as any).toUsername || '';
          const toPhoto = (req as any).to_photo || null;
          outgoing.push({ id: req.id, to: req.to, to_username: toUsername });
          if (toUsername || toPhoto) {
            // Also store in requestInfo for photo lookup display
            newRequestInfo[req.to] = { username: toUsername, photo_url: toPhoto };
          }
          if (!toUsername) {
            needLookup.add(req.to);
          }
        }
      }
    });
    
    // Merge stored usernames into requestInfo
    if (Object.keys(newRequestInfo).length) {
      setRequestInfo(prev => ({ ...prev, ...newRequestInfo }));
    }

    setIncomingReqs(incoming);
    setOutgoingReqs(outgoing);

    if (needLookup.size > 0) {
      // OPTIMIZED: Use batchFetchUserProfiles with caching
      (async () => {
        const entries = Array.from(needLookup);
        const profiles = await batchFetchUserProfiles(entries);
        const out: Record<string, { username?: string; photo_url?: string | null }> = {};
        profiles.forEach((profile, uid) => {
          out[uid] = { username: profile.username?.toLowerCase(), photo_url: profile.photo_url };
        });
        if (Object.keys(out).length) setRequestInfo(prev => ({ ...prev, ...out }));
      })();
    }
  }, [uid, userData.friendRequests]);

  // Search helpers
  const runTypeahead = async (prefix: string) => {
    try {
      if (prefix.length < 3) { setFindResults([]); return; }
      const q = query(
        collection(db as any, 'usernames'),
        orderBy('__name__'),
        startAt(prefix),
        endAt(prefix + '\uf8ff'),
        limit(10)
      );
      const snap = await getDocs(q as any);
      
      // OPTIMIZED: Collect UIDs and batch fetch profiles with caching
      const usernameMap: Record<string, string> = {};
      const uids: string[] = [];
      snap.docs.forEach((d: any) => {
        const username = d.id;
        const uid0 = (d.data() as any)?.uid;
        if (uid0) {
          usernameMap[uid0] = username;
          uids.push(uid0);
        }
      });
      
      const profiles = await batchFetchUserProfiles(uids);
      const rows: Array<{ uid: string; username: string; photo_url?: string | null }> = [];
      uids.forEach((uid0) => {
        const profile = profiles.get(uid0);
        rows.push({
          uid: uid0,
          username: usernameMap[uid0],
          photo_url: profile?.photo_url || null
        });
      });
      setFindResults(rows);
    } catch { setFindResults([]); }
  };

  const findUserByUsername = async () => {
    try {
      setFindError(""); setFindResult(null); setFindLoading(true);
      const name = (findQuery || "").trim().toLowerCase();
      if (!/^[a-z0-9.]{3,20}$/.test(name)) { setFindError("Enter a valid username (3-20 lowercase)" ); return; }
      const uref = doc(db as any, 'usernames', name);
      const usnap = await getDoc(uref);
      if (!usnap.exists()) { setFindError('No user with that username'); return; }
      const uid0 = (usnap.data() as any)?.uid;
      if (!uid0) { setFindError('No user with that username'); return; }
      // PRIVACY: read public_profiles mirror (users/{uid} is owner-only)
      const userRef = doc(db as any, 'public_profiles', uid0);
      const userSnap = await getDoc(userRef);
      const data = userSnap.exists() ? (userSnap.data() as any) : {};
      setFindResult({ uid: uid0, username: name, photo_url: data.photo_url || null });
    } catch (e:any) { setFindError(e?.message || 'Search failed'); } finally { setFindLoading(false); }
  };

  // Friend actions
  const sendFriendRequest = async (target: { uid: string; username?: string; photo_url?: string | null }) => {
    if (!uid || !target?.uid || uid === target.uid) return;
    const myUid = uid; const toUid = target.uid;
    const now = serverTimestamp();
    
    // Optimistic UI update - add to outgoing immediately
    setOutgoingReqs(prev => prev.some(r => r.id === toUid) ? prev : [...prev, { id: toUid, to: toUid, to_username: target.username || '' }]);
    // Also add to requestInfo for photo display
    if (target.photo_url || target.username) {
      setRequestInfo(prev => ({ ...prev, [toUid]: { username: target.username || '', photo_url: target.photo_url || null } }));
    }
    
    await Promise.all([
      setDoc(doc(db as any, 'users', myUid, 'friend_requests', toUid), {
        type: 'outgoing', from: myUid, to: toUid, status: 'pending', created_at: now,
        to_username: (target.username||''), to_photo: (target.photo_url||null)
      }, { merge: true }),
      setDoc(doc(db as any, 'users', toUid, 'friend_requests', myUid), {
        type: 'incoming', from: myUid, to: toUid, status: 'pending', created_at: now,
        from_username: (username || ''), from_photo: (auth.currentUser?.photoURL || null)
      }, { merge: true })
    ]);
  };

  const acceptFriendRequest = async (fromUid: string) => {
    // Get the request info before removing it (for optimistic UI)
    const req = incomingReqs.find(r => r.id === fromUid);
    try {
      const fn = httpsCallable(fbFunctions, 'acceptFriend');
      await fn({ otherUid: fromUid });
    } catch {}
    // Optimistic UI - add friend and immediately set their info from the request
    setFriends(prev => (prev.some(f => f.friend_uid === fromUid) ? prev : [...prev, { id: fromUid, friend_uid: fromUid }]));
    if (req) {
      setFriendInfo(prev => ({
        ...prev,
        [fromUid]: {
          username: req.from_username,
          photo_url: req.from_photo || null,
          education_level: undefined,
          exists: true
        }
      }));
    }
    setIncomingReqs(prev => prev.filter(r => r.id !== fromUid));
    setOutgoingReqs(prev => prev.filter(r => r.id !== fromUid));
  };

  const declineFriendRequest = async (fromUid: string) => {
    if (!uid) return; const myUid = uid;
    await Promise.all([
      deleteDoc(doc(db as any, 'users', myUid, 'friend_requests', fromUid)),
      deleteDoc(doc(db as any, 'users', fromUid, 'friend_requests', myUid))
    ]);
  };

  const cancelFriendRequest = async (toUid: string) => {
    if (!uid) return; const myUid = uid;
    await Promise.all([
      deleteDoc(doc(db as any, 'users', myUid, 'friend_requests', toUid)),
      deleteDoc(doc(db as any, 'users', toUid, 'friend_requests', myUid))
    ]);
  };

  const blockUser = async (otherUid: string) => {
    if (!uid) return;
    const myUid = uid;
    try {
      // Record block
      await setDoc(doc(db as any, 'users', myUid, 'blocks', otherUid), {
        blocked_uid: otherUid,
        created_at: serverTimestamp(),
      }, { merge: true });
    } catch {}
    try { await deleteDoc(doc(db as any, 'users', myUid, 'friends', otherUid)); } catch {}
    try { await deleteDoc(doc(db as any, 'users', otherUid, 'friends', myUid)); } catch {}
    try { await deleteDoc(doc(db as any, 'users', myUid, 'friend_requests', otherUid)); } catch {}
    try { await deleteDoc(doc(db as any, 'users', otherUid, 'friend_requests', myUid)); } catch {}
    setFriends(prev => prev.filter(f => f.friend_uid !== otherUid));
    setIncomingReqs(prev => prev.filter(r => r.id !== otherUid));
    setOutgoingReqs(prev => prev.filter(r => r.id !== otherUid));
  };

  const openFriendProfile = async (uid0: string) => {
    try {
      setProfileLoading(true);
      // PRIVACY: single read of the public_profiles mirror (users doc, counters
      // and achievements are owner-only readable)
      const usnap = await getDoc(doc(db as any, 'public_profiles', uid0));
      const udata = usnap.exists() ? (usnap.data() as any) : {};
      setProfileExists(usnap.exists());
      const xp = Number(udata.xp || 0);
      setProfileCounters({ xp, quizzes: Number(udata.quizzes || 0), chats: Number(udata.chats || 0), flashcards: Number(udata.flashcards || 0) });
      setProfileStreakCurrent(Number(udata.streak_current || 0));
      setProfileStreakLongest(Number(udata.streak_longest || 0));
      setProfileDaysTotal(Number(udata.days_total || 0));
      setProfileUser({ uid: uid0, username: (udata.username || '').toLowerCase(), photo_url: (udata.photo_url || udata.photoURL || null) });
      setProfileXp(xp);
      // Load latest reaction THEY sent to ME in last 24h
      try {
        if (uid) {
          const dayMs = 24*60*60*1000; const now = Date.now();
          const notifQ = query(collection(db as any, 'users', uid, 'notifications'), orderBy('created_at', 'desc'), limit(25));
          const notifSnap = await getDocs(notifQ as any);
          let latestFrom: { emoji: string; ts: number } | null = null;
          notifSnap.forEach((d:any) => {
            if (latestFrom) return; const x = d.data();
            if (x?.type === 'reaction' && String(x.from) === uid0 && x?.emoji) {
              const ts = x.created_at && typeof x.created_at.toMillis === 'function' ? x.created_at.toMillis() : now;
              if (now - ts <= dayMs) latestFrom = { emoji: String(x.emoji), ts };
            }
          });
          setProfileLatestFrom(latestFrom);
        }
      } catch { setProfileLatestFrom(null); }
      // Load latest reaction I sent to THEM in last 24h
      try {
        if (uid) {
          const dayMs = 24*60*60*1000; const now = Date.now();
          const sentSnap = await getDoc(doc(db as any, 'users', uid, 'sent_reactions', uid0));
          if (sentSnap.exists()) {
            const x = sentSnap.data() as any;
            const ts = x.created_at && typeof x.created_at.toMillis === 'function' ? x.created_at.toMillis() : now;
            if (x?.emoji && (now - ts) <= dayMs) setProfileLatestSent({ emoji: String(x.emoji), ts }); else setProfileLatestSent(null);
          } else setProfileLatestSent(null);
        }
      } catch { setProfileLatestSent(null); }
      setProfileOpen(true);
    } finally { setProfileLoading(false); }
  };

  // Send a reaction
  // OPTIMIZED: Uses batch write and localStorage caching for per-friend emojis
  
  // Derived counts from subcollections - OPTIMIZED: use getCountFromServer instead of getDocs
  useEffect(() => {
    if (!uid) { setDerivedCounts({}); return; }
    (async () => {
      try {
        const base = `users/${uid}`;
        // Use getCountFromServer for efficient counting without downloading all documents
        const ids = await Promise.all([
          getCountFromServer(collection(db, base, 'summaries')).then(s=>s.data().count).catch(()=>0),
          getCountFromServer(collection(db, base, 'quizzes')).then(s=>s.data().count).catch(()=>0),
          getCountFromServer(collection(db, base, 'study_plans')).then(s=>s.data().count).catch(()=>0),
          getCountFromServer(collection(db, base, 'lessons')).then(s=>s.data().count).catch(()=>0),
          getCountFromServer(collection(db, base, 'career_resumes')).then(s=>s.data().count).catch(()=>0),
          getCountFromServer(collection(db, base, 'linkedin_posts')).then(s=>s.data().count).catch(()=>0),
          getCountFromServer(collection(db, base, 'interview_sessions')).then(s=>s.data().count).catch(()=>0),
          getCountFromServer(collection(db, base, 'career_plans')).then(s=>s.data().count).catch(()=>0),
        ]);
        setDerivedCounts({
          summaries: ids[0],
          quizzes: ids[1],
          study_plans: ids[2],
          lessons: ids[3],
          resumes: ids[4],
          linkedin_posts: ids[5],
          interviews: ids[6],
          career_plans: ids[7],
        });
      } catch {
        setDerivedCounts({});
      }
    })();
  }, [uid]);

  const uses = typeof counters?.uses_this_month === "number" ? counters.uses_this_month : 0;
  const plan = (usage?.plan || "free") as string;
  
  // Infer monthly_quota from plan if not set
  let quota = typeof usage?.monthly_quota === "number" ? usage.monthly_quota : 0;
  if (quota === 0) {
    if (plan === 'free') quota = 5;
    else if (plan === 'basic') quota = 50;
    else if (plan === 'advanced') quota = 200;
    else if (plan === 'pro') quota = 500;
  }
  
  const wordLimit = typeof usage?.word_limit === "number" ? usage.word_limit : undefined;
  const extraBal = typeof counters?.extra_uses_balance === "number" ? counters.extra_uses_balance : 0;
  const extraUsed = typeof counters?.extra_uses_used === "number" ? counters.extra_uses_used : 0;
  const periodEnd = typeof counters?.usage_period_end === 'string' ? counters.usage_period_end : null;
  const renewsAt = typeof usage?.renews_at === 'string' ? usage.renews_at : null;
  const cycleDay = typeof usage?.usage_cycle_day === 'number' ? Math.min(28, Math.max(1, Math.floor(usage.usage_cycle_day))) : null;
  const computeNextFromDay = (anchor: number) => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const d = now.getDate();
    return (d < anchor ? new Date(y, m, anchor) : new Date(y, m + 1, anchor)).toLocaleDateString();
  };

  const items = Object.entries(ALL_ACHIEVEMENTS).sort(([idA], [idB]) => {
    const a = !!achEarned[idA];
    const b = !!achEarned[idB];
    if (a === b) return idA.localeCompare(idB);
    return a ? -1 : 1;
  });
  const [achFilter, setAchFilter] = useState<'earned'|'locked'>('earned');
  const filteredItems = items.filter(([id]) => achFilter==='earned' ? !!achEarned[id] : !achEarned[id]);

  const levelInfo = getLevelInfo(xp);
  const rankProgress = Math.min(100, Math.max(0, Math.round(levelInfo.progress * 100)));
  // XP bar theming: in light mode, track shows remaining (#FEF8CA) and indicator uses default (darker). In dark mode, indicator is #FEF8CA.
  const xpTrackStyle = !isDark ? { backgroundColor: '#FEF8CA' } as React.CSSProperties : undefined;
  const xpIndicatorStyle = isDark ? { backgroundColor: '#FEF8CA' } as React.CSSProperties : undefined;
  // Derive display totals to avoid showing 0 when streaks exist
  const displayDaysTotal = Math.max(Number(daysTotal || 0), Number(streakCurrent || 0), Number(streakLongest || 0));
  Math.max(Number(profileDaysTotal || 0), Number(profileStreakCurrent || 0), Number(profileStreakLongest || 0));

  return (
    <div className="min-h-screen">
      <LoadingOverlay open={changingUname || uploading} title="Working…" subtitle={funFact ? `Fun fact: ${funFact}` : undefined} />
      <SEO
        title="My Account • metastudy-e1ba2.web.app"
        description="Manage your plan, usage, achievements, and friends."
        canonical={typeof window !== 'undefined' ? window.location.origin + "/account" : undefined}
      />
      {/* Minimal account header (no public links) */}
      <div className="sticky top-0 z-40 w-full backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
        <div className="max-w-7xl mx-auto flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <img src={MetaStudyLogo} alt="Logo" className="w-9 h-9 object-contain hidden dark:block" />
            <img src={MetaStudyLogo} alt="Logo" className="w-9 h-9 object-contain dark:hidden" />
            <div>
              <h1 className="text-xl font-semibold">My Account</h1>
              <p className="text-xs text-muted-foreground">{version ? `v${version}` : ''}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate('/study')}>Back to Study</Button>
            <Button variant="outline" size="sm" onClick={toggleTheme} aria-label="Toggle theme">
              {isDark ? (<Sun className="w-4 h-4" />) : (<Moon className="w-4 h-4" />)}
            </Button>
          </div>
        </div>
      </div>

      <section className="py-8">
        <div className="max-w-7xl mx-auto px-4">
          <FadeIn>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="grid w-full grid-cols-5 mb-6 bg-background text-foreground" data-tour="account-tabs">
              <TabsTrigger value="usage" data-tour="account-usage" className="flex items-center justify-center gap-2 py-2 sm:py-3 text-xs sm:text-sm rounded-md transition-colors hover:bg-accent/50 data-[state=active]:bg-accent data-[state=active]:text-accent-foreground"><Gauge className="w-4 h-4"/><span className="hidden sm:inline">Management</span></TabsTrigger>
              <TabsTrigger value="friends" data-tour="account-friends" className="flex items-center justify-center gap-2 py-2 sm:py-3 text-xs sm:text-sm rounded-md transition-colors hover:bg-accent/50 data-[state=active]:bg-accent data-[state=active]:text-accent-foreground"><Users className="w-4 h-4"/><span className="hidden sm:inline">Friends</span></TabsTrigger>
              <TabsTrigger value="achievements" data-tour="account-achievements" className="flex items-center justify-center gap-2 py-2 sm:py-3 text-xs sm:text-sm rounded-md transition-colors hover:bg-accent/50 data-[state=active]:bg-accent data-[state=active]:text-accent-foreground"><Trophy className="w-4 h-4"/><span className="hidden sm:inline">Achievements</span></TabsTrigger>
              <TabsTrigger value="stats" data-tour="account-stats" className="flex items-center justify-center gap-2 py-2 sm:py-3 text-xs sm:text-sm rounded-md transition-colors hover:bg-accent/50 data-[state=active]:bg-accent data-[state=active]:text-accent-foreground"><BarChart3 className="w-4 h-4"/><span className="hidden sm:inline">Statistics</span></TabsTrigger>
              <TabsTrigger value="privacy" className="flex items-center justify-center gap-2 py-2 sm:py-3 text-xs sm:text-sm rounded-md transition-colors hover:bg-accent/50 data-[state=active]:bg-accent data-[state=active]:text-accent-foreground"><ShieldCheck className="w-4 h-4"/><span className="hidden sm:inline">Settings</span></TabsTrigger>
            </TabsList>

            <TabsContent value="privacy">
              {!uid ? (
                <p className="text-muted-foreground">Please sign in to manage your privacy settings.</p>
              ) : (
                <PrivacyCenter onOpenDeleteAccount={() => setDeleteOpen(true)} />
              )}
            </TabsContent>

            <TabsContent value="usage">
              {!uid ? (
                <p className="text-muted-foreground">Please sign in to view your usage.</p>
              ) : loadingUsage ? (
                <p className="text-muted-foreground">Loading...</p>
              ) : (
                <div className="space-y-8">
                  {/* Top: Profile & Account combined */}
                  <div className="grid grid-cols-1 gap-6">
                    <Card className="p-6" data-tour="account-profile">
                      <h2 className="text-lg font-semibold mb-4">Profile & Account</h2>
                      <div className="flex items-center gap-4">
                        <div className="h-20 w-20 rounded-full overflow-hidden bg-muted flex items-center justify-center">
                          {photoURL ? (
                            <img src={photoURL} alt="Avatar" className="h-full w-full object-cover" />
                          ) : (
                            <span className="text-base text-muted-foreground">{(displayName||'M').slice(0,1).toUpperCase()}</span>
                          )}
                        </div>
                        <div className="flex-1">
                          <input
                            id="avatar-input"
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              if (file.size > 10 * 1024 * 1024) {
                                toast({ title: 'Image too large', description: 'Max upload size is 10MB. Please choose a smaller image.', variant: 'destructive' });
                                e.currentTarget.value = '';
                                return;
                              }
                              const reader = new FileReader();
                              reader.onload = () => { setImageSrc(reader.result as string); setCropOpen(true); };
                              reader.readAsDataURL(file);
                              e.currentTarget.value = '';
                            }}
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              document.getElementById('avatar-input')?.click();
                            }}
                            disabled={uploading}
                          >
                            Change Photo
                          </Button>
                        </div>
                      </div>
                      <div className="mt-4 space-y-3 text-sm">
                        <div>
                          <span className="text-muted-foreground">Email:</span> <span className="font-medium break-all">{auth.currentUser?.email || ''}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">Username:</span> 
                          {username ? (
                            <span className="font-medium">@{username}</span>
                          ) : (
                            <span className="text-destructive font-medium">Not set. Click "Change Username" below</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground flex items-center gap-1">
                            <GraduationCap className="w-4 h-4" />
                            Profession:
                          </span>
                          <Select
                            value={educationLevel || ''}
                            onValueChange={async (val) => {
                              if (!uid) return;
                              setEducationLevel(val);
                              try {
                                await setDoc(doc(db as any, 'users', uid), { education_level: val || null }, { merge: true });
                                toast({ title: 'Updated', description: 'Profession saved.' });
                              } catch (e: any) {
                                toast({ title: 'Error', description: e?.message || 'Could not save.', variant: 'destructive' });
                              }
                            }}
                          >
                            <SelectTrigger className="w-[180px] h-8 text-sm">
                              <SelectValue placeholder="Select (optional)" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="elementary">Elementary School</SelectItem>
                              <SelectItem value="middle_high">Middle or High School</SelectItem>
                              <SelectItem value="university">University</SelectItem>
                              <SelectItem value="entry_level">Entry Level (0-2 years)</SelectItem>
                              <SelectItem value="mid_career">Mid-Career (3-7 years)</SelectItem>
                              <SelectItem value="senior">Senior Level (8+ years)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        {resetSent && (
                          <div className="rounded-lg border p-2 bg-muted/30 text-xs">Password reset email sent. Check your inbox.</div>
                        )}
                        <div className="flex flex-wrap gap-3">
                          <Button
                            variant="default"
                            size="sm"
                            className="w-full sm:w-auto"
                            onClick={async () => {
                              const u = auth.currentUser;
                              if (!u || !u.email) return;
                              try {
                                const send = httpsCallable(fbFunctions, 'sendBrandedPasswordResetEmail');
                                await send({ email: u.email.toLowerCase() });
                                setResetSent(true);
                              } catch (e: any) {
                                toast({ title: 'Could not send reset email', description: e?.message || 'Try again in a moment.', variant: 'destructive' });
                              }
                            }}
                          >
                            Reset Password
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full sm:w-auto"
                            onClick={() => { setChangeUnameOpen(true); setUnameSuggestions([]); setNewUsername(''); }}
                          >
                            Change Username
                          </Button>
                          {/* Manage Billing - hidden for institution users (their institution handles billing) */}
                          {plan !== 'free' && usage?.stripe_customer_id && !isInstitutionUser && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="w-full sm:w-auto"
                              data-tour="account-billing"
                              disabled={billingLoading}
                              onClick={async () => {
                                if (billingLoading) return;
                                setBillingLoading(true);
                                const customerId = (usage?.stripe_customer_id || null) as string | null;
                                try {
                                  const res = await createPortalSession(String(customerId));
                                  const url = (res as any)?.url;
                                  if (url) {
                                    billingOpenedRef.current = Date.now(); // Track when portal opened for auto-sync
                                    window.open(url, '_blank', 'noopener,noreferrer');
                                    return;
                                  }
                                  toast({ title: 'No portal URL', description: 'Could not get billing portal link. Please try again later.', variant: 'destructive' });
                                } catch (e: any) {
                                  toast({ title: 'Unable to open billing portal', description: e?.message || 'Please try again later.', variant: 'destructive' });
                                } finally {
                                  setBillingLoading(false);
                                }
                              }}
                            >
                              {billingLoading ? (
                                <>
                                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                  Loading...
                                </>
                              ) : (
                                'Manage Billing'
                              )}
                            </Button>
                          )}
                        </div>
                      </div>
                    </Card>
                  </div>

                  {/* Below: Plan overview & usage */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6" data-tour="account-plan-usage">
                    <Card className="p-6">
                      <h2 className="text-lg font-semibold">Plan Overview</h2>
                      <div className="mt-2 space-y-1 text-sm">
                        <div><span className="text-muted-foreground">Plan:</span> <span className="font-medium uppercase">{plan}</span></div>
                        <div><span className="text-muted-foreground">Monthly Quota:</span> <span className="font-medium">{quota}</span></div>
                        {typeof wordLimit === 'number' && (
                          <div><span className="text-muted-foreground">Words per use:</span> <span className="font-medium">{wordLimit.toLocaleString()}</span></div>
                        )}
                        {(usage as any)?.subscription_cancelled && renewsAt && (
                          <div className="mt-2 rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                            Subscription cancelled. Access continues until <span className="font-semibold">{new Date(renewsAt).toLocaleDateString()}</span>
                          </div>
                        )}
                      </div>
                    </Card>
                    <Card className="p-6">
                      <h2 className="text-lg font-semibold">This Month</h2>
                      <div className="mt-3">
                        <Progress value={quota > 0 ? Math.min(100, (uses / quota) * 100) : 0} indicatorStyle={xpIndicatorStyle} style={xpTrackStyle} />
                      </div>
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-sm text-muted-foreground">{uses} of {quota} credits</span>
                        <button
                          onClick={async () => {
                            if (syncingUsage) return;
                            setSyncingUsage(true);
                            try {
                              const fixExpiredCounters = httpsCallable(fbFunctions, 'fixExpiredCounters');
                              const result = await fixExpiredCounters();
                              const data = (result as any).data;
                              if (data.fixed) {
                                toast({ title: 'Credits Synced!', description: data.message });
                                window.location.reload();
                              } else {
                                toast({ title: 'Already Up to Date', description: data.message || 'Usage is current' });
                              }
                            } catch (e: any) {
                              toast({ title: 'Sync Failed', description: e?.message || 'Could not sync credits', variant: 'destructive' });
                            } finally {
                              setSyncingUsage(false);
                            }
                          }}
                          disabled={syncingUsage}
                          className="p-1 rounded hover:bg-accent/60 transition-colors disabled:opacity-50"
                          title="Sync credits"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 text-muted-foreground ${syncingUsage ? 'animate-spin' : ''}`} />
                        </button>
                      </div>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-xs text-muted-foreground">
                          {plan !== 'free' && renewsAt
                            ? <>Renews on: {new Date(renewsAt).toLocaleDateString()}</>
                            : <>Credits reset on: {periodEnd ? new Date(periodEnd).toLocaleDateString() : (cycleDay ? computeNextFromDay(cycleDay) : '-')}</>}
                        </span>
                        {/* Only show Stripe sync for paid plans - free users use usage sync button above */}
                        {plan !== 'free' && (
                          <button
                            onClick={async () => {
                              if (syncingRenewal) return;
                              setSyncingRenewal(true);
                              try {
                                const syncRenewsAt = httpsCallable(fbFunctions, 'syncRenewsAtFromStripe');
                                const result = await syncRenewsAt();
                                const data = (result as any).data;
                                if (data.synced) {
                                  toast({ title: 'Date Synced!', description: data.message });
                                  window.location.reload();
                                } else {
                                  toast({ title: 'Could Not Sync', description: data.message || 'No subscription found' });
                                }
                              } catch (e: any) {
                                toast({ title: 'Sync Failed', description: e?.message || 'Could not sync date', variant: 'destructive' });
                              } finally {
                                setSyncingRenewal(false);
                              }
                            }}
                            disabled={syncingRenewal}
                            className="p-1 rounded hover:bg-accent/60 transition-colors disabled:opacity-50"
                            title="Sync renewal date from Stripe"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 text-muted-foreground ${syncingRenewal ? 'animate-spin' : ''}`} />
                          </button>
                        )}
                      </div>
                    </Card>
                    <Card className="p-6">
                      <h2 className="text-lg font-semibold">Add-on Credits</h2>
                      {extraBal > 0 || extraUsed > 0 ? (
                        <div className="mt-2 space-y-1 text-sm">
                          <div><span className="text-muted-foreground">Remaining:</span> <span className="font-medium">{extraBal}</span></div>
                          <div><span className="text-muted-foreground">Used:</span> <span className="font-medium">{extraUsed}</span></div>
                        </div>
                      ) : (
                        <p className="mt-2 text-sm text-muted-foreground">No add-on credits purchased yet.</p>
                      )}
                    </Card>
                  </div>

                  {/* Pricing at bottom - hidden for institution users (their institution handles billing) */}
                  {!isInstitutionUser && (
                    <div className="mt-2">
                      <Pricing showCurrentPlan={true} />
                    </div>
                  )}
                  
                  {/* Institution notice for institution users */}
                  {isInstitutionUser && (
                    <Card className="p-6 bg-green-50/50 dark:bg-green-950/20 border-green-200 dark:border-green-900 mt-2">
                      <h2 className="text-lg font-semibold flex items-center gap-2">
                        <GraduationCap className="w-5 h-5" />
                        Institution Plan
                      </h2>
                      <p className="text-sm text-muted-foreground mt-2">
                        Your plan is managed by your institution ({(userData.profile as any)?.schoolName || 'your school'}). 
                        Plan changes and billing are handled by your institution administrator.
                      </p>
                    </Card>
                  )}

                  {/* Troubleshooting section - visible for all users */}
                  <Card className="p-6 bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900">
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Troubleshooting
                    </h2>
                    <p className="text-sm text-muted-foreground mt-2">
                      {plan === 'free' 
                        ? 'Having issues with your credit counts? Use these tools to sync and reset.'
                        : 'Having issues with your subscription? Use these tools to fix common problems.'}
                    </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {/* Sync Plan button - syncs subscription from Stripe */}
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={syncingPlan}
                          onClick={async () => {
                            if (syncingPlan || !uid) return;
                            setSyncingPlan(true);
                            try {
                              const syncPlan = httpsCallable(fbFunctions, 'syncPlanFromStripe');
                              const result = await syncPlan();
                              const data = (result as any)?.data;
                              if (data?.success) {
                                toast({ title: 'Plan Synced!', description: data.message || `Your plan is now: ${data.plan?.toUpperCase()}` });
                                window.location.reload();
                              } else {
                                toast({ title: 'Sync Failed', description: data?.error || 'Could not sync plan', variant: 'destructive' });
                              }
                            } catch (e: any) {
                              toast({ title: 'Sync Failed', description: e?.message || 'Please try again later.', variant: 'destructive' });
                            } finally {
                              setSyncingPlan(false);
                            }
                          }}
                        >
                          {syncingPlan ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          ) : (
                            <RefreshCw className="w-4 h-4 mr-2" />
                          )}
                          Sync Plan
                        </Button>
                        {!renewsAt && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={async () => {
                              try {
                                const syncRenewsAt = httpsCallable(fbFunctions, 'syncRenewsAtFromStripe');
                                const result = await syncRenewsAt();
                                const data = (result as any).data;
                                
                                if (data.synced) {
                                  toast({
                                    title: 'Renewal Date Synced!',
                                    description: data.message,
                                  });
                                  window.location.reload();
                                } else {
                                  toast({
                                    title: 'Could Not Sync',
                                    description: data.message,
                                    variant: 'destructive',
                                  });
                                }
                              } catch (e: any) {
                                toast({
                                  title: 'Error',
                                  description: e?.message || 'Failed to sync renewal date',
                                  variant: 'destructive',
                                });
                              }
                            }}
                          >
                            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            Sync Renewal Date
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={async () => {
                            try {
                              const fixExpiredCounters = httpsCallable(fbFunctions, 'fixExpiredCounters');
                              const result = await fixExpiredCounters();
                              const data = (result as any).data;
                              
                              if (data.fixed) {
                                toast({
                                  title: 'Counters Fixed!',
                                  description: data.message,
                                });
                                window.location.reload();
                              } else {
                                toast({
                                  title: 'No Fix Needed',
                                  description: data.message,
                                });
                              }
                            } catch (e: any) {
                              toast({
                                title: 'Error',
                                description: e?.message || 'Failed to fix counters',
                                variant: 'destructive',
                              });
                            }
                          }}
                        >
                          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          Reset Usage Counters
                        </Button>
                      </div>
                    </Card>

                  {/* Report an Issue */}
                  <Card className="p-6">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertCircle className="w-5 h-5 text-primary" />
                      <h2 className="text-lg font-semibold">Report an Issue</h2>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Having problems? Found a bug? Let us know and we'll look into it.
                    </p>
                    <div className="mt-3">
                      <Button
                        variant="outline"
                        onClick={() => setReportOpen(true)}
                      >
                        <AlertCircle className="w-4 h-4 mr-2" />
                        Report Issue
                      </Button>
                    </div>
                  </Card>

                </div>
              )}
            </TabsContent>

            {/* Change Username Dialog */}
            <Dialog open={changeUnameOpen} onOpenChange={setChangeUnameOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Change Username</DialogTitle>
                </DialogHeader>
                <div className="space-y-2">
                  <div className="text-xs text-muted-foreground">You can change your username once per year. 3-20 chars, lowercase letters, numbers, or dot.</div>
                  <input
                    className="w-full bg-background border rounded px-2 py-1 text-sm"
                    placeholder="new.username"
                    value={newUsername}
                    onChange={(e) => { setNewUsername(e.target.value.toLowerCase()); setUnameSuggestions([]); }}
                  />
                  {unameSuggestions.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {unameSuggestions.map(s => (
                        <Button key={s} type="button" variant="outline" size="sm" onClick={() => { setNewUsername(s); setUnameSuggestions([]); }}>
                          {s}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setChangeUnameOpen(false)}>Cancel</Button>
                  <Button
                    size="sm"
                    disabled={changingUname || !newUsername.trim()}
                    onClick={async () => {
                      const uname = (newUsername || '').trim().toLowerCase();
                      if (!/^[a-z0-9.]{3,20}$/.test(uname)) { toast({ title: 'Invalid username', description: 'Use 3-20 lowercase characters (letters, numbers, dot).', variant: 'destructive' }); return; }
                      setFunFact(getRandomFunFact());
                      setChangingUname(true);
                      setUnameSuggestions([]);
                      try {
                        const fn = httpsCallable(fbFunctions, 'changeUsername');
                        const resp: any = await fn({ newUsername: uname });
                        if (resp?.data?.ok) {
                          setUsername(resp.data.username);
                          setNewUsername('');
                          setChangeUnameOpen(false);
                          toast({ title: 'Username updated', description: `Your new username is @${resp.data.username}` });
                        }
                      } catch (err: any) {
                        const suggestions = err?.details?.suggestions || [];
                        if (Array.isArray(suggestions) && suggestions.length) setUnameSuggestions(suggestions.slice(0,3));
                        const msg = err?.message || 'Failed to change username';
                        toast({ title: 'Could not change', description: msg, variant: 'destructive' });
                      } finally {
                        setChangingUname(false);
                      }
                    }}
                  >
                    {changingUname ? <><Loader2 className='w-3 h-3 mr-1 animate-spin' />Saving...</> : 'Save'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Confirm Delete Friend Dialog */}
            <Dialog open={deleteFriendOpen} onOpenChange={setDeleteFriendOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Remove this friend?</DialogTitle>
                </DialogHeader>
                <div className="text-sm text-muted-foreground">
                  {deleteFriendTarget?.username ? (
                    <>You are about to remove @{deleteFriendTarget.username} from your friends list.</>
                  ) : (
                    <>You are about to remove this user from your friends list.</>
                  )}
                </div>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setDeleteFriendOpen(false)}>Cancel</Button>
                  <Button
                    variant="destructive"
                    onClick={async () => { if (deleteFriendTarget?.uid) { await deleteDoc(doc(db as any, 'users', uid as any, 'friends', deleteFriendTarget.uid)); } setDeleteFriendOpen(false); setDeleteFriendTarget(null); }}
                  >
                    Yes, remove
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Friends Tab */}
            <TabsContent value="friends">
              {!uid ? (
                <p className="text-muted-foreground">Please sign in to manage friends.</p>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <Card className="p-4 sm:p-6" data-tour="friends-list">
                    <div className="flex items-center gap-2 mb-4">
                      <Users className="w-5 h-5 text-primary" />
                      <h2 className="text-lg font-semibold">Your Friends</h2>
                      {friends.length > 0 && (
                        <span className="text-xs text-muted-foreground">({friends.length})</span>
                      )}
                    </div>
                    {friends.length === 0 ? (
                      <div className="text-center py-8">
                        <Users className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
                        <p className="text-sm text-muted-foreground">No friends yet</p>
                        <p className="text-xs text-muted-foreground mt-1">Search for users to add them!</p>
                      </div>
                    ) : (
                      <div className="space-y-1.5 max-h-[400px] overflow-y-auto pr-1">
                        {[...friends]
                          .filter(f => (friendInfo[f.friend_uid] as any)?.exists !== false)
                          .sort((a,b) => {
                            const af = a.favorite ? 1 : 0; const bf = b.favorite ? 1 : 0;
                            if (af !== bf) return bf - af;
                            const an = (friendInfo[a.friend_uid]?.username || '').toLowerCase();
                            const bn = (friendInfo[b.friend_uid]?.username || '').toLowerCase();
                            return an.localeCompare(bn);
                          })
                          .map(f => {
                          const info0 = friendInfo[f.friend_uid] || {} as any;
                          return (
                            <div
                              key={f.id}
                              className="flex items-center gap-3 p-2.5 rounded-lg border bg-card hover:bg-accent/50 transition-colors group"
                            >
                              <button className="flex items-center gap-3 min-w-0 flex-1" onClick={() => openFriendProfile(f.friend_uid)}>
                                <div className="relative flex-shrink-0">
                                  {info0.photo_url ? (
                                    <img src={info0.photo_url} alt={info0.username||'user'} className="h-10 w-10 rounded-full object-cover ring-2 ring-background" />
                                  ) : (
                                    <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                                      <UserCircle className="h-6 w-6 text-muted-foreground" />
                                    </div>
                                  )}
                                  {f.favorite && (
                                    <Star className="absolute -top-1 -right-1 w-4 h-4 text-yellow-500 fill-yellow-500" />
                                  )}
                                </div>
                                <div className="min-w-0 text-left">
                                  <div className="font-medium text-sm truncate">@{(info0.username || 'unknown').toLowerCase()}</div>
                                  {info0.education_level && (
                                    <div className="text-xs text-muted-foreground truncate">
                                      {info0.education_level === 'elementary' ? 'Elementary' : info0.education_level === 'middle' ? 'Middle School' : info0.education_level === 'high' ? 'High School' : info0.education_level === 'middle_high' ? 'Middle/High School' : info0.education_level === 'university' ? 'University' : info0.education_level === 'working' ? 'Working' : info0.education_level === 'entry_level' ? 'Entry Level' : info0.education_level === 'mid_career' ? 'Mid-Career' : info0.education_level === 'senior' ? 'Senior Level' : info0.education_level}
                                    </div>
                                  )}
                                </div>
                              </button>
                              <div className="flex items-center gap-1 flex-shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-8 w-8 p-0"
                                  onClick={(e) => { e.stopPropagation(); toggleFavorite(f.friend_uid, !f.favorite); }}
                                  title={f.favorite ? 'Unfavorite' : 'Favorite'}
                                >
                                  <Star className={`w-4 h-4 ${f.favorite ? 'text-yellow-500 fill-yellow-500' : 'text-muted-foreground'}`} />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                                  onClick={(e) => { e.stopPropagation(); setDeleteFriendTarget({ uid: f.friend_uid, username: (info0.username||'').toLowerCase() }); setDeleteFriendOpen(true); }}
                                  title="Remove friend"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                                  onClick={(e) => { e.stopPropagation(); setBlockTarget({ uid: f.friend_uid, username: (info0.username||'').toLowerCase() }); setBlockConfirmOpen(true); }}
                                  title="Block user"
                                >
                                  <Ban className="w-4 h-4" />
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </Card>
                  <Card className="p-4 sm:p-6" data-tour="friends-search">
                    <div className="flex items-center gap-2 mb-4">
                      <Search className="w-5 h-5 text-primary" />
                      <h2 className="text-lg font-semibold">Find & Requests</h2>
                    </div>
                    
                    {/* Search input */}
                    <div className="relative mb-4">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <input
                        className="w-full bg-background border rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                        placeholder="Search username..."
                        value={findQuery}
                        onChange={(e) => {
                          const v = e.target.value.toLowerCase();
                          setFindQuery(v); setFindError(""); setFindResult(null);
                          if (findTimerRef.current) window.clearTimeout(findTimerRef.current);
                          findTimerRef.current = window.setTimeout(() => runTypeahead(v), 250) as any;
                        }}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); findUserByUsername(); } }}
                      />
                    </div>

                    {/* Search results */}
                    {findQuery.length >= 3 && findResults.length > 0 && !findResult && (
                      <div className="space-y-1 mb-4">
                        {findResults.map(r => {
                          const fav = !!friends.find(f => f.friend_uid === r.uid && f.favorite)?.favorite;
                          const isFriend = friends.some(f => f.friend_uid === r.uid);
                          return (
                            <div key={r.uid} className="flex items-center gap-3 p-2 rounded-lg border bg-card hover:bg-accent/30 transition-colors">
                              <button className="flex items-center gap-2 min-w-0 flex-1" onClick={() => openFriendProfile(r.uid)}>
                                {r.photo_url ? (
                                  <img src={r.photo_url} alt={r.username} className="h-8 w-8 rounded-full object-cover" />
                                ) : (
                                  <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                                    <UserCircle className="h-5 w-5 text-muted-foreground" />
                                  </div>
                                )}
                                <span className="truncate text-sm font-medium flex items-center gap-1">
                                  @{r.username}
                                  {isFriend && fav && <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />}
                                </span>
                              </button>
                              <Button
                                size="sm"
                                variant={isFriend ? "secondary" : "outline"}
                                className="text-xs h-7 px-2"
                                onClick={() => sendFriendRequest({ uid: r.uid, username: r.username, photo_url: r.photo_url })}
                                disabled={uid === r.uid || outgoingReqs.some(o=>o.id===r.uid) || isFriend}
                              >
                                {isFriend ? '✓' : outgoingReqs.some(o => o.id === r.uid) ? 'Sent' : 'Add'}
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {findError && (<div className="text-xs text-destructive bg-destructive/10 px-3 py-2 rounded-lg mb-4">{findError}</div>)}
                    {findLoading && (
                      <div className="flex items-center justify-center py-4 mb-4">
                        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                      </div>
                    )}

                    {/* Incoming Requests */}
                    {incomingReqs.length > 0 && (
                      <div className="space-y-2 mb-4">
                        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Incoming Requests</div>
                        {incomingReqs.map(req => (
                          <div key={req.id} className="flex items-center gap-3 p-2.5 rounded-lg border bg-primary/5 border-primary/20">
                            <button className="flex items-center gap-2 min-w-0 flex-1" onClick={() => openFriendProfile(req.from)}>
                              {req.from_photo ? (
                                <img src={req.from_photo} alt={req.from_username||req.from} className="h-8 w-8 rounded-full object-cover" />
                              ) : (
                                <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                                  <UserCircle className="h-5 w-5 text-muted-foreground" />
                                </div>
                              )}
                              <span className="text-sm font-medium truncate">@{(req.from_username || '').toLowerCase()}</span>
                            </button>
                            <div className="flex items-center gap-1.5">
                              <Button size="sm" className="h-7 px-2 text-xs" onClick={() => acceptFriendRequest(req.id)}>✓</Button>
                              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground" onClick={() => declineFriendRequest(req.id)}>✕</Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Outgoing Requests */}
                    {outgoingReqs.filter(req => !friends.some(f => f.friend_uid === req.id)).length > 0 && (
                      <div className="space-y-2 mb-4">
                        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Pending</div>
                        {outgoingReqs.filter(req => !friends.some(f => f.friend_uid === req.id)).map(req => {
                          const displayUsername = (req.to_username || requestInfo[req.id]?.username || '').toLowerCase();
                          const displayPhoto = requestInfo[req.id]?.photo_url || null;
                          return (
                            <div key={req.id} className="flex items-center gap-3 p-2 rounded-lg border bg-muted/30">
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                {displayPhoto ? (
                                  <img src={displayPhoto} alt="" className="h-8 w-8 rounded-full object-cover opacity-70" />
                                ) : (
                                  <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                                    <UserCircle className="h-5 w-5 text-muted-foreground" />
                                  </div>
                                )}
                                <span className="text-sm truncate text-muted-foreground">
                                  {displayUsername ? `@${displayUsername}` : '(pending)'}
                                </span>
                              </div>
                              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground" onClick={() => cancelFriendRequest(req.id)}>Cancel</Button>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Empty state */}
                    {incomingReqs.length === 0 && outgoingReqs.filter(req => !friends.some(f => f.friend_uid === req.id)).length === 0 && findQuery.length < 3 && (
                      <div className="text-center py-6 text-muted-foreground">
                        <Search className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        <p className="text-sm">Search for users above</p>
                      </div>
                    )}

                    {/* Blocked people toggle */}
                    <div className="pt-4 border-t">
                      <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setShowBlocked(v => !v)}>
                        <Ban className="w-4 h-4 mr-2" />
                        {showBlocked ? 'Hide blocked' : 'Blocked users'} ({blocked.length})
                      </Button>
                      {showBlocked && blocked.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {blocked.map(uid0 => (
                            <div key={uid0} className="flex items-center gap-2 p-2 rounded-lg bg-muted/30">
                              {blockedInfo[uid0]?.photo_url ? (
                                <img src={blockedInfo[uid0]?.photo_url as string} alt={blockedInfo[uid0]?.username||'user'} className="h-8 w-8 rounded-full object-cover opacity-50" />
                              ) : (
                                <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                                  <UserCircle className="h-5 w-5 text-muted-foreground" />
                                </div>
                              )}
                              <span className="truncate text-sm text-muted-foreground">@{(blockedInfo[uid0]?.username || uid0).toLowerCase()}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {showBlocked && blocked.length === 0 && (
                        <p className="mt-2 text-sm text-muted-foreground">No blocked users.</p>
                      )}
                    </div>
                  </Card>
                </div>
              )}
            </TabsContent>

            {/* Block Friend Confirm Dialog */}
            <Dialog open={blockConfirmOpen} onOpenChange={setBlockConfirmOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Block this person?</DialogTitle>
                </DialogHeader>
                <div className="space-y-1 text-sm">
                  <p>Are you sure you want to block {blockTarget?.username ? `@${blockTarget.username}` : 'this person'}?</p>
                  <p className="text-muted-foreground">They will no longer be able to interact with you.</p>
                </div>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setBlockConfirmOpen(false)}>No, I change my mind</Button>
                  <Button
                    variant="destructive"
                    onClick={async () => { if (blockTarget?.uid) { await blockUser(blockTarget.uid); } setBlockConfirmOpen(false); setBlockTarget(null); }}
                  >
                    Yes, block
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Unified Profile Popup */}
            <UnifiedProfilePopup
              isOpen={profileOpen}
              onClose={() => setProfileOpen(false)}
              targetUserId={profileUser?.uid || ''}
              targetUsername={profileUser?.username}
              targetPhotoURL={profileUser?.photo_url || null}
              currentUserId={uid || ''}
              currentUsername={username}
            />

            <TabsContent value="achievements">
              {!uid ? (
                <p className="text-muted-foreground">Please sign in to view achievements.</p>
              ) : loadingAch ? (
                <p className="text-muted-foreground">Loading...</p>
              ) : (
                <>
                  <Card
                    className="p-4 mb-6 cursor-pointer hover:border-primary/40 transition-colors"
                    data-tour="achievements-xp"
                    onClick={() => setTab('achievements')}
                    role="button"
                    aria-label="View Achievements"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="text-xs text-muted-foreground">Knowledge Level</div>
                        <div className="text-lg font-semibold">{getRankTitle(xp)}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-muted-foreground">XP</div>
                        <div className="text-lg font-semibold">{xp.toLocaleString()}</div>
                      </div>
                    </div>
                    <div className="mt-3">
                      <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                        <span>{levelInfo.current} / {levelInfo.required}</span>
                        <span>Lvl {levelInfo.level + 1}</span>
                      </div>
                      <Progress value={rankProgress} indicatorStyle={xpIndicatorStyle} style={xpTrackStyle} />
                    </div>
                  </Card>
                  <div className="mb-6 text-sm text-muted-foreground" data-tour="achievements-streak">
                    <span>Current streak: </span><span className="font-medium">{streakCurrent} days</span>
                    <span className="ml-4">Longest streak: </span><span className="font-medium">{streakLongest} days</span>
                  </div>
                  <div className="mb-4 flex items-center gap-2">
                    <Button size="sm" variant={achFilter==='earned'?'default':'outline'} onClick={()=>setAchFilter('earned')}>Earned</Button>
                    <Button size="sm" variant={achFilter==='locked'?'default':'outline'} onClick={()=>setAchFilter('locked')}>Yet to Achieve</Button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" data-tour="achievements-badges">
                    {filteredItems.map(([id, meta]) => {
                      const have = !!achEarned[id];
                      return (
                        <div
                          key={id}
                          className={`group relative overflow-hidden rounded-xl border transition-colors ${have ? 'bg-card border-primary/30' : 'bg-muted/20'}`}
                        >
                          <div className="flex items-center gap-3 p-4">
                            {(() => {
                              const { emoji, cls } = getAchievementVisual(id);
                              return (
                                <div className={`w-16 h-16 rounded-lg flex items-center justify-center flex-shrink-0 transition-opacity ${cls} ${have ? '' : 'grayscale opacity-50 group-hover:opacity-70'}`}>
                                  <span className="text-3xl leading-none select-none" role="img" aria-label={meta.title}>{emoji}</span>
                                </div>
                              );
                            })()}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between">
                                <h3 className={`font-semibold truncate ${have ? '' : 'text-foreground/70'}`}>{meta.title}</h3>
                                {have && <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-600">Earned</span>}
                              </div>
                              <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{meta.description}</p>
                              {have && <p className="text-xs text-muted-foreground mt-2">{new Date(achEarned[id].earned_at).toLocaleString()}</p>}
                            </div>
                          </div>
                          {!have && (
                            <div className="absolute inset-0 bg-gradient-to-b from-transparent to-background/40 pointer-events-none group-hover:to-background/50" />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </TabsContent>

            <TabsContent value="stats">
              {!uid ? (
                <p className="text-muted-foreground">Please sign in to view statistics.</p>
              ) : !counters ? (
                <p className="text-muted-foreground">Loading...</p>
              ) : (
                <div className="space-y-6" data-tour="stats-dashboard">
                  {/* User Dashboard with trends and charts */}
                  <UserDashboard 
                    uid={uid} 
                    counters={counters} 
                    xp={xp} 
                    streakCurrent={streakCurrent} 
                    streakLongest={streakLongest} 
                    daysTotal={displayDaysTotal} 
                  />
                  
                  {/* Upgrade prompt - hidden for institution users */}
                  {(plan === 'free' || plan === 'basic') && !isInstitutionUser && (
                    <div className="rounded-xl border p-4 flex items-center justify-between gap-3">
                      <div className="text-sm text-muted-foreground">Unlock Career features and higher limits with Advanced/Pro.</div>
                      <Button size="sm" onClick={() => navigate('/account?tab=usage')}>Upgrade to Advanced/Pro</Button>
                    </div>
                  )}
                </div>
              )}
            </TabsContent>

          </Tabs>
          </FadeIn>
        </div>
      </section>

      

      {/* Confirm Delete Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="text-xl">Delete your account?</DialogTitle>
            <div className="text-sm text-muted-foreground">This will permanently remove your account and data and immediately cancel your subscription and access to paid features.</div>
          </DialogHeader>
          <div className="text-sm space-y-3">
            <div className="rounded-md border bg-muted/30 p-3">
              <p className="font-medium mb-1">This will:</p>
              <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                <li><span className="font-medium text-foreground">Immediately cancel your current subscription/tier</span> and remove access to paid features</li>
              </ul>
            </div>
            <p className="text-sm text-destructive font-medium">This action cannot be undone and you will no longer be able to access your account.</p>
            <div className="space-y-1">
              <Label htmlFor="confirmDelete" className="text-sm">Type <span className="font-semibold">DELETE</span> to confirm</Label>
              <Input
                id="confirmDelete"
                placeholder="delete"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                className={`${deleteConfirmGlow ? 'ring-2 ring-destructive animate-pulse' : ''}`}
              />
            </div>
          </div>
          <DialogFooter className="sm:justify-between">
            <Button variant="ghost" onClick={() => setDeleteOpen(false)} disabled={deleting}>Cancel</Button>
            <Button
              variant="destructive"
              className={`${(deleteConfirmText.trim().toLowerCase() !== 'delete') ? 'opacity-70 cursor-not-allowed' : ''}`}
              onClick={() => {
                const ok = deleteConfirmText.trim().toLowerCase() === 'delete';
                if (!ok || deleting) {
                  setDeleteConfirmGlow(true);
                  setTimeout(() => setDeleteConfirmGlow(false), 700);
                  return;
                }
                handleDeleteAccount();
              }}
            >
              {deleting ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" />Deleting…</>) : 'Yes, delete everything'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Crop Modal */}
      <Dialog open={cropOpen} onOpenChange={setCropOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Adjust avatar</DialogTitle>
          </DialogHeader>
          <div className="relative h-64 bg-muted rounded-md overflow-hidden">
            {imageSrc && (
              <Cropper
                image={imageSrc}
                crop={crop}
                zoom={zoom}
                aspect={1}
                showGrid={false}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={(_, areaPixels) => setCroppedArea(areaPixels)}
              />
            )}
            {/* circular mask */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-48 w-48 rounded-full border-2 border-white/40" />
            </div>
          </div>
          <div className="mt-4">
            <div className="text-xs text-muted-foreground mb-2">Zoom</div>
            <Slider value={[zoom]} min={1} max={3} step={0.01} onValueChange={(v) => setZoom(v[0])} />
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => { setCropOpen(false); setImageSrc(null); }}>Cancel</Button>
            <Button
              onClick={async () => {
                if (!imageSrc || !croppedArea || !uid) { setCropOpen(false); return; }
                setFunFact(getRandomFunFact());
                setUploading(true);
                try {
                  // export cropped area to blob (fast decode via ImageBitmap, smaller size, WebP if supported)
                  const srcBlob: Blob = await (await fetch(imageSrc)).blob();
                  const bitmap = await createImageBitmap(srcBlob);
                  const canvas = document.createElement('canvas');
                  let size = 192; // smaller default for faster uploads
                  const drawToCanvas = () => {
                    canvas.width = size; canvas.height = size;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) throw new Error('Canvas unsupported');
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    // circular mask so only visible avatar area remains (transparent outside)
                    ctx.save();
                    ctx.beginPath();
                    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
                    ctx.closePath();
                    ctx.clip();
                    ctx.drawImage(
                      bitmap,
                      croppedArea.x,
                      croppedArea.y,
                      croppedArea.width,
                      croppedArea.height,
                      0,
                      0,
                      size,
                      size
                    );
                    ctx.restore();
                  };
                  drawToCanvas();
                  try { bitmap.close(); } catch {}
                  // Prefer WebP; adaptively reduce quality/size to keep <=2MB
                  let mime: string = 'image/webp';
                  let quality = 0.7;
                  const targetBytes = 300 * 1024; // ~300KB target for snappy uploads
                  let outBlob: Blob | null = null;
                  const encode = async () => new Promise<Blob | null>((resolve) => canvas.toBlob(b => resolve(b), mime, quality));
                  outBlob = await encode();
                  if (!outBlob) { mime = 'image/jpeg'; outBlob = await encode(); }
                  let attempts = 0;
                  while (outBlob && outBlob.size > targetBytes && attempts < 8) {
                    if (quality > 0.5) { quality -= 0.1; }
                    else { size = Math.max(128, Math.round(size * 0.85)); drawToCanvas(); }
                    outBlob = await encode();
                    if (!outBlob && mime !== 'image/jpeg') { mime = 'image/jpeg'; outBlob = await encode(); }
                    attempts++;
                  }
                  if (!outBlob) throw new Error('Failed to encode image');
                  const ext = mime === 'image/webp' ? 'webp' : 'jpg';
                  // Use unique filename with timestamp to avoid browser caching issues
                  const timestamp = Date.now();
                  const newPath = `users/${uid}/avatar_${timestamp}.${ext}`;
                  
                  // Delete ALL old avatar files first (any pattern)
                  try {
                    const userFolder = ref(storage, `users/${uid}`);
                    const list = await listAll(userFolder);
                    const avatarFiles = list.items.filter(item => 
                      item.name.startsWith('avatar_') || 
                      item.name.startsWith('profile.')
                    );
                    await Promise.all(avatarFiles.map(f => deleteObject(f).catch(() => {})));
                  } catch {}
                  
                  const r = ref(storage, newPath);
                  const task = uploadBytesResumable(r, outBlob, { contentType: mime });
                  await new Promise<void>((resolve, reject) => {
                    task.on('state_changed', undefined, (err) => reject(err), () => resolve());
                  });
                  // Shorter cache time to allow updates to propagate
                  try { await updateMetadata(r, { cacheControl: 'public,max-age=3600' }); } catch {}
                  const url = await getDownloadURL(r);
                  const u = auth.currentUser;
                  if (u) { try { await updateProfile(u, { photoURL: url }); } catch {} }
                  try {
                    const setPhoto = httpsCallable(fbFunctions, 'setPhotoURL');
                    await setPhoto({ url });
                  } catch {}
                  // Update localStorage cache immediately
                  try {
                    const cached = localStorage.getItem(`profile_${uid}`);
                    if (cached) {
                      const parsed = JSON.parse(cached);
                      parsed.photo_url = url;
                      localStorage.setItem(`profile_${uid}`, JSON.stringify(parsed));
                    }
                  } catch {}
                  setPhotoURL(url);
                  setCropOpen(false);
                  setImageSrc(null);
                } catch (e:any) {
                  console.error(e);
                  alert(e?.message || 'Failed to save');
                } finally {
                  setUploading(false);
                }
              }}
            >
              {uploading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Uploading</> : 'Save Photo'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      
      {/* Upsell Dialog for Friends Feature */}
      <Dialog open={upsellOpen} onOpenChange={setUpsellOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upgrade Required</DialogTitle>
            <DialogDescription>{upsellMsg}</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setUpsellOpen(false)}>Maybe Later</Button>
            <Button onClick={() => { setUpsellOpen(false); setTab('usage'); }}>View Plans</Button>
          </div>
        </DialogContent>
      </Dialog>
      <Footer />
      
      {/* Report Issue Dialog */}
      <ReportIssueDialog open={reportOpen} onOpenChange={setReportOpen} />
      
      {/* Feature Help Button */}
      {uid && <FeatureHelpButton currentTab={tab === 'usage' ? 'account' : `account-${tab}`} />}
    </div>
  );
};

export default Account;
