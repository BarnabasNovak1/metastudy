import { useState, useEffect } from "react";
import { doc, setDoc, collection, query, where, getDocs, serverTimestamp, getDoc, limit, updateDoc, type DocumentReference } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { incrementCounterAndAwardOn } from "@/lib/achievements";
import { db, functions as fbFunctions } from "../../../firebase";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Users, Plus, Settings, UserPlus, UserMinus, Crown, Copy, Check, Shield, X, UserCheck, Lock, Globe, HelpCircle, Loader2, Trash2 } from "lucide-react";
import { sendGroupInviteNotification } from "@/lib/notifications";

interface Group {
  id: string;
  name: string;
  description: string;
  createdBy: string;
  createdByUsername: string;
  members: string[];
  memberUsernames: { [userId: string]: string };
  admins: string[];
  inviteCode: string;
  createdAt: any;
  isPrivate: boolean;
  scoresVisible?: boolean;
  joinRequests?: { [userId: string]: { username: string; requestedAt: any } };
  // Moderator access
  moderatorAccessRequested?: boolean;
  moderatorAccessReason?: string;
}

interface GroupsManagerProps {
  userId: string;
  username?: string;
  userGroups: Group[];
  selectedGroup: string | null;
  onGroupSelect: (groupId: string | null) => void;
  onGroupsUpdate: () => void;
}

export const GroupsManager = ({ 
  userId, 
  username, 
  userGroups, 
  selectedGroup, 
  onGroupSelect, 
  onGroupsUpdate 
}: GroupsManagerProps) => {
  const { toast } = useToast();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [joinDialogOpen, setJoinDialogOpen] = useState(false);
  const [groupSettingsOpen, setGroupSettingsOpen] = useState(false);
  const [selectedGroupForSettings, setSelectedGroupForSettings] = useState<Group | null>(null);
  const [activeTab, setActiveTab] = useState("feed");
  
  // Create group form
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDescription, setNewGroupDescription] = useState("");
  const [newGroupPrivate, setNewGroupPrivate] = useState(false);
  const [creating, setCreating] = useState(false);
  
  // Join group form
  const [inviteCode, setInviteCode] = useState("");
  const [joining, setJoining] = useState(false);
  
  // Settings
  const [copiedCode, setCopiedCode] = useState(false);
  
  // Member management
  const [groupMembers, setGroupMembers] = useState<any[]>([]);
  const [groupDetail, setGroupDetail] = useState<any>(null); // fresh group doc for the selected group
  const [scoresToggleLoading, setScoresToggleLoading] = useState(false);
  const [scoresVisibleFlag, setScoresVisibleFlag] = useState(true);
  const [joinRequests, setJoinRequests] = useState<any[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  // Member action confirmation (add/remove admin, kick)
  const [memberConfirm, setMemberConfirm] = useState<{ type: 'admin' | 'kick'; member: any } | null>(null);
  const [memberActionLoading, setMemberActionLoading] = useState(false);
  // Discover dialog
  const [discoverOpen, setDiscoverOpen] = useState(false);
  // Delete group
  const [deleteConfirmGroup, setDeleteConfirmGroup] = useState<Group | null>(null);
  const [deletingGroup, setDeletingGroup] = useState(false);
  
  // Discover groups
  const [allGroups, setAllGroups] = useState<Group[]>([]);
  const [filteredGroups, setFilteredGroups] = useState<Group[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loadingDiscover, setLoadingDiscover] = useState(false);
  
  // Invite dialog
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteTargetGroup, setInviteTargetGroup] = useState<Group | null>(null);
  const [inviteUsername, setInviteUsername] = useState("");
  const [inviteLoading, setInviteLoading] = useState(false);
  
  // Moderator help dialog
  const [modHelpDialogOpen, setModHelpDialogOpen] = useState(false);
  const [modHelpReason, setModHelpReason] = useState("");
  const [modHelpLoading, setModHelpLoading] = useState(false);
  const [modHelpTargetGroup, setModHelpTargetGroup] = useState<Group | null>(null);

  // Load members when selectedGroup changes or Members tab is activated.
  // Fetch by group ID directly - don't depend on userGroups being loaded.
  useEffect(() => {
    if (selectedGroup && activeTab === 'members') {
      const group = userGroups.find(g => g.id === selectedGroup);
      loadGroupMembers(group || ({ id: selectedGroup } as Group));
    }
  }, [selectedGroup, activeTab, userGroups]);

  const generateInviteCode = () => {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  };

  const createGroup = async () => {
    if (!newGroupName.trim() || !userId) return;
    
    setCreating(true);
    try {
      const groupRef = doc(collection(db as any, "groups"));
      const inviteCode = generateInviteCode();
      
      await setDoc(groupRef as any, {
        name: newGroupName.trim(),
        description: newGroupDescription.trim(),
        createdBy: userId,
        createdByUsername: username || "user",
        members: [userId],
        memberUsernames: { [userId]: username || "user" },
        admins: [userId],
        inviteCode,
        createdAt: serverTimestamp(),
        isPrivate: newGroupPrivate,
        scoresVisible: true,
        joinRequests: {}
      });

      // Award group creation achievements
      try {
        await incrementCounterAndAwardOn(userId, 'groups_created', [
          [1, 'first_group'],
          [10, 'groups_10'],
        ]);
      } catch {}

      // Add group to user's groups
      const userGroupRef = doc(db as any, "users", userId, "groups", groupRef.id);
      await setDoc(userGroupRef as any, {
        groupId: groupRef.id,
        groupName: newGroupName.trim(),
        role: "admin",
        joinedAt: serverTimestamp()
      });

      toast({
        title: "Group created",
        description: `${newGroupName} has been created successfully`
      });

      setNewGroupName("");
      setNewGroupDescription("");
      setNewGroupPrivate(false);
      setCreateDialogOpen(false);
      onGroupsUpdate();
    } catch (error: any) {
      console.error("Error creating group:", error);
      toast({
        title: "Failed to create group",
        description: error?.message || "Please check your connection and try again.",
        variant: "destructive"
      });
    } finally {
      setCreating(false);
    }
  };

  const joinGroup = async () => {
    if (!inviteCode.trim() || !userId) return;
    setJoining(true);
    try {
      // Invite code joins instantly - even for private groups, since the code
      // can only be given out by the owner/admins. Server-side join.
      const fn = httpsCallable(fbFunctions, 'joinGroupByCode');
      const res = await fn({ inviteCode: inviteCode.trim().toUpperCase() }) as any;
      toast({
        title: "Joined group",
        description: `You have joined ${res?.data?.groupName || 'the group'}`
      });
      setInviteCode("");
      setJoinDialogOpen(false);
      onGroupsUpdate();
    } catch (error: any) {
      toast({
        title: "Failed to join group",
        description: error?.message || "Please try again.",
        variant: "destructive"
      });
    } finally {
      setJoining(false);
    }
  };

  const leaveGroup = async (group: Group) => {
    if (!userId) return;
    try {
      const fn = httpsCallable(fbFunctions, 'leaveGroup');
      await fn({ groupId: group.id });

      toast({
        title: "Left group",
        description: `You have left ${group.name}`
      });

      if (selectedGroup === group.id) {
        onGroupSelect(null);
      }
      onGroupsUpdate();
    } catch (error) {
      toast({
        title: "Failed to leave group",
        description: "Please try again.",
        variant: "destructive"
      });
    }
  };

  const copyInviteCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
      toast({
        title: "Invite code copied",
        description: "Share this code with others to invite them to the group"
      });
    } catch (error) {
      toast({
        title: "Failed to copy",
        description: "Please copy the code manually",
        variant: "destructive"
      });
    }
  };

  const loadGroupMembers = async (group: Group) => {
    if (!group) return;
    
    setLoadingMembers(true);
    try {
      const groupRef = doc(db as any, "groups", group.id);
      const groupSnap = await getDoc(groupRef);
      
      if (groupSnap.exists()) {
        const data = groupSnap.data();
        const members = data.members || [];
        const admins = data.admins || [];
        const memberUsernames = data.memberUsernames || {};
        const joinRequests = data.joinRequests || {};
        const creatorId = data.createdBy || group.createdBy;
        setGroupDetail({ id: group.id, ...data });
        
        const membersList = members.map((memberId: string) => ({
          id: memberId,
          username: memberUsernames[memberId] || "Unknown",
          isAdmin: admins.includes(memberId),
          isCreator: memberId === creatorId
        }));

        // Fetch member stats (xp/quizzes/flashcards) from public_profiles only
        // when the viewer is allowed: scores visible OR viewer is owner/admin.
        const canSeeScores = data.scoresVisible !== false ||
          creatorId === userId || admins.includes(userId);
        if (canSeeScores && members.length > 0) {
          try {
            const statsMap: Record<string, { xp: number; quizzes: number; flashcards: number }> = {};
            for (let i = 0; i < members.length; i += 30) {
              const batch = members.slice(i, i + 30);
              const refs = batch.map((id: string) => doc(db as any, 'public_profiles', id));
              const snaps = await Promise.all(refs.map((r: DocumentReference) => getDoc(r as any)));
              snaps.forEach((s: any, j: number) => {
                if (s.exists()) {
                  const p = s.data();
                  statsMap[batch[j]] = {
                    xp: Number(p.xp || 0),
                    quizzes: Number(p.quizzes || 0),
                    flashcards: Number(p.flashcards || 0),
                  };
                }
              });
            }
            membersList.forEach((m: { id: string }) => { (m as any).stats = statsMap[m.id] || null; });
          } catch {}
        }
        setScoresVisibleFlag(data.scoresVisible !== false);
        
        // Sort: creator first, then admins, then regular members
        membersList.sort((a: any, b: any) => {
          if (a.isCreator) return -1;
          if (b.isCreator) return 1;
          if (a.isAdmin && !b.isAdmin) return -1;
          if (b.isAdmin && !a.isAdmin) return 1;
          return 0;
        });
        
        const requestsList = Object.entries(joinRequests).map(([userId, data]: [string, any]) => ({
          id: userId,
          username: data.username,
          requestedAt: data.requestedAt
        }));
        
        setGroupMembers(membersList);
        setJoinRequests(requestsList);
      }
    } catch (error) {
      console.error("Failed to load group members:", error);
    } finally {
      setLoadingMembers(false);
    }
  };

  const kickMember = async (group: Group, memberId: string) => {
    if (!group || memberId === group.createdBy) return;
    try {
      const fn = httpsCallable(fbFunctions, 'kickGroupMember');
      await fn({ groupId: group.id, memberId });

      toast({
        title: "Member removed",
        description: "The member has been removed from the group."
      });

      loadGroupMembers(group);
      onGroupsUpdate();
    } catch (error) {
      toast({
        title: "Failed to remove member",
        description: "Please try again.",
        variant: "destructive"
      });
    }
  };

  const toggleAdmin = async (group: Group, memberId: string) => {
    if (!group || memberId === group.createdBy) return;
    try {
      const isCurrentlyAdmin = group.admins?.includes(memberId);
      const fn = httpsCallable(fbFunctions, 'setGroupAdmin');
      await fn({ groupId: group.id, memberId, makeAdmin: !isCurrentlyAdmin });

      toast({
        title: isCurrentlyAdmin ? "Admin removed" : "Admin added",
        description: `Member ${isCurrentlyAdmin ? "removed from" : "added to"} admin role.`
      });

      loadGroupMembers(group);
      onGroupsUpdate();
    } catch (error: any) {
      toast({
        title: "Failed to update admin status",
        description: error?.message || "Please try again.",
        variant: "destructive"
      });
    }
  };

  const runMemberAction = async () => {
    if (!memberConfirm) return;
    const group = userGroups.find(g => g.id === selectedGroup);
    if (!group) { setMemberConfirm(null); return; }
    setMemberActionLoading(true);
    try {
      if (memberConfirm.type === 'admin') await toggleAdmin(group, memberConfirm.member.id);
      else await kickMember(group, memberConfirm.member.id);
    } finally {
      setMemberActionLoading(false);
      setMemberConfirm(null);
    }
  };

  const handleJoinRequest = async (group: Group, memberId: string, approve: boolean) => {
    if (!group) return;
    try {
      const fn = httpsCallable(fbFunctions, 'respondToJoinRequest');
      await fn({ groupId: group.id, targetUid: memberId, approve });
      const request = joinRequests.find(r => r.id === memberId);
      toast({
        title: approve ? "Request approved" : "Request rejected",
        description: approve ? `${request?.username || 'User'} has been added to the group.` : "The join request has been rejected."
      });
      loadGroupMembers(group);
      onGroupsUpdate();
    } catch (error: any) {
      toast({
        title: "Failed to handle request",
        description: error?.message || "Please try again.",
        variant: "destructive"
      });
    }
  };

  // Admin/owner toggles whether member scores are visible to all members
  const toggleScoresVisible = async (group: Group) => {
    setScoresToggleLoading(true);
    try {
      const next = group.scoresVisible === false;
      await updateDoc(doc(db as any, "groups", group.id) as any, { scoresVisible: next });
      toast({ title: next ? "Scores visible" : "Scores hidden", description: next ? "All members can see each other's stats." : "Only owner/admins can see member stats." });
      onGroupsUpdate();
      setSelectedGroupForSettings({ ...group, scoresVisible: next } as any);
    } catch (e: any) {
      toast({ title: 'Failed to update setting', description: e?.message, variant: 'destructive' });
    } finally {
      setScoresToggleLoading(false);
    }
  };

  // Owner deletes the entire group
  const deleteGroup = async (group: Group) => {
    if (!group) return;
    setDeletingGroup(true);
    try {
      const fn = httpsCallable(fbFunctions, 'deleteGroup');
      await fn({ groupId: group.id });
      toast({ title: 'Group deleted', description: `${group.name} has been deleted.` });
      setDeleteConfirmGroup(null);
      setGroupSettingsOpen(false);
      setSelectedGroupForSettings(null);
      if (selectedGroup === group.id) onGroupSelect(null);
      onGroupsUpdate();
    } catch (e: any) {
      toast({ title: 'Failed to delete group', description: e?.message, variant: 'destructive' });
    } finally {
      setDeletingGroup(false);
    }
  };

  const loadDiscoverableGroups = async () => {
    setLoadingDiscover(true);
    try {
      const groupsRef = collection(db as any, "groups");
      // OPTIMIZED: Limit discover groups to 50 to reduce reads
      const groupsSnap = await getDocs(query(groupsRef, limit(50)));
      const groups: Group[] = [];
      
      groupsSnap.forEach((doc) => {
        const data = doc.data();
        // Only show groups that the user is not already a member of
        if (!data.members?.includes(userId)) {
          groups.push({
            id: doc.id,
            ...data
          } as Group);
        }
      });
      
      // Sort by member count (most popular first) and then by creation date
      groups.sort((a, b) => {
        const memberDiff = (b.members?.length || 0) - (a.members?.length || 0);
        if (memberDiff !== 0) return memberDiff;
        
        const aTime = a.createdAt?.seconds || 0;
        const bTime = b.createdAt?.seconds || 0;
        return bTime - aTime;
      });
      
      setAllGroups(groups);
      setFilteredGroups(groups);
    } catch (error) {
      console.error("Failed to load discoverable groups:", error);
      toast({
        title: "Failed to load groups",
        description: "Please try again.",
        variant: "destructive"
      });
    } finally {
      setLoadingDiscover(false);
    }
  };

  const searchGroups = (query: string) => {
    setSearchQuery(query);
    
    if (!query.trim()) {
      setFilteredGroups(allGroups);
      return;
    }
    
    const filtered = allGroups.filter(group => 
      group.name.toLowerCase().includes(query.toLowerCase()) ||
      group.description.toLowerCase().includes(query.toLowerCase()) ||
      group.createdByUsername.toLowerCase().includes(query.toLowerCase())
    );
    
    setFilteredGroups(filtered);
  };

  const joinDiscoveredGroup = async (group: Group) => {
    if (!userId) return;
    setJoining(true);
    try {
      const fn = httpsCallable(fbFunctions, 'requestGroupJoin');
      const res = await fn({ groupId: group.id }) as any;
      if (res?.data?.requested) {
        toast({
          title: "Join request sent",
          description: `Your request to join ${group.name} has been sent to the group owner/admins.`
        });
      } else {
        toast({
          title: "Joined group",
          description: `You have joined ${group.name}`
        });
      }
      loadDiscoverableGroups();
      onGroupsUpdate();
    } catch (error: any) {
      toast({
        title: "Failed to join group",
        description: error?.message || "Please try again.",
        variant: "destructive"
      });
    } finally {
      setJoining(false);
    }
  };

  // Request moderator help for group (creator only)
  const requestModeratorHelp = async () => {
    if (!modHelpTargetGroup) return;
    
    setModHelpLoading(true);
    try {
      const requestHelp = httpsCallable(fbFunctions, 'requestGroupModeratorHelp');
      await requestHelp({ groupId: modHelpTargetGroup.id, reason: modHelpReason });
      
      toast({
        title: "Help requested",
        description: "Moderators have been notified and can now access your group."
      });
      
      setModHelpDialogOpen(false);
      setModHelpReason("");
      setModHelpTargetGroup(null);
      onGroupsUpdate();
    } catch (error: any) {
      toast({
        title: "Failed to request help",
        description: error?.message || "Please try again.",
        variant: "destructive"
      });
    } finally {
      setModHelpLoading(false);
    }
  };

  // Revoke moderator access (creator only)
  const revokeModeratorAccess = async (group: Group) => {
    try {
      const revokeAccess = httpsCallable(fbFunctions, 'revokeGroupModeratorAccess');
      await revokeAccess({ groupId: group.id });
      
      toast({
        title: "Access revoked",
        description: "Moderators can no longer access your group."
      });
      
      onGroupsUpdate();
    } catch (error: any) {
      toast({
        title: "Failed to revoke access",
        description: error?.message || "Please try again.",
        variant: "destructive"
      });
    }
  };

  const inviteUserToGroup = async () => {
    if (!inviteTargetGroup || !inviteUsername.trim()) return;
    
    setInviteLoading(true);
    try {
      // Find user by username
      const usersRef = collection(db as any, "users");
      const userQuery = query(usersRef, where("username", "==", inviteUsername.trim()), limit(1));
      const userSnap = await getDocs(userQuery);
      
      if (userSnap.empty) {
        toast({
          title: "User not found",
          description: "No user found with that username.",
          variant: "destructive"
        });
        return;
      }
      
      const targetUser = userSnap.docs[0];
      const targetUserId = targetUser.id;
      targetUser.data();
      
      // Check if user is already a member
      if (inviteTargetGroup.members?.includes(targetUserId)) {
        toast({
          title: "Already a member",
          description: "This user is already a member of the group.",
          variant: "destructive"
        });
        return;
      }
      
      // Check if user already has a pending request or invite
      if (inviteTargetGroup.joinRequests?.[targetUserId]) {
        toast({
          title: "Request already exists",
          description: "This user already has a pending request for this group.",
          variant: "destructive"
        });
        return;
      }
      
      // Check if current user is admin
      const isCurrentUserAdmin = inviteTargetGroup.admins?.includes(userId);
      
      // Send notification
      await sendGroupInviteNotification(
        targetUserId,
        userId,
        username || "user",
        undefined, // photoUrl would need to be passed as prop
        inviteTargetGroup.id,
        inviteTargetGroup.name,
        isCurrentUserAdmin
      );
      
      toast({
        title: "Invitation sent",
        description: `Invitation sent to @${inviteUsername}`
      });
      
      setInviteDialogOpen(false);
      setInviteUsername("");
      setInviteTargetGroup(null);
    } catch (error) {
      toast({
        title: "Failed to send invitation",
        description: "Please try again.",
        variant: "destructive"
      });
    } finally {
      setInviteLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Group Selection and Actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4" />
          <span className="text-sm font-medium">Study Groups</span>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => { setDiscoverOpen(true); loadDiscoverableGroups(); }} data-tour="feed-discover-groups">
            <Globe className="w-3 h-3 mr-1" />
            Discover
          </Button>
          <Button size="sm" variant="outline" onClick={() => setJoinDialogOpen(true)} data-tour="feed-join-code">
            <UserPlus className="w-3 h-3 mr-1" />
            Join by code
          </Button>
          <Button size="sm" onClick={() => setCreateDialogOpen(true)} data-tour="feed-create-group">
            <Plus className="w-3 h-3 mr-1" />
            Create
          </Button>
        </div>
      </div>

      {/* Groups List */}
      <div className="space-y-2">
        <Button
          variant={selectedGroup === null ? "default" : "ghost"}
          size="sm"
          className="w-full justify-start"
          onClick={() => {
            onGroupSelect(null);
            setActiveTab("feed");
          }}
        >
          All Groups
        </Button>
        
        {userGroups.map((group) => (
          <div key={group.id} className="flex items-center gap-2">
            <Button
              variant={selectedGroup === group.id ? "default" : "ghost"}
              size="sm"
              className="flex-1 justify-start"
              onClick={() => {
                onGroupSelect(group.id);
                setActiveTab("feed");
              }}
            >
              <div className="flex items-center gap-2">
                {group.isPrivate ? <Lock className="w-3 h-3" /> : <Globe className="w-3 h-3" />}
                <Users className="w-3 h-3" />
                {group.name}
                <Badge variant="secondary" className="ml-2 text-xs">
                  {group.members?.length || 0}
                </Badge>
              </div>
            </Button>
            
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0"
              data-tour="feed-group-settings"
              onClick={() => {
                setSelectedGroupForSettings(group);
                loadGroupMembers(group);
                setGroupSettingsOpen(true);
              }}
            >
              <Settings className="w-3 h-3" />
            </Button>
          </div>
        ))}
      </div>

      {/* Group Tabs - only when a group is selected: Feed + Members */}
      {selectedGroup && (
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="feed">Feed</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
        </TabsList>
          
          <TabsContent value="feed" className="mt-4">
            <div className="text-center py-4 text-muted-foreground text-sm">
              Group feed content will appear here
            </div>
          </TabsContent>
          
          <TabsContent value="members" className="mt-4">
            {selectedGroup ? (
              loadingMembers ? (
                <div className="text-center py-4 text-muted-foreground text-sm">
                  Loading members...
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Join Requests (for admins) */}
                  {joinRequests.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-sm font-medium">Join Requests</h4>
                      {joinRequests.map((request) => (
                        <div key={request.id} className="flex items-center justify-between p-2 border rounded">
                          <div className="flex items-center gap-2">
                            <Avatar className="w-6 h-6">
                              <AvatarFallback className="text-xs">
                                {request.username[0]?.toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <span className="text-sm">@{request.username}</span>
                          </div>
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                const group = userGroups.find(g => g.id === selectedGroup);
                                if (group) handleJoinRequest(group, request.id, true);
                              }}
                            >
                              <UserCheck className="w-3 h-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                const group = userGroups.find(g => g.id === selectedGroup);
                                if (group) handleJoinRequest(group, request.id, false);
                              }}
                            >
                              <X className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Members List */}
                  <div className="space-y-2">
                    {(() => {
                      const currentGroup = userGroups.find(g => g.id === selectedGroup);
                      const memberCount = groupMembers.length > 0 ? groupMembers.length : (currentGroup?.members?.length || 0);
                      return <h4 className="text-sm font-medium">Members ({memberCount})</h4>;
                    })()}

                    {!scoresVisibleFlag && !(groupDetail?.createdBy === userId || groupDetail?.admins?.includes(userId)) && (
                      <p className="text-xs text-muted-foreground italic">Member scores are hidden by the group admins.</p>
                    )}
                    
                    {(() => {
                      const currentGroup = groupDetail?.id === selectedGroup ? groupDetail : userGroups.find(g => g.id === selectedGroup);
                      const membersToShow = groupMembers.length > 0 ? groupMembers : 
                        (currentGroup?.members || []).map((memberId: string) => ({
                          id: memberId,
                          username: currentGroup?.memberUsernames?.[memberId] || "Unknown",
                          isAdmin: currentGroup?.admins?.includes(memberId) || false,
                          isCreator: memberId === currentGroup?.createdBy
                        }));
                      
                      return (
                        <>
                          {membersToShow.map((member: any) => {
                            const isCurrentUserAdmin = currentGroup?.admins?.includes(userId);
                            
                            return (
                              <div key={member.id} className="flex items-center justify-between p-2 border rounded">
                                <div className="flex items-center gap-2">
                                  <Avatar className="w-6 h-6">
                                    <AvatarFallback className="text-xs">
                                      {member.username[0]?.toUpperCase()}
                                    </AvatarFallback>
                                  </Avatar>
                                  <span className="text-sm">@{member.username}</span>
                                  {member.isCreator && <Crown className="w-3 h-3 text-yellow-500" />}
                                  {member.isAdmin && !member.isCreator && <Shield className="w-3 h-3 text-blue-500" />}
                                  {member.stats && (
                                    <span className="text-[10px] text-muted-foreground ml-1">
                                      {member.stats.xp}xp • {member.stats.quizzes}q • {member.stats.flashcards}f
                                    </span>
                                  )}
                                </div>
                                
                                {isCurrentUserAdmin && !member.isCreator && member.id !== userId && (
                                  <div className="flex gap-1">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      title={member.isAdmin ? "Remove admin" : "Make admin"}
                                      onClick={() => setMemberConfirm({ type: 'admin', member })}
                                    >
                                      {member.isAdmin ? <UserMinus className="w-3 h-3" /> : <Shield className="w-3 h-3" />}
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      title="Remove from group"
                                      onClick={() => setMemberConfirm({ type: 'kick', member })}
                                    >
                                      <X className="w-3 h-3" />
                                    </Button>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </>
                      );
                    })()}
                  </div>
                </div>
              )
            ) : (
              <div className="text-center py-4 text-muted-foreground text-sm">
                Select a group to view members
              </div>
            )}
          </TabsContent>

        </Tabs>
      )}

      {/* Discover Groups Dialog - separate from a group's own feed/members */}
      <Dialog open={discoverOpen} onOpenChange={setDiscoverOpen}>
        <DialogContent className="w-[calc(100vw-1.5rem)] max-w-lg sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Globe className="w-5 h-5" />
              Discover Groups
            </DialogTitle>
          </DialogHeader>
            <div className="space-y-4">
              {/* Search Bar */}
              <div className="space-y-2">
                <Input
                  placeholder="Search groups by name, description, or creator..."
                  value={searchQuery}
                  onChange={(e) => searchGroups(e.target.value)}
                  className="w-full"
                />
                <Button
                  size="sm"
                  onClick={loadDiscoverableGroups}
                  disabled={loadingDiscover}
                  className="w-full"
                >
                  {loadingDiscover ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Loading...</> : "Refresh Groups"}
                </Button>
              </div>

              {/* Groups List */}
              {loadingDiscover ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Loading groups...</p>
                </div>
              ) : filteredGroups.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">
                    {searchQuery ? "No groups found matching your search" : "No groups available to join"}
                  </p>
                  {searchQuery && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => searchGroups("")}
                      className="mt-2"
                    >
                      Clear search
                    </Button>
                  )}
                </div>
              ) : (
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {filteredGroups.map((group) => (
                    <Card key={group.id} className="p-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            {group.isPrivate ? <Lock className="w-4 h-4 text-muted-foreground" /> : <Globe className="w-4 h-4 text-muted-foreground" />}
                            <h4 className="font-medium text-sm truncate">{group.name}</h4>
                            <Badge variant="secondary" className="text-xs">
                              {group.members?.length || 0} members
                            </Badge>
                          </div>
                          
                          {group.description && (
                            <p className="text-xs text-muted-foreground mb-2 line-clamp-2">
                              {group.description}
                            </p>
                          )}
                          
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span>Created by @{group.createdByUsername}</span>
                            {group.isPrivate && (
                              <Badge variant="outline" className="text-xs">
                                Private
                              </Badge>
                            )}
                          </div>
                        </div>
                        
                        <Button
                          size="sm"
                          onClick={() => joinDiscoveredGroup(group)}
                          disabled={joining}
                          className="ml-3"
                        >
                          {group.isPrivate ? (
                            <>
                              <UserPlus className="w-3 h-3 mr-1" />
                              Request
                            </>
                          ) : (
                            <>
                              <UserPlus className="w-3 h-3 mr-1" />
                              Join
                            </>
                          )}
                        </Button>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
        </DialogContent>
      </Dialog>

      {userGroups.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No groups yet</p>
          <p className="text-xs">Create or join a study group to get started</p>
        </div>
      )}

      {/* Create Group Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="w-[calc(100vw-1.5rem)] max-w-lg" aria-describedby="create-group-description">
          <DialogHeader>
            <DialogTitle>Create Study Group</DialogTitle>
          </DialogHeader>
          <p id="create-group-description" className="sr-only">
            Create a new study group by providing a name, optional description, and privacy settings.
          </p>
          
          <div className="space-y-4">
            <div>
              <Label htmlFor="groupName">Group Name</Label>
              <Input
                id="groupName"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="Enter group name"
                maxLength={50}
              />
            </div>
            
            <div>
              <Label htmlFor="groupDescription">Description (Optional)</Label>
              <Textarea
                id="groupDescription"
                value={newGroupDescription}
                onChange={(e) => setNewGroupDescription(e.target.value)}
                placeholder="Describe your study group"
                rows={3}
                maxLength={200}
              />
            </div>
            
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="groupPrivate"
                checked={newGroupPrivate}
                onChange={(e) => setNewGroupPrivate(e.target.checked)}
                className="rounded"
              />
              <Label htmlFor="groupPrivate" className="text-sm">
                Private group (join via invite code, or request, approved by owner/admins)
              </Label>
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={createGroup} 
              disabled={!newGroupName.trim() || creating}
            >
              {creating ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Creating...</> : "Create Group"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Join Group Dialog */}
      <Dialog open={joinDialogOpen} onOpenChange={setJoinDialogOpen}>
        <DialogContent className="w-[calc(100vw-1.5rem)] max-w-lg" aria-describedby="join-group-description">
          <DialogHeader>
            <DialogTitle>Join by Code</DialogTitle>
          </DialogHeader>
          <p id="join-group-description" className="sr-only">
            Join an existing study group by entering the 6-character invite code.
          </p>
          
          <div className="space-y-4">
            <div>
              <Label htmlFor="inviteCode">Invite Code</Label>
              <Input
                id="inviteCode"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder="Enter 6-character invite code"
                maxLength={6}
                className="uppercase"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Ask a group member for the invite code
              </p>
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="ghost" onClick={() => setJoinDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={joinGroup} 
              disabled={!inviteCode.trim() || joining}
            >
              {joining ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Joining...</> : "Join Group"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Group Settings Dialog */}
      <Dialog open={groupSettingsOpen} onOpenChange={setGroupSettingsOpen}>
        <DialogContent className="w-[calc(100vw-1.5rem)] max-w-lg sm:max-w-xl" aria-describedby="group-settings-description">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              {selectedGroupForSettings?.name}
            </DialogTitle>
          </DialogHeader>
          <p id="group-settings-description" className="sr-only">
            Manage group settings including invite code, members, and administrative functions.
          </p>
          
          {selectedGroupForSettings && (
            <div className="space-y-4">
              <div>
                <Label className="text-sm font-medium">Invite Code</Label>
                <div className="flex items-center gap-2 mt-1">
                  <Input
                    value={selectedGroupForSettings.inviteCode}
                    readOnly
                    className="font-mono"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copyInviteCode(selectedGroupForSettings.inviteCode)}
                  >
                    {copiedCode ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Share this code to invite others
                </p>
              </div>

              {/* Scores visibility toggle - owner/admins only; member management lives in the Members tab */}
              {(selectedGroupForSettings.createdBy === userId || selectedGroupForSettings.admins?.includes(userId)) && (
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <Label className="text-sm font-medium">Member scores</Label>
                    <p className="text-xs text-muted-foreground">
                      {selectedGroupForSettings.scoresVisible !== false ? 'All members can see each other\u2019s quiz/flashcard stats' : 'Hidden from regular members'}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant={selectedGroupForSettings.scoresVisible !== false ? 'default' : 'outline'}
                    onClick={() => toggleScoresVisible(selectedGroupForSettings)}
                    disabled={scoresToggleLoading}
                  >
                    {scoresToggleLoading && <Loader2 className="w-3 h-3 mr-2 animate-spin" />}
                    {selectedGroupForSettings.scoresVisible !== false ? 'Visible' : 'Hidden'}
                  </Button>
                </div>
              )}
            </div>
          )}
          
          <DialogFooter className="flex-col sm:flex-row gap-2">
            {/* Moderator Help - only for group creator */}
            {selectedGroupForSettings && selectedGroupForSettings.createdBy === userId && (
              <>
                {selectedGroupForSettings.moderatorAccessRequested ? (
                  <Button 
                    variant="outline"
                    onClick={() => revokeModeratorAccess(selectedGroupForSettings)}
                    className="w-full sm:w-auto"
                  >
                    <Shield className="w-3 h-3 mr-2" />
                    Revoke Mod Access
                  </Button>
                ) : (
                  <Button 
                    variant="outline"
                    onClick={() => {
                      setModHelpTargetGroup(selectedGroupForSettings);
                      setModHelpDialogOpen(true);
                    }}
                    className="w-full sm:w-auto"
                  >
                    <HelpCircle className="w-3 h-3 mr-2" />
                    Ask Mod for Help
                  </Button>
                )}
              </>
            )}
            
            <div className="flex gap-2 w-full sm:w-auto">
              <Button variant="ghost" onClick={() => setGroupSettingsOpen(false)}>
                Close
              </Button>
              {selectedGroupForSettings && selectedGroupForSettings.createdBy === userId && (
                <Button
                  variant="destructive"
                  onClick={() => setDeleteConfirmGroup(selectedGroupForSettings)}
                >
                  <Trash2 className="w-3 h-3 mr-2" />
                  Delete Group
                </Button>
              )}
              {selectedGroupForSettings && selectedGroupForSettings.createdBy !== userId && (
                <Button 
                  variant="destructive"
                  onClick={() => {
                    leaveGroup(selectedGroupForSettings);
                    setGroupSettingsOpen(false);
                  }}
                >
                  <UserMinus className="w-3 h-3 mr-2" />
                  Leave Group
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Member Action Confirmation (add/remove admin, kick) */}
      <Dialog open={!!memberConfirm} onOpenChange={(open) => { if (!open) setMemberConfirm(null); }}>
        <DialogContent className="w-[calc(100vw-1.5rem)] max-w-md">
          <DialogHeader>
            <DialogTitle>
              {memberConfirm?.type === 'admin'
                ? (memberConfirm.member.isAdmin ? 'Remove admin?' : 'Add admin?')
                : 'Remove member?'}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {memberConfirm?.type === 'admin'
              ? (memberConfirm.member.isAdmin
                  ? <>Remove <strong>@{memberConfirm.member.username}</strong> from admins? They will stay in the group as a regular member.</>
                  : <>Make <strong>@{memberConfirm.member.username}</strong> an admin? They will be able to manage members and settings.</>)
              : <>Remove <strong>@{memberConfirm?.member.username}</strong> from the group? They can rejoin with the invite code or by request.</>}
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setMemberConfirm(null)} disabled={memberActionLoading}>
              Cancel
            </Button>
            <Button
              variant={memberConfirm?.type === 'kick' || memberConfirm?.member?.isAdmin ? 'destructive' : 'default'}
              onClick={runMemberAction}
              disabled={memberActionLoading}
            >
              {memberActionLoading && <Loader2 className="w-3 h-3 mr-2 animate-spin" />}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Group Confirmation Dialog */}
      <Dialog open={!!deleteConfirmGroup} onOpenChange={(open) => { if (!open) setDeleteConfirmGroup(null); }}>
        <DialogContent className="w-[calc(100vw-1.5rem)] max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="w-5 h-5" />
              Delete Group
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Permanently delete <strong>{deleteConfirmGroup?.name}</strong>? All {deleteConfirmGroup?.members?.length || 0} members will be removed. This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteConfirmGroup(null)} disabled={deletingGroup}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => deleteConfirmGroup && deleteGroup(deleteConfirmGroup)} disabled={deletingGroup}>
              {deletingGroup ? <Loader2 className="w-3 h-3 mr-2 animate-spin" /> : <Trash2 className="w-3 h-3 mr-2" />}
              Delete Group
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Moderator Help Dialog */}
      <Dialog open={modHelpDialogOpen} onOpenChange={setModHelpDialogOpen}>
        <DialogContent className="w-[calc(100vw-1.5rem)] max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HelpCircle className="w-5 h-5" />
              Request Moderator Help
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This will allow site moderators to access your group content to help resolve issues. 
              You can revoke access at any time.
            </p>
            <div>
              <Label htmlFor="modHelpReason">Reason (optional)</Label>
              <Textarea
                id="modHelpReason"
                value={modHelpReason}
                onChange={(e) => setModHelpReason(e.target.value)}
                placeholder="Describe the issue you need help with..."
                rows={3}
                maxLength={500}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => {
              setModHelpDialogOpen(false);
              setModHelpReason("");
              setModHelpTargetGroup(null);
            }}>
              Cancel
            </Button>
            <Button onClick={requestModeratorHelp} disabled={modHelpLoading}>
              {modHelpLoading ? (
                <>
                  <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                  Requesting...
                </>
              ) : (
                <>
                  <Shield className="w-3 h-3 mr-2" />
                  Grant Access
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invite User Dialog */}
      <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
        <DialogContent className="w-[calc(100vw-1.5rem)] max-w-lg">
          <DialogHeader>
            <DialogTitle>Invite User to Group</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="inviteUsername">Username</Label>
              <Input
                id="inviteUsername"
                value={inviteUsername}
                onChange={(e) => setInviteUsername(e.target.value)}
                placeholder="Enter username (without @)"
                maxLength={50}
              />
            </div>
            <div className="text-sm text-muted-foreground">
              {inviteTargetGroup?.admins?.includes(userId) ? (
                <p>As an admin, your invitation will automatically add the user to the group.</p>
              ) : (
                <p>Your invitation will be sent to the user. Admins will still need to approve their join request.</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => {
              setInviteDialogOpen(false);
              setInviteUsername("");
              setInviteTargetGroup(null);
            }}>
              Cancel
            </Button>
            <Button 
              onClick={inviteUserToGroup}
              disabled={!inviteUsername.trim() || inviteLoading}
            >
              {inviteLoading ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Sending...</> : "Send Invitation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
