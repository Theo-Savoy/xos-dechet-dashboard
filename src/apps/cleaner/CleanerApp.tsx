import { supabase } from "../../lib/supabase";

type CleanerAppProps = {
  params?: Record<string, string>;
};

export default function CleanerApp({ params }: CleanerAppProps) {
  const query = params?.q ? `?q=${encodeURIComponent(params.q)}` : "";
  return (
    <iframe
      src={`/dashboard.html${query}`}
      title="CRM Cleaner"
      onLoad={(event) => {
        const target = event.currentTarget;
        void supabase.auth.getSession().then(({ data: { session } }) => {
          if (session?.access_token) {
            target.contentWindow?.postMessage(
              { type: "xos:auth", accessToken: session.access_token },
              window.location.origin,
            );
          }
        });
      }}
      style={{
        width: "100%",
        height: "100%",
        border: "none",
        display: "block",
      }}
    />
  );
}
