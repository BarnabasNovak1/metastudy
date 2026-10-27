import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { auth, functions as fbFunctions } from "../../firebase";
import { httpsCallable } from "firebase/functions";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { 
  Shield, ShieldAlert, ShieldCheck, Users, UserPlus, UserMinus, UserX,
  Ban, MessageSquareOff, FileX, History, Lock, Loader2, 
  Send, X, Check, Eye, RefreshCw, KeyRound, Power, BarChart3, Sun, Moon, Bug, Search, RotateCcw, Trash2, Download
} from "lucide-react";

type UserRole = 'user' | 'moderator' | 'admin' | 'superadmin';

interface RoleInvite {
  id: string;
  email: string;
  role: string;
  invitedBy: string;
  status: string;
  createdAt: string;
  expiresAt: string;
}

interface DemoAccessStatus {
  enabled: boolean;
  username: string;
  email: string;
  demoUid?: string;
  updatedAt?: string | null;
  updatedBy?: string;
}

interface PerformanceUser {
  uid: string;
  username: string;
  email: string;
  role: string;
  plan: string;
  uses_this_month: number;
  monthly_quota: number;
  usage_period_end?: string | null;
  created_at?: string | null;
  isDemoUser?: boolean;
}

interface RoleUser {
  uid: string;
  username: string;
  email: string;
  role: string;
  roleUpdatedAt: string | null;
  photo_url: string | null;
}

interface ModerationLog {
  id: string;
  type: string;
  actorUid: string;
  actorRole?: string;
  targetUid?: string;
  timestamp: string;
  [key: string]: any;
}

interface SupportReport {
  id: string;
  type: string;
  category: 'systemic' | 'user_related' | 'general';
  message: string;
  reportedUser?: string | null;
  reporterUid?: string;
  reporterUsername?: string | null;
  reporterEmail?: string | null;
  createdAt?: string | null;
  assignedTo?: string | null;
  assignedBy?: string | null;
  assignedAt?: string | null;
}

interface SupportReportSummary {
  totalOpen: number;
  systemicOpen: number;
  userRelatedOpen: number;
  generalOpen: number;
  updatedAt?: string | null;
}


const ROLE_LEVELS: Record<UserRole, number> = {
  user: 0,
  moderator: 1,
  admin: 2,
  superadmin: 3,
};

const getRoleBadgeColor = (role: string) => {
  switch (role) {
    case 'superadmin': return 'bg-red-500/10 text-red-500 border-red-500/20';
    case 'admin': return 'bg-purple-500/10 text-purple-500 border-purple-500/20';
    case 'moderator': return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
    default: return 'bg-gray-500/10 text-gray-500 border-gray-500/20';
  }
};

const PROMO_STATS_EMAILS = new Set([
  'admin@metastudy.com',
  'admin@metastudy.com',
]);

const getReportCategoryBadgeColor = (category: SupportReport['category']) => {
  switch (category) {
    case 'systemic':
      return 'bg-amber-500/10 text-amber-600 border-amber-500/20';
    case 'user_related':
      return 'bg-blue-500/10 text-blue-600 border-blue-500/20';
    default:
      return 'bg-gray-500/10 text-gray-500 border-gray-500/20';
  }
};

const getDefaultTabForLevel = (level: number) => {
  if (level >= ROLE_LEVELS.admin) return 'invites';
  return 'reports';
};

const ADMIN_QUERY_KEYS = {
  invites: ['admin', 'invites'] as const,
  roleUsers: ['admin', 'role-users'] as const,
  reports: ['admin', 'reports'] as const,
  reportSummary: ['admin', 'report-summary'] as const,
  logs: ['admin', 'logs'] as const,
  performance: ['admin', 'performance'] as const,
  demoStatus: ['admin', 'demo-status'] as const,
};

const AdminDashboard = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // Auth state
  const [authorized, setAuthorized] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [password, setPassword] = useState("");
  const [userRole, setUserRole] = useState<UserRole>('user');
  const [userLevel, setUserLevel] = useState(0);
  const [authReady, setAuthReady] = useState(false);
  const [isSignedIn, setIsSignedIn] = useState(false);
  
  // Data state
  const [invites, setInvites] = useState<RoleInvite[]>([]);
  const [roleUsers, setRoleUsers] = useState<RoleUser[]>([]);
  const [logs, setLogs] = useState<ModerationLog[]>([]);
  const [logsLoaded, setLogsLoaded] = useState(false);
  const [logsCursor, setLogsCursor] = useState<string | null>(null);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [loadingMoreLogs, setLoadingMoreLogs] = useState(false);
  const [reports, setReports] = useState<SupportReport[]>([]);
  const [reportSummary, setReportSummary] = useState<SupportReportSummary | null>(null);
  const [demoStatus, setDemoStatus] = useState<DemoAccessStatus | null>(null);
  const [performanceUsers, setPerformanceUsers] = useState<PerformanceUser[]>([]);
  const [performanceSummary, setPerformanceSummary] = useState<{ totalUsers: number; totalUsesThisMonth: number; planBreakdown: Record<string, number> } | null>(null);
  const [loadingInvites, setLoadingInvites] = useState(false);
  const [invitesLoaded, setInvitesLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("invites");
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [performanceLoaded, setPerformanceLoaded] = useState(false);
  const [loadingPerformance, setLoadingPerformance] = useState(false);
  const [demoLoaded, setDemoLoaded] = useState(false);
  const [loadingDemo, setLoadingDemo] = useState(false);
  const [reportsLoaded, setReportsLoaded] = useState(false);
  const [loadingReports, setLoadingReports] = useState(false);
  const [loadingMoreReports, setLoadingMoreReports] = useState(false);
  const [reportsCursor, setReportsCursor] = useState<string | null>(null);
  const [assigningReportId, setAssigningReportId] = useState<string | null>(null);
  
  // Invite form
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("moderator");
  const [sendingInvite, setSendingInvite] = useState(false);
  
  // Maintenance (backfills)
  const [backfillRunning, setBackfillRunning] = useState<string | null>(null);
  const [backfillResults, setBackfillResults] = useState<Record<string, string>>({});
  
  const runBackfill = async (fnName: string) => {
    setBackfillRunning(fnName);
    try {
      const fn = httpsCallable(fbFunctions, fnName);
      const resp = await fn({}) as any;
      const summary = JSON.stringify(resp?.data || {});
      setBackfillResults(prev => ({ ...prev, [fnName]: `Done: ${summary}` }));
      toast({ title: 'Backfill complete', description: `${fnName}: ${summary}` });
    } catch (e: any) {
      const msg = e?.message || 'Failed';
      setBackfillResults(prev => ({ ...prev, [fnName]: `Error: ${msg}` }));
      toast({ title: 'Backfill failed', description: msg, variant: 'destructive' });
    } finally {
      setBackfillRunning(null);
    }
  };

  // Reconcile orphaned user docs (users/{uid} with no matching Auth account)
  const [reconcileState, setReconcileState] = useState<{ running: boolean; result: any | null; confirming: boolean }>({ running: false, result: null, confirming: false });

  const runReconcile = async (dryRun: boolean) => {
    setReconcileState(s => ({ ...s, running: true }));
    try {
      const fn = httpsCallable(fbFunctions, 'reconcileDeletedUsers');
      const resp = await fn({ dryRun }) as any;
      const r = resp?.data || {};
      if (dryRun) {
        setReconcileState({ running: false, result: r, confirming: (r.orphanedCount || 0) > 0 });
      } else {
        setReconcileState({ running: false, result: r, confirming: false });
        toast({ title: 'Reconcile complete', description: `Deleted ${r.deleted ?? 0} orphaned user docs` });
      }
    } catch (e: any) {
      setReconcileState(s => ({ ...s, running: false, confirming: false }));
      toast({ title: 'Reconcile failed', description: e?.message || 'Failed', variant: 'destructive' });
    }
  };
  
  // Ban dialog
  const [banDialogOpen, setBanDialogOpen] = useState(false);
  const [banTarget, setBanTarget] = useState<{ uid: string; username: string } | null>(null);
  const [banType, setBanType] = useState<string>("cannot_post");
  const [banReason, setBanReason] = useState("");
  const [banning, setBanning] = useState(false);
  
  // Remove role dialog
  const [removeRoleOpen, setRemoveRoleOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<RoleUser | null>(null);
  const [removing, setRemoving] = useState(false);

  // Demo access controls (superadmin only)
  const [demoDialogOpen, setDemoDialogOpen] = useState(false);
  
  // User search and reset
  const [userSearchQuery, setUserSearchQuery] = useState("");
  const [searchingUsers, setSearchingUsers] = useState(false);
  const [searchResults, setSearchResults] = useState<PerformanceUser[]>([]);
  const [resettingCounterUid, setResettingCounterUid] = useState<string | null>(null);
  const [demoAction, setDemoAction] = useState<'activate' | 'change_password'>('activate');
  const [demoUsernameInput, setDemoUsernameInput] = useState("");
  const [demoPassword, setDemoPassword] = useState("");
  const [updatingDemo, setUpdatingDemo] = useState(false);
  const [isDark, setIsDark] = useState<boolean>(false);
  

  // Signup/promo code stats (owner-superadmin only)
  const [codeStats, setCodeStats] = useState<{ totalRedemptions: number; uniqueCodes: number; subscriptionsScanned: number; codes: Array<{ code: string; redemptionCount: number; tierBreakdown?: Record<string, number>; firstRedemption?: number | null; lastRedemption?: number | null; users: Array<{ uid?: string; email?: string; username?: string; plan?: string; customerId?: string; tier?: string; redeemedAt?: number | null; firstName?: string; lastName?: string; status?: string; subStart?: number | null; renewal?: number | null; months?: number | null }> }> } | null>(null);
  const [codeStatsLoaded, setCodeStatsLoaded] = useState(false);
  const [loadingCodeStats, setLoadingCodeStats] = useState(false);
  const [promoSearch, setPromoSearch] = useState('');

  // Check if user is logged in
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (!user) {
        setIsSignedIn(false);
        setAuthReady(true);
        try { sessionStorage.removeItem('admin_gate_v1'); } catch {}
        navigate('/auth?redirect=/internal-ops-7f3k9x-admin', { replace: true });
        return;
      }
      setIsSignedIn(true);
      setAuthReady(true);
      // Restore admin gate for this browser session (avoids re-entering the
      // admin password on every refresh). All admin actions are still verified
      // server-side via role claims on each Cloud Function call.
      try {
        const raw = sessionStorage.getItem('admin_gate_v1');
        if (raw) {
          const gate = JSON.parse(raw);
          const fresh = gate && gate.uid === user.uid && (Date.now() - Number(gate.ts || 0)) < 12 * 60 * 60 * 1000;
          if (fresh && gate.role && gate.level) {
            setAuthorized(true);
            setUserRole(gate.role as UserRole);
            setUserLevel(Number(gate.level));
            setActiveTab(getDefaultTabForLevel(Number(gate.level)));
          } else {
            sessionStorage.removeItem('admin_gate_v1');
          }
        }
      } catch {}
    });
    return () => unsubscribe();
  }, [navigate]);

  useEffect(() => {
    const checkDark = () => document.documentElement.classList.contains('dark');
    setIsDark(checkDark());
    const observer = new MutationObserver(() => setIsDark(checkDark()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const toggleTheme = () => {
    const next = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('theme', next ? 'dark' : 'light');
    setIsDark(next);
  };

  const loadInvites = async (force = false) => {
    if (!authorized || userLevel < ROLE_LEVELS.admin) return;
    if (!force && invitesLoaded) return;

    setLoadingInvites(true);
    try {
      if (force) {
        await queryClient.invalidateQueries({ queryKey: ADMIN_QUERY_KEYS.invites });
      }
      const inviteData = await queryClient.fetchQuery({
        queryKey: ADMIN_QUERY_KEYS.invites,
        staleTime: 30000,
        queryFn: async () => {
          const getInvites = httpsCallable(fbFunctions, 'getPendingInvites');
          const invitesResult = await getInvites() as any;
          return Array.isArray(invitesResult.data?.invites) ? invitesResult.data.invites : [];
        },
      });
      setInvites(inviteData as RoleInvite[]);
      setInvitesLoaded(true);
    } catch (e: any) {
      toast({ title: 'Failed to load invites', description: e?.message, variant: 'destructive' });
    } finally {
      setLoadingInvites(false);
    }
  };

  const loadPerformanceOverview = async (force = false) => {
    if (!authorized || userLevel < ROLE_LEVELS.moderator) return;
    if (!force && performanceLoaded) return;

    setLoadingPerformance(true);
    try {
      if (force) {
        await queryClient.invalidateQueries({ queryKey: ADMIN_QUERY_KEYS.performance });
      }
      const performanceResult = await queryClient.fetchQuery({
        queryKey: ADMIN_QUERY_KEYS.performance,
        staleTime: 60000,
        queryFn: async () => {
          const getPerformance = httpsCallable(fbFunctions, 'getAdminPerformanceOverview');
          return await getPerformance({ limitCount: 500 }) as any;
        },
      });

      setPerformanceUsers(Array.isArray(performanceResult?.data?.users) ? performanceResult.data.users : []);
      setPerformanceSummary(performanceResult?.data?.summary || null);
      setPerformanceLoaded(true);
    } catch (e: any) {
      toast({ title: 'Failed to load performance', description: e?.message, variant: 'destructive' });
      setPerformanceUsers([]);
      setPerformanceSummary(null);
    } finally {
      setLoadingPerformance(false);
    }
  };

  const loadDemoStatus = async (force = false) => {
    if (!authorized || userLevel < ROLE_LEVELS.admin) return;
    if (!force && demoLoaded) return;

    setLoadingDemo(true);
    try {
      if (force) {
        await queryClient.invalidateQueries({ queryKey: ADMIN_QUERY_KEYS.demoStatus });
      }
      const demoResult = await queryClient.fetchQuery({
        queryKey: ADMIN_QUERY_KEYS.demoStatus,
        staleTime: 60000,
        queryFn: async () => {
          const getDemo = httpsCallable(fbFunctions, 'getDemoAccessStatus');
          return await getDemo() as any;
        },
      });
      setDemoStatus(demoResult?.data || null);
      setDemoLoaded(true);
    } catch (e: any) {
      toast({ title: 'Failed to load demo status', description: e?.message, variant: 'destructive' });
    } finally {
      setLoadingDemo(false);
    }
  };

  const handleSearchUsers = async () => {
    if (!authorized || userLevel < ROLE_LEVELS.admin) return;
    if (!userSearchQuery.trim() || userSearchQuery.trim().length < 2) {
      toast({ title: 'Search query too short', description: 'Enter at least 2 characters', variant: 'destructive' });
      return;
    }

    setSearchingUsers(true);
    try {
      const searchUsers = httpsCallable(fbFunctions, 'adminSearchUsers');
      const result = await searchUsers({ query: userSearchQuery.trim(), limitCount: 50 }) as any;
      setSearchResults(Array.isArray(result.data?.users) ? result.data.users : []);
    } catch (e: any) {
      toast({ title: 'Search failed', description: e?.message, variant: 'destructive' });
      setSearchResults([]);
    } finally {
      setSearchingUsers(false);
    }
  };

  const handleResetUserCounters = async (targetUid: string, username: string) => {
    if (!authorized || userLevel < ROLE_LEVELS.admin) return;
    setResettingCounterUid(targetUid);
    try {
      const resetCounters = httpsCallable(fbFunctions, 'adminResetUserCounters');
      await resetCounters({ targetUid });
      toast({ title: 'Counters Reset', description: `Credits reset to 0 for @${username}` });
      // Update local state
      setPerformanceUsers(prev => prev.map(u => u.uid === targetUid ? { ...u, uses_this_month: 0 } : u));
      setSearchResults(prev => prev.map(u => u.uid === targetUid ? { ...u, uses_this_month: 0 } : u));
    } catch (e: any) {
      toast({ title: 'Reset failed', description: e?.message, variant: 'destructive' });
    } finally {
      setResettingCounterUid(null);
    }
  };

  const handleVerifyAccess = async () => {
    if (!auth.currentUser) {
      navigate('/auth?redirect=/internal-ops-7f3k9x-admin', { replace: true });
      return;
    }

    if (!password.trim()) {
      toast({ title: "Password required", variant: "destructive" });
      return;
    }
    
    setVerifying(true);
    try {
      const verifyAccess = httpsCallable(fbFunctions, 'verifyAdminAccess');
      const result = await verifyAccess({ adminPassword: password.trim() }) as any;
      
      if (result.data?.authorized) {
        const nextLevel = Number(result.data.level || 0);
        setAuthorized(true);
        setUserRole(result.data.role as UserRole);
        setUserLevel(nextLevel);
        // Persist gate for this browser session so refreshes don't require re-verification
        try {
          sessionStorage.setItem('admin_gate_v1', JSON.stringify({
            uid: auth.currentUser?.uid || '',
            role: result.data.role,
            level: nextLevel,
            ts: Date.now(),
          }));
        } catch {}
        setActiveTab(getDefaultTabForLevel(nextLevel));
        setInvitesLoaded(false);
        setInvites([]);
        setUsersLoaded(false);
        setRoleUsers([]);
        setPerformanceLoaded(false);
        setPerformanceUsers([]);
        setPerformanceSummary(null);
        setDemoLoaded(false);
        setDemoStatus(null);
        setReportsLoaded(false);
        setReports([]);
        setReportSummary(null);
        setLogsLoaded(false);
        setLogs([]);
        toast({ title: "Access granted", description: `Welcome, ${result.data.role}` });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ADMIN_QUERY_KEYS.invites }),
          queryClient.invalidateQueries({ queryKey: ADMIN_QUERY_KEYS.roleUsers }),
          queryClient.invalidateQueries({ queryKey: ADMIN_QUERY_KEYS.reports }),
          queryClient.invalidateQueries({ queryKey: ADMIN_QUERY_KEYS.reportSummary }),
          queryClient.invalidateQueries({ queryKey: ADMIN_QUERY_KEYS.logs }),
          queryClient.invalidateQueries({ queryKey: ADMIN_QUERY_KEYS.performance }),
          queryClient.invalidateQueries({ queryKey: ADMIN_QUERY_KEYS.demoStatus }),
        ]);
      } else {
        const reason = result.data?.reason;
        if (reason === 'insufficient_role') {
          toast({ title: "Access denied", description: "You don't have a moderator or higher role", variant: "destructive" });
        } else {
          toast({ title: "Invalid password", variant: "destructive" });
        }
      }
    } catch (e: any) {
      toast({ title: "Verification failed", description: e?.message, variant: "destructive" });
    } finally {
      setVerifying(false);
    }
  };

  const loadRoleUsers = async (force = false) => {
    if (!authorized) return;
    if (!force && usersLoaded) return;

    setLoadingUsers(true);
    try {
      if (force) {
        await queryClient.invalidateQueries({ queryKey: ADMIN_QUERY_KEYS.roleUsers });
      }
      const users = await queryClient.fetchQuery({
        queryKey: ADMIN_QUERY_KEYS.roleUsers,
        staleTime: 120000,
        queryFn: async () => {
          const getUsers = httpsCallable(fbFunctions, 'getUsersWithRoles');
          const usersResult = await getUsers() as any;
          return Array.isArray(usersResult.data?.users) ? usersResult.data.users : [];
        },
      });
      setRoleUsers(users as RoleUser[]);
      setUsersLoaded(true);
    } catch (e: any) {
      toast({ title: 'Failed to load users', description: e?.message, variant: 'destructive' });
    } finally {
      setLoadingUsers(false);
    }
  };

  const loadSupportReportSummary = async (force = false) => {
    try {
      if (force) {
        await queryClient.invalidateQueries({ queryKey: ADMIN_QUERY_KEYS.reportSummary });
      }
      const data = await queryClient.fetchQuery({
        queryKey: ADMIN_QUERY_KEYS.reportSummary,
        staleTime: 30000,
        queryFn: async () => {
          const getSummary = httpsCallable(fbFunctions, 'getSupportReportSummary');
          const summaryResult = await getSummary() as any;
          return summaryResult.data || {};
        },
      }) as any;
      setReportSummary({
        totalOpen: Number(data.totalOpen || 0),
        systemicOpen: Number(data.systemicOpen || 0),
        userRelatedOpen: Number(data.userRelatedOpen || 0),
        generalOpen: Number(data.generalOpen || 0),
        updatedAt: data.updatedAt || null,
      });
    } catch {
      setReportSummary(null);
    }
  };

  const loadReports = async (force = false, startAfter?: string | null) => {
    if (!authorized) return;
    if (!force && !startAfter && reportsLoaded) return;

    if (startAfter) {
      setLoadingMoreReports(true);
    } else {
      setLoadingReports(true);
    }

    try {
      if (startAfter) {
        const getOpenReports = httpsCallable(fbFunctions, 'getOpenReports');
        const reportsResult = await getOpenReports({ limitCount: 25, startAfter }) as any;
        const nextReports = Array.isArray(reportsResult.data?.reports) ? reportsResult.data.reports : [];
        const nextCursor = reportsResult.data?.nextCursor || null;
        setReports((prev) => [...prev, ...nextReports]);
        setReportsCursor(nextCursor);
      } else {
        if (force) {
          await queryClient.invalidateQueries({ queryKey: ADMIN_QUERY_KEYS.reports });
        }
        const reportsData = await queryClient.fetchQuery({
          queryKey: ADMIN_QUERY_KEYS.reports,
          staleTime: 30000,
          queryFn: async () => {
            const getOpenReports = httpsCallable(fbFunctions, 'getOpenReports');
            const reportsResult = await getOpenReports({ limitCount: 25 }) as any;
            return {
              reports: Array.isArray(reportsResult.data?.reports) ? reportsResult.data.reports : [],
              nextCursor: reportsResult.data?.nextCursor || null,
            };
          },
        }) as { reports: SupportReport[]; nextCursor: string | null };
        setReports(reportsData.reports);
        setReportsCursor(reportsData.nextCursor);
      }
      setReportsLoaded(true);
      if (!startAfter) {
        await loadSupportReportSummary(force);
      }
    } catch (e: any) {
      toast({ title: 'Failed to load reports', description: e?.message, variant: 'destructive' });
    } finally {
      if (startAfter) {
        setLoadingMoreReports(false);
      } else {
        setLoadingReports(false);
      }
    }
  };

  const loadLogs = async (force = false, startAfter?: string | null) => {
    if (!authorized || userLevel < ROLE_LEVELS.moderator) return;
    if (!force && !startAfter && logsLoaded) return;

    if (startAfter) {
      setLoadingMoreLogs(true);
    } else {
      setLoadingLogs(true);
    }

    try {
      if (startAfter) {
        const getLogs = httpsCallable(fbFunctions, 'getModerationLogs');
        const logsResult = await getLogs({ limitCount: 25, startAfter }) as any;
        const nextLogs = Array.isArray(logsResult.data?.logs) ? logsResult.data.logs : [];
        const nextCursor = logsResult.data?.nextCursor || null;
        setLogs((prev) => [...prev, ...nextLogs]);
        setLogsCursor(nextCursor);
      } else {
        if (force) {
          await queryClient.invalidateQueries({ queryKey: ADMIN_QUERY_KEYS.logs });
        }
        const logsData = await queryClient.fetchQuery({
          queryKey: ADMIN_QUERY_KEYS.logs,
          staleTime: 30000,
          queryFn: async () => {
            const getLogs = httpsCallable(fbFunctions, 'getModerationLogs');
            const logsResult = await getLogs({ limitCount: 25 }) as any;
            return {
              logs: Array.isArray(logsResult.data?.logs) ? logsResult.data.logs : [],
              nextCursor: logsResult.data?.nextCursor || null,
            };
          },
        }) as { logs: ModerationLog[]; nextCursor: string | null };
        setLogs(logsData.logs);
        setLogsCursor(logsData.nextCursor);
      }
      setLogsLoaded(true);
    } catch (e: any) {
      toast({ title: 'Failed to load logs', description: e?.message, variant: 'destructive' });
    } finally {
      if (startAfter) {
        setLoadingMoreLogs(false);
      } else {
        setLoadingLogs(false);
      }
    }
  };

  const canResolveReport = (report: SupportReport) => {
    if (report.category === 'systemic') return userLevel >= ROLE_LEVELS.admin;
    return userLevel >= ROLE_LEVELS.moderator;
  };

  const canAssignReport = (report: SupportReport) => {
    if (!report.assignedTo) return true;
    if (report.assignedTo === auth.currentUser?.uid) return true;
    return userLevel >= ROLE_LEVELS.admin;
  };

  const handleAssignReport = async (report: SupportReport) => {
    setAssigningReportId(report.id);
    try {
      const assignReportToMe = httpsCallable(fbFunctions, 'assignReportToMe');
      const action = report.assignedTo === auth.currentUser?.uid ? 'unassign' : 'assign';
      await assignReportToMe({ reportId: report.id, action });
      await queryClient.invalidateQueries({ queryKey: ADMIN_QUERY_KEYS.logs });

      const currentUid = auth.currentUser?.uid || null;
      setReports((prev) => prev.map((item) => {
        if (item.id !== report.id) return item;
        if (action === 'assign') {
          return {
            ...item,
            assignedTo: currentUid,
            assignedBy: currentUid,
            assignedAt: new Date().toISOString(),
          };
        }
        return {
          ...item,
          assignedTo: null,
          assignedBy: null,
          assignedAt: null,
        };
      }));
    } catch (e: any) {
      toast({ title: 'Failed to update assignment', description: e?.message, variant: 'destructive' });
    } finally {
      setAssigningReportId(null);
    }
  };

  const handleResolveReport = async (report: SupportReport) => {
    try {
      const resolveReport = httpsCallable(fbFunctions, 'resolveReport');
      await resolveReport({ reportId: report.id });
      setReports((prev) => prev.filter((r) => r.id !== report.id));
      setReportSummary((prev) => {
        if (!prev) return prev;
        const next = {
          ...prev,
          totalOpen: Math.max(0, Number(prev.totalOpen || 0) - 1),
        };
        if (report.category === 'systemic') {
          next.systemicOpen = Math.max(0, Number(prev.systemicOpen || 0) - 1);
        } else if (report.category === 'user_related') {
          next.userRelatedOpen = Math.max(0, Number(prev.userRelatedOpen || 0) - 1);
        } else {
          next.generalOpen = Math.max(0, Number(prev.generalOpen || 0) - 1);
        }
        return next;
      });
      await queryClient.invalidateQueries({ queryKey: ADMIN_QUERY_KEYS.logs });
      toast({ title: 'Report resolved', description: 'The report has been removed from the open queue.' });
    } catch (e: any) {
      toast({ title: 'Failed to resolve report', description: e?.message, variant: 'destructive' });
    }
  };

  const loadCodeStats = async (force = false) => {
    if (!authorized || userLevel < ROLE_LEVELS.superadmin) return;
    if (!PROMO_STATS_EMAILS.has((auth.currentUser?.email || '').toLowerCase())) return;
    if (!force && codeStatsLoaded) return;

    setLoadingCodeStats(true);
    try {
      const getStats = httpsCallable(fbFunctions, 'getSignupCodeStats');
      const result = await getStats({}) as any;
      setCodeStats(result?.data || null);
      setCodeStatsLoaded(true);
    } catch (e: any) {
      toast({ title: 'Failed to load code stats', description: e?.message, variant: 'destructive' });
      setCodeStats(null);
    } finally {
      setLoadingCodeStats(false);
    }
  };

  // mode 'full' = owner report (names, full emails); 'ambassador' = privacy-safe
  // (first name only, masked email) for showing promoters their performance.
  const exportPromoCode = async (code: { code: string; users: NonNullable<typeof codeStats>['codes'][number]['users'] }, mode: 'full' | 'ambassador') => {
    const fmt = (ms?: number | null) => ms ? new Date(ms).toLocaleDateString() : '';
    const rows = mode === 'full'
      ? code.users.map(u => ({
          'First Name': u.firstName || '',
          'Last Name': u.lastName || '',
          'Username': u.username ? `@${u.username}` : '',
          'Email': u.email || '',
          'Tier': u.tier || u.plan || '',
          'Status': u.status || '',
          'Subscribed': fmt(u.subStart || u.redeemedAt),
          'Next Renewal': u.status === 'active' || u.status === 'canceling' || u.status === 'trialing' ? fmt(u.renewal) : '',
          'Months Subscribed': u.months ?? '',
        }))
      : code.users.map(u => ({
          'First Name': u.firstName || String(u.email || '').split('@')[0].slice(0, 3) || 'N/A',
          'Email': u.email ? `${u.email.slice(0, 3)}***` : '',
          'Tier': u.tier || u.plan || '',
          'Subscribed': fmt(u.subStart || u.redeemedAt),
          'Renewal': u.status === 'active' || u.status === 'canceling' || u.status === 'trialing' ? fmt(u.renewal) : '',
          'Status': u.status === 'active' || u.status === 'trialing' ? 'Active' : u.status === 'canceling' ? 'Canceling (active until renewal)' : 'Inactive',
          'Months Subscribed': u.months ?? '',
        }));
    try {
      const XLSX = await import('xlsx');
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Redemptions');
      XLSX.writeFile(wb, `promo-${code.code}-${mode}-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (e: any) {
      toast({ title: 'Export failed', description: e?.message, variant: 'destructive' });
    }
  };

  const handleSubmitDemoAction = async () => {
    const uname = demoUsernameInput.trim().toLowerCase();
    const usernameValid = /^[a-z0-9.]{3,20}$/.test(uname);
    if (!usernameValid) {
      toast({ title: 'Username required', description: 'Use 3-20 lowercase letters, numbers, or dot.', variant: 'destructive' });
      return;
    }

    const pwd = demoPassword.trim();
    const valid = /^(?=.*[A-Z]).{6,}$/.test(pwd);
    if (!valid) {
      toast({ title: 'Password invalid', description: 'Use at least 6 characters and include at least one uppercase letter.', variant: 'destructive' });
      return;
    }
    setUpdatingDemo(true);
    try {
      const setDemoAccess = httpsCallable(fbFunctions, 'setDemoAccess');
      await setDemoAccess({ action: demoAction, username: uname, password: demoPassword.trim() });
      toast({ title: demoAction === 'activate' ? 'Demo activated' : 'Demo password updated' });
      setDemoDialogOpen(false);
      setDemoUsernameInput("");
      setDemoPassword("");
      await loadDemoStatus(true);
    } catch (e: any) {
      toast({ title: 'Demo update failed', description: e?.message, variant: 'destructive' });
    } finally {
      setUpdatingDemo(false);
    }
  };

  const handleDeactivateDemo = async () => {
    setUpdatingDemo(true);
    try {
      const setDemoAccess = httpsCallable(fbFunctions, 'setDemoAccess');
      await setDemoAccess({ action: 'deactivate' });
      toast({ title: 'Demo deactivated', description: 'Demo login is disabled.' });
      await loadDemoStatus(true);
    } catch (e: any) {
      toast({ title: 'Demo update failed', description: e?.message, variant: 'destructive' });
    } finally {
      setUpdatingDemo(false);
    }
  };

  const handleSendInvite = async () => {
    if (!inviteEmail.trim()) {
      toast({ title: "Email required", variant: "destructive" });
      return;
    }
    
    setSendingInvite(true);
    try {
      const sendInvite = httpsCallable(fbFunctions, 'sendRoleInvite');
      await sendInvite({ targetEmail: inviteEmail, role: inviteRole });
      
      toast({ title: "Invite sent!", description: `Invite sent to ${inviteEmail}` });
      setInviteEmail("");
      await loadInvites(true);
    } catch (e: any) {
      toast({ title: "Failed to send invite", description: e?.message, variant: "destructive" });
    } finally {
      setSendingInvite(false);
    }
  };

  const handleCancelInvite = async (inviteId: string) => {
    try {
      const cancelInvite = httpsCallable(fbFunctions, 'cancelRoleInvite');
      await cancelInvite({ inviteId });
      toast({ title: "Invite cancelled" });
      await loadInvites(true);
    } catch (e: any) {
      toast({ title: "Failed to cancel", description: e?.message, variant: "destructive" });
    }
  };

  const handleRemoveRole = async () => {
    if (!removeTarget) return;
    
    setRemoving(true);
    try {
      const removeRole = httpsCallable(fbFunctions, 'removeUserRole');
      await removeRole({ targetUid: removeTarget.uid });
      
      toast({ title: "Role removed", description: `${removeTarget.username} is now a regular user` });
      setRemoveRoleOpen(false);
      setRemoveTarget(null);
      await queryClient.invalidateQueries({ queryKey: ADMIN_QUERY_KEYS.roleUsers });
      await queryClient.invalidateQueries({ queryKey: ADMIN_QUERY_KEYS.logs });
      await loadRoleUsers(true);
    } catch (e: any) {
      toast({ title: "Failed to remove role", description: e?.message, variant: "destructive" });
    } finally {
      setRemoving(false);
    }
  };

  const handleBanUser = async () => {
    if (!banTarget) return;
    
    setBanning(true);
    try {
      const ban = httpsCallable(fbFunctions, 'banUser');
      await ban({ targetUid: banTarget.uid, banType, reason: banReason });
      
      toast({ title: "User banned", description: `Applied ${banType} ban to ${banTarget.username}` });
      setBanDialogOpen(false);
      setBanTarget(null);
      setBanReason("");
      await queryClient.invalidateQueries({ queryKey: ADMIN_QUERY_KEYS.logs });
    } catch (e: any) {
      toast({ title: "Failed to ban", description: e?.message, variant: "destructive" });
    } finally {
      setBanning(false);
    }
  };

  // Password gate
  if (!authorized) {
    if (!authReady || !isSignedIn) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
          <p className="text-sm text-muted-foreground">Checking account session...</p>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-background p-4">
        <Dialog open={true} onOpenChange={() => {}}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Lock className="w-5 h-5" />
                Admin Access
              </DialogTitle>
              <DialogDescription>Enter the admin password to continue</DialogDescription>
            </DialogHeader>

            <div className="space-y-2">
              <Label htmlFor="admin-password">Password</Label>
              <Input
                id="admin-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleVerifyAccess()}
                placeholder="Enter admin password"
                autoFocus
              />
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => navigate('/study')}>
                Back to App
              </Button>
              <Button onClick={handleVerifyAccess} disabled={verifying}>
                {verifying ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Verifying...</>
                ) : (
                  <><Shield className="w-4 h-4 mr-2" /> Access Dashboard</>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${getRoleBadgeColor(userRole)}`}>
              {userRole === 'superadmin' ? <ShieldAlert className="w-5 h-5" /> :
               userRole === 'admin' ? <ShieldCheck className="w-5 h-5" /> :
               <Shield className="w-5 h-5" />}
            </div>
            <div>
              <h1 className="text-xl font-bold">Admin Dashboard</h1>
              <p className="text-sm text-muted-foreground capitalize">{userRole}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={toggleTheme} aria-label="Toggle theme">
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                if (activeTab === 'invites' && invitesLoaded) {
                  await loadInvites(true);
                }
                if (activeTab === 'performance' && usersLoaded) {
                  await loadRoleUsers(true);
                }
                if (activeTab === 'performance' && performanceLoaded) {
                  await loadPerformanceOverview(true);
                }
                if (activeTab === 'reports') {
                  await loadReports(true);
                }
                if (activeTab === 'logs' && logsLoaded) {
                  await loadLogs(true);
                }
                if (activeTab === 'demo' && userLevel >= ROLE_LEVELS.admin && demoLoaded) {
                  await loadDemoStatus(true);
                }
              }}
              disabled={loadingInvites || loadingUsers || loadingPerformance || loadingReports || loadingLogs || loadingDemo}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${(loadingInvites || loadingUsers || loadingPerformance || loadingReports || loadingLogs || loadingDemo) ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button variant="ghost" size="sm" onClick={() => navigate('/study')}>
              Back to App
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="flex h-auto flex-wrap gap-1">
            {userLevel >= ROLE_LEVELS.admin && (
              <TabsTrigger value="invites">
                <UserPlus className="w-4 h-4 mr-2" />
                Invites
              </TabsTrigger>
            )}
            <TabsTrigger value="reports">
              <Bug className="w-4 h-4 mr-2" />
              Reports
            </TabsTrigger>
            <TabsTrigger value="performance">
              <Users className="w-4 h-4 mr-2" />
              Performance
            </TabsTrigger>
            <TabsTrigger value="logs">
              <History className="w-4 h-4 mr-2" />
              Logs
            </TabsTrigger>
            {userLevel >= ROLE_LEVELS.admin && (
              <TabsTrigger value="demo">
                <KeyRound className="w-4 h-4 mr-2" />
                Demo Login
              </TabsTrigger>
            )}
            {userLevel >= ROLE_LEVELS.admin && (
              <TabsTrigger value="maintenance">
                <RefreshCw className="w-4 h-4 mr-2" />
                Maintenance
              </TabsTrigger>
            )}
          </TabsList>

          {/* Invites Tab */}
          {userLevel >= ROLE_LEVELS.admin && (
          <TabsContent value="invites" className="space-y-6">
            {/* Send Invite Card */}
            {userLevel >= ROLE_LEVELS.admin && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Send className="w-5 h-5" />
                    Send Role Invite
                  </CardTitle>
                  <CardDescription>
                    Invite someone to become a {userRole === 'superadmin' ? 'moderator or admin' : 'moderator'}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col sm:flex-row gap-4">
                    <div className="flex-1">
                      <Label htmlFor="invite-email">Email</Label>
                      <Input
                        id="invite-email"
                        type="email"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        placeholder="user@example.com"
                      />
                    </div>
                    <div className="w-full sm:w-40">
                      <Label>Role</Label>
                      <Select value={inviteRole} onValueChange={setInviteRole}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="moderator">Moderator</SelectItem>
                          {userRole === 'superadmin' && (
                            <SelectItem value="admin">Admin</SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-end">
                      <Button onClick={handleSendInvite} disabled={sendingInvite}>
                        {sendingInvite ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <><Send className="w-4 h-4 mr-2" /> Send</>
                        )}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Pending Invites */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Pending Invites</CardTitle>
              </CardHeader>
              <CardContent>
                {!invitesLoaded ? (
                  <div className="space-y-3">
                    <p className="text-muted-foreground text-sm">Click to load pending invites.</p>
                    <Button onClick={() => loadInvites(true)} disabled={loadingInvites}>
                      {loadingInvites ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Eye className="w-4 h-4 mr-2" />}
                      Load Invites
                    </Button>
                  </div>
                ) : invites.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No pending invites</p>
                ) : (
                  <div className="space-y-3">
                    {invites.map((invite) => (
                      <div key={invite.id} className="flex items-center justify-between p-3 rounded-lg border">
                        <div>
                          <p className="font-medium">{invite.email}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant="outline" className={getRoleBadgeColor(invite.role)}>
                              {invite.role}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              Expires: {new Date(invite.expiresAt).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleCancelInvite(invite.id)}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

          </TabsContent>
          )}

          {/* Reports Tab */}
          <TabsContent value="reports" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Bug className="w-5 h-5" />
                  Open Reports
                </CardTitle>
                <CardDescription>
                  Bug reports, user reports, and other support issues from users
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!reportsLoaded ? (
                  <div className="space-y-3">
                    <p className="text-muted-foreground text-sm">Click to load open reports.</p>
                    <Button onClick={() => loadReports(true)} disabled={loadingReports}>
                      {loadingReports ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Eye className="w-4 h-4 mr-2" />}
                      Load Reports
                    </Button>
                  </div>
                ) : (
                  <>
                {reportSummary && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
                    <div className="rounded border p-2">
                      <p className="text-xs text-muted-foreground">Open</p>
                      <p className="text-lg font-semibold">{reportSummary.totalOpen}</p>
                    </div>
                    <div className="rounded border p-2">
                      <p className="text-xs text-muted-foreground">Systemic</p>
                      <p className="text-lg font-semibold">{reportSummary.systemicOpen}</p>
                    </div>
                    <div className="rounded border p-2">
                      <p className="text-xs text-muted-foreground">User Related</p>
                      <p className="text-lg font-semibold">{reportSummary.userRelatedOpen}</p>
                    </div>
                    <div className="rounded border p-2">
                      <p className="text-xs text-muted-foreground">General</p>
                      <p className="text-lg font-semibold">{reportSummary.generalOpen}</p>
                    </div>
                  </div>
                )}
                {loadingReports ? (
                  <p className="text-muted-foreground text-sm flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Loading reports...</p>
                ) : reports.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No open reports</p>
                ) : (
                  <div className="space-y-3">
                    {reports.map((report) => {
                      const canResolve = canResolveReport(report);
                      return (
                        <div key={report.id} className="p-3 rounded-lg border space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="outline" className="uppercase">{report.type || 'general'}</Badge>
                              <Badge variant="outline" className={getReportCategoryBadgeColor(report.category)}>
                                {report.category === 'user_related' ? 'User Related' : report.category === 'systemic' ? 'Systemic' : 'General'}
                              </Badge>
                            </div>
                            <span className="text-xs text-muted-foreground">{report.createdAt ? new Date(report.createdAt).toLocaleString() : 'N/A'}</span>
                          </div>
                          <p className="text-sm whitespace-pre-wrap">{report.message}</p>
                          <div className="text-xs text-muted-foreground space-y-1">
                            <p>Reporter: {report.reporterUsername ? `@${report.reporterUsername}` : report.reporterUid?.slice(0, 8) || 'unknown'}{report.reporterEmail ? ` (${report.reporterEmail})` : ''}</p>
                            {report.reportedUser && <p>Reported user: {report.reportedUser}</p>}
                            <p>Assigned: {report.assignedTo ? (report.assignedTo === auth.currentUser?.uid ? 'You' : `${report.assignedTo.slice(0, 8)}...`) : 'Unassigned'}</p>
                          </div>
                          <div className="flex flex-wrap justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleAssignReport(report)}
                              disabled={assigningReportId === report.id || !canAssignReport(report)}
                              title={!canAssignReport(report) ? 'Only assignee or admin can change this assignment' : undefined}
                            >
                              {assigningReportId === report.id ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                              {report.assignedTo === auth.currentUser?.uid ? 'Unassign' : 'Assign to Me'}
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => handleResolveReport(report)}
                              disabled={!canResolve}
                              title={!canResolve ? 'Only admin/superadmin can resolve systemic reports' : undefined}
                            >
                              <Check className="w-4 h-4 mr-2" />
                              Resolve
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                    {reportsCursor && (
                      <div className="pt-2 flex justify-center">
                        <Button
                          variant="outline"
                          onClick={() => loadReports(true, reportsCursor)}
                          disabled={loadingMoreReports}
                        >
                          {loadingMoreReports ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                          Load More Reports
                        </Button>
                      </div>
                    )}
                  </div>
                )}
                </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Performance Tab */}
          <TabsContent value="performance" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Users className="w-5 h-5" />
                  Users with Roles
                </CardTitle>
                <CardDescription>
                  Manage moderators{userLevel >= ROLE_LEVELS.superadmin ? ' and admins' : ''}. Users load only on demand.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!usersLoaded ? (
                  <div className="space-y-3">
                    <p className="text-muted-foreground text-sm">Click to load users with elevated roles.</p>
                    <Button onClick={() => loadRoleUsers(true)} disabled={loadingUsers}>
                      {loadingUsers ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Eye className="w-4 h-4 mr-2" />}
                      Load Users
                    </Button>
                  </div>
                ) : roleUsers.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No users with elevated roles</p>
                ) : (
                  <div className="space-y-3">
                    {roleUsers.map((user) => {
                      const targetLevel = ROLE_LEVELS[user.role as UserRole] || 0;
                      const canManage = userLevel > targetLevel;
                      
                      return (
                        <div key={user.uid} className="flex items-center justify-between p-3 rounded-lg border">
                          <div className="flex items-center gap-3">
                            <Avatar className="w-10 h-10">
                              <AvatarImage src={user.photo_url || undefined} />
                              <AvatarFallback>
                                {user.username?.[0]?.toUpperCase() || '?'}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="font-medium">@{user.username || 'unknown'}</p>
                              <p className="text-xs text-muted-foreground">{user.email}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className={getRoleBadgeColor(user.role)}>
                              {user.role}
                            </Badge>
                            {canManage && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    setBanTarget({ uid: user.uid, username: user.username });
                                    setBanDialogOpen(true);
                                  }}
                                >
                                  <Ban className="w-4 h-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    setRemoveTarget(user);
                                    setRemoveRoleOpen(true);
                                  }}
                                >
                                  <UserMinus className="w-4 h-4" />
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {userLevel >= ROLE_LEVELS.moderator && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <BarChart3 className="w-5 h-5" />
                    Performance Overview
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {!performanceLoaded ? (
                    <div className="space-y-3">
                      <p className="text-muted-foreground text-sm">Click to load performance metrics and usage data.</p>
                      <Button onClick={() => loadPerformanceOverview(true)} disabled={loadingPerformance}>
                        {loadingPerformance ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Eye className="w-4 h-4 mr-2" />}
                        Load Performance
                      </Button>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                        <div className="rounded-lg border p-3">
                          <p className="text-xs text-muted-foreground">Total Users</p>
                          <p className="text-xl font-semibold">{performanceSummary?.totalUsers ?? 0}</p>
                        </div>
                        <div className="rounded-lg border p-3">
                          <p className="text-xs text-muted-foreground">Total Monthly Credits</p>
                          <p className="text-xl font-semibold">{performanceSummary?.totalUsesThisMonth ?? 0}</p>
                        </div>
                        <div className="rounded-lg border p-3">
                          <p className="text-xs text-muted-foreground">Plan Breakdown</p>
                          <p className="text-sm mt-1">
                            {performanceSummary?.planBreakdown
                              ? Object.entries(performanceSummary.planBreakdown).map(([plan, count]) => `${plan}: ${count}`).join(' • ')
                              : 'N/A'}
                          </p>
                        </div>
                      </div>
                      
                      {/* User Search */}
                      <div className="flex gap-2 mb-4">
                        <Input
                          placeholder="Search by username or email..."
                          value={userSearchQuery}
                          onChange={(e) => setUserSearchQuery(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleSearchUsers()}
                          className="flex-1"
                        />
                        <Button onClick={handleSearchUsers} disabled={searchingUsers}>
                          {searchingUsers ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                        </Button>
                        {searchResults.length > 0 && (
                          <Button variant="outline" onClick={() => { setSearchResults([]); setUserSearchQuery(''); }}>
                            <X className="w-4 h-4" />
                          </Button>
                        )}
                      </div>

                      {/* Search Results */}
                      {searchResults.length > 0 && (
                        <div className="mb-4">
                          <p className="text-sm font-medium mb-2">Search Results ({searchResults.length})</p>
                          <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1 border rounded-lg p-2 bg-muted/30">
                            {searchResults.map((u) => (
                              <div key={u.uid} className="border rounded-lg p-3 flex flex-col md:flex-row md:items-center md:justify-between gap-2 bg-background">
                                <div>
                                  <p className="font-medium">@{u.username || 'unknown'}</p>
                                  <p className="text-xs text-muted-foreground">{u.email || 'no-email'} • {u.role || 'user'}</p>
                                </div>
                                <div className="flex flex-wrap items-center gap-2 text-xs">
                                  <Badge variant="outline">Plan: {u.plan || 'free'}</Badge>
                                  <Badge variant="outline">Credits: {Number(u.uses_this_month || 0)}</Badge>
                                  <Badge variant="outline">Quota: {Number(u.monthly_quota || 0)}</Badge>
                                  {u.isDemoUser && <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/20">Demo</Badge>}
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleResetUserCounters(u.uid, u.username)}
                                    disabled={resettingCounterUid === u.uid}
                                    title="Reset credits to 0"
                                  >
                                    {resettingCounterUid === u.uid ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* All Users List */}
                      <p className="text-sm font-medium mb-2">All Users</p>
                      {performanceUsers.length === 0 ? (
                        <p className="text-muted-foreground text-sm">No user data available</p>
                      ) : (
                        <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
                          {performanceUsers.map((u) => (
                            <div key={u.uid} className="border rounded-lg p-3 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                              <div>
                                <p className="font-medium">@{u.username || 'unknown'}</p>
                                <p className="text-xs text-muted-foreground">{u.email || 'no-email'} • {u.role || 'user'}</p>
                              </div>
                              <div className="flex flex-wrap items-center gap-2 text-xs">
                                <Badge variant="outline">Plan: {u.plan || 'free'}</Badge>
                                <Badge variant="outline">Credits: {Number(u.uses_this_month || 0)}</Badge>
                                <Badge variant="outline">Quota: {Number(u.monthly_quota || 0)}</Badge>
                                {u.isDemoUser && <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/20">Demo</Badge>}
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleResetUserCounters(u.uid, u.username)}
                                  disabled={resettingCounterUid === u.uid}
                                  title="Reset credits to 0"
                                >
                                  {resettingCounterUid === u.uid ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            {userLevel >= ROLE_LEVELS.superadmin && PROMO_STATS_EMAILS.has((auth.currentUser?.email || '').toLowerCase()) && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <KeyRound className="w-5 h-5" />
                    Promo Code Usage
                  </CardTitle>
                  <CardDescription>
                    Which customers redeemed a promotion code at checkout, with per-user status and renewal dates. Export full details for internal use or a privacy-safe sheet for ambassadors.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {!codeStatsLoaded ? (
                    <div className="space-y-3">
                      <p className="text-muted-foreground text-sm">Click to load promotion code redemptions.</p>
                      <Button onClick={() => loadCodeStats(true)} disabled={loadingCodeStats}>
                        {loadingCodeStats ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Eye className="w-4 h-4 mr-2" />}
                        Load Code Stats
                      </Button>
                    </div>
                  ) : !codeStats || codeStats.codes.length === 0 ? (
                    <p className="text-muted-foreground text-sm">No promotion codes have been redeemed yet.</p>
                  ) : (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        <div className="rounded-lg border p-3">
                          <p className="text-xs text-muted-foreground">Total Redemptions</p>
                          <p className="text-xl font-semibold">{codeStats.totalRedemptions}</p>
                        </div>
                        <div className="rounded-lg border p-3">
                          <p className="text-xs text-muted-foreground">Unique Codes</p>
                          <p className="text-xl font-semibold">{codeStats.uniqueCodes}</p>
                        </div>
                        <div className="rounded-lg border p-3">
                          <p className="text-xs text-muted-foreground">Subscriptions Scanned</p>
                          <p className="text-xl font-semibold">{codeStats.subscriptionsScanned}</p>
                        </div>
                      </div>
                      <Input
                        placeholder="Search by code, username, or email..."
                        value={promoSearch}
                        onChange={(e) => setPromoSearch(e.target.value)}
                        className="max-w-sm"
                      />
                      <div className="space-y-3">
                        {codeStats.codes
                          .filter(c => {
                            const q = promoSearch.trim().toLowerCase();
                            if (!q) return true;
                            return c.code.toLowerCase().includes(q) ||
                              c.users.some(u => (u.username || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q));
                          })
                          .map((c) => (
                          <div key={c.code} className="border rounded-lg p-3">
                            <div className="flex items-center justify-between flex-wrap gap-2">
                              <p className="font-mono font-semibold">{c.code}</p>
                              <div className="flex items-center gap-2 flex-wrap">
                                <Badge variant="outline">{c.redemptionCount} redemption{c.redemptionCount === 1 ? '' : 's'}</Badge>
                                <Button variant="outline" size="sm" onClick={() => exportPromoCode(c, 'full')}>
                                  <Download className="w-3.5 h-3.5 mr-1" /> Full
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => exportPromoCode(c, 'ambassador')}
                                  title="Privacy-safe export: first name, masked email, dates, status, months">
                                  <Download className="w-3.5 h-3.5 mr-1" /> Ambassador-safe
                                </Button>
                              </div>
                            </div>
                            {c.tierBreakdown && Object.keys(c.tierBreakdown).length > 0 && (
                              <div className="flex flex-wrap gap-1.5 mt-2">
                                {Object.entries(c.tierBreakdown).map(([tier, n]) => (
                                  <Badge key={tier} variant="secondary" className="text-xs capitalize">
                                    {tier}: {n}
                                  </Badge>
                                ))}
                              </div>
                            )}
                            {(c.firstRedemption || c.lastRedemption) && (
                              <p className="text-xs text-muted-foreground mt-1.5">
                                {new Date(c.firstRedemption!).toLocaleDateString()}
                                {c.lastRedemption && c.lastRedemption !== c.firstRedemption
                                  ? ` → ${new Date(c.lastRedemption).toLocaleDateString()}`
                                  : ''}
                              </p>
                            )}
                            <div className="mt-2 space-y-1">
                              {c.users.map((u, i) => (
                                <div key={u.uid || u.customerId || i} className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                                  <span>
                                    {(u.firstName || u.lastName) ? `${u.firstName || ''} ${u.lastName || ''}`.trim() + ' • ' : ''}
                                    {u.username ? `@${u.username}` : u.email || u.customerId || 'unknown'}
                                    {u.email && u.username ? ` • ${u.email}` : ''}
                                    {u.tier ? ` • ${u.tier}` : (u.plan ? ` • ${u.plan}` : '')}
                                    {u.subStart || u.redeemedAt ? ` • subscribed ${new Date((u.subStart || u.redeemedAt)!).toLocaleDateString()}` : ''}
                                    {u.renewal && (u.status === 'active' || u.status === 'canceling' || u.status === 'trialing')
                                      ? ` • renews ${new Date(u.renewal).toLocaleDateString()}` : ''}
                                    {u.months ? ` • ${u.months} mo` : ''}
                                  </span>
                                  {u.status && (
                                    <Badge
                                      variant={u.status === 'active' || u.status === 'trialing' ? 'secondary' : 'outline'}
                                      className={`text-[10px] px-1.5 py-0 ${u.status === 'canceling' ? 'border-amber-500 text-amber-600' : u.status !== 'active' && u.status !== 'trialing' ? 'border-destructive/50 text-destructive' : ''}`}
                                    >
                                      {u.status === 'canceling' ? 'canceling at period end' : u.status}
                                    </Badge>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Logs Tab (Admin+ only) */}
          {userLevel >= ROLE_LEVELS.admin && (
            <TabsContent value="logs" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <History className="w-5 h-5" />
                    Moderation Logs
                  </CardTitle>
                  <CardDescription>
                    Recent moderation actions
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {!logsLoaded ? (
                    <div className="space-y-3">
                      <p className="text-muted-foreground text-sm">Click to load moderation logs.</p>
                      <Button onClick={() => loadLogs(true)} disabled={loadingLogs}>
                        {loadingLogs ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Eye className="w-4 h-4 mr-2" />}
                        Load Logs
                      </Button>
                    </div>
                  ) : loadingLogs ? (
                    <p className="text-muted-foreground text-sm flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Loading logs...</p>
                  ) : logs.length === 0 ? (
                    <p className="text-muted-foreground text-sm">No logs yet</p>
                  ) : (
                    <div className="space-y-2">
                      {logs.map((log) => (
                        <div key={log.id} className="p-3 rounded-lg border text-sm">
                          <div className="flex items-center justify-between">
                            <Badge variant="outline">{log.type}</Badge>
                            <span className="text-xs text-muted-foreground">
                              {log.timestamp ? new Date(log.timestamp).toLocaleString() : 'N/A'}
                            </span>
                          </div>
                          <div className="mt-2 text-muted-foreground">
                            <span>Actor: {log.actorUid?.slice(0, 8)}...</span>
                            {log.actorRole && <span className="ml-2">({log.actorRole})</span>}
                            {log.targetUid && <span className="ml-2">→ Target: {log.targetUid.slice(0, 8)}...</span>}
                          </div>
                        </div>
                      ))}
                      {logsCursor && (
                        <div className="pt-2 flex justify-center">
                          <Button
                            variant="outline"
                            onClick={() => loadLogs(true, logsCursor)}
                            disabled={loadingMoreLogs}
                          >
                            {loadingMoreLogs ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                            Load More Logs
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {/* Demo Access Tab (admin+) */}
          {userLevel >= ROLE_LEVELS.admin && (
            <TabsContent value="demo" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <KeyRound className="w-5 h-5" />
                    Demo Login Controls
                  </CardTitle>
                  <CardDescription>
                    Manage event demo credentials and activation
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {!demoLoaded ? (
                    <div className="space-y-3">
                      <p className="text-muted-foreground text-sm">Click to load demo login controls.</p>
                      <Button onClick={() => loadDemoStatus(true)} disabled={loadingDemo}>
                        {loadingDemo ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Eye className="w-4 h-4 mr-2" />}
                        Load Demo Settings
                      </Button>
                    </div>
                  ) : (
                    <>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={demoStatus?.enabled ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' : 'bg-gray-500/10 text-gray-500 border-gray-500/20'}>
                      {demoStatus?.enabled ? 'Active' : 'Disabled'}
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      Username: <span className="font-medium text-foreground">{demoStatus?.username || 'not set'}</span>
                    </span>
                    <span className="text-sm text-muted-foreground">
                      Email: <span className="font-medium text-foreground">{demoStatus?.email || 'demo@metastudy.app'}</span>
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() => {
                        setDemoAction('activate');
                        setDemoUsernameInput(demoStatus?.username || 'demo');
                        setDemoPassword('');
                        setDemoDialogOpen(true);
                      }}
                      disabled={updatingDemo}
                    >
                      <Power className="w-4 h-4 mr-2" /> Activate / Reset Credentials
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setDemoAction('change_password');
                        setDemoUsernameInput(demoStatus?.username || 'demo');
                        setDemoPassword('');
                        setDemoDialogOpen(true);
                      }}
                      disabled={updatingDemo}
                    >
                      <KeyRound className="w-4 h-4 mr-2" /> Update Credentials
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={handleDeactivateDemo}
                      disabled={updatingDemo || !demoStatus?.enabled}
                    >
                      <Power className="w-4 h-4 mr-2" /> Deactivate Demo
                    </Button>
                  </div>
                  </>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {/* Maintenance Tab (admin+) */}
          {userLevel >= ROLE_LEVELS.admin && (
            <TabsContent value="maintenance" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <RefreshCw className="w-5 h-5" />
                    One-time Migrations
                  </CardTitle>
                  <CardDescription>
                    Run these once after deploying the privacy update (functions first, then rules). Safe to re-run (idempotent).
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between gap-4 p-3 rounded-lg border">
                    <div>
                      <div className="font-medium text-sm">Backfill public profiles</div>
                      <div className="text-xs text-muted-foreground">Creates public_profiles mirrors (username, photo, stats) for all existing users. Run BEFORE deploying the new Firestore rules.</div>
                      {backfillResults['backfillPublicProfiles'] && <div className="text-xs mt-1 font-mono">{backfillResults['backfillPublicProfiles']}</div>}
                    </div>
                    <Button onClick={() => runBackfill('backfillPublicProfiles')} disabled={!!backfillRunning}>
                      {backfillRunning === 'backfillPublicProfiles' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Run'}
                    </Button>
                  </div>
                  <div className="flex items-center justify-between gap-4 p-3 rounded-lg border">
                    <div>
                      <div className="font-medium text-sm">Backfill shared flags</div>
                      <div className="text-xs text-muted-foreground">Marks source content of existing feed posts as shared:true so old challenges keep working under private-by-default rules.</div>
                      {backfillResults['backfillSharedFlags'] && <div className="text-xs mt-1 font-mono">{backfillResults['backfillSharedFlags']}</div>}
                    </div>
                    <Button onClick={() => runBackfill('backfillSharedFlags')} disabled={!!backfillRunning}>
                      {backfillRunning === 'backfillSharedFlags' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Run'}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <UserX className="w-5 h-5" />
                    Orphaned User Docs
                  </CardTitle>
                  <CardDescription>
                    users/{`{uid}`} docs with no matching Firebase Auth account (deleted before cleanup triggers existed). These inflate Total Users. Owner emails only.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between gap-4 p-3 rounded-lg border">
                    <div>
                      <div className="font-medium text-sm">Reconcile deleted users</div>
                      <div className="text-xs text-muted-foreground">
                        Compares Firebase Auth accounts against users/ docs and removes orphans (plus their usernames, public_profiles, customers mirrors).
                      </div>
                      {reconcileState.result && (
                        <div className="text-xs mt-1 font-mono">
                          {`Auth: ${reconcileState.result.authUsers} · Docs: ${reconcileState.result.userDocs} · Orphans: ${reconcileState.result.orphanedCount}`}
                          {reconcileState.result.deleted !== undefined && ` · Deleted: ${reconcileState.result.deleted}`}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button variant="outline" onClick={() => runReconcile(true)} disabled={reconcileState.running}>
                        {reconcileState.running ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Check'}
                      </Button>
                      {reconcileState.confirming && (
                        <Button variant="destructive" onClick={() => runReconcile(false)} disabled={reconcileState.running}>
                          Delete {reconcileState.result?.orphanedCount} orphans
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          )}
        </Tabs>
      </div>

      {/* Ban Dialog */}
      <Dialog open={banDialogOpen} onOpenChange={setBanDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Ban className="w-5 h-5" />
              Ban User
            </DialogTitle>
            <DialogDescription>
              Apply restrictions to @{banTarget?.username}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Ban Type</Label>
              <Select value={banType} onValueChange={setBanType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cannot_post">
                    <div className="flex items-center gap-2">
                      <FileX className="w-4 h-4" />
                      Cannot Post
                    </div>
                  </SelectItem>
                  <SelectItem value="cannot_comment">
                    <div className="flex items-center gap-2">
                      <MessageSquareOff className="w-4 h-4" />
                      Cannot Comment
                    </div>
                  </SelectItem>
                  <SelectItem value="full">
                    <div className="flex items-center gap-2">
                      <Ban className="w-4 h-4" />
                      Full Restriction
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Reason (optional)</Label>
              <Textarea
                value={banReason}
                onChange={(e) => setBanReason(e.target.value)}
                placeholder="Reason for ban..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBanDialogOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleBanUser} disabled={banning}>
              {banning ? <Loader2 className="w-4 h-4 animate-spin" /> : "Apply Ban"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove Role Dialog */}
      <Dialog open={removeRoleOpen} onOpenChange={setRemoveRoleOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserMinus className="w-5 h-5" />
              Remove Role
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to remove {removeTarget?.role} role from @{removeTarget?.username}?
              They will become a regular user.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveRoleOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleRemoveRole} disabled={removing}>
              {removing ? <Loader2 className="w-4 h-4 animate-spin" /> : "Remove Role"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Demo Password Dialog */}
      <Dialog open={demoDialogOpen} onOpenChange={setDemoDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{demoAction === 'activate' ? 'Activate Demo Login' : 'Change Demo Password'}</DialogTitle>
            <DialogDescription>
              Set the demo username and password for event login.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="demo-username">Username</Label>
            <Input
              id="demo-username"
              type="text"
              value={demoUsernameInput}
              onChange={(e) => setDemoUsernameInput(e.target.value.toLowerCase())}
              placeholder="event-demo"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="demo-password">Password</Label>
            <Input
              id="demo-password"
              type="password"
              value={demoPassword}
              onChange={(e) => setDemoPassword(e.target.value)}
              placeholder="Minimum 6 characters"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDemoDialogOpen(false)} disabled={updatingDemo}>Cancel</Button>
            <Button onClick={handleSubmitDemoAction} disabled={updatingDemo}>
              {updatingDemo ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              {demoAction === 'activate' ? 'Activate' : 'Update Password'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
};

export default AdminDashboard;
