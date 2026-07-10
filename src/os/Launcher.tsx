import { useCallback, useEffect, useRef, useState } from "react";
import { Command } from "cmdk";
import { appRegistry, type AppManifest } from "./registry";
import "./launcher.css";

type SearchResult = {
  type: "Account" | "Contact" | "Opportunity";
  id: string;
  name: string;
  detail: string;
  recordUrl: string | null;
};

const GROUP_LABELS: Record<string, string> = {
  Account: "Comptes",
  Contact: "Contacts",
  Opportunity: "Opportunités",
};

type LauncherProps = {
  accessToken: string;
  onOpenApp: (app: AppManifest) => void;
};

export function Launcher({ accessToken, onOpenApp }: LauncherProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  // Cmd+K / Ctrl+K global shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Abort in-flight requests when palette closes
  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      setQuery("");
      setResults([]);
      setLoading(false);
      setError(false);
    }
  }, [open]);

  // Debounced search — only when palette is open and query is long enough
  const search = useCallback(
    async (q: string) => {
      if (q.length < 2) {
        setResults([]);
        setLoading(false);
        setError(false);
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      setError(false);

      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const body = await res.json();
        if (!controller.signal.aborted) {
          setResults(body.results ?? []);
          setLoading(false);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (!controller.signal.aborted) {
          setError(true);
          setLoading(false);
        }
      }
    },
    [accessToken],
  );

  // Debounce the query — skip entirely when palette is closed
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(query), 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, search, open]);

  // Group results by type using reduce (no Object.groupBy — TS/browser compat)
  const grouped = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    (acc[r.type] ??= []).push(r);
    return acc;
  }, {});

  const isLoading = loading && query.length >= 2;

  // Filter local apps that match the query
  const matchingApps =
    query.length >= 2
      ? appRegistry.filter((app) =>
          app.title.toLowerCase().includes(query.toLowerCase()),
        )
      : [];

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      shouldFilter={false}
      label="Recherche X OS"
      overlayClassName="xos-launcher-overlay"
      contentClassName="xos-launcher"
    >
      <Command.Input
        value={query}
        onValueChange={setQuery}
        placeholder="Rechercher un compte, contact, opportunité…"
        className="xos-launcher__input"
      />
      <Command.List className="xos-launcher__list">
        {isLoading && (
          <Command.Loading className="xos-launcher__status">
            Recherche…
          </Command.Loading>
        )}
        {error && (
          <div className="xos-launcher__status xos-launcher__status--error">
            Erreur de recherche.
          </div>
        )}
        {!isLoading && !error && query.length >= 2 && results.length === 0 && matchingApps.length === 0 && (
          <Command.Empty className="xos-launcher__status">
            Aucun résultat.
          </Command.Empty>
        )}
        {!isLoading && !error && query.length < 2 && (
          <div className="xos-launcher__status">
            Tapez au moins 2 caractères…
          </div>
        )}

        {/* Local X OS apps */}
        {matchingApps.length > 0 && (
          <Command.Group heading="Apps" className="xos-launcher__group">
            {matchingApps.map((app) => (
              <Command.Item
                key={app.id}
                value={app.title}
                className="xos-launcher__item"
                onSelect={() => {
                  onOpenApp(app);
                  setOpen(false);
                }}
              >
                <span className="xos-launcher__item-icon" aria-hidden="true">
                  {app.icon}
                </span>
                <span className="xos-launcher__item-name">{app.title}</span>
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {/* Salesforce results */}
        {(["Account", "Contact", "Opportunity"] as const).map((type) => {
          const items = grouped[type];
          if (!items?.length) return null;
          return (
            <Command.Group
              key={type}
              heading={GROUP_LABELS[type]}
              className="xos-launcher__group"
            >
              {items.map((item) => (
                <Command.Item
                  key={item.id}
                  value={`${item.name} ${item.detail}`}
                  className="xos-launcher__item"
                  onSelect={() => {
                    if (item.recordUrl)
                      window.open(item.recordUrl, "_blank", "noopener,noreferrer");
                    setOpen(false);
                  }}
                >
                  <span className="xos-launcher__item-name">{item.name}</span>
                  {item.detail && (
                    <span className="xos-launcher__item-detail">
                      {item.detail}
                    </span>
                  )}
                </Command.Item>
              ))}
            </Command.Group>
          );
        })}
      </Command.List>
      <div className="xos-launcher__footer">
        <kbd>⌘K</kbd> pour ouvrir · <kbd>↑↓</kbd> naviguer ·{" "}
        <kbd>↵</kbd> ouvrir · <kbd>esc</kbd> fermer
      </div>
    </Command.Dialog>
  );
}
