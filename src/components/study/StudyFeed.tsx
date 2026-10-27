import { useEffect, useMemo, useState, useCallback } from "react";
import { flushSync } from "react-dom";
import { UsageAnimation, useUsageAnimation } from "@/components/ui/usage-animation";
import { doc, setDoc, collection, query, where, orderBy, limit, onSnapshot, serverTimestamp, deleteDoc, updateDoc, getDoc, getDocs, increment, documentId, writeBatch, runTransaction, startAfter, type QuerySnapshot, type DocumentData } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions as fbFunctions } from "../../../firebase";
import { useUserData } from "@/contexts/UserDataContext";
import { batchFetchUserProfiles } from "@/lib/firestore-utils";
import { useToast } from "@/hooks/use-toast";
import { incrementMonthlyUsage } from "@/lib/usage";
import { sendPostLikeNotification, sendPostDislikeNotification, sendPostCommentNotification } from "@/lib/notifications";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Heart, ThumbsDown, MessageCircle, Trophy, Globe2, Lock, Plus, MoreHorizontal, Edit, Trash2, X, ChevronDown, Check, Medal, RotateCcw, ExternalLink, BookOpen, Loader2, Menu, Users, RefreshCw, Shield, Ban, MessageSquareOff } from "lucide-react";
import { ChallengePopup } from "./ChallengePopup";
import { incrementCounterAndAwardOn } from "@/lib/achievements";
import { UnifiedProfilePopup } from "../UnifiedProfilePopup";
import { GroupsManager } from "./GroupsManager";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

interface FeedPost {
  id: string;
  ownerId: string;
  ownerUsername?: string;
  ownerPhotoURL?: string | null;
  title: string;
  description?: string;
  type: "lesson" | "quiz" | "flashcards" | "summary" | "mixed";
  summaryType?: string;
  sourceRef?: { type: string; docId: string } | null;
  coverImageUrl?: string | null;
  visibility: "public" | "friends" | "group";
  topics: string[];
  likeCount: number;
  dislikeCount: number;
  commentCount: number;
  participantCount: number;
  createdAt?: any;
  lastActivityAt?: any;
  subject?: string;
  class?: string;
}

interface FeedProps {
  userId: string;
  username?: string;
  photoUrl?: string | null;
  onQuizSaved?: () => void;
  onFlashcardsSaved?: () => void;
  onSummarySaved?: () => void;
  onPlanSaved?: () => void;
}

// Helper to format summary type for display (e.g., "key_points" -> "Key Points")
const formatSummaryType = (type: string) => {
  if (!type) return '';
  return type.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
};

// Module-level in-memory feed cache - survives tab switches within the same app session.
// Reading from this costs 0 Firestore reads and 0 IndexedDB look-ups.
interface FeedMemCache { posts: FeedPost[]; cursor: any; hasMore: boolean; ts: number }
const _feedMemCache = new Map<string, FeedMemCache>();
const FEED_MEM_TTL = 5 * 60 * 1000; // 5 minutes

export const StudyFeed = ({ userId, username, photoUrl, onQuizSaved, onFlashcardsSaved, onSummarySaved }: FeedProps) => {
  const { toast } = useToast();
  const userData = useUserData();
  const { isModerator } = userData;
  
  // Moderation state
  const [moderatingPost, setModeratingPost] = useState<string | null>(null);
  const [banDialogOpen, setBanDialogOpen] = useState(false);
  const [banTargetUser, setBanTargetUser] = useState<{ uid: string; username: string } | null>(null);
  const [banType, setBanType] = useState<'cannot_post' | 'cannot_comment' | 'full'>('cannot_post');
  const [banReason, setBanReason] = useState('');
  const [banning, setBanning] = useState(false);
  
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [joinedChallengesPosts, setJoinedChallengesPosts] = useState<FeedPost[]>([]);
  const [groupPosts, setGroupPosts] = useState<FeedPost[]>([]);
  const [userGroups, setUserGroups] = useState<any[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(() => {
    try { return sessionStorage.getItem(`feed_group_${userId}`) || null; } catch { return null; }
  });
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [filterTab, setFilterTab] = useState<string>(() => {
    try {
      const saved = sessionStorage.getItem(`feed_tab_${userId}`);
      return ['for-you', 'latest', 'my-posts', 'groups'].includes(saved || '') ? saved! : 'for-you';
    } catch { return 'for-you'; }
  });
  const [subjectFilter, setSubjectFilter] = useState<string>("all");
  const [classFilter, setClassFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [commentDialogPost, setCommentDialogPost] = useState<FeedPost | null>(null);
  const [comments, setComments] = useState<Array<{ id: string; userId: string; username?: string; userPhotoURL?: string | null; text: string; createdAt?: any }>>([]);
  const [newComment, setNewComment] = useState("");
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentText, setEditingCommentText] = useState<string>("");
  const [userReactions, setUserReactions] = useState<Record<string, 'like' | 'dislike'>>({});
  const [joinDialogPost, setJoinDialogPost] = useState<FeedPost | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [postDialogStep, setPostDialogStep] = useState<'picker' | 'composer'>('picker');
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [caption, setCaption] = useState('');
  const [subject, setSubject] = useState("");
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<"public" | "friends" | "group">("public");
  const [selectedGroupForPost, setSelectedGroupForPost] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const { showAnimation: showPostAnim, triggerAnimation: triggerPostAnim } = useUsageAnimation();
  const [subjectOpen, setSubjectOpen] = useState(false);
  const [topicsOpen, setTopicsOpen] = useState(false);
  const [visibilityOpen, setVisibilityOpen] = useState(false);
  const [subjectFilterOpen, setSubjectFilterOpen] = useState(false);
  const [classFilterOpen, setClassFilterOpen] = useState(false);
  const [typeFilterOpen, setTypeFilterOpen] = useState(false);
  const [joinedChallenges, setJoinedChallenges] = useState<Set<string>>(new Set());
  // OPTIMIZED: Cache friends list to avoid multiple reads across functions
  const [cachedFriendIds, setCachedFriendIds] = useState<string[]>([]);
  const [friendsCacheLoaded, setFriendsCacheLoaded] = useState(false);
  // Pagination state for infinite scroll (Instagram-style auto-load on scroll)
  const [displayedPostCount, setDisplayedPostCount] = useState(15); // How many to show
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [lastPostCursor, setLastPostCursor] = useState<any>(null); // Firestore cursor for pagination
  const [hasMoreFirestore, setHasMoreFirestore] = useState(true); // Whether more posts exist in Firestore
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [selectedChallenge, setSelectedChallenge] = useState<FeedPost | null>(null);
  const [leaderboardData, setLeaderboardData] = useState<any[]>([]);
  const [joining, setJoining] = useState(false);
  const [funFactIndex, setFunFactIndex] = useState(0);
  const [loadingPicker, setLoadingPicker] = useState(false);
  const [lessons, setLessons] = useState<any[]>([]);
  const [quizzes, setQuizzes] = useState<any[]>([]);
  const [flashcards, setFlashcards] = useState<any[]>([]);
  const [summaries, setSummaries] = useState<any[]>([]);

  // Edit/Delete state
  const [editingPost, setEditingPost] = useState<FeedPost | null>(null);
  const [editCaption, setEditCaption] = useState("");
  const [editSubject, setEditSubject] = useState("");
  const [editKlass, setEditKlass] = useState("");
  const [editVisibility, setEditVisibility] = useState<"public" | "friends" | "group">("public");
  const [editLoading, setEditLoading] = useState(false);
  const [deleteConfirmPost, setDeleteConfirmPost] = useState<FeedPost | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [challengePopupOpen, setChallengePopupOpen] = useState(false);
  const [selectedChallengeForPopup, setSelectedChallengeForPopup] = useState<FeedPost | null>(null);
  const [openingChallengeId, setOpeningChallengeId] = useState<string | null>(null);
  const [profileCardOpen, setProfileCardOpen] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<{userId: string, username?: string, photoURL?: string | null} | null>(null);

  const funFacts = [
    "Longer challenges may take a moment to prepare. Perfect time to grab water.",
    "Remember: reviewing mistakes is where most learning happens.",
    "You can share your favorite lessons as challenges for your friends.",
    "Short, focused sessions often beat long distracted ones.",
  ];

  const normalizeForMath = (s: string) => {
    let out = String(s || "");
    out = out.replace(/\r\n/g, "\n").replace(/\\n/g, "\n");
    // Fix common escaped LaTeX commands coming from JSON / stringified content
    out = out.replace(/\\\\([A-Za-z]+)/g, "\\$1");
    out = out.replace(/\*\*/g, "");
    out = out.replace(/\\\(/g, "$" ).replace(/\\\)/g, "$");
    out = out.replace(/\\\[/g, "$$").replace(/\\\]/g, "$$");

    const maybeWrapFormula = (line: string) => {
      if (!line) return line;
      if (/\$|\\\(|\\\[|\\begin\{/.test(line)) return line;
      const m = line.match(/^(\s*(?:[-*+]\s+)?(?:[A-D]\.)?\s*)(.*)$/);
      const prefix = m ? m[1] : "";
      const rest = m ? m[2] : line;
      const t = rest.trim();
      const hasLatex = /\\(frac|times|cdot|sqrt|sum|int|left|right|alpha|beta|gamma|pi|theta|mu|sigma)/.test(t) || /[_^]\{?\w/.test(t);
      const looksLikeEquation = (/=/.test(t) && /\d/.test(t)) || hasLatex;
      if (!looksLikeEquation) return line;
      return `${prefix}$${t}$`;
    };

    out = out.split("\n").map(maybeWrapFormula).join("\n");
    out = out.replace(/(\n\s*){3,}/g, "\n\n");
    return out;
  };

  // Helper to format relative time
  const formatRelativeTime = (timestamp: any) => {
    if (!timestamp) return '';
    try {
      const date = timestamp.seconds ? new Date(timestamp.seconds * 1000) : new Date(timestamp);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMinutes = Math.floor(diffMs / (1000 * 60));
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      
      if (diffMinutes < 1) return 'Just now';
      if (diffMinutes < 60) return `${diffMinutes}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays < 7) return `${diffDays}d ago`;
      return date.toLocaleDateString();
    } catch {
      return '';
    }
  };

  const getSubjectLabel = (value: string) => {
    const subjects: Record<string, string> = {
      'math': 'Math',
      'reading-writing': 'Reading & Writing',
      'science': 'Science (General)',
      'biology': 'Biology',
      'chemistry': 'Chemistry',
      'physics': 'Physics',
      'history': 'History',
      'economics': 'Economics',
      'business': 'Business',
      'computer-science': 'Computer Science',
      'language': 'Languages',
      'arts': 'Arts & Humanities',
      'politics': 'Political Science',
      'psychology': 'Psychology',
      'sociology': 'Sociology',
      'philosophy': 'Philosophy',
      'law': 'Law',
      'engineering': 'Engineering',
      'health': 'Health & Medicine',
      'movies': 'Movies & TV',
      'sports': 'Sports',
      'music': 'Music',
      'gaming': 'Gaming',
      'travel': 'Travel & Geography',
      'food': 'Food & Cooking',
      'fitness': 'Fitness & Wellness',
      'technology': 'Technology & Gadgets',
      'nature': 'Nature & Animals',
      'other': 'Other'
    };
    return subjects[value] || value;
  };

  const getVisibilityLabel = (value: string, groupId?: string) => {
    if (groupId) {
      const group = userGroups.find(g => g.id === groupId);
      return group ? group.name : "Group";
    }
    return value === "public" ? "Public" : "Friends only";
  };

  const getTopicLabel = (value: string) => {
    const topics: Record<string, string> = {
      'elementary-addition': 'Math, Addition (Elementary)',
      'elementary-fractions': 'Math, Fractions (Elementary)',
      'pre-algebra': 'Pre-Algebra',
      'algebra-1': 'Algebra 1',
      'geometry': 'Geometry',
      'algebra-2': 'Algebra 2',
      'trigonometry': 'Trigonometry',
      'calculus-1': 'Calculus 1',
      'calculus-2': 'Calculus 2',
      'calculus-3': 'Calculus 3',
      'linear-algebra': 'Linear Algebra',
      'statistics': 'Statistics / Probability',
      'intro-biology': 'Intro Biology',
      'cell-biology': 'Cell Biology',
      'genetics': 'Genetics',
      'human-biology': 'Human Biology / Anatomy',
      'ecology': 'Ecology',
      'intro-chemistry': 'Intro Chemistry',
      'organic-chemistry': 'Organic Chemistry',
      'physical-chemistry': 'Physical Chemistry',
      'mechanics': 'Mechanics',
      'electricity-magnetism': 'Electricity & Magnetism',
      'waves-optics': 'Waves & Optics',
      'microeconomics': 'Microeconomics',
      'macroeconomics': 'Macroeconomics',
      'personal-finance': 'Personal Finance',
      'econometrics': 'Econometrics',
      'development-econ': 'Development Economics',
      'intro-business': 'Intro to Business',
      'marketing': 'Marketing',
      'management': 'Management',
      'accounting': 'Accounting',
      'finance': 'Finance',
      'entrepreneurship': 'Entrepreneurship',
      'hr': 'Human Resources',
      'supply-chain': 'Supply Chain',
      'cs-intro': 'Intro to CS',
      'programming-basics': 'Programming Basics',
      'data-structures': 'Data Structures',
      'algorithms': 'Algorithms',
      'world-history': 'World History',
      'us-history': 'US History',
      'european-history': 'European History',
      'reading-comprehension': 'Reading Comprehension',
      'essay-writing': 'Essay Writing',
      'grammar': 'Grammar',
      'spanish': 'Spanish',
      'french': 'French',
      'german': 'German',
      'english-as-second-language': 'English as a Second Language',
      'earth-science': 'Earth Science',
      'environmental-science': 'Environmental Science',
      'art-history': 'Art History',
      'studio-art': 'Studio Art',
      'music-theory': 'Music Theory',
      'intro-pol-sci': 'Intro to Political Science',
      'international-relations': 'International Relations',
      'comparative-politics': 'Comparative Politics',
      'public-admin': 'Public Administration',
      'intro-psych': 'Intro to Psychology',
      'abnormal-psych': 'Abnormal Psychology',
      'developmental-psych': 'Developmental Psychology',
      'cognitive-psych': 'Cognitive Psychology',
      'intro-soc': 'Intro to Sociology',
      'social-problems': 'Social Problems',
      'criminology': 'Criminology',
      'intro-phil': 'Intro to Philosophy',
      'ethics': 'Ethics',
      'logic': 'Logic',
      'intro-law': 'Intro to Law',
      'constitutional-law': 'Constitutional Law',
      'business-law': 'Business Law',
      'criminal-law': 'Criminal Law',
      'civil-eng': 'Civil Engineering',
      'mechanical-eng': 'Mechanical Engineering',
      'electrical-eng': 'Electrical Engineering',
      'chemical-eng': 'Chemical Engineering',
      'anatomy': 'Anatomy',
      'physiology': 'Physiology',
      'public-health': 'Public Health',
      'nursing-basics': 'Nursing Basics',
      // Movies & TV
      'action-movies': 'Action Movies',
      'comedy-movies': 'Comedy Movies',
      'drama-movies': 'Drama',
      'horror-movies': 'Horror',
      'sci-fi-movies': 'Sci-Fi',
      'thriller-movies': 'Thriller & Mystery',
      'romance-movies': 'Romance',
      'documentary': 'Documentary',
      'animation': 'Animation',
      'tv-series': 'TV Series',
      'classic-films': 'Classic Films',
      // Sports
      'soccer': 'Soccer / Football',
      'american-football': 'American Football',
      'basketball': 'Basketball',
      'baseball': 'Baseball',
      'hockey': 'Hockey',
      'tennis': 'Tennis',
      'golf': 'Golf',
      'mma-boxing': 'MMA & Boxing',
      'olympics': 'Olympics',
      'motorsports': 'Motorsports',
      'cricket': 'Cricket',
      'rugby': 'Rugby',
      // Music
      'pop-music': 'Pop',
      'rock-music': 'Rock',
      'hip-hop': 'Hip-Hop & Rap',
      'classical-music': 'Classical',
      'jazz': 'Jazz',
      'electronic': 'Electronic & EDM',
      'country': 'Country',
      'rnb-soul': 'R&B & Soul',
      'music-production': 'Music Production',
      'instruments': 'Instruments',
      // Gaming
      'pc-gaming': 'PC Gaming',
      'console-gaming': 'Console Gaming',
      'mobile-gaming': 'Mobile Gaming',
      'esports': 'Esports',
      'game-reviews': 'Game Reviews',
      'rpg-games': 'RPG Games',
      'fps-games': 'FPS Games',
      'strategy-games': 'Strategy Games',
      'indie-games': 'Indie Games',
      // Travel & Geography
      'europe-travel': 'Europe',
      'asia-travel': 'Asia',
      'americas-travel': 'Americas',
      'africa-travel': 'Africa',
      'oceania-travel': 'Oceania',
      'travel-tips': 'Travel Tips',
      'cultures': 'Cultures & Traditions',
      'world-geography': 'World Geography',
      // Food & Cooking
      'recipes': 'Recipes',
      'baking': 'Baking',
      'cuisines': 'World Cuisines',
      'healthy-eating': 'Healthy Eating',
      'vegetarian-vegan': 'Vegetarian & Vegan',
      'cooking-techniques': 'Cooking Techniques',
      'food-science': 'Food Science',
      // Fitness & Wellness
      'workout-routines': 'Workout Routines',
      'nutrition': 'Nutrition',
      'yoga-meditation': 'Yoga & Meditation',
      'running': 'Running',
      'weightlifting': 'Weightlifting',
      'mental-health': 'Mental Health',
      // Technology & Gadgets
      'smartphones': 'Smartphones',
      'computers': 'Computers & Laptops',
      'ai-tech': 'AI & Machine Learning',
      'social-media': 'Social Media',
      'cybersecurity': 'Cybersecurity',
      'gadgets-reviews': 'Gadget Reviews',
      // Nature & Animals
      'wildlife': 'Wildlife',
      'pets': 'Pets',
      'marine-life': 'Marine Life',
      'birds': 'Birds',
      'plants-gardening': 'Plants & Gardening',
      'conservation': 'Conservation',
      'other-general': 'Other / General'
    };
    return topics[value] || value;
  };

  const getTopicsForSubject = (subjectValue: string) => {
    const topicsBySubject: Record<string, Array<{value: string, label: string}>> = {
      'math': [
        { value: 'elementary-addition', label: 'Math, Addition (Elementary)' },
        { value: 'elementary-fractions', label: 'Math, Fractions (Elementary)' },
        { value: 'pre-algebra', label: 'Pre-Algebra' },
        { value: 'algebra-1', label: 'Algebra 1' },
        { value: 'geometry', label: 'Geometry' },
        { value: 'algebra-2', label: 'Algebra 2' },
        { value: 'trigonometry', label: 'Trigonometry' },
        { value: 'calculus-1', label: 'Calculus 1' },
        { value: 'calculus-2', label: 'Calculus 2' },
        { value: 'calculus-3', label: 'Calculus 3' },
        { value: 'linear-algebra', label: 'Linear Algebra' },
        { value: 'statistics', label: 'Statistics / Probability' }
      ],
      'biology': [
        { value: 'intro-biology', label: 'Intro Biology' },
        { value: 'cell-biology', label: 'Cell Biology' },
        { value: 'genetics', label: 'Genetics' },
        { value: 'human-biology', label: 'Human Biology / Anatomy' },
        { value: 'ecology', label: 'Ecology' }
      ],
      'chemistry': [
        { value: 'intro-chemistry', label: 'Intro Chemistry' },
        { value: 'organic-chemistry', label: 'Organic Chemistry' },
        { value: 'physical-chemistry', label: 'Physical Chemistry' }
      ],
      'physics': [
        { value: 'mechanics', label: 'Mechanics' },
        { value: 'electricity-magnetism', label: 'Electricity & Magnetism' },
        { value: 'waves-optics', label: 'Waves & Optics' }
      ],
      'economics': [
        { value: 'microeconomics', label: 'Microeconomics' },
        { value: 'macroeconomics', label: 'Macroeconomics' },
        { value: 'personal-finance', label: 'Personal Finance' },
        { value: 'econometrics', label: 'Econometrics' },
        { value: 'development-econ', label: 'Development Economics' }
      ],
      'business': [
        { value: 'intro-business', label: 'Intro to Business' },
        { value: 'marketing', label: 'Marketing' },
        { value: 'management', label: 'Management' },
        { value: 'accounting', label: 'Accounting' },
        { value: 'finance', label: 'Finance' },
        { value: 'entrepreneurship', label: 'Entrepreneurship' },
        { value: 'hr', label: 'Human Resources' },
        { value: 'supply-chain', label: 'Supply Chain' }
      ],
      'computer-science': [
        { value: 'cs-intro', label: 'Intro to CS' },
        { value: 'programming-basics', label: 'Programming Basics' },
        { value: 'data-structures', label: 'Data Structures' },
        { value: 'algorithms', label: 'Algorithms' }
      ],
      'history': [
        { value: 'world-history', label: 'World History' },
        { value: 'us-history', label: 'US History' },
        { value: 'european-history', label: 'European History' }
      ],
      'reading-writing': [
        { value: 'reading-comprehension', label: 'Reading Comprehension' },
        { value: 'essay-writing', label: 'Essay Writing' },
        { value: 'grammar', label: 'Grammar' }
      ],
      'language': [
        { value: 'spanish', label: 'Spanish' },
        { value: 'french', label: 'French' },
        { value: 'german', label: 'German' },
        { value: 'english-as-second-language', label: 'English as a Second Language' }
      ],
      'science': [
        { value: 'earth-science', label: 'Earth Science' },
        { value: 'environmental-science', label: 'Environmental Science' }
      ],
      'arts': [
        { value: 'art-history', label: 'Art History' },
        { value: 'studio-art', label: 'Studio Art' },
        { value: 'music-theory', label: 'Music Theory' }
      ],
      'politics': [
        { value: 'intro-pol-sci', label: 'Intro to Political Science' },
        { value: 'international-relations', label: 'International Relations' },
        { value: 'comparative-politics', label: 'Comparative Politics' },
        { value: 'public-admin', label: 'Public Administration' }
      ],
      'psychology': [
        { value: 'intro-psych', label: 'Intro to Psychology' },
        { value: 'abnormal-psych', label: 'Abnormal Psychology' },
        { value: 'developmental-psych', label: 'Developmental Psychology' },
        { value: 'cognitive-psych', label: 'Cognitive Psychology' }
      ],
      'sociology': [
        { value: 'intro-soc', label: 'Intro to Sociology' },
        { value: 'social-problems', label: 'Social Problems' },
        { value: 'criminology', label: 'Criminology' }
      ],
      'philosophy': [
        { value: 'intro-phil', label: 'Intro to Philosophy' },
        { value: 'ethics', label: 'Ethics' },
        { value: 'logic', label: 'Logic' }
      ],
      'law': [
        { value: 'intro-law', label: 'Intro to Law' },
        { value: 'constitutional-law', label: 'Constitutional Law' },
        { value: 'business-law', label: 'Business Law' },
        { value: 'criminal-law', label: 'Criminal Law' }
      ],
      'engineering': [
        { value: 'civil-eng', label: 'Civil Engineering' },
        { value: 'mechanical-eng', label: 'Mechanical Engineering' },
        { value: 'electrical-eng', label: 'Electrical Engineering' },
        { value: 'chemical-eng', label: 'Chemical Engineering' }
      ],
      'health': [
        { value: 'anatomy', label: 'Anatomy' },
        { value: 'physiology', label: 'Physiology' },
        { value: 'public-health', label: 'Public Health' },
        { value: 'nursing-basics', label: 'Nursing Basics' }
      ],
      'movies': [
        { value: 'action-movies', label: 'Action Movies' },
        { value: 'comedy-movies', label: 'Comedy Movies' },
        { value: 'drama-movies', label: 'Drama' },
        { value: 'horror-movies', label: 'Horror' },
        { value: 'sci-fi-movies', label: 'Sci-Fi' },
        { value: 'thriller-movies', label: 'Thriller & Mystery' },
        { value: 'romance-movies', label: 'Romance' },
        { value: 'documentary', label: 'Documentary' },
        { value: 'animation', label: 'Animation' },
        { value: 'tv-series', label: 'TV Series' },
        { value: 'classic-films', label: 'Classic Films' }
      ],
      'sports': [
        { value: 'soccer', label: 'Soccer / Football' },
        { value: 'american-football', label: 'American Football' },
        { value: 'basketball', label: 'Basketball' },
        { value: 'baseball', label: 'Baseball' },
        { value: 'hockey', label: 'Hockey' },
        { value: 'tennis', label: 'Tennis' },
        { value: 'golf', label: 'Golf' },
        { value: 'mma-boxing', label: 'MMA & Boxing' },
        { value: 'olympics', label: 'Olympics' },
        { value: 'motorsports', label: 'Motorsports' },
        { value: 'cricket', label: 'Cricket' },
        { value: 'rugby', label: 'Rugby' }
      ],
      'music': [
        { value: 'pop-music', label: 'Pop' },
        { value: 'rock-music', label: 'Rock' },
        { value: 'hip-hop', label: 'Hip-Hop & Rap' },
        { value: 'classical-music', label: 'Classical' },
        { value: 'jazz', label: 'Jazz' },
        { value: 'electronic', label: 'Electronic & EDM' },
        { value: 'country', label: 'Country' },
        { value: 'rnb-soul', label: 'R&B & Soul' },
        { value: 'music-production', label: 'Music Production' },
        { value: 'instruments', label: 'Instruments' }
      ],
      'gaming': [
        { value: 'pc-gaming', label: 'PC Gaming' },
        { value: 'console-gaming', label: 'Console Gaming' },
        { value: 'mobile-gaming', label: 'Mobile Gaming' },
        { value: 'esports', label: 'Esports' },
        { value: 'game-reviews', label: 'Game Reviews' },
        { value: 'rpg-games', label: 'RPG Games' },
        { value: 'fps-games', label: 'FPS Games' },
        { value: 'strategy-games', label: 'Strategy Games' },
        { value: 'indie-games', label: 'Indie Games' }
      ],
      'travel': [
        { value: 'europe-travel', label: 'Europe' },
        { value: 'asia-travel', label: 'Asia' },
        { value: 'americas-travel', label: 'Americas' },
        { value: 'africa-travel', label: 'Africa' },
        { value: 'oceania-travel', label: 'Oceania' },
        { value: 'travel-tips', label: 'Travel Tips' },
        { value: 'cultures', label: 'Cultures & Traditions' },
        { value: 'world-geography', label: 'World Geography' }
      ],
      'food': [
        { value: 'recipes', label: 'Recipes' },
        { value: 'baking', label: 'Baking' },
        { value: 'cuisines', label: 'World Cuisines' },
        { value: 'healthy-eating', label: 'Healthy Eating' },
        { value: 'vegetarian-vegan', label: 'Vegetarian & Vegan' },
        { value: 'cooking-techniques', label: 'Cooking Techniques' },
        { value: 'food-science', label: 'Food Science' }
      ],
      'fitness': [
        { value: 'workout-routines', label: 'Workout Routines' },
        { value: 'nutrition', label: 'Nutrition' },
        { value: 'yoga-meditation', label: 'Yoga & Meditation' },
        { value: 'running', label: 'Running' },
        { value: 'weightlifting', label: 'Weightlifting' },
        { value: 'mental-health', label: 'Mental Health' }
      ],
      'technology': [
        { value: 'smartphones', label: 'Smartphones' },
        { value: 'computers', label: 'Computers & Laptops' },
        { value: 'ai-tech', label: 'AI & Machine Learning' },
        { value: 'social-media', label: 'Social Media' },
        { value: 'cybersecurity', label: 'Cybersecurity' },
        { value: 'gadgets-reviews', label: 'Gadget Reviews' }
      ],
      'nature': [
        { value: 'wildlife', label: 'Wildlife' },
        { value: 'pets', label: 'Pets' },
        { value: 'marine-life', label: 'Marine Life' },
        { value: 'birds', label: 'Birds' },
        { value: 'plants-gardening', label: 'Plants & Gardening' },
        { value: 'conservation', label: 'Conservation' }
      ],
      'other': [
        { value: 'other-general', label: 'Other / General' }
      ]
    };
    return topicsBySubject[subjectValue] || [];
  };

  // Tour can ask the feed to switch tabs (so spotlighted elements exist)
  useEffect(() => {
    const onNav = (e: Event) => {
      const tab = (e as CustomEvent).detail;
      if (['for-you', 'latest', 'my-posts', 'groups'].includes(tab)) setFilterTab(tab);
    };
    window.addEventListener('tour-feed-nav', onNav);
    return () => window.removeEventListener('tour-feed-nav', onNav);
  }, []);

  // Persist feed view (tab + selected group) so refresh keeps the user's place
  useEffect(() => {
    try {
      sessionStorage.setItem(`feed_tab_${userId}`, filterTab);
      if (selectedGroup) sessionStorage.setItem(`feed_group_${userId}`, selectedGroup);
      else sessionStorage.removeItem(`feed_group_${userId}`);
    } catch {}
  }, [filterTab, selectedGroup, userId]);

  // Load user's joined challenges (with localStorage cache to reduce reads)
  // OPTIMIZED: Also cache runs with timestamps to avoid duplicate reads when switching tabs
  useEffect(() => {
    if (!userId) return;
    const cacheKey = `joined_challenges_${userId}`;
    const cacheTsKey = `joined_challenges_ts_${userId}`;
    const runsCacheKey = `joined_runs_data_${userId}`;
    
    // Try cache first for instant display
    try {
      const cached = localStorage.getItem(cacheKey);
      const cachedTs = localStorage.getItem(cacheTsKey);
      const cacheAge = cachedTs ? Date.now() - parseInt(cachedTs) : Infinity;
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) {
          setJoinedChallenges(new Set(parsed));
          // If cache is fresh (under 2 minutes), skip Firestore fetch
          if (cacheAge < 120000) return;
        }
      }
    } catch {}
    
    const loadJoinedChallenges = async () => {
      try {
        const userRunsRef = collection(db as any, `users/${userId}/runs`);
        // OPTIMIZED: Limit runs to 50 to reduce reads (most users don't have more)
        const snap = await getDocs(query(userRunsRef, limit(50)));
        const joined = new Set<string>();
        const runsData: Array<{postId: string, joinedAt: any}> = [];
        snap.forEach((doc) => {
          const data = doc.data();
          if (data.feedPostId) {
            joined.add(data.feedPostId);
            runsData.push({ postId: data.feedPostId, joinedAt: data.joinedAt });
          }
        });
        setJoinedChallenges(joined);
        // Cache for next time (both IDs and full runs data)
        try {
          localStorage.setItem(cacheKey, JSON.stringify([...joined]));
          localStorage.setItem(cacheTsKey, String(Date.now()));
          sessionStorage.setItem(runsCacheKey, JSON.stringify(runsData));
        } catch {}
      } catch (e) {
        console.error("Failed to load joined challenges", e);
      }
    };
    loadJoinedChallenges();
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    setLoading(true);

    // 1. Module-level memory cache (zero reads, zero serialization - fastest path)
    const memEntry = _feedMemCache.get(userId);
    if (memEntry && Date.now() - memEntry.ts < FEED_MEM_TTL) {
      setPosts(memEntry.posts);
      setLastPostCursor(memEntry.cursor);
      setHasMoreFirestore(memEntry.hasMore);
      setDisplayedPostCount(15);
      setLoading(false);
      return;
    }

    // 2. sessionStorage cache for instant display after a page refresh (valid for 2 minutes)
    const postsCacheKey = `feed_posts_${userId}`;
    const postsCacheTsKey = `feed_posts_ts_${userId}`;
    try {
      const cachedPosts = sessionStorage.getItem(postsCacheKey);
      const cachedTs = sessionStorage.getItem(postsCacheTsKey);
      const cacheAge = cachedTs ? Date.now() - parseInt(cachedTs) : Infinity;
      if (cachedPosts && cacheAge < 120000) {
        const parsed = JSON.parse(cachedPosts);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setPosts(parsed);
          setLoading(false);
          // If cache is very fresh (under 60s), skip Firestore fetch entirely
          if (cacheAge < 60000) return;
        }
      }
    } catch {}
    
    const loadPosts = async () => {
      try {
        const baseRef = collection(db as any, "feed_posts");
        
        // 1. Load public posts (initial batch of 30)
        const publicQuery = query(
          baseRef,
          where("visibility", "==", "public"),
          orderBy("createdAt", "desc"),
          limit(15)
        );
        
        // 2. Load friends list (use cache if available to save reads)
        const friendsRef = collection(db as any, "users", userId, "friends");
        
        // 3. Load user's own private posts
        const userPrivateQuery = query(
          baseRef,
          where("visibility", "==", "friends"),
          where("ownerId", "==", userId),
          orderBy("createdAt", "desc"),
          limit(15)
        );

        // OPTIMIZED: Only fetch friends if not cached
        let friendIds: string[] = [];
        if (friendsCacheLoaded && cachedFriendIds.length >= 0) {
          friendIds = cachedFriendIds;
        }
        
        // Execute initial queries in parallel - each is independent so one
        // failure (e.g. index still building) can't blank the whole feed
        const safeGet = (q: any) => getDocs(q).catch((e: any) => {
          console.warn('Feed sub-query failed (skipping):', e?.message || e);
          return null;
        });
        const [publicSnap, friendsSnap, userPrivateSnap] = await Promise.all([
          safeGet(publicQuery),
          friendsCacheLoaded ? Promise.resolve(null) : safeGet(friendsRef),
          safeGet(userPrivateQuery)
        ]);
        
        const allPosts: FeedPost[] = [];
        
        // Process public posts
        publicSnap?.forEach((d: any) => {
          const data = d.data() as any;
          // Skip posts without valid ownerId
          if (!data.ownerId) return;
          allPosts.push({
            id: d.id,
            ownerId: String(data.ownerId),
            ownerUsername: data.ownerUsername || "user",
            ownerPhotoURL: data.ownerPhotoURL ?? null,
            title: String(data.title || "Untitled"),
            description: String(data.description || ""),
            type: (data.type || "lesson") as any,
            sourceRef: data.sourceRef || null,
            summaryType: data.summaryType || undefined,
            coverImageUrl: data.coverImageUrl || null,
            visibility: (data.visibility || "public") as any,
            topics: Array.isArray(data.topics) ? data.topics : [],
            likeCount: Number(data.likeCount || 0),
            dislikeCount: Number(data.dislikeCount || 0),
            commentCount: Number(data.commentCount || 0),
            participantCount: Number(data.participantCount || 0),
            createdAt: data.createdAt,
            lastActivityAt: data.lastActivityAt,
            subject: data.subject || undefined,
            class: data.class || undefined,
          });
        });
        
        // Use fetched friends or cached
        if (friendsSnap) {
          friendsSnap.forEach((doc: any) => {
            friendIds.push(doc.id);
          });
          // Cache friends for other functions
          setCachedFriendIds(friendIds);
          setFriendsCacheLoaded(true);
        }
        
        // Process friends' private posts (batched) - each batch fails independently
        if (friendIds.length > 0) {
          // Firestore 'in' queries are limited to 10 items
          const batchSize = 10;
          const friendQueryPromises: Promise<unknown>[] = [];
          
          for (let i = 0; i < friendIds.length; i += batchSize) {
            const batch = friendIds.slice(i, i + batchSize);
            const friendsQuery = query(
              baseRef,
              where("visibility", "==", "friends"),
              where("ownerId", "in", batch),
              orderBy("createdAt", "desc"),
              limit(20)
            );
            friendQueryPromises.push(safeGet(friendsQuery));
          }
          
          const friendSnaps = (await Promise.all(friendQueryPromises)).filter(Boolean) as any[];
          
          friendSnaps.forEach(snap => {
            snap.forEach((d: any) => {
              const data = d.data() as any;
              if (!data.ownerId) return;
              allPosts.push({
                id: d.id,
                ownerId: String(data.ownerId),
                ownerUsername: data.ownerUsername || "user",
                ownerPhotoURL: data.ownerPhotoURL ?? null,
                title: String(data.title || "Untitled"),
                description: String(data.description || ""),
                type: (data.type || "lesson") as any,
                sourceRef: data.sourceRef || null,
                summaryType: data.summaryType || undefined,
                coverImageUrl: data.coverImageUrl || null,
                visibility: (data.visibility || "friends") as any,
                topics: Array.isArray(data.topics) ? data.topics : [],
                likeCount: Number(data.likeCount || 0),
                dislikeCount: Number(data.dislikeCount || 0),
                commentCount: Number(data.commentCount || 0),
                participantCount: Number(data.participantCount || 0),
                createdAt: data.createdAt,
                lastActivityAt: data.lastActivityAt,
                subject: data.subject || undefined,
                class: data.class || undefined,
              });
            });
          });
        }
        
        // Process user's own private posts
        userPrivateSnap?.forEach((d: any) => {
          const data = d.data() as any;
          if (!data.ownerId) return;
          allPosts.push({
            id: d.id,
            ownerId: String(data.ownerId),
            ownerUsername: data.ownerUsername || username || "user",
            ownerPhotoURL: data.ownerPhotoURL ?? photoUrl ?? null,
            title: String(data.title || "Untitled"),
            description: String(data.description || ""),
            type: (data.type || "lesson") as any,
            sourceRef: data.sourceRef || null,
            summaryType: data.summaryType || undefined,
            coverImageUrl: data.coverImageUrl || null,
            visibility: (data.visibility || "friends") as any,
            topics: Array.isArray(data.topics) ? data.topics : [],
            likeCount: Number(data.likeCount || 0),
            dislikeCount: Number(data.dislikeCount || 0),
            commentCount: Number(data.commentCount || 0),
            participantCount: Number(data.participantCount || 0),
            createdAt: data.createdAt,
            lastActivityAt: data.lastActivityAt,
            subject: data.subject || undefined,
            class: data.class || undefined,
          });
        });
        
        // Remove duplicates and sort
        const uniquePosts = allPosts.filter((post, index, self) => 
          index === self.findIndex(p => p.id === post.id)
        ).sort((a, b) => {
          const aTime = a.createdAt?.seconds || 0;
          const bTime = b.createdAt?.seconds || 0;
          return bTime - aTime;
        });
        
        // Store all posts - pagination applied via visiblePosts useMemo
        const lastCursor = uniquePosts.length > 0 ? uniquePosts[uniquePosts.length - 1].createdAt : null;
        const hasMoreFS = uniquePosts.length >= 15;
        setPosts(uniquePosts);
        setDisplayedPostCount(15);
        setLastPostCursor(lastCursor);
        setHasMoreFirestore(hasMoreFS);
        setLoading(false);

        // Write module-level memory cache
        _feedMemCache.set(userId, { posts: uniquePosts, cursor: lastCursor, hasMore: hasMoreFS, ts: Date.now() });
        
        // OPTIMIZED: Cache posts in sessionStorage for next page load
        try {
          // Only cache essential fields to reduce storage size
          const toCache = uniquePosts.slice(0, 50).map(p => ({
            id: p.id, ownerId: p.ownerId, ownerUsername: p.ownerUsername, ownerPhotoURL: p.ownerPhotoURL,
            title: p.title, description: p.description, type: p.type, summaryType: p.summaryType,
            visibility: p.visibility, topics: p.topics, likeCount: p.likeCount, dislikeCount: p.dislikeCount,
            commentCount: p.commentCount, participantCount: p.participantCount, subject: p.subject, class: p.class,
            createdAt: p.createdAt ? { seconds: p.createdAt.seconds } : null
          }));
          sessionStorage.setItem(postsCacheKey, JSON.stringify(toCache));
          sessionStorage.setItem(postsCacheTsKey, String(Date.now()));
        } catch {}
        
        // Background: refresh owner photos from public_profiles mirror.
        // NOTE: do NOT hide posts when the mirror doc is missing - orphaned
        // posts are cleaned up server-side (cleanupOrphanedFeedPosts).
        (async () => {
          try {
            const ownerIds = [...new Set(uniquePosts.map(p => p.ownerId).filter(Boolean))];
            const ownerPhotos: Record<string, string | null> = {};
            
            // OPTIMIZED: Use batchFetchUserProfiles with caching
            const profiles = await batchFetchUserProfiles(ownerIds);
            profiles.forEach((profile, uid) => {
              if (profile.photo_url) ownerPhotos[uid] = profile.photo_url;
            });
            
            // Update posts with fresh photos; keep module cache in sync
            setPosts(prev => {
              const updated = prev
                .map(p => ({ ...p, ownerPhotoURL: ownerPhotos[p.ownerId] || p.ownerPhotoURL || null }));
              const cached = _feedMemCache.get(userId);
              if (cached) _feedMemCache.set(userId, { ...cached, posts: updated });
              return updated;
            });
          } catch {}
        })();
      } catch (error) {
        console.error('Feed loading error:', error);
        setLoading(false);
        toast({
          title: 'Feed unavailable',
          description: 'Failed to load feed. Please try again.',
          variant: 'destructive'
        });
      }
    };
    
    loadPosts();
  }, [userId]);

  // Load more posts when user scrolls (infinite scroll with Firestore pagination)
  const loadMorePosts = useCallback(async () => {
    if (loadingMore) return;
    
    // First, show more already-loaded posts if available
    if (displayedPostCount < posts.length) {
      setDisplayedPostCount(prev => Math.min(prev + 15, posts.length));
      return;
    }
    
    // If we've shown all loaded posts, fetch more from Firestore
    if (!hasMoreFirestore || !lastPostCursor) return;
    
    setLoadingMore(true);
    try {
      const baseRef = collection(db as any, "feed_posts");
      const moreQuery = query(
        baseRef,
        where("visibility", "==", "public"),
        orderBy("createdAt", "desc"),
        startAfter(lastPostCursor),
        limit(15)
      );
      
      const moreSnap = await getDocs(moreQuery);
      const newPosts: FeedPost[] = [];
      
      moreSnap.forEach((d: any) => {
        const data = d.data() as any;
        if (!data.ownerId) return;
        newPosts.push({
          id: d.id,
          ownerId: String(data.ownerId),
          ownerUsername: data.ownerUsername || "user",
          ownerPhotoURL: data.ownerPhotoURL ?? null,
          title: String(data.title || "Untitled"),
          description: String(data.description || ""),
          type: (data.type || "lesson") as any,
          sourceRef: data.sourceRef || null,
          summaryType: data.summaryType || undefined,
          coverImageUrl: data.coverImageUrl || null,
          visibility: (data.visibility || "public") as any,
          topics: Array.isArray(data.topics) ? data.topics : [],
          likeCount: Number(data.likeCount || 0),
          dislikeCount: Number(data.dislikeCount || 0),
          commentCount: Number(data.commentCount || 0),
          participantCount: Number(data.participantCount || 0),
          createdAt: data.createdAt,
          lastActivityAt: data.lastActivityAt,
          subject: data.subject || undefined,
          class: data.class || undefined,
        });
      });
      
      if (newPosts.length > 0) {
        // Append new posts and update cursor
        const newCursor = newPosts[newPosts.length - 1].createdAt;
        const newHasMore = newPosts.length >= 15;
        setPosts(prev => {
          const existingIds = new Set(prev.map(p => p.id));
          const uniqueNew = newPosts.filter(p => !existingIds.has(p.id));
          const combined = [...prev, ...uniqueNew];
          // Keep module cache in sync
          const cached = _feedMemCache.get(userId);
          if (cached) _feedMemCache.set(userId, { ...cached, posts: combined, cursor: newCursor, hasMore: newHasMore });
          return combined;
        });
        setDisplayedPostCount(prev => prev + newPosts.length);
        setLastPostCursor(newCursor);
        setHasMoreFirestore(newHasMore);
      } else {
        setHasMoreFirestore(false);
      }
    } catch (e) {
      console.error('Failed to load more posts:', e);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, displayedPostCount, posts.length, hasMoreFirestore, lastPostCursor]);

  // Reset pagination when tab or filters change
  useEffect(() => {
    setDisplayedPostCount(30);
  }, [filterTab, subjectFilter, classFilter, typeFilter]);

  // Scroll detection for infinite scroll (uses window scroll) - works for all tabs
  useEffect(() => {
    const handleScroll = () => {
      if (loadingMore || !hasMore) return;
      
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      const scrollHeight = document.documentElement.scrollHeight;
      const clientHeight = window.innerHeight;
      
      // Load more when user is within 300px of the bottom
      if (scrollHeight - scrollTop - clientHeight < 300) {
        loadMorePosts();
      }
    };
    
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [loadMorePosts, loadingMore, hasMore]);

  // Load joined challenges posts
  useEffect(() => {
    if (!userId || filterTab !== 'joined-challenges') return;
    
    // OPTIMIZED: Check sessionStorage cache first (valid for 2 minutes)
    const joinedCacheKey = `joined_challenges_posts_${userId}`;
    const joinedCacheTsKey = `joined_challenges_posts_ts_${userId}`;
    try {
      const cached = sessionStorage.getItem(joinedCacheKey);
      const cachedTs = sessionStorage.getItem(joinedCacheTsKey);
      if (cached && cachedTs && Date.now() - parseInt(cachedTs) < 120000) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) {
          setJoinedChallengesPosts(parsed);
          setLoading(false);
          return; // Use cache, skip Firestore reads
        }
      }
    } catch {}
    
    const loadJoinedChallenges = async () => {
      setLoading(true);
      try {
        // OPTIMIZED: Try to use cached runs data from initial load to avoid duplicate read
        const runsCacheKey = `joined_runs_data_${userId}`;
        let joinedPostIds: string[] = [];
        let joinedPostsWithTimestamp: Array<{postId: string, joinedAt: any}> = [];
        
        try {
          const cachedRuns = sessionStorage.getItem(runsCacheKey);
          if (cachedRuns) {
            const parsed = JSON.parse(cachedRuns);
            if (Array.isArray(parsed) && parsed.length > 0) {
              joinedPostIds = parsed.map((r: any) => r.postId).filter(Boolean);
              joinedPostsWithTimestamp = parsed;
            }
          }
        } catch {}
        
        // Only fetch from Firestore if cache is empty
        if (joinedPostIds.length === 0) {
          const userRunsRef = collection(db as any, `users/${userId}/runs`);
          const runsSnap = await getDocs(userRunsRef);
          
          runsSnap.forEach((doc) => {
            const data = doc.data();
            if (data.feedPostId) {
              joinedPostIds.push(data.feedPostId);
              joinedPostsWithTimestamp.push({
                postId: data.feedPostId,
                joinedAt: data.joinedAt
              });
            }
          });
          
          // Update cache
          try { sessionStorage.setItem(runsCacheKey, JSON.stringify(joinedPostsWithTimestamp)); } catch {}
        }

        if (joinedPostIds.length === 0) {
          setJoinedChallengesPosts([]);
          setLoading(false);
          return;
        }

        // Get posts in batched reads (Firestore 'in' queries support up to 10 IDs)
        const uniqueIds = Array.from(new Set(joinedPostIds));
        const joinMap = new Map<string, any>();
        joinedPostsWithTimestamp.forEach(j => { if (j?.postId) joinMap.set(j.postId, j.joinedAt); });

        const postsRef = collection(db as any, "feed_posts");
        const fetched: FeedPost[] = [];
        for (let i = 0; i < uniqueIds.length; i += 10) {
          const batchIds = uniqueIds.slice(i, i + 10);
          const q = query(postsRef as any, where(documentId(), 'in', batchIds));
          const snap = await getDocs(q as any);
          snap.forEach((d: any) => {
            const data = d.data() as any;
            if (!data?.ownerId) return;
            fetched.push({
              id: d.id,
              ownerId: String(data.ownerId),
              ownerUsername: data.ownerUsername || "user",
              ownerPhotoURL: data.ownerPhotoURL ?? null,
              title: String(data.title || "Untitled"),
              description: String(data.description || ""),
              type: (data.type || "lesson") as any,
              sourceRef: data.sourceRef || null,
              summaryType: data.summaryType || undefined,
              coverImageUrl: data.coverImageUrl || null,
              visibility: (data.visibility || "public") as any,
              topics: Array.isArray(data.topics) ? data.topics : [],
              likeCount: Number(data.likeCount || 0),
              dislikeCount: Number(data.dislikeCount || 0),
              commentCount: Number(data.commentCount || 0),
              participantCount: Number(data.participantCount || 0),
              createdAt: data.createdAt,
              lastActivityAt: data.lastActivityAt,
              subject: data.subject || undefined,
              class: data.class || undefined,
            } as FeedPost);
          });
        }

        const validPosts = fetched;
        
        // OPTIMIZED: Use cached friends list instead of reading again
        const friendIdsSet = new Set<string>(cachedFriendIds);
        
        const visiblePosts = validPosts.filter(post => {
          // User can always see their own posts
          if (post.ownerId === userId) return true;
          
          // Everyone can see and participate in public posts - no friend requirement
          if (post.visibility === "public") return true;
          
          // Only friends can see private posts
          if (post.visibility === "friends" && friendIdsSet.has(post.ownerId)) return true;
          
          return false;
        });
        
        // Sort by join date (most recent first)
        const sortedPosts = visiblePosts.sort((a, b) => {
          const aJoinedAt = joinMap.get(a.id);
          const bJoinedAt = joinMap.get(b.id);
          if (!aJoinedAt || !bJoinedAt) return 0;
          return bJoinedAt.seconds - aJoinedAt.seconds;
        });
        
        setJoinedChallengesPosts(sortedPosts);
        
        // OPTIMIZED: Cache for next load
        try {
          const toCache = sortedPosts.slice(0, 30).map(p => ({
            id: p.id, ownerId: p.ownerId, ownerUsername: p.ownerUsername, ownerPhotoURL: p.ownerPhotoURL,
            title: p.title, description: p.description, type: p.type, summaryType: p.summaryType,
            visibility: p.visibility, topics: p.topics, likeCount: p.likeCount, dislikeCount: p.dislikeCount,
            commentCount: p.commentCount, participantCount: p.participantCount, subject: p.subject, class: p.class,
            createdAt: p.createdAt ? { seconds: p.createdAt.seconds } : null
          }));
          sessionStorage.setItem(joinedCacheKey, JSON.stringify(toCache));
          sessionStorage.setItem(joinedCacheTsKey, String(Date.now()));
        } catch {}
      } catch (error) {
        console.error('Failed to load joined challenges:', error);
        toast({
          title: 'Failed to load joined challenges',
          description: 'Please try again.',
          variant: 'destructive'
        });
      } finally {
        setLoading(false);
      }
    };

    loadJoinedChallenges();
  }, [userId, filterTab]);

  // Load user groups
  useEffect(() => {
    if (!userId) return;
    
    // OPTIMIZED: Check sessionStorage cache first (valid for 5 minutes)
    const groupsCacheKey = `user_groups_${userId}`;
    const groupsCacheTsKey = `user_groups_ts_${userId}`;
    try {
      const cached = sessionStorage.getItem(groupsCacheKey);
      const cachedTs = sessionStorage.getItem(groupsCacheTsKey);
      if (cached && cachedTs && Date.now() - parseInt(cachedTs) < 300000) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) {
          setUserGroups(parsed);
          return; // Use cache, skip Firestore reads
        }
      }
    } catch {}
    
    const loadUserGroups = async () => {
      try {
        const userGroupsRef = collection(db as any, "users", userId, "groups");
        const userGroupsSnap = await getDocs(userGroupsRef);
        const groupIds: string[] = [];
        
        userGroupsSnap.forEach((doc) => {
          const data = doc.data();
          if (data.groupId) {
            groupIds.push(data.groupId);
          }
        });

        if (groupIds.length === 0) {
          setUserGroups([]);
          return;
        }

        // Get the actual group data in batches (reduce N getDoc -> N/10 getDocs)
        const groupsRef = collection(db as any, "groups");
        const byId = new Map<string, any>();
        for (let i = 0; i < groupIds.length; i += 10) {
          const batchIds = groupIds.slice(i, i + 10);
          const q = query(groupsRef as any, where(documentId(), 'in', batchIds));
          const snap = await getDocs(q as any);
          snap.forEach((d: any) => byId.set(d.id, { id: d.id, ...(d.data() as any) }));
        }

        // Preserve original order from user's groups list
        const ordered = groupIds.map(id => byId.get(id)).filter(Boolean);
        setUserGroups(ordered);
        
        // OPTIMIZED: Cache for next load
        try {
          sessionStorage.setItem(groupsCacheKey, JSON.stringify(ordered));
          sessionStorage.setItem(groupsCacheTsKey, String(Date.now()));
        } catch {}
      } catch (error) {
        console.error('Failed to load user groups:', error);
      }
    };

    loadUserGroups();
  }, [userId]);

  // Load group posts
  useEffect(() => {
    if (!userId || filterTab !== 'groups') return;
    
    const loadGroupPosts = async () => {
      setLoading(true);
      try {
        const baseRef = collection(db as any, "feed_posts");
        const allGroupPosts: FeedPost[] = [];

        if (selectedGroup) {
          // Load posts for specific group
          const groupQuery = query(
            baseRef,
            where("visibility", "==", "group"),
            where("groupId", "==", selectedGroup)
          );
          
          const groupSnap = await getDocs(groupQuery);
          groupSnap.forEach((d: any) => {
            const data = d.data() as any;
            if (!data.ownerId) return;
            allGroupPosts.push({
              id: d.id,
              ownerId: String(data.ownerId),
              ownerUsername: data.ownerUsername || "user",
              ownerPhotoURL: data.ownerPhotoURL ?? null,
              title: String(data.title || "Untitled"),
              description: String(data.description || ""),
              type: (data.type || "lesson") as any,
              sourceRef: data.sourceRef || null,
              summaryType: data.summaryType || undefined,
              coverImageUrl: data.coverImageUrl || null,
              visibility: (data.visibility || "group") as any,
              topics: Array.isArray(data.topics) ? data.topics : [],
              likeCount: Number(data.likeCount || 0),
              dislikeCount: Number(data.dislikeCount || 0),
              commentCount: Number(data.commentCount || 0),
              participantCount: Number(data.participantCount || 0),
              createdAt: data.createdAt,
              lastActivityAt: data.lastActivityAt,
              subject: data.subject || undefined,
              class: data.class || undefined,
            });
          });
        } else {
          // Load posts from all user's groups
          const groups = Array.isArray(userGroups) ? userGroups : [];
          const groupIds = groups.map((g: any) => g?.id).filter(Boolean);
          const chunkSize = 5;
          for (let i = 0; i < groupIds.length; i += chunkSize) {
            const chunk = groupIds.slice(i, i + chunkSize);
            const snaps = await Promise.all(
              chunk.map((groupId: string) => {
                const groupQuery = query(
                  baseRef,
                  where("visibility", "==", "group"),
                  where("groupId", "==", groupId)
                );
                return getDocs(groupQuery);
              })
            );

            snaps.forEach((groupSnap: any) => {
              groupSnap.forEach((d: any) => {
                const data = d.data() as any;
                if (!data.ownerId) return;
                allGroupPosts.push({
                  id: d.id,
                  ownerId: String(data.ownerId),
                  ownerUsername: data.ownerUsername || "user",
                  ownerPhotoURL: data.ownerPhotoURL ?? null,
                  title: String(data.title || "Untitled"),
                  description: String(data.description || ""),
                  type: (data.type || "lesson") as any,
                  sourceRef: data.sourceRef || null,
                  summaryType: data.summaryType || undefined,
                  coverImageUrl: data.coverImageUrl || null,
                  visibility: (data.visibility || "group") as any,
                  topics: Array.isArray(data.topics) ? data.topics : [],
                  likeCount: Number(data.likeCount || 0),
                  dislikeCount: Number(data.dislikeCount || 0),
                  commentCount: Number(data.commentCount || 0),
                  participantCount: Number(data.participantCount || 0),
                  createdAt: data.createdAt,
                  lastActivityAt: data.lastActivityAt,
                  subject: data.subject || undefined,
                  class: data.class || undefined,
                });
              });
            });
          }
        }

        // Sort by creation time and remove duplicates
        const uniquePosts = allGroupPosts.filter((post, index, self) => 
          index === self.findIndex(p => p.id === post.id)
        ).sort((a, b) => {
          const aTime = a.createdAt?.seconds || 0;
          const bTime = b.createdAt?.seconds || 0;
          return bTime - aTime;
        });

        setGroupPosts(uniquePosts);
      } catch (error) {
        console.error('Failed to load group posts:', error);
        toast({
          title: 'Failed to load group posts',
          description: 'Please try again.',
          variant: 'destructive'
        });
      } finally {
        setLoading(false);
      }
    };

    loadGroupPosts();
  }, [userId, filterTab, selectedGroup, userGroups]);

  // Load basic lists of user's lessons, quizzes, and flashcards for the Feed picker
  useEffect(() => {
    if (!userId || !pickerOpen) return;
    let cancelled = false;
    
    // OPTIMIZED: Check sessionStorage cache first (valid for 3 minutes)
    const materialsCacheKey = `user_materials_${userId}`;
    const materialsCacheTsKey = `user_materials_ts_${userId}`;
    try {
      const cached = sessionStorage.getItem(materialsCacheKey);
      const cachedTs = sessionStorage.getItem(materialsCacheTsKey);
      if (cached && cachedTs && Date.now() - parseInt(cachedTs) < 180000) {
        const parsed = JSON.parse(cached);
        if (parsed.lessons) setLessons(parsed.lessons);
        if (parsed.quizzes) setQuizzes(parsed.quizzes);
        if (parsed.flashcards) setFlashcards(parsed.flashcards);
        if (parsed.summaries) setSummaries(parsed.summaries);
        setLoadingPicker(false);
        return; // Use cache, skip Firestore reads
      }
    } catch {}
    
    const run = async () => {
      try {
        setLoadingPicker(true);
        const lessonsRef = collection(db as any, 'users', userId, 'lessons');
        const quizzesRef = collection(db as any, 'users', userId, 'quizzes');
        const setsRef = collection(db as any, 'users', userId, 'flashcard_sets');
        const summariesRef = collection(db as any, 'users', userId, 'summaries');

        // OPTIMIZED: Limit all queries to 20 to reduce reads
        const [lessonsSnap, quizzesSnap, setsSnap, summariesSnap] = await Promise.all([
          getDocs(query(lessonsRef as any, limit(20))),
          getDocs(query(quizzesRef as any, limit(20))),
          getDocs(query(setsRef as any, limit(20))),
          getDocs(query(summariesRef as any, limit(20))),
        ]);

        if (cancelled) return;

        const lessonsList = lessonsSnap.docs.map((d: any) => {
          const data = d.data() as any;
          return {
            id: d.id,
            title: data.title || 'Untitled Lesson',
            goals: data.goals || '',
            created_at: data.created_at || data.createdAt || { seconds: 0 }
          };
        });
        lessonsList.sort((a, b) => {
          const aTime = a.created_at?.seconds || a.created_at?.toMillis?.() / 1000 || 0;
          const bTime = b.created_at?.seconds || b.created_at?.toMillis?.() / 1000 || 0;
          return bTime - aTime;
        });
        setLessons(lessonsList);

        const quizzesList = quizzesSnap.docs.map((d: any) => {
          const data = d.data() as any;
          return {
            id: d.id,
            title: data.title || 'Untitled Quiz',
            questionCount: data.questionCount || (data.questions?.length || 0),
            created_at: data.created_at || data.createdAt || { seconds: 0 }
          };
        });
        quizzesList.sort((a, b) => {
          const aTime = a.created_at?.seconds || a.created_at?.toMillis?.() / 1000 || 0;
          const bTime = b.created_at?.seconds || b.created_at?.toMillis?.() / 1000 || 0;
          return bTime - aTime;
        });
        setQuizzes(quizzesList);

        const flashcardsList = setsSnap.docs.map((d: any) => {
          const data = d.data() as any;
          const cards = Array.isArray(data.flashcards) ? data.flashcards.length : (data.total_count || 0);
          return {
            id: d.id,
            title: data.title || 'Untitled Flashcards',
            cardCount: cards,
            created_at: data.created_at || data.createdAt || { seconds: 0 }
          };
        });
        flashcardsList.sort((a, b) => {
          const aTime = a.created_at?.seconds || a.created_at?.toMillis?.() / 1000 || 0;
          const bTime = b.created_at?.seconds || b.created_at?.toMillis?.() / 1000 || 0;
          return bTime - aTime;
        });
        setFlashcards(flashcardsList);

        const summariesList = summariesSnap.docs.map((d: any) => {
          const data = d.data() as any;
          return {
            id: d.id,
            title: data.title || 'Untitled Summary',
            summary_type: data.summary_type || 'brief',
            word_count: data.word_count || 0,
            summary_text: data.summary_text || '',
            created_at: data.created_at || data.createdAt || { seconds: 0 }
          };
        });
        summariesList.sort((a, b) => {
          const aTime = a.created_at?.seconds || a.created_at?.toMillis?.() / 1000 || 0;
          const bTime = b.created_at?.seconds || b.created_at?.toMillis?.() / 1000 || 0;
          return bTime - aTime;
        });
        setSummaries(summariesList);
        
        // OPTIMIZED: Cache materials for next picker open
        try {
          sessionStorage.setItem(materialsCacheKey, JSON.stringify({
            lessons: lessonsList, quizzes: quizzesList, flashcards: flashcardsList, summaries: summariesList
          }));
          sessionStorage.setItem(materialsCacheTsKey, String(Date.now()));
        } catch {}
      } catch (e) {
        console.error("Error loading content picker data:", e);
        if (!cancelled) {
          setLessons([]); setQuizzes([]); setFlashcards([]); setSummaries([]);
        }
      } finally {
        if (!cancelled) setLoadingPicker(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [userId, pickerOpen]);

  useEffect(() => {
    if (!commentDialogPost) return;
    const ref = collection(db as any, "feed_posts", commentDialogPost.id, "comments");
    const q = query(ref, orderBy("createdAt", "asc"), limit(100));
    const unsub = onSnapshot(q as any, (snap: QuerySnapshot<DocumentData>) => {
      const list: any[] = [];
      snap.forEach((d: any) => {
        const data = d.data() as any;
        list.push({
          id: d.id,
          userId: String(data.userId || ""),
          username: data.username,
          userPhotoURL: data.userPhotoURL ?? null,
          text: String(data.text || ""),
          createdAt: data.createdAt,
        });
      });
      setComments(list);
    });
    return () => unsub();
  }, [commentDialogPost?.id]);

  // Memoize post IDs to avoid infinite loop
  const postIds = useMemo(() => {
    const ids = new Set<string>();
    [...posts, ...joinedChallengesPosts, ...groupPosts].forEach(p => ids.add(p.id));
    return Array.from(ids).sort().join(',');
  }, [posts, joinedChallengesPosts, groupPosts]);

  // Load this user's reactions across posts to style icons (with cache, only load uncached)
  useEffect(() => {
    if (!userId || !postIds) return;
    const ids = postIds.split(',').filter(Boolean);
    if (ids.length === 0) return;
    
    const cacheKey = `user_reactions_${userId}`;
    let cachedReactions: Record<string, 'like' | 'dislike'> = {};
    
    // Try cache first for instant display
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && typeof parsed === 'object') {
          cachedReactions = parsed;
          setUserReactions(parsed);
        }
      }
    } catch {}
    
    // OPTIMIZED: Only load reactions for posts NOT in cache (reduces reads significantly)
    const uncachedIds = ids.filter(id => !(id in cachedReactions));
    if (uncachedIds.length === 0) return; // All cached, no reads needed
    
    // Limit to first 5 uncached posts to reduce Firestore reads
    const idsToLoad = uncachedIds.slice(0, 5);
    
    const loadReactions = async () => {
      try {
        const entries: Array<[string, 'like' | 'dislike']> = [];
        await Promise.all(idsToLoad.map(async (postId) => {
          try {
            const rRef = doc(db as any, 'feed_posts', postId, 'reactions', userId);
            const rSnap = await getDoc(rRef as any);
            if (rSnap.exists()) {
              const t = (rSnap.data() as any)?.type;
              if (t === 'like' || t === 'dislike') entries.push([postId, t]);
            }
          } catch {}
        }));
        const map: Record<string, 'like' | 'dislike'> = {};
        entries.forEach(([pid, t]) => { map[pid] = t; });
        setUserReactions(prev => {
          const merged = { ...prev, ...map };
          // Cache merged reactions
          try { localStorage.setItem(cacheKey, JSON.stringify(merged)); } catch {}
          return merged;
        });
      } catch {}
    };
    loadReactions();
  }, [userId, postIds]);

  // NOTE: Count hydration removed - posts already store likeCount, dislikeCount, commentCount
  // This saves 3 reads per post (was causing excessive Firestore usage)

  // Instagram-style algorithm: score posts based on engagement, recency, and relevance
  // Returns all filtered/sorted posts (pagination applied separately)
  const allFilteredPosts = useMemo(() => {
    let list = filterTab === 'joined-challenges' ? [...joinedChallengesPosts] :
               filterTab === 'groups' ? [...groupPosts] : [...posts];

    // Audio transcription was removed - hide legacy transcript posts
    list = list.filter(p => !(p.type === 'summary' && (p.summaryType === 'transcript'
      || (p.description && (p.description.toLowerCase().includes('transcript') || p.description.toLowerCase().includes('audio'))))));

    // Apply manual filters first
    if (subjectFilter && subjectFilter !== 'all') {
      list = list.filter(p => (p.subject || "") === subjectFilter);
    }
    if (classFilter && classFilter !== 'all') {
      list = list.filter(p => (p.class || "") === classFilter);
    }
    if (typeFilter && typeFilter !== 'all') {
      list = list.filter(p => p.type === typeFilter);
    }
    
    // Filter by tab type
    if (filterTab === 'my-posts') {
      list = list.filter(p => p.ownerId === userId);
    } else if (filterTab === 'joined-challenges' || filterTab === 'groups') {
      // For joined challenges and groups, the list is already filtered, just return as is
      return list;
    }
    
    // Apply algorithm-based scoring and sorting
    if (filterTab === 'for-you') {
      // Score each post based on multiple factors
      const scoredPosts = list.map(post => {
        const now = Date.now();
        const postTime = post.createdAt?.seconds ? post.createdAt.seconds * 1000 : (post.createdAt instanceof Date ? post.createdAt.getTime() : now);
        const ageHours = (now - postTime) / (1000 * 60 * 60);
        
        // Engagement score (likes, comments, participation)
        const engagementScore = (
          (post.likeCount * 3) + 
          (post.commentCount * 5) + 
          (post.participantCount * 10) - 
          (post.dislikeCount * 2)
        );
        
        // Recency score (newer posts get higher scores, but not too heavily weighted)
        const recencyScore = Math.max(0, 100 - (ageHours * 2));
        
        // Content type preference (quizzes and interactive content score higher)
        const typeScore = post.type === 'quiz' ? 20 : post.type === 'flashcards' ? 15 : 10;
        
        // Subject relevance (could be enhanced with user's past activity)
        const subjectScore = 5; // Base score, could be personalized later
        
        // Avoid showing very old posts unless they have high engagement
        const agePenalty = ageHours > 168 ? -50 : 0; // 1 week penalty
        
        // Final weighted score
        const totalScore = (
          engagementScore * 0.4 +
          recencyScore * 0.3 +
          typeScore * 0.2 +
          subjectScore * 0.1
        ) + agePenalty;
        
        return { ...post, algorithmScore: totalScore };
      });
      
      // Sort by algorithm score (highest first)
      return scoredPosts.sort((a, b) => b.algorithmScore - a.algorithmScore);
    } else {
      // 'latest' tab: simple chronological order
      return list.sort((a, b) => {
        const getTime = (t: any) => t?.seconds || (t instanceof Date ? t.getTime() / 1000 : 0);
        const aTime = getTime(a.createdAt);
        const bTime = getTime(b.createdAt);
        return bTime - aTime;
      });
    }
  }, [posts, joinedChallengesPosts, groupPosts, subjectFilter, classFilter, typeFilter, filterTab, userId]);

  // Apply pagination - show only displayedPostCount posts (infinite scroll loads more)
  const visiblePosts = useMemo(() => {
    return allFilteredPosts.slice(0, displayedPostCount);
  }, [allFilteredPosts, displayedPostCount]);

  // Update hasMore when filtered posts change (account for both loaded posts and Firestore availability)
  useEffect(() => {
    const hasMoreLoaded = displayedPostCount < allFilteredPosts.length;
    const hasMoreToFetch = filterTab === 'for-you' && hasMoreFirestore;
    setHasMore(hasMoreLoaded || hasMoreToFetch);
  }, [allFilteredPosts.length, displayedPostCount, hasMoreFirestore, filterTab]);

  const toggleReaction = async (post: FeedPost, type: "like" | "dislike") => {
    if (!userId) return;
    const prevReaction = userReactions[post.id] as ('like' | 'dislike' | undefined);
    // Compute optimistic deltas
    let deltaLike = 0, deltaDislike = 0;
    if (!prevReaction) {
      deltaLike = type === 'like' ? 1 : 0;
      deltaDislike = type === 'dislike' ? 1 : 0;
    } else if (prevReaction === type) {
      deltaLike = type === 'like' ? -1 : 0;
      deltaDislike = type === 'dislike' ? -1 : 0;
    } else {
      // switching
      deltaLike = type === 'like' ? 1 : -1;
      deltaDislike = type === 'dislike' ? 1 : -1;
    }
    // Apply optimistic UI
    applyPostCounterDeltas(post.id, deltaLike, deltaDislike);
    setUserReactions(prev => {
      const copy = { ...prev };
      if (!prevReaction) copy[post.id] = type; else if (prevReaction === type) delete copy[post.id]; else copy[post.id] = type;
      return copy;
    });
    try {
      const reactionRef = doc(db as any, "feed_posts", post.id, "reactions", userId);
      const postRef = doc(db as any, "feed_posts", post.id);
      let shouldNotify: null | 'like' | 'dislike' = null;

      const snap = await getDoc(reactionRef);
      const batch = writeBatch(db as any);
      const now = serverTimestamp();

      if (!snap.exists()) {
        batch.set(reactionRef, { type, createdAt: now });
        batch.update(postRef, {
          likeCount: type === 'like' ? increment(1) : increment(0),
          dislikeCount: type === 'dislike' ? increment(1) : increment(0),
          lastActivityAt: now,
        } as any);
        shouldNotify = type;
      } else {
        const cur = (snap.data() as any)?.type as ('like'|'dislike'|undefined);
        if (cur === type) {
          batch.delete(reactionRef);
          const field = type === 'like' ? 'likeCount' : 'dislikeCount';
          batch.update(postRef, { [field]: increment(-1), lastActivityAt: now } as any);
        } else {
          batch.set(reactionRef, { type, createdAt: now }, { merge: true });
          batch.update(postRef, {
            likeCount: type === 'like' ? increment(1) : increment(-1),
            dislikeCount: type === 'dislike' ? increment(1) : increment(-1),
            lastActivityAt: now,
          } as any);
        }
      }

      await batch.commit();

      if (shouldNotify === 'like') {
        await sendPostLikeNotification(post.ownerId, userId, username || "user", photoUrl || undefined, post.title, post.id);
      } else if (shouldNotify === 'dislike') {
        await sendPostDislikeNotification(post.ownerId, userId, username || "user", photoUrl || undefined, post.title, post.id);
      }
    } catch (e: any) {
      console.error('toggleReaction failed:', e);
      toast({ title: 'Failed to react', description: e?.message || 'Please try again.', variant: 'destructive' });
      // Revert optimistic UI
      applyPostCounterDeltas(post.id, -deltaLike, -deltaDislike);
      setUserReactions(prev => {
        const copy = { ...prev };
        if (prevReaction) copy[post.id] = prevReaction; else delete copy[post.id];
        return copy;
      });
    }
  };

  const applyPostCounterDeltas = (postId: string, deltaLike: number, deltaDislike: number) => {
    const apply = (arr: FeedPost[]) => arr.map(p => p.id === postId ? { ...p, likeCount: Math.max(0, (p.likeCount || 0) + deltaLike), dislikeCount: Math.max(0, (p.dislikeCount || 0) + deltaDislike) } : p);
    setPosts(prev => apply(prev));
    setJoinedChallengesPosts(prev => apply(prev));
    setGroupPosts(prev => apply(prev));
  };

  const applyPostCommentDelta = (postId: string, delta: number) => {
    const clamp = (n: number) => Math.max(0, n);
    const apply = (arr: FeedPost[]) => arr.map(p => p.id === postId ? { ...p, commentCount: clamp((p.commentCount || 0) + delta) } : p);
    setPosts(prev => apply(prev));
    setJoinedChallengesPosts(prev => apply(prev));
    setGroupPosts(prev => apply(prev));
  };

  const openComments = (post: FeedPost) => {
    setCommentDialogPost(post);
    setNewComment("");
  };

  const submitComment = async () => {
    if (!userId || !commentDialogPost) return;
    const text = newComment.trim();
    if (!text) return;
    // Optimistic UI: increment count immediately
    applyPostCommentDelta(commentDialogPost.id, +1);
    try {
      const commentsCol = collection(db as any, "feed_posts", commentDialogPost.id, "comments");
      const newRef = doc(commentsCol as any);
      const postRef = doc(db as any, "feed_posts", commentDialogPost.id);
      const batch = writeBatch(db as any);
      batch.set(newRef as any, {
        userId,
        username: username || "user",
        userPhotoURL: photoUrl || null,
        text,
        createdAt: serverTimestamp(),
      });
      batch.update(postRef as any, {
        commentCount: increment(1),
        lastActivityAt: serverTimestamp(),
      } as any);
      await batch.commit();
      
      // Send notification to post owner
      await sendPostCommentNotification(
        commentDialogPost.ownerId,
        userId,
        username || "user",
        photoUrl || undefined,
        commentDialogPost.title,
        commentDialogPost.id,
        text
      );
      
      setNewComment("");
    } catch {
      toast({ title: "Failed to comment", description: "Please try again.", variant: "destructive" });
      // Revert optimistic
      applyPostCommentDelta(commentDialogPost.id, -1);
    }
  };

  const startEditComment = (c: { id: string; text: string; userId: string }) => {
    setEditingCommentId(c.id);
    setEditingCommentText(c.text);
  };

  const cancelEditComment = () => {
    setEditingCommentId(null);
    setEditingCommentText("");
  };

  const saveEditComment = async () => {
    if (!userId || !commentDialogPost || !editingCommentId) return;
    const text = editingCommentText.trim();
    if (!text) { cancelEditComment(); return; }
    try {
      const ref = doc(db as any, "feed_posts", commentDialogPost.id, "comments", editingCommentId);
      await updateDoc(ref as any, { text });
      setComments(prev => prev.map(c => c.id === editingCommentId ? { ...c, text } : c));
      cancelEditComment();
    } catch {
      toast({ title: "Failed to edit comment", description: "Please try again.", variant: "destructive" });
    }
  };

  const joinChallenge = async (post: FeedPost, isRedo = false) => {
    if (!userId) return;
    try {
      setJoining(true);
      setFunFactIndex(Math.floor(Math.random() * funFacts.length));

      const runRef = doc(db as any, "feed_posts", post.id, "runs", userId);
      const postRef = doc(db as any, "feed_posts", post.id);
      const userRunRef = doc(db as any, "users", userId, "runs", post.id);

      let firstJoin = false;
      let attempts = 1;

      await runTransaction(db as any, async (tx) => {
        const runSnap = await tx.get(runRef as any);
        const prevAttempts = runSnap.exists() ? Number((runSnap.data() as any)?.attempts || 0) : 0;
        attempts = prevAttempts + 1;
        firstJoin = !runSnap.exists();

        const joinedAt = runSnap.exists() ? (runSnap.data() as any)?.joinedAt : serverTimestamp();
        const lastAttemptAt = serverTimestamp();

        tx.set(runRef as any, {
          userId,
          username: username || "user",
          userPhotoURL: photoUrl || null,
          joinedAt,
          lastAttemptAt,
          status: "joined",
          type: post.type,
          attempts,
          feedPostId: post.id,
          score: null,
          completedAt: null,
        }, { merge: true });

        if (firstJoin) {
          tx.update(postRef as any, {
            participantCount: increment(1),
            lastActivityAt: serverTimestamp(),
          } as any);
        }

        tx.set(userRunRef as any, {
          feedPostId: post.id,
          postTitle: post.title,
          postType: post.type,
          joinedAt,
          lastAttemptAt,
          attempts,
          status: "joined",
        }, { merge: true });
      });

      if (firstJoin) {
        setJoinedChallenges(prev => {
          const next = new Set(prev);
          next.add(post.id);
          try { localStorage.setItem(`joined_challenges_${userId}`, JSON.stringify([...next])); } catch {}
          return next;
        });
        setPosts(prev => prev.map(p => p.id === post.id ? { ...p, participantCount: (p.participantCount || 0) + 1 } : p));

        try {
          await incrementCounterAndAwardOn(userId, 'challenges_joined', [
            [1, 'first_challenge_join'],
            [50, 'challenges_50'],
            [100, 'challenges_100'],
            [1000, 'challenges_1000'],
          ]);
        } catch {}
      }

      if (isRedo || firstJoin) {
        try {
          await incrementMonthlyUsage(userId, { inputChars: 1 });
        } catch (e: any) {
          console.warn('Could not increment usage:', e);
        }
      }

      toast({
        title: firstJoin ? "Joined" : "Joined again",
        description: "You can now work on this challenge from the original tool (quiz, flashcards, or lesson).",
      });
    } catch {
      toast({ title: "Failed to join", description: "Please try again.", variant: "destructive" });
    } finally {
      setJoining(false);
    }
  };

  const loadLeaderboard = async (post: FeedPost) => {
    try {
      // OPTIMIZED: Check sessionStorage cache first (valid for 1 minute)
      const lbCacheKey = `leaderboard_${post.id}`;
      const lbCacheTsKey = `leaderboard_ts_${post.id}`;
      try {
        const cached = sessionStorage.getItem(lbCacheKey);
        const cachedTs = sessionStorage.getItem(lbCacheTsKey);
        if (cached && cachedTs && Date.now() - parseInt(cachedTs) < 60000) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed)) {
            setLeaderboardData(parsed);
            setSelectedChallenge(post);
            setLeaderboardOpen(true);
            return; // Use cache
          }
        }
      } catch {}
      
      const runsRef = collection(db as any, "feed_posts", post.id, "runs");
      // Limit to top 100 runs to prevent excessive reads
      const runsQuery = query(runsRef, limit(100));
      const runsSnap = await getDocs(runsQuery);
      const runs: any[] = [];
      
      runsSnap.forEach((doc) => {
        const data = doc.data();
        // Show all completed runs, including 0% scores
        if (data.completedAt && data.score !== undefined) {
          runs.push({
            userId: doc.id,
            username: data.username || "Anonymous",
            userPhotoURL: data.userPhotoURL,
            score: data.score ?? 0,
            attempts: data.attempts || 1,
            completedAt: data.completedAt,
            joinedAt: data.joinedAt
          });
        }
      });
      
      // Sort by score (descending), then by attempts (ascending), then by completion time (ascending)
      runs.sort((a, b) => {
        if (a.score !== b.score) return b.score - a.score;
        if (a.attempts !== b.attempts) return a.attempts - b.attempts;
        return a.completedAt?.seconds - b.completedAt?.seconds;
      });
      
      // OPTIMIZED: Cache leaderboard
      try {
        sessionStorage.setItem(lbCacheKey, JSON.stringify(runs));
        sessionStorage.setItem(lbCacheTsKey, String(Date.now()));
      } catch {}
      
      setLeaderboardData(runs);
      setSelectedChallenge(post);
      setLeaderboardOpen(true);
    } catch (error) {
      toast({ title: "Failed to load leaderboard", description: "Please try again.", variant: "destructive" });
    }
  };

  const handleChallengeClick = async (post: FeedPost) => {
    // Prevent double-clicks while loading
    if (openingChallengeId) return;
    
    setOpeningChallengeId(post.id);
    
    try {
      // Open the challenge popup for the interactive experience
      setSelectedChallengeForPopup(post);
      setChallengePopupOpen(true);
      
      // Join the challenge automatically if not already joined
      // Usage is tracked inside joinChallenge - no duplicate needed here
      if (!joinedChallenges.has(post.id)) {
        await joinChallenge(post);
      }
    } finally {
      setOpeningChallengeId(null);
    }
  };

  const handleSaveToLibrary = async (content: any, originalCreator: string) => {
    if (!userId || !selectedChallengeForPopup) return;
    
    try {
      // Use correct collection names - flashcard_sets for flashcards
      const collectionName = selectedChallengeForPopup.type === "flashcards" ? "flashcard_sets" : 
                           selectedChallengeForPopup.type === "quiz" ? "quizzes" : 
                           selectedChallengeForPopup.type === "lesson" ? "lessons" : "summaries";
      
      const docRef = doc(collection(db as any, "users", userId, collectionName));
      
      // For flashcards, we need to save cards to a subcollection
      if (selectedChallengeForPopup.type === "flashcards" && content.flashcards?.length > 0) {
        const flashcardsToSave = content.flashcards;
        // Remove flashcards array from parent doc - they go in subcollection
        const { flashcards: _, ...parentData } = content;
        
        await setDoc(docRef as any, {
          ...parentData,
          title: content.title || parentData.title || selectedChallengeForPopup.title || "Saved Flashcards",
          description: content.description || parentData.description || "",
          createdBy: originalCreator,
          originalCreator: originalCreator,
          created_at: serverTimestamp(),
          savedAt: serverTimestamp(),
          savedFrom: "feed",
          feedPostId: selectedChallengeForPopup.id,
          total_count: flashcardsToSave.length,
          mastered_count: 0,
          mastered_ids: []
        });
        
        // Save each flashcard to subcollection
        const flashcardsRef = collection(docRef, "flashcards");
        for (const card of flashcardsToSave) {
          const cardDoc = doc(flashcardsRef);
          await setDoc(cardDoc as any, {
            question: card.question || card.front || "",
            answer: card.answer || card.back || "",
            created_at: serverTimestamp()
          });
        }
      } else if (selectedChallengeForPopup.type === "quiz") {
        // Quiz needs title and questions array with all question data
        const questions = content.questions || [];
        await setDoc(docRef as any, {
          ...content,
          title: content.title || selectedChallengeForPopup.title || "Saved Quiz",
          description: content.description || selectedChallengeForPopup.description || "",
          questions: questions,
          questionCount: questions.length,
          mode: content.mode || (questions.some((q: any) => q?.question_type === 'short_answer' || !q?.options) ? 'short' : 'mcq'),
          best_score: 0,
          best_total: questions.length,
          createdBy: originalCreator,
          originalCreator: originalCreator,
          created_at: serverTimestamp(),
          savedAt: serverTimestamp(),
          savedFrom: "feed",
          feedPostId: selectedChallengeForPopup.id
        });
      } else if (selectedChallengeForPopup.type === "summary") {
        // Summary needs title, summary_text, summary_type, original_text
        await setDoc(docRef as any, {
          ...content,
          title: content.title || selectedChallengeForPopup.title || "Saved Summary",
          summary_text: content.summary_text || content.text || content.summary || "",
          summary_type: content.summary_type || content.summaryType || selectedChallengeForPopup.summaryType || "brief",
          original_text: content.original_text || content.originalText || "",
          word_count: content.word_count || 0,
          reading_time: content.reading_time || 0,
          createdBy: originalCreator,
          originalCreator: originalCreator,
          created_at: serverTimestamp(),
          savedAt: serverTimestamp(),
          savedFrom: "feed",
          feedPostId: selectedChallengeForPopup.id
        });
      } else if (selectedChallengeForPopup.type === "lesson") {
        // Lesson needs title and sections with all content
        const sections = content.sections || [];
        await setDoc(docRef as any, {
          ...content,
          title: content.title || selectedChallengeForPopup.title || "Saved Lesson",
          description: content.description || selectedChallengeForPopup.description || "",
          sections: sections,
          topic: content.topic || selectedChallengeForPopup.title || "",
          createdBy: originalCreator,
          originalCreator: originalCreator,
          created_at: serverTimestamp(),
          savedAt: serverTimestamp(),
          savedFrom: "feed",
          feedPostId: selectedChallengeForPopup.id
        });
      } else {
        // Default fallback for any other type
        await setDoc(docRef as any, {
          ...content,
          title: content.title || selectedChallengeForPopup.title || "Saved Content",
          createdBy: originalCreator,
          originalCreator: originalCreator,
          created_at: serverTimestamp(),
          savedAt: serverTimestamp(),
          savedFrom: "feed",
          feedPostId: selectedChallengeForPopup.id
        });
      }
      
      toast({
        title: "Saved successfully",
        description: `${selectedChallengeForPopup.type} saved to your library (created by @${originalCreator})`
      });
      
      // Trigger appropriate library refresh based on content type
      switch (selectedChallengeForPopup.type) {
        case "quiz":
          onQuizSaved?.();
          break;
        case "flashcards":
          onFlashcardsSaved?.();
          break;
        case "lesson":
          onSummarySaved?.();
          break;
        default:
          // For other types like study plans, use the summary callback as fallback
          onSummarySaved?.();
          break;
      }
    } catch (error) {
      toast({
        title: "Failed to save",
        description: "Could not save to your library.",
        variant: "destructive"
      });
    }
  };

  const handleScoreUpdate = async (score: number, attempts: number) => {
    // This function is called when a user completes a challenge
    // Refresh the leaderboard if it's currently open
    console.log(`Challenge completed with score: ${score}%, attempts: ${attempts}`);
    
    if (leaderboardOpen && selectedChallenge) {
      // Refresh the leaderboard data immediately and multiple times
      loadLeaderboard(selectedChallenge); // Immediate refresh
      setTimeout(() => {
        loadLeaderboard(selectedChallenge);
        console.log("StudyFeed leaderboard refreshed after 300ms");
      }, 300);
      setTimeout(() => {
        loadLeaderboard(selectedChallenge);
        console.log("StudyFeed leaderboard refreshed after 1000ms");
      }, 1000);
    }
    
    // Also refresh the posts to update any score displays
    // This will help if there are any score indicators in the feed
    console.log("Triggering posts refresh after score update");
  };

  const openProfileCard = (userId: string, username?: string, photoURL?: string | null) => {
    setSelectedProfile({ userId, username, photoURL });
    setProfileCardOpen(true);
  };

  const openEditPost = (post: FeedPost) => {
    setEditingPost(post);
    setEditCaption(post.description || "");
    setEditSubject(post.subject || "");
    setEditKlass(post.class || "");
    setEditVisibility(post.visibility);
  };

  const saveEditPost = async () => {
    if (!editingPost || !userId || !editSubject || !editKlass) return;
    setEditLoading(true);
    try {
      const topics = [editSubject, editKlass].filter(Boolean);
      const postRef = doc(db as any, 'feed_posts', editingPost.id);
      await updateDoc(postRef as any, {
        description: editCaption,
        subject: editSubject,
        class: editKlass,
        topics,
        visibility: editVisibility,
        lastActivityAt: serverTimestamp(),
      });
      toast({
        title: 'Post updated',
        description: 'Your post has been successfully updated.',
      });
      setEditingPost(null);
    } catch (e: any) {
      toast({
        title: 'Failed to update post',
        description: e?.message || 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setEditLoading(false);
    }
  };

  const deletePost = async (post: FeedPost) => {
    if (!userId || post.ownerId !== userId) return;
    setDeleting(true);
    try {
      // Optimistic UI update - remove immediately
      setPosts(prev => prev.filter(p => p.id !== post.id));
      setJoinedChallengesPosts(prev => prev.filter(p => p.id !== post.id));
      setGroupPosts(prev => prev.filter(p => p.id !== post.id));
      // Keep module cache in sync with optimistic delete
      const memDel = _feedMemCache.get(userId);
      if (memDel) _feedMemCache.set(userId, { ...memDel, posts: memDel.posts.filter(p => p.id !== post.id) });

      // Server-side delete handles subcollections (reactions/comments/runs)
      // so the client doesn't pay the fan-out read cost
      const del = httpsCallable(fbFunctions, 'deleteFeedPost');
      await del({ postId: post.id });
      
      toast({
        title: 'Post deleted',
        description: 'Your post has been permanently deleted.',
        duration: 5000,
      });
      setDeleteConfirmPost(null);
    } catch (e: any) {
      // Revert optimistic update on error
      setLoading(true); // Trigger reload
      toast({
        title: 'Failed to delete post',
        description: e?.message || 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setDeleting(false);
    }
  };

  const [deleteCommentConfirm, setDeleteCommentConfirm] = useState<string | null>(null);

  const deleteOwnComment = (commentId: string) => {
    setDeleteCommentConfirm(commentId);
  };

  const confirmDeleteComment = async () => {
    if (!deleteCommentConfirm || !commentDialogPost) return;
    const commentId = deleteCommentConfirm;
    setDeleteCommentConfirm(null);

    // Optimistic UI removal
    setComments(prev => prev.filter(c => c.id !== commentId));
    applyPostCommentDelta(commentDialogPost.id, -1);
    if (editingCommentId === commentId) cancelEditComment();

    try {
      const commentRef = doc(db as any, "feed_posts", commentDialogPost.id, "comments", commentId);
      await deleteDoc(commentRef);
      
      // Decrement comment count
      const postRef = doc(db as any, "feed_posts", commentDialogPost.id);
      await updateDoc(postRef as any, {
        commentCount: increment(-1),
        lastActivityAt: serverTimestamp()
      } as any);

      toast({
        title: 'Comment deleted',
        description: 'Your comment has been permanently deleted.',
        duration: 5000,
      });
    } catch (error) {
      console.error("Error deleting comment:", error);
      // Revert
      applyPostCommentDelta(commentDialogPost.id, +1);
      
      toast({
        title: "Error",
        description: "Could not delete comment. Please try again.",
        variant: "destructive"
      });
    }
  };

  // Moderation: Delete post (moderator+)
  const handleModerateDeletePost = async (post: FeedPost, reason?: string) => {
    if (!isModerator) return;
    setModeratingPost(post.id);
    try {
      const moderateContent = httpsCallable(fbFunctions, 'moderateContent');
      await moderateContent({ contentType: 'post', contentId: post.id, reason: reason || 'Moderation action' });
      toast({ title: 'Post removed', description: 'Post has been removed by moderator.' });
      // Remove from local state
      setPosts(prev => prev.filter(p => p.id !== post.id));
      setJoinedChallengesPosts(prev => prev.filter(p => p.id !== post.id));
      setGroupPosts(prev => prev.filter(p => p.id !== post.id));
      _feedMemCache.delete(userId); // Invalidate so next load gets fresh data
    } catch (e: any) {
      toast({ title: 'Failed to remove post', description: e?.message, variant: 'destructive' });
    } finally {
      setModeratingPost(null);
    }
  };

  // Moderation: Delete comment (moderator+)
  
  // Moderation: Ban user
  const handleBanUser = async () => {
    if (!banTargetUser || !isModerator) return;
    setBanning(true);
    try {
      const banUser = httpsCallable(fbFunctions, 'banUser');
      await banUser({ targetUid: banTargetUser.uid, banType, reason: banReason });
      toast({ 
        title: 'User banned', 
        description: `@${banTargetUser.username} has been banned (${banType.replace('_', ' ')}).` 
      });
      setBanDialogOpen(false);
      setBanTargetUser(null);
      setBanReason('');
    } catch (e: any) {
      toast({ title: 'Failed to ban user', description: e?.message, variant: 'destructive' });
    } finally {
      setBanning(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Sidebar menu button - mobile only */}
      <div className="md:hidden flex items-center justify-between mb-4">
        <Button variant="outline" size="sm" onClick={() => setSidebarOpen(true)}>
          <Menu className="w-4 h-4 mr-2" />
          Menu
        </Button>
      </div>

      {/* Mobile sidebar drawer */}
      {sidebarOpen && (
        <>
          <div className="fixed inset-0 z-30 bg-black/40" onClick={() => setSidebarOpen(false)} />
          <div className="fixed inset-y-0 left-0 z-[80] w-80 bg-background shadow-xl p-4 overflow-y-auto pointer-events-auto">
            <div className="flex items-center justify-between mb-4 sticky top-0 z-[90] bg-background/95 backdrop-blur py-2 pointer-events-auto">
              <h3 className="text-lg font-semibold">Feed Navigation</h3>
              <Button variant="ghost" size="icon" type="button" className="pointer-events-auto" onClick={(e) => { e.stopPropagation(); setSidebarOpen(false); }} aria-label="Close">
                <X className="w-5 h-5" />
              </Button>
            </div>
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground mb-2">Feed Filters</p>
              <Button variant={filterTab === 'for-you' ? 'default' : 'ghost'} className="w-full justify-start" onClick={() => { setFilterTab('for-you'); setSidebarOpen(false); }}>
                <Trophy className="w-4 h-4 mr-2" />
                For You
              </Button>
              <Button variant={filterTab === 'latest' ? 'default' : 'ghost'} className="w-full justify-start" onClick={() => { setFilterTab('latest'); setSidebarOpen(false); }}>
                <Trophy className="w-4 h-4 mr-2" />
                Latest
              </Button>
              <Button variant={filterTab === 'my-posts' ? 'default' : 'ghost'} className="w-full justify-start" onClick={() => { setFilterTab('my-posts'); setSidebarOpen(false); }}>
                <BookOpen className="w-4 h-4 mr-2" />
                My Posts
              </Button>
              <Button variant={filterTab === 'groups' ? 'default' : 'ghost'} className="w-full justify-start" onClick={() => { setFilterTab('groups'); setSidebarOpen(false); }}>
                <Users className="w-4 h-4 mr-2" />
                Groups
              </Button>
            </div>
          </div>
        </>
      )}

      {joining && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="bg-card border rounded-xl px-6 py-5 shadow-lg max-w-sm w-full text-center space-y-3">
            <div className="flex justify-center">
              <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            </div>
            <div className="text-sm font-semibold">Joining your challenge…</div>
            <div className="text-xs text-muted-foreground">
              {funFacts[funFactIndex]}
            </div>
          </div>
        </div>
      )}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Trophy className="w-5 h-5 text-yellow-500" />
          <div>
            <div className="text-sm font-semibold">Study Feed</div>
            <div className="text-xs text-muted-foreground hidden sm:block">Discover challenges created by the community.</div>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
          <div className="w-full sm:w-auto overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
            <div className="flex items-center bg-muted/50 rounded-lg p-1 min-w-max" data-tour="feed-tabs">
              <button
                onClick={() => setFilterTab('for-you')}
                data-tour="feed-posts"
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  filterTab === 'for-you'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
                }`}
              >
                For you
              </button>
              <button
                onClick={() => setFilterTab('latest')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  filterTab === 'latest'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
                }`}
              >
                Latest
              </button>
              <button
                onClick={() => setFilterTab('my-posts')}
                data-tour="feed-my-posts"
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  filterTab === 'my-posts'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
                }`}
              >
                My Posts
              </button>
              <button
                onClick={() => setFilterTab('groups')}
                data-tour="feed-groups"
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  filterTab === 'groups'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
                }`}
              >
                Groups
              </button>
            </div>
          </div>
          <Button size="sm" className="flex items-center gap-1 justify-center" data-tour="feed-share" onClick={() => {
            // Set default visibility and group based on current context
            if (filterTab === 'groups' && selectedGroup) {
              userGroups.find(g => g.id === selectedGroup);
              setSelectedGroupForPost(selectedGroup);
              setVisibility("friends"); // Will be overridden to "group" in post creation
            } else {
              setSelectedGroupForPost(null);
              setVisibility("public");
            }
            setPickerOpen(true);
          }}>
            <Plus className="w-3 h-3" />
            <span className="hidden sm:inline">
              {filterTab === 'groups' && selectedGroup 
                ? `Post to ${userGroups.find(g => g.id === selectedGroup)?.name || 'Group'}`
                : 'Post to Feed'
              }
            </span>
            <span className="sm:hidden">Post</span>
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-2 text-xs">
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          <div className="space-y-1">
            <Label className="text-[11px]">Type</Label>
            <Popover open={typeFilterOpen} onOpenChange={setTypeFilterOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={typeFilterOpen}
                  className="h-8 w-full sm:w-[140px] justify-between text-xs font-normal"
                >
                  {typeFilter === 'all' ? 'All types' :
                   typeFilter === 'flashcards' ? 'Flashcards' :
                   typeFilter === 'quiz' ? 'Quiz' :
                   typeFilter === 'summary' ? 'Summary' :
                   typeFilter === 'lesson' ? 'Lesson' : 'All types'}
                  <ChevronDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[200px] p-0">
                <Command>
                  <CommandInput placeholder="Search type..." className="h-8 text-xs" />
                  <CommandList>
                    <CommandEmpty>No type found.</CommandEmpty>
                    <CommandGroup>
                      <CommandItem onSelect={() => { setTypeFilter('all'); setTypeFilterOpen(false); }}>
                        <Check className={`mr-2 h-3 w-3 ${typeFilter === 'all' ? 'opacity-100' : 'opacity-0'}`} />
                        All types
                      </CommandItem>
                      <CommandItem onSelect={() => { setTypeFilter('flashcards'); setTypeFilterOpen(false); }}>
                        <Check className={`mr-2 h-3 w-3 ${typeFilter === 'flashcards' ? 'opacity-100' : 'opacity-0'}`} />
                        Flashcards
                      </CommandItem>
                      <CommandItem onSelect={() => { setTypeFilter('quiz'); setTypeFilterOpen(false); }}>
                        <Check className={`mr-2 h-3 w-3 ${typeFilter === 'quiz' ? 'opacity-100' : 'opacity-0'}`} />
                        Quiz
                      </CommandItem>
                      <CommandItem onSelect={() => { setTypeFilter('summary'); setTypeFilterOpen(false); }}>
                        <Check className={`mr-2 h-3 w-3 ${typeFilter === 'summary' ? 'opacity-100' : 'opacity-0'}`} />
                        Summary
                      </CommandItem>
                      <CommandItem onSelect={() => { setTypeFilter('lesson'); setTypeFilterOpen(false); }}>
                        <Check className={`mr-2 h-3 w-3 ${typeFilter === 'lesson' ? 'opacity-100' : 'opacity-0'}`} />
                        Lesson
                      </CommandItem>
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Subject</Label>
            <Popover open={subjectFilterOpen} onOpenChange={setSubjectFilterOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={subjectFilterOpen}
                  className="h-8 w-full sm:w-[140px] justify-between text-xs font-normal"
                >
                  {subjectFilter === 'all' ? 'All subjects' : getSubjectLabel(subjectFilter)}
                  <ChevronDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[200px] p-0">
                <Command>
                  <CommandInput placeholder="Search subject..." className="h-8 text-xs" />
                  <CommandList>
                    <CommandEmpty>No subject found.</CommandEmpty>
                    <CommandGroup>
                      <CommandItem onSelect={() => { setSubjectFilter('all'); setClassFilter('all'); setSubjectFilterOpen(false); }}>
                        <Check className={`mr-2 h-3 w-3 ${subjectFilter === 'all' ? 'opacity-100' : 'opacity-0'}`} />
                        All subjects
                      </CommandItem>
                      <CommandItem onSelect={() => { setSubjectFilter('math'); setClassFilter('all'); setSubjectFilterOpen(false); }}>
                        <Check className={`mr-2 h-3 w-3 ${subjectFilter === 'math' ? 'opacity-100' : 'opacity-0'}`} />
                        Math
                      </CommandItem>
                      <CommandItem onSelect={() => { setSubjectFilter('reading-writing'); setClassFilter('all'); setSubjectFilterOpen(false); }}>
                        <Check className={`mr-2 h-3 w-3 ${subjectFilter === 'reading-writing' ? 'opacity-100' : 'opacity-0'}`} />
                        Reading & Writing
                      </CommandItem>
                      <CommandItem onSelect={() => { setSubjectFilter('science'); setClassFilter('all'); setSubjectFilterOpen(false); }}>
                        <Check className={`mr-2 h-3 w-3 ${subjectFilter === 'science' ? 'opacity-100' : 'opacity-0'}`} />
                        Science (General)
                      </CommandItem>
                      <CommandItem onSelect={() => { setSubjectFilter('biology'); setClassFilter('all'); setSubjectFilterOpen(false); }}>
                        <Check className={`mr-2 h-3 w-3 ${subjectFilter === 'biology' ? 'opacity-100' : 'opacity-0'}`} />
                        Biology
                      </CommandItem>
                      <CommandItem onSelect={() => { setSubjectFilter('chemistry'); setClassFilter('all'); setSubjectFilterOpen(false); }}>
                        <Check className={`mr-2 h-3 w-3 ${subjectFilter === 'chemistry' ? 'opacity-100' : 'opacity-0'}`} />
                        Chemistry
                      </CommandItem>
                      <CommandItem onSelect={() => { setSubjectFilter('physics'); setClassFilter('all'); setSubjectFilterOpen(false); }}>
                        <Check className={`mr-2 h-3 w-3 ${subjectFilter === 'physics' ? 'opacity-100' : 'opacity-0'}`} />
                        Physics
                      </CommandItem>
                      <CommandItem onSelect={() => { setSubjectFilter('history'); setClassFilter('all'); setSubjectFilterOpen(false); }}>
                        <Check className={`mr-2 h-3 w-3 ${subjectFilter === 'history' ? 'opacity-100' : 'opacity-0'}`} />
                        History
                      </CommandItem>
                      <CommandItem onSelect={() => { setSubjectFilter('economics'); setClassFilter('all'); setSubjectFilterOpen(false); }}>
                        <Check className={`mr-2 h-3 w-3 ${subjectFilter === 'economics' ? 'opacity-100' : 'opacity-0'}`} />
                        Economics
                      </CommandItem>
                      <CommandItem onSelect={() => { setSubjectFilter('business'); setClassFilter('all'); setSubjectFilterOpen(false); }}>
                        <Check className={`mr-2 h-3 w-3 ${subjectFilter === 'business' ? 'opacity-100' : 'opacity-0'}`} />
                        Business
                      </CommandItem>
                      <CommandItem onSelect={() => { setSubjectFilter('computer-science'); setClassFilter('all'); setSubjectFilterOpen(false); }}>
                        <Check className={`mr-2 h-3 w-3 ${subjectFilter === 'computer-science' ? 'opacity-100' : 'opacity-0'}`} />
                        Computer Science
                      </CommandItem>
                      <CommandItem onSelect={() => { setSubjectFilter('language'); setClassFilter('all'); setSubjectFilterOpen(false); }}>
                        <Check className={`mr-2 h-3 w-3 ${subjectFilter === 'language' ? 'opacity-100' : 'opacity-0'}`} />
                        Languages
                      </CommandItem>
                      <CommandItem onSelect={() => { setSubjectFilter('arts'); setClassFilter('all'); setSubjectFilterOpen(false); }}>
                        <Check className={`mr-2 h-3 w-3 ${subjectFilter === 'arts' ? 'opacity-100' : 'opacity-0'}`} />
                        Arts & Humanities
                      </CommandItem>
                      <CommandItem onSelect={() => { setSubjectFilter('politics'); setClassFilter('all'); setSubjectFilterOpen(false); }}>
                        <Check className={`mr-2 h-3 w-3 ${subjectFilter === 'politics' ? 'opacity-100' : 'opacity-0'}`} />
                        Political Science
                      </CommandItem>
                      <CommandItem onSelect={() => { setSubjectFilter('psychology'); setClassFilter('all'); setSubjectFilterOpen(false); }}>
                        <Check className={`mr-2 h-3 w-3 ${subjectFilter === 'psychology' ? 'opacity-100' : 'opacity-0'}`} />
                        Psychology
                      </CommandItem>
                      <CommandItem onSelect={() => { setSubjectFilter('sociology'); setClassFilter('all'); setSubjectFilterOpen(false); }}>
                        <Check className={`mr-2 h-3 w-3 ${subjectFilter === 'sociology' ? 'opacity-100' : 'opacity-0'}`} />
                        Sociology
                      </CommandItem>
                      <CommandItem onSelect={() => { setSubjectFilter('philosophy'); setClassFilter('all'); setSubjectFilterOpen(false); }}>
                        <Check className={`mr-2 h-3 w-3 ${subjectFilter === 'philosophy' ? 'opacity-100' : 'opacity-0'}`} />
                        Philosophy
                      </CommandItem>
                      <CommandItem onSelect={() => { setSubjectFilter('law'); setClassFilter('all'); setSubjectFilterOpen(false); }}>
                        <Check className={`mr-2 h-3 w-3 ${subjectFilter === 'law' ? 'opacity-100' : 'opacity-0'}`} />
                        Law
                      </CommandItem>
                      <CommandItem onSelect={() => { setSubjectFilter('engineering'); setClassFilter('all'); setSubjectFilterOpen(false); }}>
                        <Check className={`mr-2 h-3 w-3 ${subjectFilter === 'engineering' ? 'opacity-100' : 'opacity-0'}`} />
                        Engineering
                      </CommandItem>
                      <CommandItem onSelect={() => { setSubjectFilter('health'); setClassFilter('all'); setSubjectFilterOpen(false); }}>
                        <Check className={`mr-2 h-3 w-3 ${subjectFilter === 'health' ? 'opacity-100' : 'opacity-0'}`} />
                        Health & Medicine
                      </CommandItem>
                      <CommandItem onSelect={() => { setSubjectFilter('movies'); setClassFilter('all'); setSubjectFilterOpen(false); }}>
                        <Check className={`mr-2 h-3 w-3 ${subjectFilter === 'movies' ? 'opacity-100' : 'opacity-0'}`} />
                        Movies & TV
                      </CommandItem>
                      <CommandItem onSelect={() => { setSubjectFilter('sports'); setClassFilter('all'); setSubjectFilterOpen(false); }}>
                        <Check className={`mr-2 h-3 w-3 ${subjectFilter === 'sports' ? 'opacity-100' : 'opacity-0'}`} />
                        Sports
                      </CommandItem>
                      <CommandItem onSelect={() => { setSubjectFilter('music'); setClassFilter('all'); setSubjectFilterOpen(false); }}>
                        <Check className={`mr-2 h-3 w-3 ${subjectFilter === 'music' ? 'opacity-100' : 'opacity-0'}`} />
                        Music
                      </CommandItem>
                      <CommandItem onSelect={() => { setSubjectFilter('gaming'); setClassFilter('all'); setSubjectFilterOpen(false); }}>
                        <Check className={`mr-2 h-3 w-3 ${subjectFilter === 'gaming' ? 'opacity-100' : 'opacity-0'}`} />
                        Gaming
                      </CommandItem>
                      <CommandItem onSelect={() => { setSubjectFilter('travel'); setClassFilter('all'); setSubjectFilterOpen(false); }}>
                        <Check className={`mr-2 h-3 w-3 ${subjectFilter === 'travel' ? 'opacity-100' : 'opacity-0'}`} />
                        Travel & Geography
                      </CommandItem>
                      <CommandItem onSelect={() => { setSubjectFilter('food'); setClassFilter('all'); setSubjectFilterOpen(false); }}>
                        <Check className={`mr-2 h-3 w-3 ${subjectFilter === 'food' ? 'opacity-100' : 'opacity-0'}`} />
                        Food & Cooking
                      </CommandItem>
                      <CommandItem onSelect={() => { setSubjectFilter('fitness'); setClassFilter('all'); setSubjectFilterOpen(false); }}>
                        <Check className={`mr-2 h-3 w-3 ${subjectFilter === 'fitness' ? 'opacity-100' : 'opacity-0'}`} />
                        Fitness & Wellness
                      </CommandItem>
                      <CommandItem onSelect={() => { setSubjectFilter('technology'); setClassFilter('all'); setSubjectFilterOpen(false); }}>
                        <Check className={`mr-2 h-3 w-3 ${subjectFilter === 'technology' ? 'opacity-100' : 'opacity-0'}`} />
                        Technology & Gadgets
                      </CommandItem>
                      <CommandItem onSelect={() => { setSubjectFilter('nature'); setClassFilter('all'); setSubjectFilterOpen(false); }}>
                        <Check className={`mr-2 h-3 w-3 ${subjectFilter === 'nature' ? 'opacity-100' : 'opacity-0'}`} />
                        Nature & Animals
                      </CommandItem>
                      <CommandItem onSelect={() => { setSubjectFilter('other'); setClassFilter('all'); setSubjectFilterOpen(false); }}>
                        <Check className={`mr-2 h-3 w-3 ${subjectFilter === 'other' ? 'opacity-100' : 'opacity-0'}`} />
                        Other
                      </CommandItem>
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Class / Topic</Label>
            <Popover open={classFilterOpen} onOpenChange={setClassFilterOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={classFilterOpen}
                  disabled={subjectFilter === 'all'}
                  className="h-8 w-full sm:w-[160px] justify-between text-xs font-normal"
                >
                  {classFilter === 'all' 
                    ? (subjectFilter === 'all' ? 'Choose subject first' : 'All classes')
                    : getTopicsForSubject(subjectFilter).find(t => t.value === classFilter)?.label || classFilter
                  }
                  <ChevronDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[200px] p-0">
                <Command>
                  <CommandInput placeholder="Search class..." className="h-8 text-xs" />
                  <CommandList>
                    <CommandEmpty>No class found.</CommandEmpty>
                    <CommandGroup>
                      <CommandItem onSelect={() => { setClassFilter('all'); setClassFilterOpen(false); }}>
                        <Check className={`mr-2 h-3 w-3 ${classFilter === 'all' ? 'opacity-100' : 'opacity-0'}`} />
                        All classes
                      </CommandItem>
                      {getTopicsForSubject(subjectFilter).map((topic) => (
                        <CommandItem key={topic.value} onSelect={() => { setClassFilter(topic.value); setClassFilterOpen(false); }}>
                          <Check className={`mr-2 h-3 w-3 ${classFilter === topic.value ? 'opacity-100' : 'opacity-0'}`} />
                          {topic.label}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </div>

      {/* Groups Manager */}
      {filterTab === 'groups' && (
        <GroupsManager
          userId={userId}
          username={username}
          userGroups={userGroups}
          selectedGroup={selectedGroup}
          onGroupSelect={setSelectedGroup}
          onGroupsUpdate={() => {
            // OPTIMIZED: Reload user groups with batched queries (same as main loader)
            const reloadGroups = async () => {
              try {
                const userGroupsRef = collection(db as any, "users", userId, "groups");
                const userGroupsSnap = await getDocs(userGroupsRef);
                const groupIds: string[] = [];
                
                userGroupsSnap.forEach((d) => {
                  const data = d.data();
                  if (data.groupId) groupIds.push(data.groupId);
                });

                if (groupIds.length === 0) {
                  setUserGroups([]);
                  return;
                }

                // OPTIMIZED: Batch fetch groups (10 at a time) instead of N individual getDoc
                const groupsRef = collection(db as any, "groups");
                const byId = new Map<string, any>();
                for (let i = 0; i < groupIds.length; i += 10) {
                  const batchIds = groupIds.slice(i, i + 10);
                  const q = query(groupsRef as any, where(documentId(), 'in', batchIds));
                  const snap = await getDocs(q as any);
                  snap.forEach((d: any) => byId.set(d.id, { id: d.id, ...(d.data() as any) }));
                }
                
                const ordered = groupIds.map(id => byId.get(id)).filter(Boolean);
                setUserGroups(ordered);
                
                // Update cache
                try {
                  sessionStorage.setItem(`user_groups_${userId}`, JSON.stringify(ordered));
                  sessionStorage.setItem(`user_groups_ts_${userId}`, String(Date.now()));
                } catch {}
              } catch (error) {
                console.error('Failed to reload user groups:', error);
              }
            };
            reloadGroups();
          }}
        />
      )}

      {loading && (
        <div className="text-sm text-muted-foreground">Loading feed…</div>
      )}

      {!loading && visiblePosts.length === 0 && (
        <div className="text-center py-8">
          <div className="text-sm text-muted-foreground mb-2">No posts yet in your feed.</div>
          <div className="text-xs text-muted-foreground">Share your first lesson, quiz, or flashcards as a challenge, or check that your Firestore rules allow feed access.</div>
        </div>
      )}

      <div className="space-y-4">
        {visiblePosts.map(post => (
          <Card key={post.id} className="overflow-hidden">
            <CardHeader className="flex flex-row items-center gap-3 pb-3">
              <Avatar 
                className="h-8 w-8 cursor-pointer hover:ring-2 hover:ring-primary/20 transition-all"
                onClick={() => openProfileCard(post.ownerId, post.ownerUsername, post.ownerPhotoURL)}
              >
                {post.ownerPhotoURL ? (
                  <AvatarImage src={post.ownerPhotoURL} alt={post.ownerUsername || "user"} />
                ) : (
                  <AvatarFallback>{(post.ownerUsername || "?").slice(0, 2).toUpperCase()}</AvatarFallback>
                )}
              </Avatar>
              <div className="flex-1 min-w-0">
                <div 
                  className="flex items-center gap-1 text-sm font-medium truncate cursor-pointer hover:text-primary transition-colors"
                  onClick={() => openProfileCard(post.ownerId, post.ownerUsername, post.ownerPhotoURL)}
                >
                  @{(post.ownerUsername || "user").toLowerCase()}
                </div>
                <div className="flex items-center gap-1.5 sm:gap-2 text-[11px] text-muted-foreground flex-wrap">
                  <span>
                    {post.type === "quiz" ? "Quiz challenge" :
                     post.type === "flashcards" ? "Flashcards" :
                     post.type === "lesson" ? "Lesson" :
                     post.type === "summary" ? 'Summary' :
                     "Study challenge"}
                  </span>
                  <span>·</span>
                  <span className="truncate">{formatRelativeTime(post.createdAt)}</span>
                  <span className="hidden sm:inline">·</span>
                  {filterTab === 'groups' && post.visibility === "group" && (post as any).groupId ? (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 truncate max-w-[120px] inline-flex items-center gap-1">
                      <Users className="w-3 h-3" />
                      {userGroups.find(g => g.id === (post as any).groupId)?.name || "Group"}
                    </Badge>
                  ) : post.visibility === "public" ? (
                    <span className="hidden sm:inline-flex items-center gap-1"><Globe2 className="w-3 h-3" />Public</span>
                  ) : (
                    <span className="hidden sm:inline-flex items-center gap-1"><Lock className="w-3 h-3" />Friends</span>
                  )}
                  {post.subject && (
                    <>
                      <span className="hidden sm:inline">·</span>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 truncate max-w-[100px]">{post.subject}</Badge>
                    </>
                  )}
                  {post.class && (
                    <>
                      <span className="hidden sm:inline">·</span>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 truncate max-w-[100px]">{post.class}</Badge>
                    </>
                  )}
                </div>
              </div>
              {(post.ownerId === userId || isModerator) && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                      <MoreHorizontal className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {/* Owner actions */}
                    {post.ownerId === userId && (
                      <>
                        <DropdownMenuItem onClick={() => openEditPost(post)}>
                          <Edit className="w-4 h-4 mr-2" />
                          Edit Post
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onClick={() => setDeleteConfirmPost(post)}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Delete Post
                        </DropdownMenuItem>
                      </>
                    )}
                    {/* Moderator actions */}
                    {isModerator && post.ownerId !== userId && (
                      <>
                        <DropdownMenuItem 
                          onClick={() => handleModerateDeletePost(post)}
                          disabled={moderatingPost === post.id}
                          className="text-orange-500 focus:text-orange-600"
                        >
                          <Shield className="w-4 h-4 mr-2" />
                          {moderatingPost === post.id ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Removing...</> : 'Remove Post (Mod)'}
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onClick={() => {
                            setBanTargetUser({ uid: post.ownerId, username: post.ownerUsername || 'user' });
                            setBanType('cannot_post');
                            setBanDialogOpen(true);
                          }}
                          className="text-red-500 focus:text-red-600"
                        >
                          <Ban className="w-4 h-4 mr-2" />
                          Ban User
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </CardHeader>

            <CardContent className="p-4 pt-0">
              <div
                className={`rounded-lg overflow-hidden bg-muted min-h-[120px] flex items-center justify-center text-center px-4 ${openingChallengeId === post.id ? 'opacity-70 cursor-wait' : 'cursor-pointer'}`}
                onClick={() => !openingChallengeId && handleChallengeClick(post)}
              >
                {openingChallengeId === post.id ? (
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="w-6 h-6 animate-spin" />
                    <span className="text-sm text-muted-foreground">Opening...</span>
                  </div>
                ) : post.coverImageUrl ? (
                  <img src={post.coverImageUrl} alt={post.title} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full overflow-hidden">
                    <div className="text-sm font-semibold mb-1 truncate">{post.title}</div>
                    {post.description && (
                      <div className="text-xs text-muted-foreground line-clamp-3 prose dark:prose-invert max-w-full prose-p:my-0 prose-ul:my-0 prose-ol:my-0 prose-li:my-0 overflow-hidden break-words">
                        <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]} rehypePlugins={[rehypeKatex]}>
                          {normalizeForMath(post.description)}
                        </ReactMarkdown>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-4">
                {joinedChallenges.has(post.id) && post.type === "quiz" ? (
                  <div className="flex gap-2 flex-1">
                    <Button
                      size="sm"
                      className="flex-1"
                      onClick={() => handleChallengeClick(post)}
                      variant="secondary"
                      disabled={!!openingChallengeId}
                    >
                      {openingChallengeId === post.id ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Medal className="w-4 h-4 mr-2" />
                      )}
                      {openingChallengeId === post.id ? "Opening..." : "Joined Challenge"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        await loadLeaderboard(post);
                      }}
                    >
                      <Trophy className="w-4 h-4 mr-2" />
                      Leaderboard
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    className="w-full sm:flex-1"
                    onClick={() => handleChallengeClick(post)}
                    variant={joinedChallenges.has(post.id) ? "secondary" : "default"}
                    disabled={!!openingChallengeId}
                    data-tour="feed-join-challenge"
                  >
                    {openingChallengeId === post.id ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Opening...
                      </>
                    ) : joinedChallenges.has(post.id) ? (
                      <>
                        <Medal className="w-4 h-4 mr-2" />
                        {post.type === 'lesson' ? 'Joined Lesson' :
                         post.type === 'summary' ? 'Summary Joined' :
                         'Challenge Joined'}
                      </>
                    ) : (
                      <>
                        {post.type === 'lesson' || post.type === 'summary' ? <BookOpen className="w-4 h-4 mr-2" /> : <Trophy className="w-4 h-4 mr-2" />}
                        {post.type === 'lesson' ? 'Join Lesson' :
                         post.type === 'summary' ? 'Join Summary' :
                         'Join Challenge'}
                      </>
                    )}
                  </Button>
                )}
                <div className="flex items-center gap-3 sm:gap-2 text-xs text-muted-foreground justify-between sm:justify-start">
                  <div className="flex items-center gap-1">
                    <Heart
                      className={`w-4 h-4 cursor-pointer ${userReactions[post.id] === 'like' ? 'text-red-500' : ''}`}
                      onClick={() => toggleReaction(post, 'like')}
                      fill={userReactions[post.id] === 'like' ? 'currentColor' : 'none'}
                    />
                    <span>{post.likeCount}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <ThumbsDown
                      className={`w-4 h-4 cursor-pointer ${userReactions[post.id] === 'dislike' ? 'text-blue-600' : ''}`}
                      onClick={() => toggleReaction(post, 'dislike')}
                      fill={userReactions[post.id] === 'dislike' ? 'currentColor' : 'none'}
                    />
                    <span>{post.dislikeCount}</span>
                  </div>
                  <button className="flex items-center gap-1" onClick={() => openComments(post)}>
                    <MessageCircle className="w-4 h-4" />
                    <span>{post.commentCount}</span>
                  </button>
                  <div className="flex items-center gap-1">
                    <Trophy className="w-4 h-4" />
                    <span className="hidden sm:inline">{post.participantCount} joined</span>
                    <span className="sm:hidden">{post.participantCount}</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        
        {/* Infinite scroll: Loading indicator (auto-loads on scroll like Instagram) */}
        {hasMore && !loading && visiblePosts.length > 0 && (
          <div className="flex justify-center py-4">
            {loadingMore && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading...
              </div>
            )}
          </div>
        )}
      </div>

      <Dialog open={!!commentDialogPost} onOpenChange={(open) => { if (!open) setCommentDialogPost(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Comments</DialogTitle>
            <DialogDescription>View and add comments</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
            {comments.length === 0 && (
              <div className="text-xs text-muted-foreground">No comments yet. Be the first to comment.</div>
            )}
            {comments.map(c => (
              <div key={c.id} className="flex items-start gap-2 text-xs">
                <Avatar 
                  className="h-6 w-6 mt-0.5 cursor-pointer hover:ring-2 hover:ring-primary/20 transition-all"
                  onClick={() => openProfileCard(c.userId, c.username, c.userPhotoURL)}
                >
                  {c.userPhotoURL ? <AvatarImage src={c.userPhotoURL} alt={c.username || "user"} /> : <AvatarFallback>{(c.username || "?").slice(0, 2).toUpperCase()}</AvatarFallback>}
                </Avatar>
                <div className="flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div 
                        className="font-medium text-[11px] mb-0.5 cursor-pointer hover:text-primary transition-colors"
                        onClick={() => openProfileCard(c.userId, c.username, c.userPhotoURL)}
                      >
                        @{(c.username || "user").toLowerCase()}
                      </div>
                      {editingCommentId === c.id ? (
                        <div className="space-y-2">
                          <Textarea
                            value={editingCommentText}
                            onChange={(e) => setEditingCommentText(e.target.value)}
                            rows={2}
                          />
                          <div className="flex gap-2">
                            <Button size="sm" onClick={saveEditComment} disabled={!editingCommentText.trim()}>Save</Button>
                            <Button size="sm" variant="ghost" onClick={cancelEditComment}>Cancel</Button>
                          </div>
                        </div>
                      ) : (
                        <div>{c.text}</div>
                      )}
                    </div>
                    {c.userId === userId && (
                      <div className="flex items-center gap-2">
                        {editingCommentId === c.id ? null : (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => startEditComment(c)}>Edit</Button>
                            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => deleteOwnComment(c.id)}>Delete</Button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
          
          {/* Delete Comment Confirmation */}
          <Dialog open={!!deleteCommentConfirm} onOpenChange={(open) => !open && setDeleteCommentConfirm(null)}>
            <DialogContent className="max-w-xs">
              <DialogHeader>
                <DialogTitle>Delete Comment?</DialogTitle>
                <DialogDescription>This action cannot be undone</DialogDescription>
              </DialogHeader>
              <div className="text-sm text-muted-foreground mb-4">
                Are you sure you want to delete this comment? This cannot be undone.
              </div>
              <DialogFooter>
                <Button variant="ghost" size="sm" onClick={() => setDeleteCommentConfirm(null)}>Cancel</Button>
                <Button variant="destructive" size="sm" onClick={confirmDeleteComment}>Delete</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <div className="pt-2 space-y-2">
            <Textarea
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder="Add a comment…"
              rows={2}
            />
            <DialogFooter>
              <Button size="sm" onClick={submitComment} disabled={!newComment.trim()}>Post</Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!joinDialogPost}
        onOpenChange={(open) => {
          if (!open) setJoinDialogPost(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Join this challenge?</DialogTitle>
            <DialogDescription>Complete this challenge to earn points</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <div className="font-medium">{joinDialogPost?.title || "Study challenge"}</div>
            <div className="text-xs text-muted-foreground">
              You are about to join this challenge and start working on its content.
              This will count as one usage on your account.
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setJoinDialogPost(null)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={async () => {
                if (!joinDialogPost) return;
                const target = joinDialogPost;
                setJoinDialogPost(null);
                await joinChallenge(target);
                // Usage is already tracked inside joinChallenge - no duplicate needed
                setSelectedChallengeForPopup(target);
                setChallengePopupOpen(true);
              }}
            >
              Yes, join
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* FeedPostPicker: select existing content to post */}
      <Dialog open={pickerOpen} onOpenChange={(open) => { 
        setPickerOpen(open); 
        if (!open) { 
          setTimeout(() => {
            setSelectedItem(null); 
            setPostDialogStep('picker');
            setCaption("");
            setSubject("");
            setSelectedTopics([]);
          }, 300); // delay reset to avoid seeing empty state before closing animation finishes
        } 
      }}>
        <DialogContent className={postDialogStep === 'picker' ? "max-w-3xl" : "max-w-md"}>
          {postDialogStep === 'picker' ? (
            <>
              <DialogHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <DialogTitle>Select content to post</DialogTitle>
                    <DialogDescription>Choose from your saved quizzes, flashcards, summaries, or lessons</DialogDescription>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-xs"
                    disabled={loadingPicker}
                    onClick={async () => {
                      // Clear cache and refresh materials directly (no dialog toggle)
                      try {
                        sessionStorage.removeItem(`user_materials_${userId}`);
                        sessionStorage.removeItem(`user_materials_ts_${userId}`);
                      } catch {}
                      setLoadingPicker(true);
                      
                      try {
                        const lessonsRef = collection(db as any, 'users', userId, 'lessons');
                        const quizzesRef = collection(db as any, 'users', userId, 'quizzes');
                        const setsRef = collection(db as any, 'users', userId, 'flashcard_sets');
                        const summariesRef = collection(db as any, 'users', userId, 'summaries');

                        const [lessonsSnap, quizzesSnap, setsSnap, summariesSnap] = await Promise.all([
                          getDocs(query(lessonsRef as any, limit(20))),
                          getDocs(query(quizzesRef as any, limit(20))),
                          getDocs(query(setsRef as any, limit(20))),
                          getDocs(query(summariesRef as any, limit(20))),
                        ]);

                        const lessonsList = lessonsSnap.docs.map((d: any) => {
                          const data = d.data() as any;
                          return { id: d.id, title: data.title || 'Untitled Lesson', goals: data.goals || '', created_at: data.created_at || data.createdAt || { seconds: 0 } };
                        });
                        const quizzesList = quizzesSnap.docs.map((d: any) => {
                          const data = d.data() as any;
                          return { id: d.id, title: data.title || 'Untitled Quiz', questionCount: data.questionCount || (data.questions?.length || 0), created_at: data.created_at || data.createdAt || { seconds: 0 } };
                        });
                        const flashcardsList = setsSnap.docs.map((d: any) => {
                          const data = d.data() as any;
                          const cards = Array.isArray(data.flashcards) ? data.flashcards.length : (data.total_count || 0);
                          return { id: d.id, title: data.title || 'Untitled Flashcards', cardCount: cards, created_at: data.created_at || data.createdAt || { seconds: 0 } };
                        });
                        const summariesList = summariesSnap.docs.map((d: any) => {
                          const data = d.data() as any;
                          return { id: d.id, title: data.title || 'Untitled Summary', summary_type: data.summary_type || 'brief', word_count: data.word_count || 0, created_at: data.created_at || data.createdAt || { seconds: 0 } };
                        });

                        setLessons(lessonsList);
                        setQuizzes(quizzesList);
                        setFlashcards(flashcardsList);
                        setSummaries(summariesList);
                        
                        // Update cache
                        try {
                          sessionStorage.setItem(`user_materials_${userId}`, JSON.stringify({ lessons: lessonsList, quizzes: quizzesList, flashcards: flashcardsList, summaries: summariesList }));
                          sessionStorage.setItem(`user_materials_ts_${userId}`, String(Date.now()));
                        } catch {}
                      } catch (e) {
                        console.error('Failed to refresh materials:', e);
                      } finally {
                        setLoadingPicker(false);
                      }
                    }}
                  >
                    <RefreshCw className={`w-3 h-3 mr-1 ${loadingPicker ? 'animate-spin' : ''}`} />
                    Refresh
                  </Button>
                </div>
              </DialogHeader>
              <div className="text-xs text-muted-foreground mb-3">
                Choose a lesson, quiz, or flashcard set from your library to turn into a challenge.
              </div>
          {loadingPicker ? (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
              Loading your content…
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm max-h-[420px] overflow-y-auto pr-1">
              <div className="space-y-2">
                <div className="font-semibold text-xs uppercase text-muted-foreground">Lessons</div>
                {lessons.length === 0 ? (
                  <div className="text-xs text-muted-foreground">No lessons yet.</div>
                ) : (
                  <div className="space-y-1">
                    {lessons.map(l => (
                      <button
                        key={l.id}
                        className="w-full text-left p-2 border rounded-md hover:bg-accent/40 transition-colors"
                        onClick={() => {
                          setSelectedItem({ id: l.id, type: 'lesson', title: l.title || 'Untitled Lesson', description: l.goals || '' });
                          setPostDialogStep('composer');
                        }}
                      >
                        <div className="font-medium truncate" title={l.title}>{l.title || 'Untitled Lesson'}</div>
                        {l.goals && <div className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{l.goals}</div>}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="font-semibold text-xs uppercase text-muted-foreground">Quizzes</div>
                {quizzes.length === 0 ? (
                  <div className="text-xs text-muted-foreground">No quizzes yet.</div>
                ) : (
                  <div className="space-y-1">
                    {quizzes.map(q => (
                      <button
                        key={q.id}
                        className="w-full text-left p-2 border rounded-md hover:bg-accent/40 transition-colors"
                        onClick={() => {
                          setSelectedItem({ id: q.id, type: 'quiz', title: q.title || 'Untitled Quiz', description: `${q.questionCount || 0} questions` });
                          setPostDialogStep('composer');
                        }}
                      >
                        <div className="font-medium truncate" title={q.title}>{q.title || 'Untitled Quiz'}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">{q.questionCount || 0} questions</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="font-semibold text-xs uppercase text-muted-foreground">Flashcards</div>
                {flashcards.length === 0 ? (
                  <div className="text-xs text-muted-foreground">No flashcard sets yet.</div>
                ) : (
                  <div className="space-y-1">
                    {flashcards.map(f => (
                      <button
                        key={f.id}
                        className="w-full text-left p-2 border rounded-md hover:bg-accent/40 transition-colors"
                        onClick={() => {
                          setSelectedItem({ id: f.id, type: 'flashcards', title: f.title || 'Untitled Flashcards', description: `${f.cardCount || 0} cards` });
                          setPostDialogStep('composer');
                        }}
                      >
                        <div className="font-medium truncate" title={f.title}>{f.title || 'Untitled Flashcards'}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">{f.cardCount ?? 0} cards</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <div className="font-semibold text-xs uppercase text-muted-foreground">Summaries</div>
                {summaries.filter(s => s.summary_type !== 'transcript').length === 0 ? (
                  <div className="text-xs text-muted-foreground">No summaries yet.</div>
                ) : (
                  <div className="space-y-1">
                    {summaries.filter(s => s.summary_type !== 'transcript').map(s => (
                      <button
                        key={s.id}
                        className="w-full text-left p-2 border rounded-md hover:bg-accent/40 transition-colors"
                        onClick={() => {
                          setSelectedItem({ 
                            id: s.id, 
                            type: 'summary',
                            summaryType: s.summary_type || undefined,
                            title: s.title || 'Untitled Summary', 
                            description: `${s.word_count || 0} words · ${formatSummaryType(s.summary_type || 'brief')}` 
                          });
                          setPostDialogStep('composer');
                        }}
                      >
                        <div className="font-medium truncate" title={s.title}>{s.title || 'Untitled Summary'}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">{formatSummaryType(s.summary_type || 'brief')}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Create Feed Post</DialogTitle>
                <DialogDescription>Share your content with the community</DialogDescription>
              </DialogHeader>
          <div className="space-y-3 text-sm">
            {selectedItem && (
              <div className="p-3 border rounded bg-muted/40 overflow-hidden">
                <div className="text-[11px] uppercase text-muted-foreground mb-1">
                  {selectedItem.type === 'quiz' ? 'Quiz' : 
                   selectedItem.type === 'flashcards' ? 'Flashcards' : 
                   selectedItem.type === 'summary' ? (
                     selectedItem.summaryType === 'brief' ? 'Brief Summary' :
                     selectedItem.summaryType === 'key_points' ? 'Key Points' :
                     selectedItem.summaryType === 'detailed' ? 'Detailed Summary' :
                     selectedItem.summaryType === 'study_notes' ? 'Study Notes' :
                     selectedItem.summaryType === 'academic' ? 'Academic Summary' :
                     'Summary'
                   ) : 
                   'Lesson'}
                </div>
                <div className="font-semibold truncate" title={selectedItem.title}>{selectedItem.title}</div>
                {selectedItem.description && (
                  <div className="text-xs text-muted-foreground line-clamp-2 mt-1 overflow-hidden break-words">
                    {selectedItem.description.length > 150 
                      ? selectedItem.description.substring(0, 150) + '...' 
                      : selectedItem.description}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-xs">Caption</Label>
              <Textarea
                rows={3}
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Write something about this challenge…"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Subject</Label>
              <Popover open={subjectOpen} onOpenChange={setSubjectOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={subjectOpen}
                    className="h-8 w-full justify-between text-xs font-normal"
                  >
                    {subject ? getSubjectLabel(subject) : "Select subject"}
                    <ChevronDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0 z-[1200]" align="start" side="bottom" sideOffset={4}>
                  <Command>
                    <CommandInput placeholder="Search subjects..." className="h-8 text-xs" />
                    <CommandList>
                      <CommandEmpty>No subject found.</CommandEmpty>
                      <CommandGroup>
                        <CommandItem onSelect={() => { setSubject('math'); setSelectedTopics([]); setSubjectOpen(false); }}>
                          <Check className={`mr-2 h-3 w-3 ${subject === 'math' ? 'opacity-100' : 'opacity-0'}`} />
                          Math
                        </CommandItem>
                        <CommandItem onSelect={() => { setSubject('reading-writing'); setSelectedTopics([]); setSubjectOpen(false); }}>
                          <Check className={`mr-2 h-3 w-3 ${subject === 'reading-writing' ? 'opacity-100' : 'opacity-0'}`} />
                          Reading & Writing
                        </CommandItem>
                        <CommandItem onSelect={() => { setSubject('science'); setSelectedTopics([]); setSubjectOpen(false); }}>
                          <Check className={`mr-2 h-3 w-3 ${subject === 'science' ? 'opacity-100' : 'opacity-0'}`} />
                          Science (General)
                        </CommandItem>
                        <CommandItem onSelect={() => { setSubject('biology'); setSelectedTopics([]); setSubjectOpen(false); }}>
                          <Check className={`mr-2 h-3 w-3 ${subject === 'biology' ? 'opacity-100' : 'opacity-0'}`} />
                          Biology
                        </CommandItem>
                        <CommandItem onSelect={() => { setSubject('chemistry'); setSelectedTopics([]); setSubjectOpen(false); }}>
                          <Check className={`mr-2 h-3 w-3 ${subject === 'chemistry' ? 'opacity-100' : 'opacity-0'}`} />
                          Chemistry
                        </CommandItem>
                        <CommandItem onSelect={() => { setSubject('physics'); setSelectedTopics([]); setSubjectOpen(false); }}>
                          <Check className={`mr-2 h-3 w-3 ${subject === 'physics' ? 'opacity-100' : 'opacity-0'}`} />
                          Physics
                        </CommandItem>
                        <CommandItem onSelect={() => { setSubject('history'); setSelectedTopics([]); setSubjectOpen(false); }}>
                          <Check className={`mr-2 h-3 w-3 ${subject === 'history' ? 'opacity-100' : 'opacity-0'}`} />
                          History
                        </CommandItem>
                        <CommandItem onSelect={() => { setSubject('economics'); setSelectedTopics([]); setSubjectOpen(false); }}>
                          <Check className={`mr-2 h-3 w-3 ${subject === 'economics' ? 'opacity-100' : 'opacity-0'}`} />
                          Economics
                        </CommandItem>
                        <CommandItem onSelect={() => { setSubject('business'); setSelectedTopics([]); setSubjectOpen(false); }}>
                          <Check className={`mr-2 h-3 w-3 ${subject === 'business' ? 'opacity-100' : 'opacity-0'}`} />
                          Business
                        </CommandItem>
                        <CommandItem onSelect={() => { setSubject('computer-science'); setSelectedTopics([]); setSubjectOpen(false); }}>
                          <Check className={`mr-2 h-3 w-3 ${subject === 'computer-science' ? 'opacity-100' : 'opacity-0'}`} />
                          Computer Science
                        </CommandItem>
                        <CommandItem onSelect={() => { setSubject('language'); setSelectedTopics([]); setSubjectOpen(false); }}>
                          <Check className={`mr-2 h-3 w-3 ${subject === 'language' ? 'opacity-100' : 'opacity-0'}`} />
                          Languages
                        </CommandItem>
                        <CommandItem onSelect={() => { setSubject('arts'); setSelectedTopics([]); setSubjectOpen(false); }}>
                          <Check className={`mr-2 h-3 w-3 ${subject === 'arts' ? 'opacity-100' : 'opacity-0'}`} />
                          Arts & Humanities
                        </CommandItem>
                        <CommandItem onSelect={() => { setSubject('politics'); setSelectedTopics([]); setSubjectOpen(false); }}>
                          <Check className={`mr-2 h-3 w-3 ${subject === 'politics' ? 'opacity-100' : 'opacity-0'}`} />
                          Political Science
                        </CommandItem>
                        <CommandItem onSelect={() => { setSubject('psychology'); setSelectedTopics([]); setSubjectOpen(false); }}>
                          <Check className={`mr-2 h-3 w-3 ${subject === 'psychology' ? 'opacity-100' : 'opacity-0'}`} />
                          Psychology
                        </CommandItem>
                        <CommandItem onSelect={() => { setSubject('sociology'); setSelectedTopics([]); setSubjectOpen(false); }}>
                          <Check className={`mr-2 h-3 w-3 ${subject === 'sociology' ? 'opacity-100' : 'opacity-0'}`} />
                          Sociology
                        </CommandItem>
                        <CommandItem onSelect={() => { setSubject('philosophy'); setSelectedTopics([]); setSubjectOpen(false); }}>
                          <Check className={`mr-2 h-3 w-3 ${subject === 'philosophy' ? 'opacity-100' : 'opacity-0'}`} />
                          Philosophy
                        </CommandItem>
                        <CommandItem onSelect={() => { setSubject('law'); setSelectedTopics([]); setSubjectOpen(false); }}>
                          <Check className={`mr-2 h-3 w-3 ${subject === 'law' ? 'opacity-100' : 'opacity-0'}`} />
                          Law
                        </CommandItem>
                        <CommandItem onSelect={() => { setSubject('engineering'); setSelectedTopics([]); setSubjectOpen(false); }}>
                          <Check className={`mr-2 h-3 w-3 ${subject === 'engineering' ? 'opacity-100' : 'opacity-0'}`} />
                          Engineering
                        </CommandItem>
                        <CommandItem onSelect={() => { setSubject('health'); setSelectedTopics([]); setSubjectOpen(false); }}>
                          <Check className={`mr-2 h-3 w-3 ${subject === 'health' ? 'opacity-100' : 'opacity-0'}`} />
                          Health & Medicine
                        </CommandItem>
                        <CommandItem onSelect={() => { setSubject('movies'); setSelectedTopics([]); setSubjectOpen(false); }}>
                          <Check className={`mr-2 h-3 w-3 ${subject === 'movies' ? 'opacity-100' : 'opacity-0'}`} />
                          Movies & TV
                        </CommandItem>
                        <CommandItem onSelect={() => { setSubject('sports'); setSelectedTopics([]); setSubjectOpen(false); }}>
                          <Check className={`mr-2 h-3 w-3 ${subject === 'sports' ? 'opacity-100' : 'opacity-0'}`} />
                          Sports
                        </CommandItem>
                        <CommandItem onSelect={() => { setSubject('music'); setSelectedTopics([]); setSubjectOpen(false); }}>
                          <Check className={`mr-2 h-3 w-3 ${subject === 'music' ? 'opacity-100' : 'opacity-0'}`} />
                          Music
                        </CommandItem>
                        <CommandItem onSelect={() => { setSubject('gaming'); setSelectedTopics([]); setSubjectOpen(false); }}>
                          <Check className={`mr-2 h-3 w-3 ${subject === 'gaming' ? 'opacity-100' : 'opacity-0'}`} />
                          Gaming
                        </CommandItem>
                        <CommandItem onSelect={() => { setSubject('travel'); setSelectedTopics([]); setSubjectOpen(false); }}>
                          <Check className={`mr-2 h-3 w-3 ${subject === 'travel' ? 'opacity-100' : 'opacity-0'}`} />
                          Travel & Geography
                        </CommandItem>
                        <CommandItem onSelect={() => { setSubject('food'); setSelectedTopics([]); setSubjectOpen(false); }}>
                          <Check className={`mr-2 h-3 w-3 ${subject === 'food' ? 'opacity-100' : 'opacity-0'}`} />
                          Food & Cooking
                        </CommandItem>
                        <CommandItem onSelect={() => { setSubject('fitness'); setSelectedTopics([]); setSubjectOpen(false); }}>
                          <Check className={`mr-2 h-3 w-3 ${subject === 'fitness' ? 'opacity-100' : 'opacity-0'}`} />
                          Fitness & Wellness
                        </CommandItem>
                        <CommandItem onSelect={() => { setSubject('technology'); setSelectedTopics([]); setSubjectOpen(false); }}>
                          <Check className={`mr-2 h-3 w-3 ${subject === 'technology' ? 'opacity-100' : 'opacity-0'}`} />
                          Technology & Gadgets
                        </CommandItem>
                        <CommandItem onSelect={() => { setSubject('nature'); setSelectedTopics([]); setSubjectOpen(false); }}>
                          <Check className={`mr-2 h-3 w-3 ${subject === 'nature' ? 'opacity-100' : 'opacity-0'}`} />
                          Nature & Animals
                        </CommandItem>
                        <CommandItem onSelect={() => { setSubject('other'); setSelectedTopics([]); setSubjectOpen(false); }}>
                          <Check className={`mr-2 h-3 w-3 ${subject === 'other' ? 'opacity-100' : 'opacity-0'}`} />
                          Other
                        </CommandItem>
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Topics (up to 3)</Label>
              <Popover open={topicsOpen} onOpenChange={setTopicsOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={topicsOpen}
                    className="h-auto min-h-8 w-full justify-between text-xs font-normal"
                    disabled={!subject}
                  >
                    <div className="flex flex-wrap gap-1">
                      {selectedTopics.length === 0 ? (
                        <span className="text-muted-foreground">
                          {subject ? "Select topics (up to 3)" : "Choose subject first"}
                        </span>
                      ) : (
                        selectedTopics.map((topic) => (
                          <span key={topic} className="inline-flex items-center gap-1 bg-muted px-2 py-1 rounded text-xs">
                            {getTopicLabel(topic)}
                            <X 
                              className="h-3 w-3 cursor-pointer hover:text-destructive" 
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedTopics(prev => prev.filter(t => t !== topic));
                              }}
                            />
                          </span>
                        ))
                      )}
                    </div>
                    <ChevronDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0 z-[1200]" align="start" side="bottom" sideOffset={4}>
                  <Command>
                    <CommandInput placeholder="Search topics..." className="h-8 text-xs" />
                    <CommandList>
                      <CommandEmpty>No topics found.</CommandEmpty>
                      <CommandGroup>
                        {getTopicsForSubject(subject).map((topic) => (
                          <CommandItem 
                            key={topic.value}
                            onSelect={() => {
                              if (selectedTopics.includes(topic.value)) {
                                setSelectedTopics(prev => prev.filter(t => t !== topic.value));
                              } else if (selectedTopics.length < 3) {
                                setSelectedTopics(prev => [...prev, topic.value]);
                              }
                            }}
                            disabled={!selectedTopics.includes(topic.value) && selectedTopics.length >= 3}
                          >
                            <Check className={`mr-2 h-3 w-3 ${selectedTopics.includes(topic.value) ? 'opacity-100' : 'opacity-0'}`} />
                            {topic.label}
                            {selectedTopics.length >= 3 && !selectedTopics.includes(topic.value) && (
                              <span className="ml-auto text-xs text-muted-foreground">(max 3)</span>
                            )}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Visibility</Label>
              <Popover open={visibilityOpen} onOpenChange={setVisibilityOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={visibilityOpen}
                    className="h-8 w-full justify-between text-xs font-normal"
                  >
                    {selectedGroupForPost 
                      ? getVisibilityLabel("group", selectedGroupForPost)
                      : getVisibilityLabel(visibility)
                    }
                    <ChevronDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0 z-[1200]" align="start" side="bottom" sideOffset={4}>
                  <Command>
                    <CommandList>
                      <CommandGroup>
                        <CommandItem onSelect={() => { 
                          setSelectedGroupForPost(null);
                          setVisibility("public");
                          setVisibilityOpen(false);
                        }}>
                          <Check className={`mr-2 h-3 w-3 ${!selectedGroupForPost && visibility === 'public' ? 'opacity-100' : 'opacity-0'}`} />
                          <Globe2 className="mr-2 h-3 w-3" />
                          Public
                        </CommandItem>
                        <CommandItem onSelect={() => { 
                          setSelectedGroupForPost(null);
                          setVisibility("friends");
                          setVisibilityOpen(false);
                        }}>
                          <Check className={`mr-2 h-3 w-3 ${!selectedGroupForPost && visibility === 'friends' ? 'opacity-100' : 'opacity-0'}`} />
                          <Lock className="mr-2 h-3 w-3" />
                          Friends only
                        </CommandItem>
                        {userGroups.length > 0 && (
                          <>
                            <div className="px-2 py-1 text-xs font-medium text-muted-foreground border-t">Groups</div>
                            {userGroups.map(group => (
                              <CommandItem key={group.id} onSelect={() => { 
                                setSelectedGroupForPost(group.id);
                                setVisibility("friends");
                                setVisibilityOpen(false);
                              }}>
                                <Check className={`mr-2 h-3 w-3 ${selectedGroupForPost === group.id ? 'opacity-100' : 'opacity-0'}`} />
                                {group.isPrivate ? <Lock className="mr-2 h-3 w-3" /> : <Globe2 className="mr-2 h-3 w-3" />}
                                {group.name}
                              </CommandItem>
                            ))}
                          </>
                        )}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                // Go back to picker step (same dialog, no backdrop issues)
                setPostDialogStep('picker');
                setSelectedItem(null);
                setCaption("");
                setSubject("");
                setSelectedTopics([]);
                setVisibilityOpen(false);
                setSubjectOpen(false);
                setTopicsOpen(false);
              }}
            >
              Back
            </Button>
            <div className="relative">
              <UsageAnimation show={showPostAnim} />
              <Button
                size="sm"
                disabled={!subject || selectedTopics.length === 0 || posting}
                onClick={async () => {
                  triggerPostAnim();
                  if (!selectedItem || !userId || !subject || selectedTopics.length === 0) return;
                
                // Prevent posting without a username
                if (!username || username.trim() === '') {
                  toast({
                    title: "Username required",
                    description: "Please set your username in Account settings before posting to the feed.",
                    variant: "destructive"
                  });
                  return;
                }
                
                setPosting(true);
                try {
                  [subject, ...selectedTopics].filter(Boolean);
                  const postRef = doc(collection(db as any, 'feed_posts'));

                  // PRIVACY: content is private-by-default. Explicitly mark the
                  // source item as shared so other users can open the challenge.
                  try {
                    const sourceCollection = selectedItem.type === 'flashcards' ? 'flashcard_sets'
                      : selectedItem.type === 'quiz' ? 'quizzes'
                      : selectedItem.type === 'lesson' ? 'lessons'
                      : 'summaries';
                    await setDoc(doc(db as any, 'users', userId, sourceCollection, selectedItem.id), { shared: true }, { merge: true });
                  } catch (e) {
                    console.error('Failed to mark source content as shared:', e);
                  }
                  
                  // Handle group visibility
                  const isGroupPost = selectedGroupForPost !== null;
                  const actualVisibility = isGroupPost ? 'group' : visibility;
                  
                  const postData: any = {
                    ownerId: userId,
                    ownerUsername: username, // Username is required - checked above
                    ownerPhotoURL: photoUrl || null,
                    title: selectedItem.title,
                    description: caption || selectedItem.description || '',
                    type: selectedItem.type,
                    summaryType: selectedItem.summaryType || null,
                    sourceRef: { type: selectedItem.type, docId: selectedItem.id },
                    topics: [subject, ...selectedTopics].filter(Boolean),
                    visibility: actualVisibility,
                    subject,
                    class: selectedTopics[0] || '',
                    likeCount: 0,
                    dislikeCount: 0,
                    commentCount: 0,
                    participantCount: 0,
                    createdAt: serverTimestamp(),
                    lastActivityAt: serverTimestamp(),
                  };
                  
                  // Add groupId for group posts
                  if (selectedGroupForPost) {
                    postData.groupId = selectedGroupForPost;
                  }
                  
                  await setDoc(postRef as any, postData);
                  
                  // Invalidate feed cache so refresh/re-render loads fresh data from Firestore
                  try {
                    sessionStorage.removeItem(`feed_posts_${userId}`);
                    sessionStorage.removeItem(`feed_posts_ts_${userId}`);
                  _feedMemCache.delete(userId); // Invalidate memory cache so tab-switch reloads fresh
                  } catch {}
                  
                  // Add the new post to local state immediately for real-time update
                  const newPost: FeedPost = {
                    id: postRef.id,
                    ownerId: userId,
                    ownerUsername: username, // Username is required - checked above
                    ownerPhotoURL: photoUrl || null,
                    title: selectedItem.title,
                    description: caption || selectedItem.description || '',
                    type: selectedItem.type as any,
                    summaryType: selectedItem.summaryType || undefined,
                    sourceRef: { type: selectedItem.type, docId: selectedItem.id },
                    coverImageUrl: null,
                    visibility: actualVisibility as any,
                    topics: [subject, ...selectedTopics].filter(Boolean),
                    likeCount: 0,
                    dislikeCount: 0,
                    commentCount: 0,
                    participantCount: 0,
                    createdAt: new Date(),
                    lastActivityAt: new Date(),
                    subject,
                    class: selectedTopics[0] || '',
                  };
                  
                  // Add to appropriate feed based on visibility and current filter
                  const shouldAddToMain = filterTab === 'for-you' || filterTab === 'latest' || filterTab === 'my-posts';
                  if (shouldAddToMain) {
                    setPosts(prevPosts => [newPost, ...prevPosts]);
                  }
                  
                  if (selectedGroupForPost) {
                    setGroupPosts(prev => [newPost, ...prev]);
                  }
                  
                  // Count usage for posting to feed (based on caption length, minimum 1)
                  try {
                    const result = await incrementMonthlyUsage(userId, {
                      inputChars: Math.max(1, caption.length),
                    });
                    console.log('Usage counted for posting to feed:', {
                      title: selectedItem?.title,
                      captionLength: caption.length,
                      usageResult: result
                    });
                    // Award posting achievements and track for weekly goals
                    try {
                      await incrementCounterAndAwardOn(userId, 'posts', [
                        [1, 'first_post'],
                        [10, 'posts_10'],
                        [100, 'posts_100'],
                        [1000, 'posts_1000'],
                      ]);
                    } catch {}
                  } catch (e: any) {
                    toast({
                      title: "Usage limit reached",
                      description: e?.message || "You have reached your monthly limit. Upgrade your plan or purchase extra uses.",
                      variant: "destructive"
                    });
                    setPosting(false);
                    return;
                  }
                  // Save group name before resetting state
                  const groupName = selectedGroupForPost 
                    ? userGroups.find(g => g.id === selectedGroupForPost)?.name || 'the group'
                    : null;
                  
                  // Force synchronous state update to close dialog immediately
                  flushSync(() => {
                    setPickerOpen(false);
                    setPosting(false);
                    setSelectedItem(null);
                    setSelectedGroupForPost(null);
                    setVisibility("public");
                    setCaption("");
                    setSubject("");
                    setSelectedTopics([]);
                    setVisibilityOpen(false);
                    setSubjectOpen(false);
                    setTopicsOpen(false);
                    setPostDialogStep('picker');
                  });
                  
                  // Show success toast
                  toast({
                    title: 'Posted to Feed',
                    description: groupName 
                      ? `Your challenge is now visible in ${groupName}.`
                      : 'Your challenge is now visible in the feed.',
                  });
                  return;
                } catch (e: any) {
                  toast({
                    title: 'Failed to post',
                    description: e?.message || 'Please try again.',
                    variant: 'destructive',
                  });
                } finally {
                  setPosting(false);
                }
              }}
            >
              {posting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Posting...</> : selectedGroupForPost 
                  ? `Post to ${userGroups.find(g => g.id === selectedGroupForPost)?.name || 'Group'}`
                  : 'Post to Feed'
                }
              </Button>
            </div>
          </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Post Dialog */}
      <Dialog
        open={!!editingPost}
        onOpenChange={(open) => {
          if (!open) {
            setEditingPost(null);
            setEditCaption("");
            setEditSubject("");
            setEditKlass("");
            setEditVisibility("public");
            setEditLoading(false);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Post</DialogTitle>
            <DialogDescription>Update your post details</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            {editingPost && (
              <div className="p-3 border rounded bg-muted/40">
                <div className="text-[11px] uppercase text-muted-foreground mb-1">
                  {editingPost.type === 'quiz' ? 'Quiz' : 
                   editingPost.type === 'flashcards' ? 'Flashcards' : 
                   editingPost.type === 'summary' ? 'Summary' :
                   'Lesson'}
                </div>
                <div className="font-semibold truncate" title={editingPost.title}>{editingPost.title}</div>
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-xs">Caption</Label>
              <Textarea
                rows={3}
                value={editCaption}
                onChange={(e) => setEditCaption(e.target.value)}
                placeholder="Write something about this challenge…"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Subject</Label>
              <Select value={editSubject} onValueChange={setEditSubject}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select subject" />
                </SelectTrigger>
                <SelectContent position="popper" sideOffset={4}>
                  <SelectItem value="math">Math</SelectItem>
                  <SelectItem value="reading-writing">Reading & Writing</SelectItem>
                  <SelectItem value="science">Science (General)</SelectItem>
                  <SelectItem value="biology">Biology</SelectItem>
                  <SelectItem value="chemistry">Chemistry</SelectItem>
                  <SelectItem value="physics">Physics</SelectItem>
                  <SelectItem value="history">History</SelectItem>
                  <SelectItem value="economics">Economics</SelectItem>
                  <SelectItem value="business">Business</SelectItem>
                  <SelectItem value="computer-science">Computer Science</SelectItem>
                  <SelectItem value="language">Languages</SelectItem>
                  <SelectItem value="arts">Arts & Humanities</SelectItem>
                  <SelectItem value="politics">Political Science</SelectItem>
                  <SelectItem value="psychology">Psychology</SelectItem>
                  <SelectItem value="sociology">Sociology</SelectItem>
                  <SelectItem value="philosophy">Philosophy</SelectItem>
                  <SelectItem value="law">Law</SelectItem>
                  <SelectItem value="engineering">Engineering</SelectItem>
                  <SelectItem value="health">Health & Medicine</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Class / Topic</Label>
              <Select value={editKlass} onValueChange={setEditKlass}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder={editSubject ? "Select class / topic" : "Choose subject first"} />
                </SelectTrigger>
                <SelectContent position="popper" sideOffset={4}>
                  {editSubject === 'math' && (
                    <>
                      <SelectItem value="elementary-addition">Math, Addition (Elementary)</SelectItem>
                      <SelectItem value="elementary-fractions">Math, Fractions (Elementary)</SelectItem>
                      <SelectItem value="pre-algebra">Pre-Algebra</SelectItem>
                      <SelectItem value="algebra-1">Algebra 1</SelectItem>
                      <SelectItem value="geometry">Geometry</SelectItem>
                      <SelectItem value="algebra-2">Algebra 2</SelectItem>
                      <SelectItem value="trigonometry">Trigonometry</SelectItem>
                      <SelectItem value="calculus-1">Calculus 1</SelectItem>
                      <SelectItem value="calculus-2">Calculus 2</SelectItem>
                      <SelectItem value="calculus-3">Calculus 3</SelectItem>
                      <SelectItem value="linear-algebra">Linear Algebra</SelectItem>
                      <SelectItem value="statistics">Statistics / Probability</SelectItem>
                    </>
                  )}
                  {editSubject === 'biology' && (
                    <>
                      <SelectItem value="intro-biology">Intro Biology</SelectItem>
                      <SelectItem value="cell-biology">Cell Biology</SelectItem>
                      <SelectItem value="genetics">Genetics</SelectItem>
                      <SelectItem value="human-biology">Human Biology / Anatomy</SelectItem>
                      <SelectItem value="ecology">Ecology</SelectItem>
                    </>
                  )}
                  {editSubject === 'chemistry' && (
                    <>
                      <SelectItem value="intro-chemistry">Intro Chemistry</SelectItem>
                      <SelectItem value="organic-chemistry">Organic Chemistry</SelectItem>
                      <SelectItem value="physical-chemistry">Physical Chemistry</SelectItem>
                    </>
                  )}
                  {editSubject === 'physics' && (
                    <>
                      <SelectItem value="mechanics">Mechanics</SelectItem>
                      <SelectItem value="electricity-magnetism">Electricity & Magnetism</SelectItem>
                      <SelectItem value="waves-optics">Waves & Optics</SelectItem>
                    </>
                  )}
                  {editSubject === 'economics' && (
                    <>
                      <SelectItem value="microeconomics">Microeconomics</SelectItem>
                      <SelectItem value="macroeconomics">Macroeconomics</SelectItem>
                      <SelectItem value="personal-finance">Personal Finance</SelectItem>
                    </>
                  )}
                  {editSubject === 'business' && (
                    <>
                      <SelectItem value="intro-business">Intro to Business</SelectItem>
                      <SelectItem value="marketing">Marketing</SelectItem>
                      <SelectItem value="management">Management</SelectItem>
                    </>
                  )}
                  {editSubject === 'computer-science' && (
                    <>
                      <SelectItem value="cs-intro">Intro to CS</SelectItem>
                      <SelectItem value="programming-basics">Programming Basics</SelectItem>
                      <SelectItem value="data-structures">Data Structures</SelectItem>
                      <SelectItem value="algorithms">Algorithms</SelectItem>
                    </>
                  )}
                  {editSubject === 'history' && (
                    <>
                      <SelectItem value="world-history">World History</SelectItem>
                      <SelectItem value="us-history">US History</SelectItem>
                      <SelectItem value="european-history">European History</SelectItem>
                    </>
                  )}
                  {editSubject === 'reading-writing' && (
                    <>
                      <SelectItem value="reading-comprehension">Reading Comprehension</SelectItem>
                      <SelectItem value="essay-writing">Essay Writing</SelectItem>
                      <SelectItem value="grammar">Grammar</SelectItem>
                    </>
                  )}
                  {editSubject === 'language' && (
                    <>
                      <SelectItem value="spanish">Spanish</SelectItem>
                      <SelectItem value="french">French</SelectItem>
                      <SelectItem value="german">German</SelectItem>
                      <SelectItem value="english-as-second-language">English as a Second Language</SelectItem>
                    </>
                  )}
                  {editSubject === 'science' && (
                    <>
                      <SelectItem value="earth-science">Earth Science</SelectItem>
                      <SelectItem value="environmental-science">Environmental Science</SelectItem>
                    </>
                  )}
                  {editSubject === 'other' && (
                    <SelectItem value="other-general">Other / General</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Visibility</Label>
              <Select value={editVisibility} onValueChange={(v) => setEditVisibility(v as "public" | "friends")}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" sideOffset={4}>
                  <SelectItem value="public">Public</SelectItem>
                  <SelectItem value="friends">Friends only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditingPost(null)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!editSubject || !editKlass || editLoading}
              onClick={saveEditPost}
            >
              {editLoading ? <><Loader2 className='w-4 h-4 mr-2 animate-spin' />Saving...</> : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={!!deleteConfirmPost}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteConfirmPost(null);
            setDeleting(false);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Post</DialogTitle>
            <DialogDescription>This action cannot be undone</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="text-muted-foreground">
              Are you sure you want to delete this post? This action cannot be undone.
            </div>
            {deleteConfirmPost && (
              <div className="p-3 border rounded bg-muted/40">
                <div className="font-semibold truncate" title={deleteConfirmPost.title}>{deleteConfirmPost.title}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {deleteConfirmPost.type === 'quiz' ? 'Quiz' : 
                   deleteConfirmPost.type === 'flashcards' ? 'Flashcards' : 
                   deleteConfirmPost.type === 'summary' ? 'Summary' :
                   'Lesson'} · {deleteConfirmPost.likeCount} likes · {deleteConfirmPost.commentCount} comments · {deleteConfirmPost.participantCount} participants
                </div>
              </div>
            )}
            <div className="text-xs text-muted-foreground bg-destructive/10 p-2 rounded">
              <strong>Warning:</strong> This will permanently delete the post and all associated likes, comments, and participation records.
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDeleteConfirmPost(null)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={deleting}
              onClick={() => deleteConfirmPost && deletePost(deleteConfirmPost)}
            >
              {deleting ? <><Loader2 className='w-4 h-4 mr-2 animate-spin' />Deleting...</> : 'Delete Post'}
            </Button>
          </DialogFooter>
        </DialogContent>
        </Dialog>

        {/* Leaderboard Dialog */}
        <Dialog open={leaderboardOpen} onOpenChange={setLeaderboardOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Medal className="w-5 h-5" />
                Challenge Leaderboard
              </DialogTitle>
              <DialogDescription>See who's leading this challenge</DialogDescription>
              <div className="text-sm text-muted-foreground">
                {selectedChallenge?.title}
              </div>
            </DialogHeader>
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {leaderboardData.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Trophy className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>No completions yet</p>
                  <p className="text-xs">Be the first to complete this challenge!</p>
                </div>
              ) : (
                leaderboardData.map((entry, index) => (
                  <div key={entry.userId} className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                    <div className="flex-shrink-0">
                      {index === 0 && <Medal className="w-5 h-5 text-yellow-500" />}
                      {index === 1 && <Medal className="w-5 h-5 text-gray-400" />}
                      {index === 2 && <Medal className="w-5 h-5 text-amber-600" />}
                      {index > 2 && <span className="w-5 h-5 flex items-center justify-center text-xs font-medium">{index + 1}</span>}
                    </div>
                    <Avatar className="w-8 h-8">
                      <AvatarImage src={entry.userPhotoURL || undefined} />
                      <AvatarFallback className="text-xs">{entry.username?.[0]?.toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{entry.username}</div>
                      <div className="text-xs text-muted-foreground">
                        Score: {entry.score}% · {entry.attempts} attempt{entry.attempts !== 1 ? 's' : ''}
                      </div>
                    </div>
                    {entry.userId === userId && (
                      <Badge variant="secondary" className="text-xs">You</Badge>
                    )}
                  </div>
                ))
              )}
            </div>
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLeaderboardOpen(false)}
                className="flex items-center gap-2"
              >
                <ExternalLink className="w-4 h-4" />
                Back to Feed
              </Button>
              {selectedChallenge && (
                <Button
                  size="sm"
                  onClick={async () => {
                    setLeaderboardOpen(false);
                    if (selectedChallenge) {
                      await joinChallenge(selectedChallenge, true);
                      // Usage is already tracked inside joinChallenge - no duplicate needed
                      setSelectedChallengeForPopup(selectedChallenge);
                      setChallengePopupOpen(true);
                    }
                  }}
                  className="flex items-center gap-2"
                >
                  <RotateCcw className="w-4 h-4" />
                  Redo Challenge
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Challenge Popup */}
        <ChallengePopup
          isOpen={challengePopupOpen}
          onClose={() => {
            setChallengePopupOpen(false);
            setSelectedChallengeForPopup(null);
          }}
          challenge={selectedChallengeForPopup}
          userId={userId}
          username={username || "user"}
          onSaveToLibrary={handleSaveToLibrary}
          onScoreUpdate={handleScoreUpdate}
          onOpenProfile={openProfileCard}
        />

        {/* Unified Profile Popup */}
        <UnifiedProfilePopup
          isOpen={profileCardOpen}
          onClose={() => {
            setProfileCardOpen(false);
            setSelectedProfile(null);
          }}
          targetUserId={selectedProfile?.userId || ''}
          targetUsername={selectedProfile?.username}
          targetPhotoURL={selectedProfile?.photoURL}
          currentUserId={userId}
          currentUsername={username}
        />

        {/* Moderator Ban Dialog */}
        <Dialog open={banDialogOpen} onOpenChange={setBanDialogOpen}>
          <DialogContent className="sm:max-w-[400px]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Ban className="w-5 h-5 text-red-500" />
                Ban User
              </DialogTitle>
              <DialogDescription>
                Apply restrictions to @{banTargetUser?.username}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>Ban Type</Label>
                <Select value={banType} onValueChange={(v) => setBanType(v as any)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cannot_post">
                      <span className="flex items-center gap-2">
                        <Trash2 className="w-4 h-4" /> Cannot Post
                      </span>
                    </SelectItem>
                    <SelectItem value="cannot_comment">
                      <span className="flex items-center gap-2">
                        <MessageSquareOff className="w-4 h-4" /> Cannot Comment
                      </span>
                    </SelectItem>
                    <SelectItem value="full">
                      <span className="flex items-center gap-2">
                        <Ban className="w-4 h-4" /> Full Ban
                      </span>
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
                  rows={2}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setBanDialogOpen(false)}>Cancel</Button>
              <Button variant="destructive" onClick={handleBanUser} disabled={banning}>
                {banning ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                {banning ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Banning...</> : 'Apply Ban'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      </div>
  );
};
