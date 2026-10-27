import { auth } from "../../firebase";
import { useEffect, useState } from "react";

export async function refreshAndGetStripeRole(): Promise<string | undefined> {
  const user = auth.currentUser;
  if (!user) return undefined;
  await user.getIdToken(true);
  const result = await user.getIdTokenResult();
  return (result?.claims as any)?.stripeRole as string | undefined;
}

export function useStripeRole() {
  const [role, setRole] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const r = await refreshAndGetStripeRole();
        if (mounted) setRole(r);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  return { role, loading, refresh: async () => {
    setLoading(true);
    try {
      const r = await refreshAndGetStripeRole();
      setRole(r);
      return r;
    } finally {
      setLoading(false);
    }
  }};
}
