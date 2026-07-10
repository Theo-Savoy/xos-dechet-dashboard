import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const bridged = useRef(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setLoading(false);
      if (s && !bridged.current) {
        bridged.current = true;
        fetch("/api/sso-bridge", {
          method: "POST",
          headers: { Authorization: `Bearer ${s.access_token}` },
        }).catch(() => {});
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (s && !bridged.current) {
        bridged.current = true;
        fetch("/api/sso-bridge", {
          method: "POST",
          headers: { Authorization: `Bearer ${s.access_token}` },
        }).catch(() => {});
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  return { session, loading };
}
