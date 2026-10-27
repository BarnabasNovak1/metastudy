import { useState, useEffect } from "react";
import { doc, collection, query, orderBy, updateDoc, deleteDoc, setDoc, serverTimestamp, getDocs, arrayUnion, getDoc, limit } from "firebase/firestore";
import { db } from "../../../firebase";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Bell, Users, Heart, MessageCircle, ThumbsDown, UserPlus, Settings, Check, X, Trash2, Inbox, Mail, UserCheck, FileText } from "lucide-react";

interface Notification {
  id: string;
  type: 'group_invite' | 'group_invite_admin' | 'post_like' | 'post_dislike' | 'post_comment' | 'friend_request';
  fromUserId: string;
  fromUsername: string;
  fromPhotoURL?: string;
  title: string;
  message: string;
  data?: any;
  read: boolean;
  createdAt: any;
}

interface WeeklyGoals {
  daysGoal: number;
  sessionsGoal: number;
  minutesGoal: number;
}

interface UserStats {
  activeDays: number;
  totalSessions: number;
  totalMinutes: number;
  streakCurrent: number;
  streakLongest: number;
  xp: number;
}

interface NotificationCenterProps {
  userId: string;
  username?: string;
  isOpen: boolean;
  onClose: () => void;
  onGroupsUpdate?: () => void;
  userStats?: UserStats;
  weeklyGoals?: WeeklyGoals;
}



export const NotificationCenter = ({ userId, username, isOpen, onClose, onGroupsUpdate }: NotificationCenterProps) => {
  const { toast } = useToast();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [activeTab, setActiveTab] = useState("all");
  const [notificationSettings, setNotificationSettings] = useState({
    groupInvites: true,
    postLikes: true,
    postComments: true,
    friendRequests: true
  });

  useEffect(() => {
    if (!userId || !isOpen) return;

    let active = true;
    const loadNotifications = async () => {
      try {
        const notificationsRef = collection(db as any, "users", userId, "notifications");
        const q = query(notificationsRef, orderBy("createdAt", "desc"), limit(50));
        const snapshot = await getDocs(q);
        if (!active) return;
        const notifs: Notification[] = [];
        snapshot.forEach((doc) => {
          notifs.push({
            id: doc.id,
            ...doc.data()
          } as Notification);
        });
        setNotifications(notifs);
      } catch (error) {
        console.error("Failed to load notifications:", error);
      }
    };

    loadNotifications();
    loadNotificationSettings();

    return () => {
      active = false;
    };
  }, [userId, isOpen]);

  const loadNotificationSettings = async () => {
    try {
      const settingsRef = doc(db as any, "users", userId, "settings", "notifications");
      const settingsSnap = await getDoc(settingsRef);
      
      if (settingsSnap.exists()) {
        setNotificationSettings(settingsSnap.data() as any);
      }
    } catch (error) {
      console.error("Failed to load notification settings:", error);
    }
  };

  const updateNotificationSettings = async (newSettings: any) => {
    try {
      const settingsRef = doc(db as any, "users", userId, "settings", "notifications");
      await setDoc(settingsRef, newSettings);
      setNotificationSettings(newSettings);
      toast({
        title: "Settings updated",
        description: "Your notification preferences have been saved."
      });
    } catch (error) {
      toast({
        title: "Failed to update settings",
        description: "Please try again.",
        variant: "destructive"
      });
    }
  };

  const markAsRead = async (notificationId: string) => {
    try {
      const notifRef = doc(db as any, "users", userId, "notifications", notificationId);
      await updateDoc(notifRef, { read: true });
    } catch (error) {
      console.error("Failed to mark notification as read:", error);
    }
  };

  const deleteNotification = async (notificationId: string) => {
    try {
      const notifRef = doc(db as any, "users", userId, "notifications", notificationId);
      await deleteDoc(notifRef);
      toast({
        title: "Notification deleted",
        description: "The notification has been removed."
      });
    } catch (error) {
      toast({
        title: "Failed to delete notification",
        description: "Please try again.",
        variant: "destructive"
      });
    }
  };

  const handleGroupInvite = async (notification: Notification, accept: boolean) => {
    try {
      const { groupId, groupName } = notification.data;
      
      if (accept) {
        // Add user to group
        const groupRef = doc(db as any, "groups", groupId);
        await updateDoc(groupRef, {
          members: arrayUnion(userId),
          [`memberUsernames.${userId}`]: username || "user"
        });

        // Add group to user's groups
        const userGroupRef = doc(db as any, "users", userId, "groups", groupId);
        await setDoc(userGroupRef as any, {
          groupId,
          groupName,
          role: "member",
          joinedAt: serverTimestamp()
        });

        toast({
          title: "Joined group",
          description: `You have joined ${groupName}`
        });
        
        // Refresh groups in parent component
        if (onGroupsUpdate) {
          onGroupsUpdate();
        }
      }

      // Delete the notification
      await deleteNotification(notification.id);
    } catch (error) {
      toast({
        title: accept ? "Failed to join group" : "Failed to decline invite",
        description: "Please try again.",
        variant: "destructive"
      });
    }
  };

  
  const filteredNotifications = notifications.filter(notif => {
    if (activeTab === "all") return true;
    if (activeTab === "unread") return !notif.read;
    if (activeTab === "invites") return notif.type.includes('invite') || notif.type === 'friend_request';
    if (activeTab === "posts") return notif.type.startsWith('post_');
    return true;
  });

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bell className="w-5 h-5" />
            Notifications
            {unreadCount > 0 && (
              <Badge variant="destructive" className="text-xs">
                {unreadCount}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          {/* Mobile-optimized tabs */}
          <TabsList className="grid w-full grid-cols-4 h-auto p-1">
            <TabsTrigger value="all" className="text-xs px-1 py-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground flex items-center gap-1">
              <Inbox className="w-3 h-3" />
              <span className="hidden sm:inline">All</span>
            </TabsTrigger>
            <TabsTrigger value="unread" className="text-xs px-1 py-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground flex items-center gap-1">
              <Mail className="w-3 h-3" />
              <span className="hidden sm:inline">Unread</span>
              {unreadCount > 0 && (
                <Badge variant="secondary" className="text-[10px] px-1 py-0">
                  {unreadCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="invites" className="text-xs px-1 py-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground flex items-center gap-1">
              <UserCheck className="w-3 h-3" />
              <span className="hidden sm:inline">Invites</span>
            </TabsTrigger>
            <TabsTrigger value="posts" className="text-xs px-1 py-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground flex items-center gap-1">
              <FileText className="w-3 h-3" />
              <span className="hidden sm:inline">Posts</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="all" className="mt-4">
            <NotificationList 
              notifications={filteredNotifications}
              onMarkRead={markAsRead}
              onDelete={deleteNotification}
              onGroupInvite={handleGroupInvite}
            />
          </TabsContent>

          <TabsContent value="unread" className="mt-4">
            <NotificationList 
              notifications={filteredNotifications}
              onMarkRead={markAsRead}
              onDelete={deleteNotification}
              onGroupInvite={handleGroupInvite}
            />
          </TabsContent>

          <TabsContent value="invites" className="mt-4">
            <NotificationList 
              notifications={filteredNotifications}
              onMarkRead={markAsRead}
              onDelete={deleteNotification}
              onGroupInvite={handleGroupInvite}
            />
          </TabsContent>

          <TabsContent value="posts" className="mt-4">
            <NotificationList 
              notifications={filteredNotifications}
              onMarkRead={markAsRead}
              onDelete={deleteNotification}
              onGroupInvite={handleGroupInvite}
            />
          </TabsContent>
        </Tabs>

        {/* Settings */}
        <div className="border-t pt-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold">Notification Settings</span>
            <Settings className="w-4 h-4 text-muted-foreground" />
          </div>
          
          <div className="space-y-3 text-sm">
            <label className="flex items-center justify-between cursor-pointer group">
              <span className="text-muted-foreground group-hover:text-foreground transition-colors">Group invites</span>
              <button
                type="button"
                role="switch"
                aria-checked={notificationSettings.groupInvites}
                onClick={() => updateNotificationSettings({
                  ...notificationSettings,
                  groupInvites: !notificationSettings.groupInvites
                })}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${notificationSettings.groupInvites ? 'bg-primary' : 'bg-muted'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${notificationSettings.groupInvites ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </button>
            </label>
            
            <label className="flex items-center justify-between cursor-pointer group">
              <span className="text-muted-foreground group-hover:text-foreground transition-colors">Post likes</span>
              <button
                type="button"
                role="switch"
                aria-checked={notificationSettings.postLikes}
                onClick={() => updateNotificationSettings({
                  ...notificationSettings,
                  postLikes: !notificationSettings.postLikes
                })}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${notificationSettings.postLikes ? 'bg-primary' : 'bg-muted'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${notificationSettings.postLikes ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </button>
            </label>
            
            <label className="flex items-center justify-between cursor-pointer group">
              <span className="text-muted-foreground group-hover:text-foreground transition-colors">Post comments</span>
              <button
                type="button"
                role="switch"
                aria-checked={notificationSettings.postComments}
                onClick={() => updateNotificationSettings({
                  ...notificationSettings,
                  postComments: !notificationSettings.postComments
                })}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${notificationSettings.postComments ? 'bg-primary' : 'bg-muted'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${notificationSettings.postComments ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </button>
            </label>
            
            <label className="flex items-center justify-between cursor-pointer group">
              <span className="text-muted-foreground group-hover:text-foreground transition-colors">Friend requests</span>
              <button
                type="button"
                role="switch"
                aria-checked={notificationSettings.friendRequests}
                onClick={() => updateNotificationSettings({
                  ...notificationSettings,
                  friendRequests: !notificationSettings.friendRequests
                })}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${notificationSettings.friendRequests ? 'bg-primary' : 'bg-muted'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${notificationSettings.friendRequests ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </button>
            </label>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

interface NotificationListProps {
  notifications: Notification[];
  onMarkRead: (id: string) => void;
  onDelete: (id: string) => void;
  onGroupInvite: (notification: Notification, accept: boolean) => void;
}

const NotificationList = ({ notifications, onMarkRead, onDelete, onGroupInvite }: NotificationListProps) => {
  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'group_invite':
      case 'group_invite_admin':
        return <Users className="w-4 h-4 text-blue-500" />;
      case 'post_like':
        return <Heart className="w-4 h-4 text-red-500" />;
      case 'post_dislike':
        return <ThumbsDown className="w-4 h-4 text-gray-500" />;
      case 'post_comment':
        return <MessageCircle className="w-4 h-4 text-green-500" />;
      case 'friend_request':
        return <UserPlus className="w-4 h-4 text-purple-500" />;
      default:
        return <Bell className="w-4 h-4" />;
    }
  };

  if (notifications.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Bell className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No notifications</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 max-h-96 overflow-y-auto">
      {notifications.map((notification) => (
        <Card key={notification.id} className={`p-3 border transition-colors ${!notification.read ? 'bg-primary/5 border-primary/20 dark:bg-primary/10 dark:border-primary/30' : 'hover:bg-muted/50'}`}>
          <div className="flex items-start gap-3">
            <Avatar className="w-9 h-9 border-2 border-background shadow-sm">
              <AvatarImage src={notification.fromPhotoURL || undefined} />
              <AvatarFallback className="text-xs bg-muted">
                {notification.fromUsername[0]?.toUpperCase()}
              </AvatarFallback>
            </Avatar>
            
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                {getNotificationIcon(notification.type)}
                <span className="text-sm font-medium truncate">{notification.title}</span>
                {!notification.read && (
                  <div className="w-2 h-2 bg-primary rounded-full flex-shrink-0 animate-pulse" />
                )}
              </div>
              
              <p className="text-xs text-muted-foreground mb-2">
                {notification.message}
              </p>
              
              <div className="flex items-center gap-2 flex-wrap">
                {(notification.type === 'group_invite' || notification.type === 'group_invite_admin') && (
                  <>
                    <Button
                      size="sm"
                      onClick={() => onGroupInvite(notification, true)}
                      className="h-7 px-3 text-xs font-medium bg-primary hover:bg-primary/90 text-primary-foreground rounded-full shadow-sm transition-all"
                    >
                      <Check className="w-3 h-3 mr-1.5" />
                      Accept
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onGroupInvite(notification, false)}
                      className="h-7 px-3 text-xs font-medium border-muted-foreground/30 hover:bg-muted hover:border-muted-foreground/50 rounded-full transition-all"
                    >
                      <X className="w-3 h-3 mr-1.5" />
                      Decline
                    </Button>
                  </>
                )}
                
                {!notification.read && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onMarkRead(notification.id)}
                    className="h-7 px-3 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded-full transition-all"
                  >
                    <Check className="w-3 h-3 mr-1.5" />
                    Mark read
                  </Button>
                )}
                
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onDelete(notification.id)}
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-full ml-auto transition-all"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
};
