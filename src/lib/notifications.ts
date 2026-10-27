import { doc, setDoc, serverTimestamp, getDoc } from "firebase/firestore";
import { db } from "../../firebase";

interface NotificationData {
  type: 'group_invite' | 'group_invite_admin' | 'post_like' | 'post_dislike' | 'post_comment' | 'friend_request';
  fromUserId: string;
  fromUsername: string;
  fromPhotoURL?: string;
  title: string;
  message: string;
  data?: any;
}

export const sendNotification = async (toUserId: string, notificationData: NotificationData) => {
  try {
    // Check if user has notifications enabled for this type
    const settingsRef = doc(db as any, "users", toUserId, "settings", "notifications");
    const settingsSnap = await getDoc(settingsRef);
    
    let notificationsEnabled = true;
    if (settingsSnap.exists()) {
      const settings = settingsSnap.data();
      switch (notificationData.type) {
        case 'group_invite':
        case 'group_invite_admin':
          notificationsEnabled = settings.groupInvites !== false;
          break;
        case 'post_like':
        case 'post_dislike':
          notificationsEnabled = settings.postLikes !== false;
          break;
        case 'post_comment':
          notificationsEnabled = settings.postComments !== false;
          break;
        case 'friend_request':
          notificationsEnabled = settings.friendRequests !== false;
          break;
      }
    }

    if (!notificationsEnabled) {
      return; // User has disabled this type of notification
    }

    // Create notification
    const notificationRef = doc(db as any, "users", toUserId, "notifications", `${Date.now()}_${notificationData.fromUserId}`);
    await setDoc(notificationRef, {
      ...notificationData,
      read: false,
      createdAt: serverTimestamp()
    });

    console.log(`Notification sent to ${toUserId}:`, notificationData.title);
  } catch (error) {
    console.error("Failed to send notification:", error);
  }
};

export const sendGroupInviteNotification = async (
  toUserId: string, 
  fromUserId: string, 
  fromUsername: string, 
  fromPhotoURL: string | undefined,
  groupId: string, 
  groupName: string, 
  isAdminInvite: boolean
) => {
  await sendNotification(toUserId, {
    type: isAdminInvite ? 'group_invite_admin' : 'group_invite',
    fromUserId,
    fromUsername,
    fromPhotoURL,
    title: `Group Invitation`,
    message: `${fromUsername} invited you to join ${groupName}`,
    data: {
      groupId,
      groupName,
      inviterRole: isAdminInvite ? 'admin' : 'member'
    }
  });
};

export const sendPostLikeNotification = async (
  toUserId: string,
  fromUserId: string,
  fromUsername: string,
  fromPhotoURL: string | undefined,
  postTitle: string,
  postId: string
) => {
  if (toUserId === fromUserId) return; // Don't notify self
  
  await sendNotification(toUserId, {
    type: 'post_like',
    fromUserId,
    fromUsername,
    fromPhotoURL,
    title: `Post Liked`,
    message: `${fromUsername} liked your post "${postTitle}"`,
    data: { postId, postTitle }
  });
};

export const sendPostDislikeNotification = async (
  toUserId: string,
  fromUserId: string,
  fromUsername: string,
  fromPhotoURL: string | undefined,
  postTitle: string,
  postId: string
) => {
  if (toUserId === fromUserId) return; // Don't notify self
  
  await sendNotification(toUserId, {
    type: 'post_dislike',
    fromUserId,
    fromUsername,
    fromPhotoURL,
    title: `Post Disliked`,
    message: `${fromUsername} disliked your post "${postTitle}"`,
    data: { postId, postTitle }
  });
};

export const sendPostCommentNotification = async (
  toUserId: string,
  fromUserId: string,
  fromUsername: string,
  fromPhotoURL: string | undefined,
  postTitle: string,
  postId: string,
  commentText: string
) => {
  if (toUserId === fromUserId) return; // Don't notify self
  
  await sendNotification(toUserId, {
    type: 'post_comment',
    fromUserId,
    fromUsername,
    fromPhotoURL,
    title: `New Comment`,
    message: `${fromUsername} commented on your post "${postTitle}": "${commentText.substring(0, 50)}${commentText.length > 50 ? '...' : ''}"`,
    data: { postId, postTitle, commentText }
  });
};
