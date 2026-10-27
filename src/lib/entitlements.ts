export type PlanKey = 'free' | 'basic' | 'advanced' | 'pro';

export type FeatureEntitlements = {
  studyPlans: boolean;
  askTheText: boolean;
  lessonBuilder: boolean;
  explainAllLevels: boolean;
  streaksXp: boolean;
  quizNudges: boolean;
  usageDashboard: boolean; // always true but included for completeness
  careerAccess: boolean; // centralized flag for Career Launchpad access
  quizAccess: boolean; // quiz generator access
};

export const ENTITLEMENTS: Record<PlanKey, FeatureEntitlements> = {
  free: {
    studyPlans: false,
    askTheText: false,
    lessonBuilder: false,
    explainAllLevels: false,
    streaksXp: false,
    quizNudges: false,
    usageDashboard: true,
    careerAccess: false,
    quizAccess: false,
  },
  basic: {
    studyPlans: false,
    askTheText: false,
    lessonBuilder: false,
    explainAllLevels: false,
    streaksXp: false,
    quizNudges: false,
    usageDashboard: true,
    careerAccess: false,
    quizAccess: true,
  },
  advanced: {
    studyPlans: true,
    askTheText: true,
    lessonBuilder: true,
    explainAllLevels: true,
    streaksXp: true,
    quizNudges: true,
    usageDashboard: true,
    careerAccess: true,
    quizAccess: true,
  },
  pro: {
    studyPlans: true,
    askTheText: true,
    lessonBuilder: true,
    explainAllLevels: true,
    streaksXp: true,
    quizNudges: true,
    usageDashboard: true,
    careerAccess: true,
    quizAccess: true,
  },
};
