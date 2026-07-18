import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { apiFetch } from "../lib/apiClient";
import { supabase } from "../lib/supabase";

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [bridgeError, setBridgeError] = useState(false);
  const bridged = useRef(false);
  const bridging = useRef(false);
  const generation = useRef(0);

  useEffect(() => {
    let cancelled = false;

    async function bridge(s: Session, gen: number) {
      if (bridged.current || bridging.current) return;
      bridging.current = true;
      try {
        const providerRefreshToken = s.provider_refresh_token;
        await apiFetch(s.access_token, "/api/auth", {
          method: "POST",
          ...(providerRefreshToken
            ? { body: JSON.stringify({ salesforce_refresh_token: providerRefreshToken }) }
            : {}),
        });
        if (cancelled || generation.current !== gen) return;
        bridged.current = true;
        setSession(s);
        setBridgeError(false);
        setLoading(false);
      } catch {
        if (cancelled || generation.current !== gen) return;
        setBridgeError(true);
        setSession(null);
        setLoading(false);
      } finally {
        if (generation.current === gen) {
          bridging.current = false;
        }
      }
    }

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      if (cancelled) return;
      if (s) {
        bridge(s, generation.current);
      } else {
        setSession(null);
        setBridgeError(false);
        setLoading(false);
      }
    }).catch(() => {
      if (cancelled) return;
      setBridgeError(true);
      setSession(null);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      if (cancelled) return;
      if (s && !bridged.current) {
        bridge(s, generation.current);
      } else if (s && bridged.current) {
        // Refresh tokens in place — never null the session on TOKEN_REFRESHED.
        setSession(s);
      } else if (!s) {
        generation.current += 1;
        bridged.current = false;
        bridging.current = false;
        setSession(null);
        setBridgeError(false);
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  return { session, loading, bridgeError };
}
