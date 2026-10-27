// Firebase Cloud Functions entrypoint.
// Split into domain modules; export names are unchanged so deployed
// function names remain identical (Firebase keys functions by export name).

export {
  api,
} from './api.js';

export {
  onAuthCreate,
  onAuthDelete,
  onUserDocDelete,
  setPhotoURL,
  checkUsername,
  reserveUsername,
  changeUsername,
  resolveLoginEmail,
  sendInstitutionVerificationEmail,
  confirmInstitutionEmail,
  sendBrandedPasswordResetEmail,
} from './auth-lifecycle.js';

export {
  onCountersUpdate,
  onUserProfileWrite,
  onAchievementsUpdate,
  onUserRunWrite,
  onFriendWrite,
  onCustomerWrite,
  onSubscriptionWrite,
  onCheckoutSessionWrite,
} from './triggers.js';

export {
  acceptFriend,
  cleanupMyFriends,
} from './social.js';

export {
  stripeWebhook,
  syncRenewsAtFromStripe,
  syncPlanFromStripe,
  activateInstitutionPlan,
} from './billing.js';

export {
  deleteAccountFull,
  deleteAllChats,
  exportMyData,
  enforceChatRetention,
} from './privacy.js';

export {
  sendRoleInvite,
  acceptRoleInvite,
  checkRoleInvite,
  removeUserRole,
  banUser,
  unbanUser,
  moderateContent,
  restoreContent,
  getModerationLogs,
  getPendingInvites,
  cancelRoleInvite,
  getUsersWithRoles,
  getOpenReports,
  getSupportReportSummary,
  assignReportToMe,
  resolveReport,
  getSignupCodeStats,
  sendReportEmail,
  getAdminPerformanceOverview,
  adminResetUserCounters,
  adminSearchUsers,
  verifyAdminAccess,
  syncRoleClaim,
  requestGroupModeratorHelp,
  revokeGroupModeratorAccess,
  backfillPublicProfiles,
  backfillSharedFlags,
  cleanupOrphanedUserDoc,
  cleanupOrphanedFeedContent,
  cleanupOrphanedFeedPosts,
  reconcileDeletedUsers,
  fixExpiredCounters,
} from './admin.js';

export {
  getDemoLoginEmail,
  setDemoAccess,
  bootstrapDemo,
  bootstrapDemoEmail,
  signInDemo,
  getDemoAccessStatus,
} from './demo.js';

export {
  submitInstitutionInquiry,
} from './institutions.js';

export {
  submitAmbassadorApplication,
} from './ambassadors.js';

export {
  joinGroupByCode,
  requestGroupJoin,
  respondToJoinRequest,
  leaveGroup,
  kickGroupMember,
  setGroupAdmin,
  deleteGroup,
} from './groups.js';

export { deleteFeedPost } from './feed.js';

export {
  cleanupExpiredReportLogs,
  autoResetUsageCounters,
} from './scheduled.js';

