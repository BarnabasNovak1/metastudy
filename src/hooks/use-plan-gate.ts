import { useEffect, useState } from "react";
import { ENTITLEMENTS, PlanKey } from "@/lib/entitlements";
import { useUserData } from "@/contexts/UserDataContext";

export type PlanGate = ReturnType<typeof usePlanGate>;

export function usePlanGate() {
  const userData = useUserData();
  const [plan, setPlan] = useState<PlanKey>("free");

  useEffect(() => {
    if (!userData.user) {
      setPlan("free");
      return;
    }
    
    let p = ((userData.profile?.plan as PlanKey) || "free");
    const mq = Number(userData.profile?.monthly_quota || 0);
    
    // Fallback: derive plan from quotas if server plan hasn't updated yet
    if (p === 'free') {
      if (mq >= 500) p = 'pro';
      else if (mq >= 200) p = 'advanced';
      else if (mq >= 50) p = 'basic';
    }
    
    setPlan(p);
  }, [userData.user, userData.profile]);

  const e = ENTITLEMENTS[plan] || ENTITLEMENTS.free;
  
  // Compute permissive career access: unlock if plan grants it OR quotas imply advanced/pro
  const [careerOverride, setCareerOverride] = useState<boolean>(false);
  useEffect(() => {
    if (!userData.user) { 
      setCareerOverride(false); 
      return; 
    }
    const mq = Number(userData.profile?.monthly_quota || 0);
    setCareerOverride(mq >= 200);
  }, [userData.user, userData.profile]);

  return {
    loading: userData.loading,
    plan,
    ...e,
    careerAccess: e.careerAccess || careerOverride,
  };
}
