import { lazy, Suspense, useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { auth, functions as fbFunctions } from "../../firebase";
import { useUserData } from "@/contexts/UserDataContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { BookOpen, MessageSquare, Layers, ListChecks, GraduationCap, Briefcase, Sun, Moon, ChevronRight, Users, Search, UserCircle, ChevronUp, Star, Bell, Loader2, BarChart3, BrainCircuit } from "lucide-react";
import MetaStudyLogo from "@/assets/metastudy-icon.png";
import { AccountMenu } from "@/components/AccountMenu";
import { UnifiedProfilePopup } from "@/components/UnifiedProfilePopup";
import { NotificationCenter } from "@/components/ui/NotificationCenter";
import { StatsPopup } from "@/components/ui/StatsPopup";
import { useStripeRole } from "@/lib/authClaims";
import { usePlanGate } from "@/hooks/use-plan-gate";
import { getMondayTimestamp } from "@/lib/achievements";
import { SEO } from "@/components/SEO";
import { getLevelInfo } from "@/lib/achievements";
import { db } from "../../firebase";
import { collection, query, where, doc, setDoc, deleteDoc, serverTimestamp, getDoc, getDocs, orderBy, startAt, endAt, limit, documentId, updateDoc, writeBatch } from "firebase/firestore";
import { batchFetchUserProfiles } from "@/lib/firestore-utils";
import { httpsCallable } from "firebase/functions";
import { Footer } from "@/components/Footer";
import { OnboardingTour, FeatureHelpButton } from "@/components/OnboardingTour";
import { FadeIn } from "@/components/PageTransition";
import { notifyAIPageVisit } from "@/components/AIDisclosure";

const StudySummarizer = lazy(() => import("@/components/study/StudySummarizer").then((m) => ({ default: m.StudySummarizer })));
const StudyFlashcards = lazy(() => import("@/components/study/StudyFlashcards").then((m) => ({ default: m.StudyFlashcards })));
const StudyChat = lazy(() => import("@/components/study/StudyChat").then((m) => ({ default: m.StudyChat })));
const StudyQuiz = lazy(() => import("@/components/study/StudyQuiz").then((m) => ({ default: m.StudyQuiz })));
const StudyHelper = lazy(() => import("@/components/study/StudyHelper").then((m) => ({ default: m.StudyHelper })));
const CareerLaunchpad = lazy(() => import("@/components/study/CareerLaunchpad").then((m) => ({ default: m.CareerLaunchpad })));
const StudyFeed = lazy(() => import("@/components/study/StudyFeed").then((m) => ({ default: m.StudyFeed })));
const AdaptiveTutor = lazy(() => import("@/components/study/AdaptiveTutor").then((m) => ({ default: m.AdaptiveTutor })));

const Study = () => {
  const userData = useUserData();
  const user = userData.user;
  const loading = userData.loading;
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const navigate = useNavigate();
  const [tab, setTab] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("study_tab") || "chat";
      // 'plans' was merged into the tutor tab
      return saved === "plans" ? "tutor" : saved;
    }
    return "chat";
  });
  const [tutorMode, setTutorMode] = useState<'practice' | 'lesson'>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("tutor_mode") === "lesson" ? "lesson" : "practice";
    }
    return "practice";
  });
  useEffect(() => {
    localStorage.setItem("tutor_mode", tutorMode);
  }, [tutorMode]);
  
  useEffect(() => {
    localStorage.setItem("study_tab", tab);
  }, [tab]);

  const [hasUnsaved, setHasUnsaved] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [pendingTab, setPendingTab] = useState<string | null>(null);
  useStripeRole();
  const gate = usePlanGate();
  const [upsellOpen, setUpsellOpen] = useState(false);
  const [upsellMsg, setUpsellMsg] = useState<string>("");
  const [friendsOpen, setFriendsOpen] = useState(false);
  // Lazy-start the friends listener the first time the Friends dialog opens
  useEffect(() => {
    if (friendsOpen) userData.requestFriends();
  }, [friendsOpen]);
  const [friendBadge, setFriendBadge] = useState<number>(0);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationBadge, setNotificationBadge] = useState<number>(0);
  const [statsOpen, setStatsOpen] = useState(false);
  const [savedGoals, setSavedGoals] = useState<Array<{type: string; target: number}>>([
    { type: 'days', target: 5 },
    { type: 'quizzes', target: 3 },
    { type: 'flashcards', target: 5 },
  ]);
  const [weeklyCounters, setWeeklyCounters] = useState<Record<string, number>>({});
  const [weeklyDays, setWeeklyDays] = useState(0);
  const [findQuery, setFindQuery] = useState("");
  const [findLoading, setFindLoading] = useState(false);
  const [findError, setFindError] = useState<string>("");
  const [findResult, setFindResult] = useState<{ uid: string; username: string; photo_url?: string | null } | null>(null);
  const [findResults, setFindResults] = useState<Array<{ uid: string; username: string; photo_url?: string | null }>>([]);
  const findTimerRef = useRef<number | null>(null);
  const [incomingReqs, setIncomingReqs] = useState<Array<{ id: string; from: string; from_username?: string; from_photo?: string | null }>>([]);
  const [outgoingReqs, setOutgoingReqs] = useState<Array<{ id: string; to: string; to_username?: string }>>([]);
  const [friends, setFriends] = useState<Array<{ id: string; friend_uid: string; favorite?: boolean }>>([]);
  const [friendInfo, setFriendInfo] = useState<Record<string, { username?: string; photo_url?: string | null; exists?: boolean }>>({});
  const [friendXp, setFriendXp] = useState<Record<string, number>>({});
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileUser, setProfileUser] = useState<{ uid: string; username?: string; photo_url?: string | null } | null>(null);
  const [, setProfileLoading] = useState(false);
  const [, setProfileExists] = useState<boolean>(true);
  const [, setProfileXp] = useState<number>(0);
  const [, setProfileCounters] = useState<any>(null);
  const [, setProfileDaysTotal] = useState<number>(0);
  const [, setProfileStreakCurrent] = useState<number>(0);
  const [, setProfileStreakLongest] = useState<number>(0);
  const [, setProfileLatestFrom] = useState<{ emoji: string; ts: number } | null>(null);
  const [, setProfileLatestSent] = useState<{ emoji: string; ts: number } | null>(null);
    const [reactionBubbles, setReactionBubbles] = useState<Record<string, { emoji: string; ts: number }>>({});
  const [, setSentBubbles] = useState<Record<string, { emoji: string; ts: number }>>({});
    const [myBlocks, setMyBlocks] = useState<Record<string, boolean>>({});
  const studyQuizRef = useRef<{ refreshQuizzes: () => void } | null>(null);
  const studyFlashcardsRef = useRef<{ refreshFlashcards: () => void } | null>(null);
  const studySummarizerRef = useRef<{ refreshSummaries: () => void } | null>(null);
  const studyHelperRef = useRef<{ refreshPlans: () => void } | null>(null);
  const [requestInfo, setRequestInfo] = useState<Record<string, { username?: string; photo_url?: string | null }>>({});
  const [showGoTop, setShowGoTop] = useState(false);
  const [tabsVisible, setTabsVisible] = useState(true);
  const cleanupRanRef = useRef<boolean>(false);
  const [deleteFriendOpen, setDeleteFriendOpen] = useState(false);
  const [deleteFriendTarget, setDeleteFriendTarget] = useState<{ uid: string; username?: string } | null>(null);
  const [blockConfirmOpen, setBlockConfirmOpen] = useState(false);
  const [blockTarget, setBlockTarget] = useState<{ uid: string; username?: string } | null>(null);
  const [acceptingRequests, setAcceptingRequests] = useState<Set<string>>(new Set());

  // Load saved goals from localStorage for stats button percentage
  useEffect(() => {
    if (!user?.uid) return;
    const cacheKey = `weeklyGoals_${user.uid}`;
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const data = JSON.parse(cached);
        if (Array.isArray(data.goals) && data.goals.length > 0) {
          setSavedGoals(data.goals);
        }
      }
    } catch {}
  }, [user?.uid, statsOpen]); // Re-check when statsOpen changes (user may have edited goals)

  // Load weekly counters for stats button percentage (from context - no extra Firestore read)
  useEffect(() => {
    if (!userData.uid) return;
    const data = userData.weeklyCounters as any;
    if (!data || Object.keys(data).length === 0) {
      setWeeklyCounters({});
      setWeeklyDays(0);
      return;
    }
    const currentMonday = getMondayTimestamp();
    const storedWeekStart = data.weekStartedAt || 0;
    if (storedWeekStart < currentMonday) {
      setWeeklyCounters({});
      setWeeklyDays(0);
    } else {
      const { weekStartedAt, weeklyDays: days, ...counters } = data;
      setWeeklyCounters(counters);
      setWeeklyDays((days || []).length);
    }
  }, [userData.weeklyCounters, userData.uid]);

  // Refresh weekly counters when stats panel opens (user may have done activities)
  useEffect(() => {
    if (statsOpen && userData.uid) userData.refreshWeeklyCounters();
  }, [statsOpen]);

  // Callbacks to refresh libraries when content is saved from feed
  const handleQuizSavedFromFeed = () => {
    console.log("Quiz saved from feed, refreshing quiz library");
    studyQuizRef.current?.refreshQuizzes();
  };

  const handleFlashcardsSavedFromFeed = () => {
    console.log("Flashcards saved from feed, refreshing flashcards library");
    studyFlashcardsRef.current?.refreshFlashcards();
  };

  const handleSummarySavedFromFeed = () => {
    console.log("Summary saved from feed, refreshing summaries library");
    studySummarizerRef.current?.refreshSummaries();
  };

  const handlePlanSavedFromFeed = () => {
    console.log("Study plan saved from feed, refreshing plans library");
    studyHelperRef.current?.refreshPlans();
  };

  // Listen for cross-tool event to open AI Chat (e.g., from StudyHelper Homework CTA)
  useEffect(() => {
    const openChat = () => setTab('chat');
    window.addEventListener('open-ai-chat', openChat as EventListener);
    return () => window.removeEventListener('open-ai-chat', openChat as EventListener);
  }, []);

  // Redirect to /auth when signed out
  useEffect(() => {
    if (!userData.loading && !userData.uid) navigate("/auth");
  }, [userData.uid, userData.loading, navigate]);

  // Notify page visit once per sign-in session
  useEffect(() => {
    if (userData.uid) notifyAIPageVisit();
  }, [userData.uid]);

  // Get username and photo from context - only use actual username chosen by user, no fallbacks
  const myUsername = userData.username || '';
  const myPhotoURL = userData.photoURL;

  // Get sent reactions from context
  useEffect(() => {
    setSentBubbles(userData.sentReactions);
  }, [userData.sentReactions]);

  // Removed client write to users/{uid} root to comply with Firestore rules (no client writes to account doc)
  const blockUser = async (otherUid: string) => {
    if (!user?.uid || !otherUid || otherUid === user.uid) return;
    try {
      // Create block
      const batch = writeBatch(db);
      batch.set(doc(db, 'users', user.uid, 'blocks', otherUid), { blocked_at: serverTimestamp() }, { merge: true });
      // Cleanup friendship both sides
      batch.delete(doc(db, 'users', user.uid, 'friends', otherUid));
      batch.delete(doc(db, 'users', otherUid, 'friends', user.uid));
      // Remove pending requests both directions
      batch.delete(doc(db, 'users', user.uid, 'friend_requests', otherUid));
      batch.delete(doc(db, 'users', otherUid, 'friend_requests', user.uid));
      await batch.commit();
    } catch {}
  };

  // Unfriend (remove both directions)
  
  
  // Toggle favorite flag on a friend
  
  // Typeahead search by username prefix (min 3 chars)
  // OPTIMIZED: Uses batchFetchUserProfiles with caching to reduce reads
  const runTypeahead = async (prefix: string) => {
    try {
      if (prefix.length < 3) { setFindResults([]); return; }
      const q = query(
        collection(db as any, 'usernames'),
        orderBy(documentId()),
        startAt(prefix),
        endAt(prefix + '\uf8ff'),
        limit(10)
      );
      const snap = await getDocs(q as any);
      
      // Collect UIDs and usernames
      const usernameMap: Record<string, string> = {};
      const uids: string[] = [];
      snap.docs.forEach((d: any) => {
        const username = d.id;
        const uid = (d.data() as any)?.uid;
        if (uid) {
          usernameMap[uid] = username;
          uids.push(uid);
        }
      });
      
      // Batch fetch profiles with caching
      const profiles = await batchFetchUserProfiles(uids);
      
      const rows: Array<{ uid: string; username: string; photo_url?: string | null }> = [];
      uids.forEach((uid) => {
        const profile = profiles.get(uid);
        rows.push({
          uid,
          username: usernameMap[uid],
          photo_url: profile?.photo_url || null
        });
      });
      
      setFindResults(rows);
    } catch {
      setFindResults([]);
    }
  };

  // Send a reaction notification (available to all tiers)
  // OPTIMIZED: Uses batch write and localStorage caching
  
  // Listen for unsaved change signals from tools
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ tool: string; value: boolean }>;
      setHasUnsaved(!!ce.detail?.value);
    };
    window.addEventListener("study-unsaved-changes", handler as EventListener);
    return () => window.removeEventListener("study-unsaved-changes", handler as EventListener);
  }, []);

  // Find by username (public): usernames/{lower} -> users/{uid}
  // OPTIMIZED: Uses batchFetchUserProfiles with caching to reduce reads
  const findUserByUsername = async () => {
    try {
      setFindError(""); setFindResult(null); setFindLoading(true);
      const name = (findQuery || "").trim().toLowerCase();
      if (!/^[a-z0-9.]{3,20}$/.test(name)) { setFindError("Enter a valid username (3-20 lowercase)" ); return; }
      const unameRef = doc(db as any, "usernames", name);
      const unameSnap = await getDoc(unameRef);
      if (!unameSnap.exists()) { setFindError("No user with that username"); return; }
      const uid = (unameSnap.data() as any)?.uid;
      if (!uid) { setFindError("No user with that username"); return; }
      // Use batch fetch with caching instead of direct read (saves reads on repeat lookups)
      const profiles = await batchFetchUserProfiles([uid]);
      const profile = profiles.get(uid);
      setFindResult({ uid, username: name, photo_url: profile?.photo_url || null });
    } catch (e: any) {
      setFindError(e?.message || "Search failed");
    } finally {
      setFindLoading(false);
    }
  };

  // Use context for notification badge (eliminates duplicate listener)
  useEffect(() => {
    setNotificationBadge(userData.unreadNotificationCount);
  }, [userData.unreadNotificationCount]);

  // Use receivedReactions from context (eliminates duplicate listener)
  useEffect(() => {
    const bubbles: Record<string, { emoji: string; ts: number }> = {};
    Object.entries(userData.receivedReactions).forEach(([fromUid, reaction]) => {
      bubbles[fromUid] = { emoji: reaction.emoji, ts: reaction.ts };
    });
    setReactionBubbles(bubbles);
  }, [userData.receivedReactions]);

  // Get friend requests, friends, and blocks from context
  useEffect(() => {
    const incoming: typeof incomingReqs = [];
    const outgoing: typeof outgoingReqs = [];
    const needLookup = new Set<string>();
    const newRequestInfo: Record<string, { username?: string; photo_url?: string | null }> = {};

    userData.friendRequests.forEach(req => {
      const status = req.status || 'pending';
      if (status === 'pending') {
        if (req.to === userData.uid) {
          // Incoming request - I'm the recipient
          const fromUsername = req.fromUsername || (req as any).from_username || '';
          const fromPhoto = req.fromPhotoURL || (req as any).from_photo || null;
          incoming.push({ 
            id: req.id, 
            from: req.from, 
            from_username: fromUsername, 
            from_photo: fromPhoto
          });
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
          if (toUsername) {
            newRequestInfo[req.to] = { username: toUsername, photo_url: toPhoto };
          } else {
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

    // OPTIMIZED: Fetch usernames for those missing using cached batch fetch
    if (needLookup.size > 0) {
      (async () => {
        const entries = Array.from(needLookup);
        const profiles = await batchFetchUserProfiles(entries);
        const out: Record<string, { username?: string; photo_url?: string | null }> = {};
        profiles.forEach((profile, uid) => {
          out[uid] = { username: profile.username?.toLowerCase(), photo_url: profile.photo_url };
        });
        if (Object.keys(out).length > 0) setRequestInfo(prev => ({ ...prev, ...out }));
      })();
    }
  }, [userData.friendRequests, userData.uid]);

  // Get friends from context
  useEffect(() => {
    const list: typeof friends = [];
    userData.friends.forEach(f => {
      list.push({ id: f.friend_uid, friend_uid: f.friend_uid, favorite: f.isFavorite });
    });
    setFriends(list);
  }, [userData.friends]);

  // Get blocks from context
  useEffect(() => {
    const map: Record<string, boolean> = {};
    userData.blockedUsers.forEach(uid => { map[uid] = true; });
    setMyBlocks(map);
  }, [userData.blockedUsers]);


  // OPTIMIZED: Batch read friend info every 30 seconds instead of per-friend listeners
  // This reduces from 2N listeners to 0 listeners (huge cost savings!)
  useEffect(() => {
    if (friends.length === 0) return;
    
    const fetchFriendData = async () => {
      try {
        const friendUids = friends.map(f => f.friend_uid);
        if (friendUids.length === 0) return;
        
        // OPTIMIZED: Use batchFetchUserProfiles with caching for profiles
        const profiles = await batchFetchUserProfiles(friendUids);
        const newFriendInfo: Record<string, any> = {};
        profiles.forEach((profile, uid) => {
          newFriendInfo[uid] = {
            username: profile.username,
            photo_url: profile.photo_url,
            // The friend doc itself is authoritative - never hide friends just
            // because their public_profiles mirror doc is missing
            exists: true
          };
        });
        setFriendInfo(prev => ({ ...prev, ...newFriendInfo }));
        
        // OPTIMIZED: Batch read counters with localStorage caching (reduces reads on refresh)
        const cacheKey = `friend_xp_cache`;
        let cachedXp: Record<string, { xp: number; ts: number }> = {};
        try {
          const cached = localStorage.getItem(cacheKey);
          if (cached) cachedXp = JSON.parse(cached);
        } catch {}
        
        const now = Date.now();
        const CACHE_TTL = 60000; // 1 minute cache
        const toFetch = friendUids.filter(uid => !cachedXp[uid] || now - cachedXp[uid].ts > CACHE_TTL);
        
        // Use cached values immediately
        const newFriendXp: Record<string, number> = {};
        friendUids.forEach(uid => {
          if (cachedXp[uid]) newFriendXp[uid] = cachedXp[uid].xp;
        });
        if (Object.keys(newFriendXp).length) setFriendXp(prev => ({ ...prev, ...newFriendXp }));
        
        // Fetch only uncached (max 10 at a time)
        if (toFetch.length > 0) {
          const chunks: string[][] = [];
          for (let i = 0; i < toFetch.length; i += 10) {
            chunks.push(toFetch.slice(i, i + 10));
          }
          
          for (const chunk of chunks) {
            // PRIVACY: read xp from public_profiles mirror (meta/counters is owner-only)
            const countersPromises = chunk.map(uid => 
              getDoc(doc(db as any, 'public_profiles', uid))
            );
            const countersSnaps = await Promise.all(countersPromises);
            
            const fetchedXp: Record<string, number> = {};
            countersSnaps.forEach((snap, idx) => {
              const xp = snap.exists() ? Number((snap.data() as any).xp || 0) : 0;
              fetchedXp[chunk[idx]] = xp;
              cachedXp[chunk[idx]] = { xp, ts: now };
            });
            
            setFriendXp(prev => ({ ...prev, ...fetchedXp }));
          }
          
          // Update cache
          try { localStorage.setItem(cacheKey, JSON.stringify(cachedXp)); } catch {}
        }
      } catch (error) {
        console.error('Failed to fetch friend data:', error);
      }
    };
    
    // Initial fetch
    fetchFriendData();
    
    // Refresh every 30 seconds
    const interval = setInterval(fetchFriendData, 30000);
    
    return () => clearInterval(interval);
  }, [friends]);

  const openFriendProfile = async (uid: string) => {
    try {
      setProfileLoading(true);
      
      // OPTIMIZED: Use cached profile if available for instant display
      const cachedProfiles = await batchFetchUserProfiles([uid]);
      const cachedProfile = cachedProfiles.get(uid);
      if (cachedProfile) {
        setProfileUser({ uid, username: (cachedProfile.username || '').toLowerCase(), photo_url: cachedProfile.photo_url || null });
      }
      
      // PRIVACY: single read of public_profiles mirror (users doc, meta/counters
      // and meta/achievements are owner-only readable)
      const psnap = await getDoc(doc(db as any, 'public_profiles', uid));
      const pdata = psnap.exists() ? (psnap.data() as any) : {};
      
      // If cache didn't have full profile, use fresh mirror data
      if (!cachedProfile?.username) {
        setProfileExists(psnap.exists());
        setProfileUser({ uid, username: (pdata.username || '').toLowerCase(), photo_url: (pdata.photo_url || null) });
      } else {
        setProfileExists(true);
      }
      
      const xp = Number(pdata.xp || 0);
      setProfileStreakCurrent(Number(pdata.streak_current || 0));
      setProfileStreakLongest(Number(pdata.streak_longest || 0));
      setProfileDaysTotal(Number(pdata.days_total || 0));
      // Profile user already set above from cache or fresh fetch
      setProfileCounters({ xp, quizzes: Number(pdata.quizzes || 0), chats: Number(pdata.chats || 0), flashcards: Number(pdata.flashcards || 0) });
      setProfileXp(xp);
      // Load latest reaction THEY sent to ME in last 24h
      try {
        const dayMs = 24*60*60*1000; const now = Date.now();
        const notifQ = query(collection(db as any, 'users', user!.uid, 'notifications'), orderBy('created_at', 'desc'), limit(25));
        const notifSnap = await getDocs(notifQ as any);
        let latestFrom: { emoji: string; ts: number } | null = null;
        notifSnap.forEach((d:any) => {
          if (latestFrom) return;
          const x = d.data();
          if (x?.type === 'reaction' && String(x.from) === uid && x?.emoji) {
            const ts = x.created_at && typeof x.created_at.toMillis === 'function' ? x.created_at.toMillis() : now;
            if (now - ts <= dayMs) latestFrom = { emoji: String(x.emoji), ts };
          }
        });
        setProfileLatestFrom(latestFrom);
      } catch { setProfileLatestFrom(null); }
      // Load latest reaction I sent to THEM in last 24h
      try {
        const dayMs = 24*60*60*1000; const now = Date.now();
        const sentSnap = await getDoc(doc(db as any, 'users', user!.uid, 'sent_reactions', uid));
        if (sentSnap.exists()) {
          const x = sentSnap.data() as any;
          const ts = x.created_at && typeof x.created_at.toMillis === 'function' ? x.created_at.toMillis() : now;
          if (x?.emoji && (now - ts) <= dayMs) setProfileLatestSent({ emoji: String(x.emoji), ts }); else setProfileLatestSent(null);
        } else setProfileLatestSent(null);
      } catch { setProfileLatestSent(null); }
      setProfileOpen(true);
    } finally {
      setProfileLoading(false);
    }
  };

  // Actions: send/accept/decline/cancel friend requests
  const sendFriendRequest = async (target: { uid: string; username?: string; photo_url?: string | null }) => {
    if (!user?.uid || !target?.uid || user.uid === target.uid) return;
    if (myBlocks[target.uid]) { return; }
    const myUid = user.uid; const toUid = target.uid;
    const now = serverTimestamp();
    
    // Optimistic UI update - add to outgoing immediately with username and photo
    setOutgoingReqs(prev => prev.some(r => r.id === toUid) ? prev : [...prev, { id: toUid, to: toUid, to_username: target.username || '' }]);
    if (target.photo_url || target.username) {
      setRequestInfo(prev => ({ ...prev, [toUid]: { username: target.username || '', photo_url: target.photo_url || null } }));
    }
    
    // Mirror docs: outgoing in sender, incoming in recipient
    await Promise.all([
      setDoc(doc(db, 'users', myUid, 'friend_requests', toUid), {
        type: 'outgoing', from: myUid, to: toUid, status: 'pending', created_at: now,
        to_username: (target.username||''), to_photo: (target.photo_url||null), from_username: (myUsername||''), from_photo: (myPhotoURL||null)
      }, { merge: true }),
      setDoc(doc(db, 'users', toUid, 'friend_requests', myUid), {
        type: 'incoming', from: myUid, to: toUid, status: 'pending', created_at: now,
        from_username: (myUsername||''), from_photo: (myPhotoURL||auth.currentUser?.photoURL||null)
      }, { merge: true })
    ]);
  };

  const acceptFriendRequest = async (fromUid: string) => {
    if (!user?.uid) return; if (myBlocks[fromUid]) return;
    setAcceptingRequests(prev => new Set(prev).add(fromUid));
    try {
      // Server-side finalize (idempotent)
      const fn = httpsCallable(fbFunctions, 'acceptFriend');
      await fn({ otherUid: fromUid });
      
      // Immediately fetch friend's profile info so it shows in the list
      try {
        const friendSnap = await getDoc(doc(db as any, 'public_profiles', fromUid));
        if (friendSnap.exists()) {
          const d = friendSnap.data() as any;
          setFriendInfo(prev => ({
            ...prev,
            [fromUid]: {
              username: d.username || undefined,
              photo_url: d.photo_url || d.photoURL || null,
              exists: true
            }
          }));
        }
      } catch {}
    } catch {} finally {
      setAcceptingRequests(prev => { const n = new Set(prev); n.delete(fromUid); return n; });
    }
    // Optimistic local update so both lists reflect immediately
    // Also copy the request's photo and username to friendInfo if available
    const req = incomingReqs.find(r => r.id === fromUid);
    if (req) {
      setFriendInfo(prev => ({
        ...prev,
        [fromUid]: {
          ...prev[fromUid],
          username: req.from_username || prev[fromUid]?.username,
          photo_url: req.from_photo || prev[fromUid]?.photo_url,
          exists: true
        }
      }));
    }
    setFriends(prev => (prev.some(f => f.friend_uid === fromUid) ? prev : [...prev, { id: fromUid, friend_uid: fromUid }]));
    setIncomingReqs(prev => prev.filter(r => r.id !== fromUid));
    setOutgoingReqs(prev => prev.filter(r => r.id !== fromUid));
  };

  const declineFriendRequest = async (fromUid: string) => {
    if (!user?.uid) return; const myUid = user.uid;
    const batch = writeBatch(db);
    batch.delete(doc(db, 'users', myUid, 'friend_requests', fromUid));
    batch.delete(doc(db, 'users', fromUid, 'friend_requests', myUid));
    await batch.commit();
  };

  const cancelFriendRequest = async (toUid: string) => {
    if (!user?.uid) return; const myUid = user.uid;
    const batch = writeBatch(db);
    batch.delete(doc(db, 'users', myUid, 'friend_requests', toUid));
    batch.delete(doc(db, 'users', toUid, 'friend_requests', myUid));
    await batch.commit();
  };

  // Use centralized context for friend badge instead of duplicate listeners
  useEffect(() => {
    setFriendBadge(userData.pendingFriendRequestCount + userData.unreadNotificationCount);
  }, [userData.pendingFriendRequestCount, userData.unreadNotificationCount]);

  // When Friends dialog opens, mark unread notifications as read
  useEffect(() => {
    const run = async () => {
      if (!friendsOpen || !user?.uid) return;
      try {
        const qn = query(collection(db, 'users', user.uid, 'notifications'), where('read', '==', false));
        const snap = await getDocs(qn as any);
        await Promise.all(snap.docs.map((d:any) => updateDoc(d.ref, { read: true })));
      } catch {}
      // Context will automatically update unreadNotificationCount via its listener
    };
    run();
  }, [friendsOpen, user?.uid]);

  // When opening Friends modal, run server-side cleanup to remove orphaned friends (once per session)
  useEffect(() => {
    (async () => {
      if (!friendsOpen || !user?.uid) return;
      if (cleanupRanRef.current) return;
      try {
        const fn = httpsCallable(fbFunctions, 'cleanupMyFriends');
        await fn({});
      } catch {}
      cleanupRanRef.current = true;
    })();
  }, [friendsOpen, user?.uid]);

  useEffect(() => {
    const stored = localStorage.getItem("theme");
    if (stored !== "light") {
      setTheme("dark");
      document.documentElement.classList.add("dark");
    } else {
      setTheme("light");
      document.documentElement.classList.remove("dark");
    }
  }, []);

  // Show Go-Top button when tabs are not visible OR when header overlaps the tabs
  useEffect(() => {
    try {
      const el = document.querySelector('[data-study-tabs="true"]');
      if (!el) return;
      const calcOverlay = () => {
        try {
          const tabsEl = document.querySelector('[data-study-tabs="true"]') as HTMLElement | null;
          const headerEl = document.querySelector('[data-study-header="true"]') as HTMLElement | null;
          if (!tabsEl || !headerEl) { setShowGoTop(!tabsVisible); return; }
          const t = tabsEl.getBoundingClientRect();
          const h = headerEl.getBoundingClientRect();
          const overlapped = !(h.bottom <= t.top || h.top >= t.bottom);
          // Off-screen checks: above viewport or far below viewport
          const offscreen = (t.bottom <= 0) || (t.top >= window.innerHeight);
          setShowGoTop(!tabsVisible || overlapped || offscreen);
        } catch {}
      };
      const observer = new IntersectionObserver((entries) => {
        const entry = entries[0];
        setTabsVisible(entry.isIntersecting);
        calcOverlay();
      }, { root: null, threshold: 0 });
      observer.observe(el);
      const onScrollResize = () => calcOverlay();
      // Listen to both window scroll and any inner scroll containers (capture)
      window.addEventListener('scroll', onScrollResize, { passive: true });
      document.addEventListener('scroll', onScrollResize, { passive: true, capture: true });
      // Also observe scrollable ancestors of the tabs element
      const scrollables: Element[] = [];
      try {
        let node: HTMLElement | null = el as HTMLElement;
        while (node && node !== document.documentElement) {
          const style = window.getComputedStyle(node);
          const overflowY = style.overflowY;
          const isScrollable = (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay' || node.scrollHeight > node.clientHeight);
          if (isScrollable) {
            node.addEventListener('scroll', onScrollResize, { passive: true });
            scrollables.push(node);
          }
          node = node.parentElement;
        }
      } catch {}
      window.addEventListener('resize', onScrollResize);
      // Initial compute
      calcOverlay();
      return () => { 
        observer.disconnect(); 
        window.removeEventListener('scroll', onScrollResize); 
        document.removeEventListener('scroll', onScrollResize, { capture: true } as any);
        try { scrollables.forEach((el) => el.removeEventListener('scroll', onScrollResize as any)); } catch {}
        window.removeEventListener('resize', onScrollResize); 
      };
    } catch {}
  }, [tab]);

  // Post-checkout: if user lands on /study with checkout params, force claim refresh
  useEffect(() => {
    const fn = async () => {
      try {
        const url = new URL(window.location.href);
        const hasCheckout = url.searchParams.get('session_id') || url.searchParams.get('checkout') === 'success' || url.searchParams.get('addon') === 'success';
        if (!hasCheckout) return;
        await auth.currentUser?.getIdToken(true);
        // Clean URL params without reload
        url.searchParams.delete('session_id');
        url.searchParams.delete('checkout');
        url.searchParams.delete('addon');
        window.history.replaceState({}, '', url.toString());
      } catch {}
    };
    fn();
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("theme", next);
    if (next === "dark") document.documentElement.classList.add("dark");
    else document.documentElement.classList.remove("dark");
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Cross-action dispatcher: exposes window.studyCreateFrom(detail) */}
      {(() => {
        // Attach once per render
        (window as any).studyCreateFrom = (detail: any) => {
          try {
            const t = String(detail?.type || '').toLowerCase();
            const dest = t === 'flashcards' ? 'flashcards' : t === 'quiz' ? 'quizzes' : t === 'chat' ? 'chat' : t === 'tutor' ? 'tutor' : 'summarizer';
            // Switch tab first
            setTab(dest);
            // Dispatch after a small delay to allow mount
            setTimeout(() => {
              try { window.dispatchEvent(new CustomEvent('study-cross-action', { detail })); } catch {}
            }, 60);
          } catch {}
        };
        return null;
      })()}
      {(() => {
        // Helper: open a specific saved quiz by ID from other tools (e.g., Feed)
        (window as any).studyOpenQuiz = (quizId: string) => {
          try {
            if (!quizId) return;
            setTab('quizzes');
            setTimeout(() => {
              try {
                window.dispatchEvent(new CustomEvent('study-open-quiz', { detail: { quizId } }));
              } catch {}
            }, 80);
          } catch {}
        };
        return null;
      })()}
      {(() => {
        const base = "Study | MetaStudy";
        const titles: Record<string, string> = {
          chat: "AI Study Chat | Study | MetaStudy",
          summarizer: "AI Text Summarizer | Study | MetaStudy",
          flashcards: "AI Flashcard Maker | Study | MetaStudy",
          quizzes: "AI Quiz Generator | Study | MetaStudy",
          tutor: "Adaptive Tutor, Lessons & Practice | Study | MetaStudy",
          career: "AI Career Tools | Study | MetaStudy",
          feed: "Study Feed, Challenges & Community | Study | MetaStudy",
        };
        const descs: Record<string, string> = {
          chat: "Ask questions and learn faster with MetaStudy's AI study chat, powered by Meta Llama.",
          summarizer: "Paste text and get concise summaries or study notes for online learning.",
          flashcards: "Generate flashcards from your notes for faster memorization and studying.",
          quizzes: "Create practice quizzes from your notes and test your knowledge while studying.",
          tutor: "Generate lessons and practice them with an AI tutor that adapts to your understanding.",
          career: "Build resumes, portfolios, LinkedIn posts, and practice interviews with AI.",
        };
        const current = titles[tab] || base;
        const desc = descs[tab] || "Study tools: AI Chat, Summarizer, Flashcards, Quizzes, Study Plans, and Lessons.";
        const ogImageByTab: Record<string, string> = {
          chat: window.location.origin + "/metastudy-icon.png",
          summarizer: window.location.origin + "/metastudy-icon.png",
          flashcards: window.location.origin + "/metastudy-icon.png",
          quizzes: window.location.origin + "/metastudy-icon.png",
          tutor: window.location.origin + "/metastudy-icon.png",
          career: window.location.origin + "/metastudy-icon.png",
        };
        const featureJsonLd = (() => {
          const baseObj = {
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            "operatingSystem": "Web",
            "applicationCategory": "EducationalApplication",
            "image": ogImageByTab[tab] || (window.location.origin + "/icon.png"),
            "offers": {
              "@type": "Offer",
              "price": 0,
              "priceCurrency": "USD",
              "url": window.location.origin + "/pricing"
            },
            "provider": { "@type": "Organization", "name": "metastudy-e1ba2.web.app", "url": window.location.origin }
          } as any;
          const map: Record<string, any> = {
            chat: { ...baseObj, name: "AI Study Chat Tutor", description: desc },
            summarizer: { ...baseObj, name: "AI Text Summarizer", description: desc },
            flashcards: { ...baseObj, name: "AI Flashcard Generator", description: desc },
            quizzes: { ...baseObj, name: "AI Quiz Generator", description: desc },
            tutor: { ...baseObj, name: "Adaptive Tutor (Lessons & Practice)", description: desc },
            career: { ...baseObj, name: "AI Career Launchpad", description: desc },
            feed: { ...baseObj, name: "Study Feed (Challenges)", description: desc },
          };
          return map[tab] || null;
        })();
        const jsonLd = [
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            "itemListElement": [
              {"@type":"ListItem","position":1,"name":"Home","item": window.location.origin + "/"},
              {"@type":"ListItem","position":2,"name":"Study","item": window.location.origin + "/study"},
              {"@type":"ListItem","position":3,"name": (tab.charAt(0).toUpperCase() + tab.slice(1))}
            ]
          },
          ...(featureJsonLd ? [featureJsonLd] : [])
        ];
        return (
          <SEO
            title={current}
            description={desc}
            keywords={[
              "metastudy-e1ba2.web.app",
              "MetaStudy",
              "AI study partner",
              "AI flashcard generator",
              "AI quiz maker",
              "AI study tools",
              "AI homework helper",
              "AI teacher",
              "Meta Llama",
              "flashcards",
              "quizzes",
              "study plans",
              "summarizer",
              "chat tutor",
              "education",
              "lesson generator AI",
              "AI resume grader",
              "AI interview prep",
              "LinkedIn post generator",
              "career launchpad"
            ]}
            jsonLd={jsonLd}
            canonical={window.location.origin + "/study"}
            ogImage={ogImageByTab[tab] || (window.location.origin + "/icon.png")}
          />
        );
      })()}
      <header className="border-b border-border/40 backdrop-blur-sm sticky top-0 z-50" data-study-header="true">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <img src={MetaStudyLogo} alt="Logo" className="h-10 w-auto object-contain shrink-0" />
            <div className="hidden sm:block min-w-0">
              <h1 className="text-xl font-bold truncate">MetaStudy</h1>
              <p className="hidden sm:block text-xs text-muted-foreground truncate">Welcome back!</p>
            </div>
          </div>
          {user && (
            <div className="flex items-center gap-2">
              <div className="relative">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setFriendsOpen(true)}
                  aria-label="Friends"
                  data-tour="friends-button"
                >
                  <Users className="w-4 h-4" />
                </Button>
                {friendBadge > 0 && (
                  <span className="absolute -top-1 -right-1 h-4 min-w-4 px-1 rounded-full bg-destructive text-[10px] leading-4 text-white text-center">
                    {friendBadge > 9 ? '9+' : friendBadge}
                  </span>
                )}
              </div>
              
              {/* Notifications Button */}
              <div className="relative">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setNotificationsOpen(true)}
                  aria-label="Notifications"
                >
                  <Bell className="w-4 h-4" />
                </Button>
                {notificationBadge > 0 && (
                  <span className="absolute -top-1 -right-1 h-4 min-w-4 px-1 rounded-full bg-destructive text-[10px] leading-4 text-white text-center">
                    {notificationBadge > 9 ? '9+' : notificationBadge}
                  </span>
                )}
              </div>
              
              {/* Stats Button */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStatsOpen(true)}
                aria-label="Stats"
                className="flex items-center gap-1.5 px-2"
              >
                <BarChart3 className="w-4 h-4" />
                <span className="text-xs font-medium">
                  {(() => {
                    // Calculate progress based on user's saved goals using WEEKLY counters
                    const goalConfig: Record<string, { counterKey: string | null; isWeeklyDays: boolean }> = {
                      days: { counterKey: null, isWeeklyDays: true },
                      flashcards: { counterKey: 'flashcards', isWeeklyDays: false },
                      quizzes: { counterKey: 'quizzes', isWeeklyDays: false },
                      summaries: { counterKey: 'summaries', isWeeklyDays: false },
                      posts: { counterKey: 'posts', isWeeklyDays: false },
                    };
                    if (savedGoals.length === 0) return 0;
                    const total = savedGoals.reduce((sum, goal) => {
                      const config = goalConfig[goal.type];
                      if (!config) return sum;
                      let current = 0;
                      if (config.isWeeklyDays) current = weeklyDays;
                      else if (config.counterKey) current = weeklyCounters[config.counterKey] || 0;
                      const progress = Math.min(current, goal.target) / goal.target;
                      return sum + (isNaN(progress) ? 0 : progress);
                    }, 0);
                    return Math.round((total / savedGoals.length) * 100);
                  })()}%
                </span>
              </Button>
              
              <div data-tour="account-menu"><AccountMenu user={user} theme={theme} onThemeToggle={toggleTheme} /></div>
              <Button
                variant="outline"
                size="icon"
                onClick={toggleTheme}
                aria-label="Toggle theme"
              >
                {theme === "dark" ? (<Sun className="w-4 h-4" />) : (<Moon className="w-4 h-4" />)}
              </Button>
            </div>
          )}
        </div>
      </header>

      <main className="container mx-auto px-4 py-4">
        <FadeIn>
        <Tabs value={tab} onValueChange={(next) => {
          if (hasUnsaved) {
            setPendingTab(next);
            setLeaveOpen(true);
            return;
          }
          // Gate Quizzes for Basic+ plans
          if (next === 'quizzes' && !gate?.quizAccess) {
            setUpsellMsg('Quiz Generator is available on Basic and higher plans. Upgrade to unlock this tool.');
            setUpsellOpen(true);
            return;
          }
          // Gate Career behind Career access (Advanced/Pro)
          if (next === 'career' && !gate?.careerAccess) {
            setUpsellMsg('Career Launchpad is available on Advanced and higher plans. Upgrade to unlock it.');
            setUpsellOpen(true);
            return;
          }
          // Gate Feed for Advanced/Pro only
          if (next === 'feed') {
            const canFeed = gate && ['advanced', 'pro'].includes(gate.plan);
            if (!canFeed) {
              setUpsellMsg('The Study Feed is available on Advanced and Pro plans. Upgrade to post and join challenges.');
              setUpsellOpen(true);
              return;
            }
          }
          setTab(next);
        }} className="w-full">
          <TabsList className="grid w-full grid-cols-7 mb-8 bg-background text-foreground" data-study-tabs="true">
            <TabsTrigger value="chat" data-tour="chat-tab" className="flex items-center justify-center gap-2 py-2 sm:py-3 text-xs sm:text-sm rounded-md transition-colors hover:bg-accent/50 data-[state=active]:bg-accent data-[state=active]:text-accent-foreground">
              <MessageSquare className="w-4 h-4" />
              <span className="hidden sm:inline">AI Chat</span>
            </TabsTrigger>
            <TabsTrigger value="summarizer" data-tour="summarizer-tab" className="flex items-center justify-center gap-2 py-2 sm:py-3 text-xs sm:text-sm rounded-md transition-colors hover:bg-accent/50 data-[state=active]:bg-accent data-[state=active]:text-accent-foreground">
              <BookOpen className="w-4 h-4" />
              <span className="hidden sm:inline">Summarizer</span>
            </TabsTrigger>
            <TabsTrigger value="flashcards" data-tour="flashcards-tab" className="flex items-center justify-center gap-2 py-2 sm:py-3 text-xs sm:text-sm rounded-md transition-colors hover:bg-accent/50 data-[state=active]:bg-accent data-[state=active]:text-accent-foreground">
              <Layers className="w-4 h-4" />
              <span className="hidden sm:inline">Flashcards</span>
            </TabsTrigger>
            <TabsTrigger
              value="quizzes"
              data-tour="quiz-tab"
              aria-disabled={!gate?.quizAccess}
              className={`flex items-center justify-center gap-2 py-2 sm:py-3 text-xs sm:text-sm rounded-md transition-colors hover:bg-accent/50 data-[state=active]:bg-accent data-[state=active]:text-accent-foreground ${!gate?.quizAccess ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              <ListChecks className="w-4 h-4" />
              <span className="hidden sm:inline">Quizzes</span>
            </TabsTrigger>
            <TabsTrigger value="tutor" data-tour="tutor-tab" className="flex items-center justify-center gap-2 py-2 sm:py-3 text-xs sm:text-sm rounded-md transition-colors hover:bg-accent/50 data-[state=active]:bg-accent data-[state=active]:text-accent-foreground">
              <BrainCircuit className="w-4 h-4" />
              <span className="hidden sm:inline">Tutor</span>
            </TabsTrigger>
            <TabsTrigger
              value="career"
              data-tour="career-tab"
              aria-disabled={!gate?.careerAccess}
              className={`flex items-center justify-center gap-2 py-2 sm:py-3 text-xs sm:text-sm rounded-md transition-colors hover:bg-accent/50 data-[state=active]:bg-accent data-[state=active]:text-accent-foreground ${!gate?.careerAccess ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              <Briefcase className="w-4 h-4" />
              <span className="hidden sm:inline">Career Launchpad</span>
            </TabsTrigger>
            <TabsTrigger
              value="feed"
              data-tour="feed-tab"
              aria-disabled={!(gate && ['advanced', 'pro'].includes(gate.plan))}
              className={`flex items-center justify-center gap-2 py-2 sm:py-3 text-xs sm:text-sm rounded-md transition-colors hover:bg-accent/50 data-[state=active]:bg-accent data-[state=active]:text-accent-foreground ${!(gate && ['advanced', 'pro'].includes(gate.plan)) ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              <GraduationCap className="w-4 h-4" />
              <span className="hidden sm:inline">Feed</span>
            </TabsTrigger>
          </TabsList>

          {/* Advanced toolbar removed now that these tools are first-class tabs */}
          <Suspense fallback={<div className="min-h-[200px] flex items-center justify-center" role="status" aria-live="polite">Loading study tool…</div>}>
          <TabsContent value="chat" className="mt-0">
            <StudyChat userId={user?.uid || ""} />
          </TabsContent>

          <TabsContent value="summarizer" className="mt-0">
            <StudySummarizer ref={studySummarizerRef} userId={user?.uid || ""} />
          </TabsContent>

          <TabsContent value="flashcards" className="mt-0">
            <StudyFlashcards ref={studyFlashcardsRef} userId={user?.uid || ""} />
          </TabsContent>

          <TabsContent value="quizzes" className="mt-0">
            <StudyQuiz ref={studyQuizRef} userId={user?.uid || ""} />
          </TabsContent>

          <TabsContent value="tutor" className="mt-0">
            {/* Tutor hub: adaptive practice + lesson generator share one feature surface */}
            <Tabs value={tutorMode} onValueChange={(v) => setTutorMode(v as 'practice' | 'lesson')} className="w-full">
              <TabsList className="grid w-full grid-cols-2" data-tour="tutor-modes">
                <TabsTrigger value="practice">
                  <BrainCircuit className="w-4 h-4 mr-2" />
                  Practice
                </TabsTrigger>
                <TabsTrigger value="lesson">
                  <GraduationCap className="w-4 h-4 mr-2" />
                  Lesson Generator
                  {!gate?.studyPlans && <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground/70">Advanced+</span>}
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="mt-6">
            {tutorMode === 'lesson' ? (
              gate?.studyPlans ? (
                <StudyHelper ref={studyHelperRef} userId={user?.uid || ""} />
              ) : (
                <div className="min-h-[200px] flex items-center justify-center">
                  <div className="text-center space-y-2">
                    <p className="text-sm text-muted-foreground">Lesson Generator is available on Advanced and Pro plans.</p>
                    <Button onClick={() => { setUpsellMsg('Lesson Generator is included with Advanced and Pro plans. Upgrade to generate full lessons, then practice them in the tutor.'); setUpsellOpen(true); }}>View Plans</Button>
                  </div>
                </div>
              )
            ) : (
              <AdaptiveTutor userId={user?.uid || ""} />
            )}
            </div>
          </TabsContent>

          <TabsContent value="feed" className="mt-0">
            {gate && ['advanced', 'pro'].includes(gate.plan) ? (
              <StudyFeed 
                userId={user?.uid || ""} 
                username={myUsername} 
                photoUrl={myPhotoURL} 
                onQuizSaved={handleQuizSavedFromFeed}
                onFlashcardsSaved={handleFlashcardsSavedFromFeed}
                onSummarySaved={handleSummarySavedFromFeed}
                onPlanSaved={handlePlanSavedFromFeed}
              />
            ) : (
              <div className="min-h-[200px] flex items-center justify-center">
                <div className="text-center space-y-2">
                  <p className="text-sm text-muted-foreground">Study Feed is available on Advanced and Pro plans.</p>
                  <Button onClick={() => { setUpsellMsg('The Study Feed is available on Advanced and Pro plans. Upgrade to post and join challenges.'); setUpsellOpen(true); }}>View Plans</Button>
                </div>
              </div>
            )}
          </TabsContent>


          <TabsContent value="career" className="mt-0">
            {gate?.careerAccess ? (
              <CareerLaunchpad userId={user?.uid || ""} />
            ) : (
              <div className="min-h-[200px] flex items-center justify-center">
                <div className="text-center space-y-2">
                  <p className="text-sm text-muted-foreground">Career Launchpad is available on Advanced and Pro plans.</p>
                  <Button onClick={() => { setUpsellMsg('Career Launchpad is available on Advanced and Pro plans.'); setUpsellOpen(true); }}>View Plans</Button>
                </div>
              </div>
            )}
          </TabsContent>
          </Suspense>
        </Tabs>
        </FadeIn>

        {/* Go to Top button (appears only when tabs are not visible) */}
        {showGoTop && (
          <Button
            variant="default"
            size="icon"
            className="fixed bottom-16 right-4 z-50 rounded-full h-9 w-9 sm:h-10 sm:w-10 shadow-lg bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            aria-label="Go to top"
          >
            <ChevronUp className="w-4 h-4 sm:w-5 sm:h-5" />
          </Button>
        )}

        {/* Friends Modal */}
        <Dialog open={friendsOpen} onOpenChange={setFriendsOpen}>
          <DialogContent className="w-[calc(100vw-2rem)] max-w-lg sm:max-w-2xl max-h-[85vh] overflow-hidden flex flex-col p-4 sm:p-6">
            <DialogHeader className="flex-shrink-0 pb-2">
              <DialogTitle className="flex items-center gap-2 text-lg">
                <Users className="w-5 h-5 text-primary" />
                Friends
                {friends.length > 0 && (
                  <span className="text-xs font-normal text-muted-foreground">({friends.length})</span>
                )}
              </DialogTitle>
            </DialogHeader>
            <Tabs defaultValue="friends" className="w-full flex-1 flex flex-col min-h-0">
              <TabsList className="grid grid-cols-2 w-full flex-shrink-0">
                <TabsTrigger value="friends" className="text-xs sm:text-sm">
                  <Users className="w-3.5 h-3.5 mr-1.5" />
                  Friends
                </TabsTrigger>
                <TabsTrigger value="discover" className="text-xs sm:text-sm">
                  <Search className="w-3.5 h-3.5 mr-1.5" />
                  Find & Requests
                </TabsTrigger>
              </TabsList>
              <TabsContent value="friends" className="flex-1 overflow-y-auto pt-3">
                {friends.length === 0 ? (
                  <div className="text-center py-8">
                    <Users className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
                    <p className="text-sm text-muted-foreground">No friends yet</p>
                    <p className="text-xs text-muted-foreground mt-1">Search for users to add them!</p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
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
                        const info = friendInfo[f.friend_uid] || {} as any;
                        const xp = friendXp[f.friend_uid];
                        const levelInfo = typeof xp === 'number' ? getLevelInfo(xp) : null;
                        return (
                          <button
                            key={f.id}
                            className="flex items-center gap-3 w-full p-2.5 rounded-lg border bg-card hover:bg-accent/50 transition-colors text-left group"
                            onClick={() => openFriendProfile(f.friend_uid)}
                          >
                            <div className="relative flex-shrink-0">
                              {info.photo_url ? (
                                <img src={info.photo_url} alt={info.username||'user'} className="h-10 w-10 rounded-full object-cover ring-2 ring-background" />
                              ) : (
                                <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                                  <UserCircle className="h-6 w-6 text-muted-foreground" />
                                </div>
                              )}
                              {f.favorite && (
                                <Star className="absolute -top-1 -right-1 w-4 h-4 text-yellow-500 fill-yellow-500" />
                              )}
                              {reactionBubbles[f.friend_uid] && (
                                <span className="absolute -bottom-1 -right-1 text-sm bg-background rounded-full px-0.5">{reactionBubbles[f.friend_uid].emoji}</span>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-sm truncate">@{(info.username || 'unknown').toLowerCase()}</div>
                              {levelInfo && (
                                <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-medium">
                                    Lv.{levelInfo.level + 1}
                                  </span>
                                  <span>{xp} XP</span>
                                </div>
                              )}
                            </div>
                            <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors flex-shrink-0" />
                          </button>
                        );
                      })}
                  </div>
                )}
              </TabsContent>
              <TabsContent value="discover" className="flex-1 overflow-y-auto space-y-3 pt-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    className="w-full bg-background border rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                    placeholder="Search username..."
                    value={findQuery}
                    onChange={(e) => {
                      const v = e.target.value.toLowerCase();
                      setFindQuery(v);
                      setFindError("");
                      setFindResult(null);
                      if (findTimerRef.current) window.clearTimeout(findTimerRef.current);
                      findTimerRef.current = window.setTimeout(() => runTypeahead(v), 250);
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); findUserByUsername(); } }}
                  />
                </div>
                {findQuery.length >= 3 && findResults.length > 0 && !findResult && (
                  <div className="space-y-1">
                    {findResults.map(r => {
                      const ff = friends.find(f => f.friend_uid === r.uid);
                      const fav = !!ff?.favorite;
                      const isFriend = !!ff;
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
                            disabled={user?.uid === r.uid || outgoingReqs.some(o=>o.id===r.uid) || isFriend}
                          >
                            {isFriend ? '✓' : outgoingReqs.some(o => o.id === r.uid) ? 'Sent' : 'Add'}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
                {findError && (
                  <div className="text-xs text-destructive bg-destructive/10 px-3 py-2 rounded-lg">{findError}</div>
                )}
                {findLoading && (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                )}

                {/* Incoming Requests */}
                {incomingReqs.length > 0 && (
                  <div className="space-y-2">
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
                          <span className="text-sm font-medium truncate">@{(req.from_username || requestInfo[req.from]?.username || '').toLowerCase()}</span>
                        </button>
                        <div className="flex items-center gap-1.5">
                          <Button size="sm" className="h-7 px-2 text-xs" onClick={() => acceptFriendRequest(req.id)} disabled={acceptingRequests.has(req.id)}>
                            {acceptingRequests.has(req.id) ? <Loader2 className="w-3 h-3 animate-spin" /> : '✓'}
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground" onClick={() => declineFriendRequest(req.id)}>✕</Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Outgoing Requests */}
                {outgoingReqs.filter(req => !friends.some(f => f.friend_uid === req.id)).length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Pending</div>
                    {outgoingReqs.filter(req => !friends.some(f => f.friend_uid === req.id)).map(req => {
                      const displayUsername = (req.to_username || requestInfo[req.id]?.username || '').toLowerCase();
                      const displayPhoto = requestInfo[req.id]?.photo_url || null;
                      return (
                        <div key={req.id} className="flex items-center gap-3 p-2 rounded-lg border bg-muted/30">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            {displayPhoto ? (
                              <img src={displayPhoto} alt={displayUsername || 'user'} className="h-8 w-8 rounded-full object-cover opacity-70" />
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
              </TabsContent>
            </Tabs>
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
                onClick={async () => {
                  if (deleteFriendTarget?.uid && user?.uid) {
                    try { await deleteDoc(doc(db as any, 'users', user.uid, 'friends', deleteFriendTarget.uid)); } catch {}
                    try { await deleteDoc(doc(db as any, 'users', deleteFriendTarget.uid, 'friends', user.uid)); } catch {}
                    setFriends(prev => prev.filter(f => f.friend_uid !== deleteFriendTarget.uid));
                  }
                  setDeleteFriendOpen(false);
                  setDeleteFriendTarget(null);
                  setProfileOpen(false);
                }}
              >
                Yes, remove
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Confirm Block Dialog */}
        <Dialog open={blockConfirmOpen} onOpenChange={setBlockConfirmOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Block this person?</DialogTitle>
            </DialogHeader>
            <div className="text-sm text-muted-foreground">
              {blockTarget?.username ? (
                <>Are you sure you want to block @{blockTarget.username}? They will no longer be able to interact with you.</>
              ) : (
                <>Are you sure you want to block this person? They will no longer be able to interact with you.</>
              )}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setBlockConfirmOpen(false)}>Cancel</Button>
              <Button
                variant="destructive"
                onClick={async () => {
                  if (blockTarget?.uid) {
                    await blockUser(blockTarget.uid);
                  }
                  setBlockConfirmOpen(false);
                  setBlockTarget(null);
                  setProfileOpen(false);
                }}
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
          currentUserId={user?.uid || ''}
          currentUsername={user?.displayName || ''}
        />

        {/* Upsell Dialog */}
        <Dialog open={upsellOpen} onOpenChange={setUpsellOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Unlock with Advanced or Pro</DialogTitle>
            </DialogHeader>
            <div className="space-y-1">
              <p>{upsellMsg}</p>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setUpsellOpen(false)}>Close</Button>
              <Button onClick={() => { setUpsellOpen(false); navigate('/account?tab=usage'); }}>View Plans</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={leaveOpen} onOpenChange={setLeaveOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Leave without saving?</DialogTitle>
            </DialogHeader>
            <div className="space-y-1">
              <p>If you navigate away without saving, your current work will be lost.</p>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => { setLeaveOpen(false); setPendingTab(null); }}>Stay</Button>
              <Button variant="destructive" onClick={() => { setLeaveOpen(false); setHasUnsaved(false); if (pendingTab) setTab(pendingTab); setPendingTab(null); }}>Leave without saving</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
      <Footer />
      
      {/* Notification Center */}
      <NotificationCenter
        userId={user?.uid || ""}
        username={user?.displayName || ""}
        isOpen={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
        onGroupsUpdate={() => {
          // Trigger a refresh of groups in the StudyFeed component
          // This will be handled by the feed's group loading logic
          console.log("Groups updated via notification");
        }}
      />
      
      {/* Stats Popup */}
      <StatsPopup
        userId={user?.uid || ""}
        isOpen={statsOpen}
        onClose={() => setStatsOpen(false)}
        counters={userData.counters}
        achievements={userData.achievements}
      />
      
      {/* Onboarding Tutorial for new users */}
      {user && !loading && <OnboardingTour />}
      
      {/* Feature Help Button */}
      {user && !loading && <FeatureHelpButton currentTab={tab === 'tutor' && tutorMode === 'lesson' ? 'helper' : tab} />}
    </div>
  );
};

export default Study;
