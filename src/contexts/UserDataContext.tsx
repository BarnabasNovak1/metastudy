import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { auth, db } from '../../firebase';
import { doc, onSnapshot, collection, getDoc, getDocs, setDoc, Unsubscribe, query, where, limit, orderBy } from 'firebase/firestore';
import { User } from 'firebase/auth';
import { getMondayTimestamp } from '../lib/achievements';

// Types for all user data
export interface UserProfile {
  username?: string;
  photo_url?: string;
  photoURL?: string;
  plan?: string;
  monthly_quota?: number;
  word_limit?: number;
  uses?: number;
  // RBAC fields
  role?: 'user' | 'moderator' | 'admin' | 'superadmin';
  banned?: {
    cannot_post?: boolean;
    cannot_comment?: boolean;
    full?: boolean;
  };
  // Add other profile fields as needed
  [key: string]: any;
}

export interface Counters {
  xp?: number;
  uses?: number;
  flashcards?: number;
  quizzes?: number;
  essays?: number;
  summaries?: number;
  // Add-on balances
  flashcards_addon?: number;
  quizzes_addon?: number;
  essays_addon?: number;
  summaries_addon?: number;
  [key: string]: any;
}

export interface Achievements {
  days_total?: number;
  streak_current?: number;
  streak_longest?: number;
  earned?: Record<string, boolean>;
  [key: string]: any;
}

export interface Friend {
  friend_uid: string;
  username?: string;
  photo_url?: string;
  isFavorite?: boolean;
  xp?: number;
  level?: number;
  created_at?: any;
}

export interface FriendRequest {
  id: string;
  from: string;
  to: string;
  status: 'pending' | 'accepted' | 'rejected';
  created_at?: any;
  fromUsername?: string;
  fromPhotoURL?: string;
}

export interface SentReaction {
  friendUid: string;
  emoji: string;
  ts: number;
}

export interface ReceivedReaction {
  fromUid: string;
  emoji: string;
  ts: number;
}

export interface WeeklyCounters {
  weekStartedAt?: number;
  weeklyDays?: string[];
  flashcards?: number;
  quizzes?: number;
  summaries?: number;
  posts?: number;
  [key: string]: any;
}

interface UserDataContextValue {
  user: User | null;
  uid: string | null;
  profile: UserProfile;
  counters: Counters;
  achievements: Achievements;
  weeklyCounters: WeeklyCounters;
  friends: Friend[];
  friendRequests: FriendRequest[];
  sentReactions: Record<string, SentReaction>;
  receivedReactions: Record<string, ReceivedReaction>;
  blockedUsers: string[];
  loading: boolean;
  // Computed helpers
  username: string;
  photoURL: string;
  xp: number;
  level: number;
  plan: string;
  weeklyDays: number;
  // RBAC helpers
  role: 'user' | 'moderator' | 'admin' | 'superadmin';
  isModerator: boolean;
  isAdmin: boolean;
  isSuperadmin: boolean;
  isBanned: boolean;
  canPost: boolean;
  canComment: boolean;
  // Notification/badge counts (centralized to avoid duplicate listeners)
  unreadNotificationCount: number;
  pendingFriendRequestCount: number;
  // Methods to refresh data
  refreshWeeklyCounters: () => Promise<void>;
  // Lazily start the friends listener - call when the Friends panel/tab is opened
  requestFriends: () => void;
}

const UserDataContext = createContext<UserDataContextValue | null>(null);

export function UserDataProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile>({});
  const [counters, setCounters] = useState<Counters>({});
  const [weeklyCounters, setWeeklyCounters] = useState<WeeklyCounters>({});
  const [achievements, setAchievements] = useState<Achievements>({});
  const [friends, setFriends] = useState<Friend[]>([]);
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);
  const [sentReactions, setSentReactions] = useState<Record<string, SentReaction>>({});
  const [receivedReactions, setReceivedReactions] = useState<Record<string, ReceivedReaction>>({});
  const [blockedUsers, setBlockedUsers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  // Gate the friends listener - only attaches when a friends UI is opened
  const [friendsRequested, setFriendsRequested] = useState(false);
  const requestFriends = () => setFriendsRequested(true);

  // OPTIMIZED: Initialize from cache only - let listeners handle fresh data
  // This avoids duplicate reads (init + listener both fetching)
  useEffect(() => {
    const currentUser = auth.currentUser;
    
    if (currentUser) {
      setUser(currentUser);
      setUid(currentUser.uid);
      
      // Load from cache for instant display - listeners will update with fresh data
      try {
        const cachedProfile = localStorage.getItem(`profile_${currentUser.uid}`);
        const cachedCounters = localStorage.getItem(`counters_${currentUser.uid}`);
        if (cachedProfile) setProfile(JSON.parse(cachedProfile));
        if (cachedCounters) setCounters(JSON.parse(cachedCounters));
      } catch {}
      
      setLoading(false);
    }
    // IMPORTANT: when auth.currentUser is null here, the session may still be
    // restoring from IndexedDB. Keep loading=true and let onAuthStateChanged
    // (which fires only after restoration completes) resolve the state.
    // Setting loading=false too early caused users to be redirected to /auth
    // on every refresh even though they were still signed in.
  }, []);

  // Auth listener - simplified and fast
  useEffect(() => {
    const unsubAuth = auth.onAuthStateChanged((u) => {
      setUser(u);
      const newUid = u?.uid || null;
      
      // On logout, clear all cached data immediately
      if (!u) {
        setUid(null);
        setProfile({});
        setCounters({});
        setAchievements({});
        setFriends([]);
        setFriendRequests([]);
        setSentReactions({});
        setBlockedUsers([]);
        setLoading(false);
        
        // Clear all localStorage caches
        try {
          const keys = Object.keys(localStorage);
          keys.forEach(key => {
            if (key.startsWith('profile_') || key.startsWith('counters_')) {
              localStorage.removeItem(key);
            }
          });
        } catch {}
      } else {
        // OPTIMIZED: User signed in - just set uid and load from cache
        // Listeners will handle fresh data fetching (avoids duplicate reads)
        setUid(newUid);
        
        // Load from cache for instant display
        try {
          const cachedProfile = localStorage.getItem(`profile_${newUid}`);
          const cachedCounters = localStorage.getItem(`counters_${newUid}`);
          if (cachedProfile) setProfile(JSON.parse(cachedProfile));
          if (cachedCounters) setCounters(JSON.parse(cachedCounters));
        } catch {}
        
        setLoading(false);
      }
    });
    
    return () => unsubAuth();
  }, []);

  // Main user profile listener (1 listener for entire app)
  useEffect(() => {
    if (!uid) {
      setProfile({});
      return;
    }

    const currentUid = uid;

    // Try to load from cache first for instant display
    try {
      const cached = localStorage.getItem(`profile_${uid}`);
      if (cached) setProfile(JSON.parse(cached));
    } catch {}

    // Subscribe to Firestore for real-time updates
    const userRef = doc(db, 'users', uid);
    let photoSynced = false; // Prevent multiple photo syncs
    
    const unsub = onSnapshot(
      userRef,
      async (snap) => {
        if (currentUid !== uid) return; // Prevent stale updates
        
        if (snap.exists()) {
          const data = snap.data() as UserProfile;
          setProfile(data);
          // Cache for next time
          try {
            localStorage.setItem(`profile_${uid}`, JSON.stringify(data));
          } catch {}
          
          // OPTIMIZED: Sync photo_url from Firebase Auth once per session
          if (!photoSynced && user?.photoURL) {
            const firestorePhoto = data.photo_url || data.photoURL;
            if (user.photoURL !== firestorePhoto) {
              photoSynced = true;
              try {
                await setDoc(userRef, { photo_url: user.photoURL }, { merge: true });
              } catch {}
            }
          }
        } else {
          setProfile({});
        }
      },
      (error) => {
        console.error('Profile listener error:', error);
      }
    );

    return () => unsub();
  }, [uid]);

  // Counters listener (1 listener for entire app)
  useEffect(() => {
    if (!uid) {
      setCounters({});
      return;
    }

    const currentUid = uid;

    // Try to load from cache first
    try {
      const cached = localStorage.getItem(`counters_${uid}`);
      if (cached) setCounters(JSON.parse(cached));
    } catch {}

    // Subscribe to Firestore for real-time updates
    const countersRef = doc(db, 'users', uid, 'meta', 'counters');
    const unsub = onSnapshot(
      countersRef,
      (snap) => {
        if (currentUid !== uid) return;
        
        const data = snap.exists() ? (snap.data() as Counters) : {};
        setCounters(data);
        // Cache for next time
        try {
          localStorage.setItem(`counters_${uid}`, JSON.stringify(data));
        } catch {}
      },
      (error) => {
        console.error('Counters listener error:', error);
      }
    );

    return () => unsub();
  }, [uid]);

  // Achievements - ONE-TIME READ (not real-time, load on demand)
  useEffect(() => {
    if (!uid) {
      setAchievements({});
      return;
    }

    // Single read, no listener - achievements don't change frequently
    const achievementsRef = doc(db, 'users', uid, 'meta', 'achievements');
    getDoc(achievementsRef)
      .then((snap) => {
        setAchievements(snap.exists() ? (snap.data() as Achievements) : {});
      })
      .catch((error) => {
        console.error('Achievements load error:', error);
        setAchievements({});
      });
  }, [uid]);

  // Weekly counters - ONE-TIME READ with refresh method
  const refreshWeeklyCounters = async () => {
    if (!uid) return;
    try {
      const weeklyRef = doc(db, 'users', uid, 'meta', 'weeklyCounters');
      const snap = await getDoc(weeklyRef);
      if (snap.exists()) {
        const data = snap.data() as WeeklyCounters;
        // Lazy week-rollover reset: if the stored week is stale, zero the numeric
        // counters and persist the new week so stats/goals show a fresh week.
        const mondayTs = getMondayTimestamp();
        if (Number(data.weekStartedAt || 0) !== mondayTs) {
          const reset: Record<string, any> = { weekStartedAt: mondayTs, weeklyDays: [] };
          for (const [k, v] of Object.entries(data)) {
            if (k !== 'weekStartedAt' && typeof v === 'number') reset[k] = 0;
          }
          setDoc(weeklyRef, reset, { merge: true }).catch(() => {});
          setWeeklyCounters(reset as WeeklyCounters);
          return;
        }
        setWeeklyCounters(data);
      } else {
        setWeeklyCounters({});
      }
    } catch (error) {
      console.error('Weekly counters load error:', error);
    }
  };

  useEffect(() => {
    if (!uid) {
      setWeeklyCounters({});
      return;
    }
    refreshWeeklyCounters();
  }, [uid]);

  // Friends listener - LAZY: only attaches when a friends UI calls requestFriends()
  // (saves up to ~100 reads per session for users who never open Friends)
  useEffect(() => {
    if (!uid || !friendsRequested) {
      setFriends([]);
      return;
    }

    let unsub: Unsubscribe | null = null;

    const timer = setTimeout(() => {
      const friendsRef = collection(db, 'users', uid, 'friends');
      const friendsQuery = query(friendsRef, limit(50));
      unsub = onSnapshot(
        friendsQuery,
        (snap) => {
          const friendsList: Friend[] = [];
          snap.forEach((d) => {
            const data = d.data();
            friendsList.push({
              friend_uid: d.id,
              ...data,
              isFavorite: data.favorite || false, // Map Firestore 'favorite' to interface 'isFavorite'
            } as Friend);
          });
          setFriends(friendsList);
        },
        (error) => {
          console.error('Friends listener error:', error);
        }
      );
    }, 500);

    return () => {
      clearTimeout(timer);
      if (unsub) unsub();
    };
  }, [uid, friendsRequested]);

  // Friend requests listener - DEFERRED for faster sign-in
  useEffect(() => {
    if (!uid) {
      setFriendRequests([]);
      return;
    }

    let unsub: Unsubscribe | null = null;

    // Delay 500ms to prioritize critical data
    const timer = setTimeout(() => {
      const requestsRef = collection(db, 'users', uid, 'friend_requests');
      // Pending requests are transient - 50 is more than enough
      const requestsQuery = query(requestsRef, where('status', '==', 'pending'), limit(25));
      unsub = onSnapshot(
        requestsQuery,
        (snap) => {
          const requests: FriendRequest[] = [];
          snap.forEach((d) => {
            const data = d.data();
            requests.push({
              id: d.id,
              ...data,
            } as FriendRequest);
          });
          setFriendRequests(requests);
        },
        (error) => {
          console.error('Friend requests listener error:', error);
        }
      );
    }, 500);

    return () => {
      clearTimeout(timer);
      if (unsub) unsub();
    };
  }, [uid]);

  // Sent reactions - ONE-TIME READ (not real-time, reduces listener costs)
  // OPTIMIZED: Changed from listener to single read - reactions don't need real-time updates
  useEffect(() => {
    if (!uid) {
      setSentReactions({});
      return;
    }

    // Delay 800ms to prioritize more critical data
    const timer = setTimeout(async () => {
      try {
        const reactionsRef = collection(db, 'users', uid, 'sent_reactions');
        const reactionsQuery = query(reactionsRef, limit(100));
        const snap = await getDocs(reactionsQuery);
        const now = Date.now();
        const dayMs = 24 * 60 * 60 * 1000;
        const reactions: Record<string, SentReaction> = {};
        
        snap.forEach((d) => {
          const data = d.data();
          const ts = data.created_at?.toMillis?.() || now;
          if (data.emoji && now - ts <= dayMs) {
            reactions[d.id] = {
              friendUid: d.id,
              emoji: String(data.emoji),
              ts,
            };
          }
        });
        
        setSentReactions(reactions);
      } catch (error) {
        console.error('Reactions load error:', error);
      }
    }, 800);

    return () => clearTimeout(timer);
  }, [uid]);

  // Blocked users - ONE-TIME READ (not real-time, reduces listener costs)
  // OPTIMIZED: Changed from listener to single read - blocks don't change frequently
  useEffect(() => {
    if (!uid) {
      setBlockedUsers([]);
      return;
    }

    // Delay 800ms to prioritize more critical data
    const timer = setTimeout(async () => {
      try {
        const blocksRef = collection(db, 'users', uid, 'blocks');
        const blocksQuery = query(blocksRef, limit(300));
        const snap = await getDocs(blocksQuery);
        const blocked: string[] = [];
        snap.forEach((d) => {
          blocked.push(d.id);
        });
        setBlockedUsers(blocked);
      } catch (error) {
        console.error('Blocks load error:', error);
      }
    }, 800);

    return () => clearTimeout(timer);
  }, [uid]);

  // COMBINED: Unread notification count + Received reactions listener - DEFERRED for faster sign-in
  // OPTIMIZED: Single listener instead of two separate ones (reduces Firestore reads by 50%)
  useEffect(() => {
    if (!uid) {
      setUnreadNotificationCount(0);
      setReceivedReactions({});
      return;
    }

    let unsub: Unsubscribe | null = null;

    // Delay 1000ms to prioritize more critical data
    const timer = setTimeout(() => {
      const notifRef = collection(db, 'users', uid, 'notifications');
      // OPTIMIZED: Limit to 20 most recent notifications to reduce read costs
      const notifQuery = query(notifRef, orderBy('createdAt', 'desc'), limit(20));
      unsub = onSnapshot(
        notifQuery,
        (snap) => {
          // Count unread notifications
          let unreadCount = 0;
          
          // Extract received reactions
          const now = Date.now();
          const dayMs = 24 * 60 * 60 * 1000;
          const latest: Record<string, ReceivedReaction> = {};
          
          snap.forEach((docSnap) => {
            const d = docSnap.data() as any;
            
            // Count unread
            if (d?.read === false) {
              unreadCount++;
            }
            
            // Extract reactions
            if (d?.type === 'reaction' && d?.from && d?.emoji) {
              const ts = (d.created_at && typeof d.created_at.toMillis === 'function') ? d.created_at.toMillis() : now;
              if (now - ts <= dayMs) {
                const from = String(d.from);
                if (!latest[from] || ts > latest[from].ts) {
                  latest[from] = { fromUid: from, emoji: String(d.emoji), ts };
                }
              }
            }
          });
          
          setUnreadNotificationCount(unreadCount);
          setReceivedReactions(latest);
        },
        (error) => {
          console.error('Notifications listener error:', error);
        }
      );
    }, 1000);

    return () => {
      clearTimeout(timer);
      if (unsub) unsub();
    };
  }, [uid]);

  // Computed helpers
  const username = String(profile.username || '').toLowerCase();
  const photoURL = profile.photo_url || profile.photoURL || user?.photoURL || '';
  const xp = Number(counters.xp || 0);
  const level = Math.floor(xp / 100); // Adjust based on your level calculation
  const plan = String(profile.plan || 'free');
  const weeklyDays = Array.isArray(weeklyCounters.weeklyDays) ? weeklyCounters.weeklyDays.length : 0;

  // RBAC helpers
  const role = (profile.role || 'user') as 'user' | 'moderator' | 'admin' | 'superadmin';
  const isModerator = ['moderator', 'admin', 'superadmin'].includes(role);
  const isAdmin = ['admin', 'superadmin'].includes(role);
  const isSuperadmin = role === 'superadmin';
  const banned = profile.banned || {};
  const isBanned = !!(banned.full);
  const canPost = !banned.cannot_post && !banned.full;
  const canComment = !banned.cannot_comment && !banned.full;

  // Compute pending friend request count from friendRequests
  const pendingFriendRequestCount = friendRequests.filter(r => r.status === 'pending' && r.to === uid).length;

  const value: UserDataContextValue = {
    user,
    uid,
    profile,
    counters,
    achievements,
    weeklyCounters,
    friends,
    friendRequests,
    sentReactions,
    receivedReactions,
    blockedUsers,
    loading,
    username,
    photoURL,
    xp,
    level,
    plan,
    weeklyDays,
    // RBAC
    role,
    isModerator,
    isAdmin,
    isSuperadmin,
    isBanned,
    canPost,
    canComment,
    // Notifications
    unreadNotificationCount,
    pendingFriendRequestCount,
    requestFriends,
    refreshWeeklyCounters,
  };

  return (
    <UserDataContext.Provider value={value}>
      {children}
    </UserDataContext.Provider>
  );
}

export function useUserData() {
  const context = useContext(UserDataContext);
  if (!context) {
    throw new Error('useUserData must be used within UserDataProvider');
  }
  return context;
}
