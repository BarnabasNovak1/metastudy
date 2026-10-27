import { useState, useEffect } from "react";
import { doc, getDoc, setDoc, deleteDoc, collection, query, where, getDocs, serverTimestamp, writeBatch } from "firebase/firestore";
import { db } from "../../firebase";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import { UserPlus, UserMinus, Star, UserCircle, Loader2 } from "lucide-react";

interface UnifiedProfilePopupProps {
  isOpen: boolean;
  onClose: () => void;
  targetUserId: string;
  targetUsername?: string;
  targetPhotoURL?: string | null;
  currentUserId: string;
  currentUsername?: string;
}

interface UserStats {
  postsCount: number;
  challengesJoined: number;
  challengesCompleted: number;
  friendsCount: number;
  xp: number;
  daysTotal: number;
  streakCurrent: number;
  streakLongest: number;
  educationLevel?: string;
  counters?: { 
    quizzes_count?: number; 
    chat_questions?: number; 
    flashcards_review_count?: number;
  } | null;
}

export const UnifiedProfilePopup = ({ 
  isOpen, 
  onClose, 
  targetUserId, 
  targetUsername, 
  targetPhotoURL,
  currentUserId,
  currentUsername 
}: UnifiedProfilePopupProps) => {
  const { toast } = useToast();
  const [, setLoading] = useState(false);
  
  const [stats, setStats] = useState<UserStats>({
    postsCount: 0,
    challengesJoined: 0,
    challengesCompleted: 0,
    friendsCount: 0,
    xp: 0,
    daysTotal: 0,
    streakCurrent: 0,
    streakLongest: 0,
    educationLevel: undefined,
    counters: null
  });
  const [friendshipStatus, setFriendshipStatus] = useState<'none' | 'pending' | 'friends' | 'blocked'>('none');
  const [sendingRequest, setSendingRequest] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);
  const [latestSent, setLatestSent] = useState<{emoji: string, timestamp: number} | null>(null);
  const [latestReceived, setLatestReceived] = useState<{emoji: string, timestamp: number} | null>(null);

  // Helper functions for level and rank
  const getLevelInfo = (xp: number) => {
    const level = Math.floor(xp / 1000) + 1;
    const current = xp % 1000;
    const required = 1000;
    const progress = current / required;
    return { level, progress, current, required };
  };

  const getRankTitle = (xp: number) => {
    if (xp >= 10000) return "Expert";
    if (xp >= 5000) return "Advanced";
    if (xp >= 2000) return "Intermediate";
    if (xp >= 500) return "Beginner";
    return "Newcomer";
  };

  useEffect(() => {
    if (isOpen && targetUserId && currentUserId) {
      // Reset emoji state when opening a different friend's popup
      setLatestSent(null);
      setLatestReceived(null);
      loadUserStats();
      loadFriendshipStatus();
    }
  }, [isOpen, targetUserId, currentUserId]);

  useEffect(() => {
    if (friendshipStatus === 'friends') {
      loadFavoriteStatus();
      loadEmojiReactions();
    }
  }, [friendshipStatus]);

  const loadUserStats = async () => {
    if (!targetUserId) return;
    
    setLoading(true);
    try {
      // PRIVACY: read the server-maintained public_profiles mirror instead of
      // the target user's private data (users doc, meta, runs, friends are owner-only)
      const [postsSnap, profileSnap] = await Promise.all([
        getDocs(query(collection(db as any, "feed_posts"), where("ownerId", "==", targetUserId))).catch(() => ({ size: 0 })),
        getDoc(doc(db as any, "public_profiles", targetUserId)).catch(() => ({ exists: () => false, data: () => ({}) }))
      ]);

      const postsCount = postsSnap.size || 0;
      const profile: any = profileSnap.exists() ? profileSnap.data() : {};

      setStats({
        postsCount,
        challengesJoined: Number(profile.challenges_joined || 0),
        challengesCompleted: Number(profile.challenges_completed || 0),
        friendsCount: Number(profile.friends_count || 0),
        xp: Number(profile.xp || 0),
        daysTotal: Number(profile.days_total || 0),
        streakCurrent: Number(profile.streak_current || 0),
        streakLongest: Number(profile.streak_longest || 0),
        educationLevel: profile.education_level || undefined,
        counters: {
          quizzes_count: Number(profile.quizzes || 0),
          chat_questions: Number(profile.chats || 0),
          flashcards_review_count: Number(profile.flashcards || 0),
        }
      });
    } catch (error) {
      console.error("Failed to load user stats:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadFriendshipStatus = async () => {
    if (!targetUserId || !currentUserId || targetUserId === currentUserId) return;
    
    try {
      // Only read from current user's collections (we have permission for those)
      // Check: friends list and outgoing friend_requests
      const [friendSnap, outgoingRequestSnap] = await Promise.all([
        getDoc(doc(db as any, "users", currentUserId, "friends", targetUserId)),
        getDoc(doc(db as any, "users", currentUserId, "friend_requests", targetUserId)) // My outgoing request to them
      ]);
      
      if (friendSnap.exists()) {
        setFriendshipStatus('friends');
        // Also set favorite status from same read (saves another read)
        setIsFavorite(friendSnap.data()?.favorite || false);
        return;
      }

      // Check if I have an outgoing request to them (type: 'outgoing')
      if (outgoingRequestSnap.exists()) {
        setFriendshipStatus('pending');
        return;
      }

      setFriendshipStatus('none');
    } catch (error) {
      console.error("Failed to load friendship status:", error);
    }
  };

  const loadFavoriteStatus = async () => {
    // OPTIMIZED: Already loaded in loadFriendshipStatus, no need to read again
  };

  const loadEmojiReactions = async () => {
    if (!targetUserId || !currentUserId || targetUserId === currentUserId) return;
    
    // OPTIMIZED: Check localStorage cache first for instant display
    const dayMs = 24 * 60 * 60 * 1000;
    const now = Date.now();
    try {
      const cacheKey = `sent_reaction_${currentUserId}_${targetUserId}`;
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.emoji && (now - parsed.ts) <= dayMs) {
          setLatestSent({ emoji: parsed.emoji, timestamp: parsed.ts / 1000 });
        }
      }
    } catch {}
    
    try {
      // OPTIMIZED: Parallel reads for sent and received reactions
      // Check both emoji_reactions (legacy) and sent_reactions (new format)
      const [sentReactionSnap, sentEmojiSnap, receivedSnap] = await Promise.all([
        getDoc(doc(db as any, "users", currentUserId, "sent_reactions", targetUserId)),
        getDoc(doc(db as any, "users", targetUserId, "emoji_reactions", currentUserId)),
        getDoc(doc(db as any, "users", currentUserId, "emoji_reactions", targetUserId))
      ]);
      
      // Prefer sent_reactions (newer format, per-friend)
      if (sentReactionSnap.exists()) {
        const data = sentReactionSnap.data();
        const ts = data.created_at?.toMillis?.() || Date.now();
        if (data.emoji && (now - ts) <= dayMs) {
          setLatestSent({ emoji: data.emoji, timestamp: ts / 1000 });
        }
      } else if (sentEmojiSnap.exists()) {
        // Fallback to emoji_reactions
        const data = sentEmojiSnap.data();
        const ts = data.timestamp?.seconds ? data.timestamp.seconds * 1000 : Date.now();
        if (data.emoji && (now - ts) <= dayMs) {
          setLatestSent({ emoji: data.emoji, timestamp: ts / 1000 });
        }
      }

      if (receivedSnap.exists()) {
        const data = receivedSnap.data();
        const ts = data.timestamp?.seconds ? data.timestamp.seconds * 1000 : Date.now();
        if (data.emoji && (now - ts) <= dayMs) {
          setLatestReceived({ emoji: data.emoji, timestamp: ts / 1000 });
        }
      }
    } catch (error) {
      console.error("Failed to load emoji reactions:", error);
    }
  };

  const sendFriendRequest = async () => {
    if (!targetUserId || !currentUserId || targetUserId === currentUserId) return;
    
    setSendingRequest(true);
    try {
      const now = serverTimestamp();
      
      // Create outgoing record on sender's side
      await setDoc(doc(db as any, 'users', currentUserId, 'friend_requests', targetUserId), {
        type: 'outgoing',
        from: currentUserId,
        to: targetUserId,
        status: 'pending',
        created_at: now,
        to_username: (targetUsername || '').toLowerCase(),
        from_username: (currentUsername || '').toLowerCase(),
      }, { merge: true });
      
      // Create incoming record on recipient's side (must match Firestore rules)
      await setDoc(doc(db as any, 'users', targetUserId, 'friend_requests', currentUserId), {
        type: 'incoming',
        from: currentUserId,
        to: targetUserId,
        status: 'pending',
        created_at: now,
        from_username: (currentUsername || '').toLowerCase(),
        from_photo: null,
      }, { merge: true });

      setFriendshipStatus('pending');
      toast({
        title: "Friend request sent",
        description: `Friend request sent to @${targetUsername}`
      });
    } catch (error) {
      console.error('Friend request error:', error);
      toast({
        title: "Failed to send request",
        description: "Could not send friend request.",
        variant: "destructive"
      });
    } finally {
      setSendingRequest(false);
    }
  };

  const cancelFriendRequest = async () => {
    if (!targetUserId || !currentUserId) return;
    
    setSendingRequest(true);
    try {
      // Delete from both sides (sender's outgoing and recipient's incoming)
      await Promise.all([
        deleteDoc(doc(db as any, "users", currentUserId, "friend_requests", targetUserId)),
        deleteDoc(doc(db as any, "users", targetUserId, "friend_requests", currentUserId))
      ]);

      setFriendshipStatus('none');
      toast({
        title: "Request cancelled",
        description: "Friend request cancelled"
      });
    } catch (error) {
      toast({
        title: "Failed to cancel",
        description: "Could not cancel friend request.",
        variant: "destructive"
      });
    } finally {
      setSendingRequest(false);
    }
  };

  const removeFriend = async () => {
    if (!targetUserId || !currentUserId) return;
    
    setSendingRequest(true);
    try {
      // Remove from both users' friends lists
      const friendRef1 = doc(db as any, "users", currentUserId, "friends", targetUserId);
      const friendRef2 = doc(db as any, "users", targetUserId, "friends", currentUserId);
      
      await Promise.all([
        deleteDoc(friendRef1),
        deleteDoc(friendRef2)
      ]);

      setFriendshipStatus('none');
      setIsFavorite(false);
      toast({
        title: "Friend removed",
        description: `Removed @${targetUsername} from friends`
      });
    } catch (error) {
      toast({
        title: "Failed to remove friend",
        description: "Could not remove friend.",
        variant: "destructive"
      });
    } finally {
      setSendingRequest(false);
    }
  };

  const toggleFavorite = async () => {
    if (!targetUserId || !currentUserId || friendshipStatus !== 'friends') return;
    
    try {
      const friendRef = doc(db as any, "users", currentUserId, "friends", targetUserId);
      await setDoc(friendRef as any, {
        favorite: !isFavorite
      }, { merge: true });

      setIsFavorite(!isFavorite);
      toast({
        title: isFavorite ? "Removed from favorites" : "Added to favorites",
        description: `@${targetUsername} ${isFavorite ? 'removed from' : 'added to'} favorites`
      });
    } catch (error) {
      toast({
        title: "Failed to update favorite",
        description: "Could not update favorite status.",
        variant: "destructive"
      });
    }
  };

  const sendReaction = async (emoji: string) => {
    if (!targetUserId || !currentUserId || friendshipStatus !== 'friends') return;
    
    try {
      // OPTIMIZED: Use batch write to save both sender and receiver records in one operation
      const batch = writeBatch(db as any);
      
      // 1. Save in target's emoji_reactions (so they can see it)
      const targetReactionRef = doc(db as any, "users", targetUserId, "emoji_reactions", currentUserId);
      batch.set(targetReactionRef, {
        emoji: emoji,
        timestamp: serverTimestamp(),
        fromUserId: currentUserId,
        fromUsername: currentUsername || "user"
      });
      
      // 2. Save in sender's sent_reactions (so sender can see "Sent {emoji}" per friend)
      const senderReactionRef = doc(db as any, "users", currentUserId, "sent_reactions", targetUserId);
      batch.set(senderReactionRef, {
        emoji: emoji,
        created_at: serverTimestamp(),
      }, { merge: true } as any);
      
      await batch.commit();

      // Update local state immediately
      setLatestSent({
        emoji: emoji,
        timestamp: Date.now() / 1000
      });
      
      // Cache in localStorage for instant display on reload
      try {
        const cacheKey = `sent_reaction_${currentUserId}_${targetUserId}`;
        localStorage.setItem(cacheKey, JSON.stringify({ emoji, ts: Date.now() }));
      } catch {}

      toast({
        title: "Reaction sent!",
        description: `Sent ${emoji} to @${targetUsername}`
      });
    } catch (error) {
      toast({
        title: "Failed to send reaction",
        description: "Could not send reaction.",
        variant: "destructive"
      });
    }
  };

  const getFriendshipButton = () => {
    if (targetUserId === currentUserId) return null;

    switch (friendshipStatus) {
      case 'none':
        return (
          <Button 
            onClick={sendFriendRequest}
            disabled={sendingRequest}
            className="flex items-center gap-2"
          >
            {sendingRequest ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
            {sendingRequest ? "Sending..." : "Add Friend"}
          </Button>
        );
      case 'pending':
        return (
          <Button 
            variant="outline"
            onClick={cancelFriendRequest}
            disabled={sendingRequest}
            className="flex items-center gap-2"
          >
            {sendingRequest ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserMinus className="w-4 h-4" />}
            {sendingRequest ? "Cancelling..." : "Cancel Request"}
          </Button>
        );
      case 'friends':
        return (
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              size="sm"
              onClick={toggleFavorite}
              className="flex items-center gap-2"
            >
              <Star className={`w-4 h-4 ${isFavorite ? "text-yellow-500 fill-yellow-500" : ""}`} />
              {isFavorite ? "Favorited" : "Favorite"}
            </Button>
            <Button 
              variant="outline" 
              size="sm"
              onClick={removeFriend}
              disabled={sendingRequest}
            >
              {sendingRequest ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <UserMinus className="w-4 h-4 mr-2" />}
              {sendingRequest ? "Removing..." : "Remove"}
            </Button>
          </div>
        );
      default:
        return null;
    }
  };

  const levelInfo = getLevelInfo(stats.xp);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-[360px] sm:max-w-md max-h-[85vh] overflow-hidden flex flex-col p-4 sm:p-6">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2 sm:gap-3">
            <Avatar className="h-10 w-10 sm:h-12 sm:w-12 flex-shrink-0">
              {targetPhotoURL ? (
                <AvatarImage src={targetPhotoURL} alt={targetUsername || "user"} />
              ) : (
                <AvatarFallback className="text-base sm:text-lg">
                  <UserCircle className="w-5 h-5 sm:w-6 sm:h-6" />
                </AvatarFallback>
              )}
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="text-base sm:text-lg font-semibold truncate">@{targetUsername || "user"}</div>
              <div className="text-xs sm:text-sm text-muted-foreground">{getRankTitle(stats.xp)}</div>
              <div className="text-[10px] sm:text-xs text-muted-foreground truncate hidden sm:block">
                {stats.educationLevel ? (stats.educationLevel === 'elementary' ? 'Elementary' : stats.educationLevel === 'middle' ? 'Middle School' : stats.educationLevel === 'high' ? 'High School' : stats.educationLevel === 'middle_high' ? 'Middle/High' : stats.educationLevel === 'university' ? 'University' : stats.educationLevel === 'working' ? 'Working' : stats.educationLevel === 'entry_level' ? 'Entry Level' : stats.educationLevel === 'mid_career' ? 'Mid-Career' : stats.educationLevel === 'senior' ? 'Senior' : stats.educationLevel) : ''}
              </div>
              <div className="flex gap-1 mt-1">
                {friendshipStatus === 'friends' && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Friend</Badge>
                )}
                {isFavorite && (
                  <Badge variant="default" className="text-[10px] px-1.5 py-0 bg-yellow-500">Fav</Badge>
                )}
              </div>
            </div>
          </DialogTitle>
          <DialogDescription className="sr-only">User profile and statistics</DialogDescription>
        </DialogHeader>
        
        <div className="flex-1 overflow-y-auto space-y-3 sm:space-y-4">
          {/* Level Progress */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs sm:text-sm">
              <span>Level {levelInfo.level}</span>
              <span>{stats.xp} XP</span>
            </div>
            {(() => {
              const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
              const trackStyle = !isDark ? ({ backgroundColor: '#FEF8CA' } as React.CSSProperties) : undefined;
              const indicatorStyle = isDark ? ({ backgroundColor: '#FEF8CA' } as React.CSSProperties) : undefined;
              return (
                <Progress 
                  value={Math.round(levelInfo.progress * 100)} 
                  className="h-1.5 sm:h-2" 
                  style={trackStyle}
                  indicatorStyle={indicatorStyle}
                />
              );
            })()}
          </div>

          {/* Stats Grid - Compact */}
          <div className="grid grid-cols-4 gap-1.5 sm:gap-3 text-xs sm:text-sm">
            <div className="text-center p-1.5 sm:p-3 bg-muted rounded-lg">
              <div className="text-sm sm:text-lg font-bold">{stats.postsCount}</div>
              <div className="text-muted-foreground text-[10px] sm:text-xs">Posts</div>
            </div>
            <div className="text-center p-1.5 sm:p-3 bg-muted rounded-lg">
              <div className="text-sm sm:text-lg font-bold">{stats.friendsCount}</div>
              <div className="text-muted-foreground text-[10px] sm:text-xs">Friends</div>
            </div>
            <div className="text-center p-1.5 sm:p-3 bg-muted rounded-lg">
              <div className="text-sm sm:text-lg font-bold">{stats.challengesCompleted}</div>
              <div className="text-muted-foreground text-[10px] sm:text-xs">Done</div>
            </div>
            <div className="text-center p-1.5 sm:p-3 bg-muted rounded-lg">
              <div className="text-sm sm:text-lg font-bold">{stats.streakCurrent}</div>
              <div className="text-muted-foreground text-[10px] sm:text-xs">Streak</div>
            </div>
          </div>

          {/* Detailed Activity Stats - Hidden on mobile */}
          <div className="hidden sm:block space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span>Total Study Days:</span>
              <span className="font-medium">{stats.daysTotal}</span>
            </div>
            <div className="flex justify-between">
              <span>Longest Streak:</span>
              <span className="font-medium">{stats.streakLongest} days</span>
            </div>
            <div className="flex justify-between">
              <span>Total Generations:</span>
              <span className="font-medium">{(stats.counters?.quizzes_count || 0) + (stats.counters?.chat_questions || 0) + (stats.counters?.flashcards_review_count || 0)}</span>
            </div>
            <div className="flex justify-between">
              <span>Challenges Joined:</span>
              <span className="font-medium">{stats.challengesJoined}</span>
            </div>
          </div>

          {/* Emoji Reactions - Only for friends */}
          {friendshipStatus === 'friends' && (
            <div className="space-y-2">
              <div className="text-xs sm:text-sm font-medium">Send Reaction</div>
              <div className="flex gap-1 sm:gap-2 flex-wrap justify-center">
                {['👍', '❤️', '😊', '🎉', '🔥', '💪'].map((emoji) => (
                  <Button
                    key={emoji}
                    variant="outline"
                    size="sm"
                    className="text-base sm:text-lg p-1.5 sm:p-2 h-auto min-w-[32px] sm:min-w-[40px]"
                    onClick={() => sendReaction(emoji)}
                  >
                    {emoji}
                  </Button>
                ))}
              </div>
              
              {/* Emoji Status Display - Compact on mobile */}
              {(latestSent || latestReceived) && (
                <div className="flex items-center justify-center gap-3 text-xs text-muted-foreground pt-1">
                  {latestSent && (
                    <span>You: {latestSent.emoji}</span>
                  )}
                  {latestReceived && (
                    <span>Them: {latestReceived.emoji}</span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Action Buttons - Fixed at bottom */}
        <div className="flex-shrink-0 flex justify-center pt-2 border-t mt-2">
          {getFriendshipButton()}
        </div>
      </DialogContent>
    </Dialog>
  );
};
