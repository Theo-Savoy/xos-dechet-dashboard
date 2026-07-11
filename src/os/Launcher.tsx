import { useCallback, useEffect, useRef, useState } from "react";
import { Command } from "cmdk";
import { appRegistry, type AppManifest, getAppManifest } from "./registry";
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
  /** Apps visibles pour le rôle courant (défaut : tout le registry). */
  apps?: AppManifest[];
  onOpenApp: (app: AppManifest, params?: Record<string, string>) => void;
};

export function Launcher({ accessToken, onOpenApp, apps = appRegistry }: LauncherProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const logAbortRef = useRef<AbortController | null>(null);
  const createAbortRef = useRef<AbortController | null>(null);

  // Command mode states
  const [commandMode, setCommandMode] = useState<"log" | "create" | null>(null);

  // /log states
  const [logRecord, setLogRecord] = useState<SearchResult | null>(null);
  const [logSearchQuery, setLogSearchQuery] = useState("");
  const [logSearchResults, setLogSearchResults] = useState<SearchResult[]>([]);
  const [logSearchLoading, setLogSearchLoading] = useState(false);
  const [logComments, setLogComments] = useState("");
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [logSuccess, setLogSuccess] = useState(false);

  // /create states
  const [createFirstName, setCreateFirstName] = useState("");
  const [createLastName, setCreateLastName] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [createPhone, setCreatePhone] = useState("");
  const [createAccount, setCreateAccount] = useState<SearchResult | null>(null);
  const [createAccountQuery, setCreateAccountQuery] = useState("");
  const [createAccountResults, setCreateAccountResults] = useState<SearchResult[]>([]);
  const [createAccountLoading, setCreateAccountLoading] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState(false);

  const resetFormState = () => {
    setCommandMode(null);
    setLogRecord(null);
    setLogSearchQuery("");
    setLogSearchResults([]);
    setLogComments("");
    setLogLoading(false);
    setLogError(null);
    setLogSuccess(false);

    setCreateFirstName("");
    setCreateLastName("");
    setCreateEmail("");
    setCreatePhone("");
    setCreateAccount(null);
    setCreateAccountQuery("");
    setCreateAccountResults([]);
    setCreateLoading(false);
    setCreateError(null);
    setCreateSuccess(false);
  };

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
      logAbortRef.current?.abort();
      createAbortRef.current?.abort();
      setQuery("");
      setResults([]);
      setLoading(false);
      setError(false);
      resetFormState();
    }
  }, [open]);

  // Debounced search — only when palette is open and query is long enough
  const search = useCallback(
    async (q: string) => {
      // Don't search if it's a command trigger
      if (q.startsWith("/")) {
        setResults([]);
        setLoading(false);
        setError(false);
        return;
      }

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
        const res = await fetch(`/api/launcher?q=${encodeURIComponent(q)}`, {
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

  // Dynamic search for /log association target
  useEffect(() => {
    if (logSearchQuery.length < 2) {
      setLogSearchResults([]);
      setLogSearchLoading(false);
      logAbortRef.current?.abort();
      return;
    }
    logAbortRef.current?.abort();
    const controller = new AbortController();
    logAbortRef.current = controller;
    setLogSearchLoading(true);
    const delay = setTimeout(async () => {
      try {
        const res = await fetch(`/api/launcher?q=${encodeURIComponent(logSearchQuery)}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: controller.signal,
        });
        if (res.ok && !controller.signal.aborted) {
          const body = await res.json();
          setLogSearchResults(body.results ?? []);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      } finally {
        if (!controller.signal.aborted) setLogSearchLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(delay);
      controller.abort();
    };
  }, [logSearchQuery, accessToken]);

  // Dynamic search for /create Account association
  useEffect(() => {
    if (createAccountQuery.length < 2) {
      setCreateAccountResults([]);
      setCreateAccountLoading(false);
      createAbortRef.current?.abort();
      return;
    }
    createAbortRef.current?.abort();
    const controller = new AbortController();
    createAbortRef.current = controller;
    setCreateAccountLoading(true);
    const delay = setTimeout(async () => {
      try {
        const res = await fetch(`/api/launcher?q=${encodeURIComponent(createAccountQuery)}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: controller.signal,
        });
        if (res.ok && !controller.signal.aborted) {
          const body = await res.json();
          const accounts = (body.results ?? []).filter((r: SearchResult) => r.type === "Account");
          setCreateAccountResults(accounts);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      } finally {
        if (!controller.signal.aborted) setCreateAccountLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(delay);
      controller.abort();
    };
  }, [createAccountQuery, accessToken]);

  const handleLogSubmit = async () => {
    if (!logRecord || !logComments.trim()) return;
    setLogLoading(true);
    setLogError(null);
    try {
      const res = await fetch("/api/launcher", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          action: "log_call",
          recordId: logRecord.id,
          recordType: logRecord.type,
          comments: logComments,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error || "Erreur serveur");
      }
      setLogSuccess(true);
      setTimeout(() => {
        setOpen(false);
      }, 1500);
    } catch (err) {
      setLogError(err instanceof Error ? err.message : "Une erreur est survenue lors de l'enregistrement.");
    } finally {
      setLogLoading(false);
    }
  };

  const handleCreateSubmit = async () => {
    if (!createLastName.trim()) return;
    setCreateLoading(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/launcher", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          action: "create_contact",
          firstName: createFirstName,
          lastName: createLastName,
          email: createEmail,
          phone: createPhone,
          accountId: createAccount?.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error || "Erreur serveur");
      }
      setCreateSuccess(true);
      setTimeout(() => {
        setOpen(false);
      }, 1500);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Une erreur est survenue lors de la création.");
    } finally {
      setCreateLoading(false);
    }
  };

  // Group results by type using reduce (no Object.groupBy — TS/browser compat)
  const grouped = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    (acc[r.type] ??= []).push(r);
    return acc;
  }, {});

  const isLoading = loading && query.length >= 2;

  // Filter local apps that match the query
  const matchingApps =
    query.length >= 2 && !query.startsWith("/")
      ? apps.filter((app) =>
          app.title.toLowerCase().includes(query.toLowerCase()),
        )
      : [];

  // Parse commands suggestion visibility
  const showCommands = query === "" || query.startsWith("/");
  const cleanArg = query.startsWith("/clean ") ? query.slice(7).trim() : "";

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      shouldFilter={false}
      label="Recherche X OS"
      overlayClassName="xos-launcher-overlay"
      contentClassName="xos-launcher"
    >
      {commandMode === "log" && (
        <div className="xos-launcher-form">
          <div className="xos-launcher-form__header">Consigner une note d'appel</div>

          {logSuccess ? (
            <div className="xos-launcher-form__status xos-launcher-form__status--success">
              Note d'appel enregistrée avec succès !
            </div>
          ) : (
            <>
              {logError && (
                <div className="xos-launcher-form__status xos-launcher-form__status--error">
                  {logError}
                </div>
              )}

              <div className="xos-launcher-form__group">
                <label htmlFor="log-record-search" className="xos-launcher-form__label">Associer à (compte, contact, opp)*</label>
                {logRecord ? (
                  <div className="xos-launcher-form__badge">
                    <span>
                      <strong>[{GROUP_LABELS[logRecord.type]}]</strong> {logRecord.name}
                    </span>
                    <button
                      type="button"
                      className="xos-launcher-form__badge-remove"
                      onClick={() => setLogRecord(null)}
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      id="log-record-search"
                      type="text"
                      className="xos-launcher-form__input"
                      placeholder="Rechercher un enregistrement..."
                      value={logSearchQuery}
                      onChange={(e) => setLogSearchQuery(e.target.value)}
                      autoFocus
                    />
                    {logSearchLoading && <div className="xos-launcher__status">Recherche…</div>}
                    {logSearchResults.length > 0 && (
                      <div className="xos-launcher-form__autocomplete-list">
                        {logSearchResults.map((r) => (
                          <div
                            key={r.id}
                            className="xos-launcher-form__autocomplete-item"
                            onClick={() => {
                              setLogRecord(r);
                              setLogSearchQuery("");
                              setLogSearchResults([]);
                            }}
                          >
                            <span>{r.name}</span>
                            <span style={{ color: "var(--xos-text-muted)", fontSize: "0.75rem" }}>
                              {GROUP_LABELS[r.type]}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="xos-launcher-form__group">
                <label htmlFor="log-comments" className="xos-launcher-form__label">Note d'appel*</label>
                <textarea
                  id="log-comments"
                  className="xos-launcher-form__textarea"
                  placeholder="Renseigner les notes d'appel..."
                  value={logComments}
                  onChange={(e) => setLogComments(e.target.value)}
                />
              </div>

              <div className="xos-launcher-form__actions">
                <button
                  type="button"
                  className="xos-launcher-form__button xos-launcher-form__button--secondary"
                  onClick={resetFormState}
                  disabled={logLoading}
                >
                  Annuler
                </button>
                <button
                  type="button"
                  className="xos-launcher-form__button xos-launcher-form__button--primary"
                  onClick={handleLogSubmit}
                  disabled={logLoading || !logRecord || !logComments.trim()}
                >
                  {logLoading ? "Enregistrement…" : "Enregistrer la note"}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {commandMode === "create" && (
        <div className="xos-launcher-form">
          <div className="xos-launcher-form__header">Créer un contact express</div>

          {createSuccess ? (
            <div className="xos-launcher-form__status xos-launcher-form__status--success">
              Contact créé avec succès !
            </div>
          ) : (
            <>
              {createError && (
                <div className="xos-launcher-form__status xos-launcher-form__status--error">
                  {createError}
                </div>
              )}

              <div style={{ display: "flex", gap: "10px" }}>
                <div className="xos-launcher-form__group" style={{ flex: 1 }}>
                  <label htmlFor="create-firstname" className="xos-launcher-form__label">Prénom</label>
                  <input
                    id="create-firstname"
                    type="text"
                    className="xos-launcher-form__input"
                    value={createFirstName}
                    onChange={(e) => setCreateFirstName(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="xos-launcher-form__group" style={{ flex: 1 }}>
                  <label htmlFor="create-lastname" className="xos-launcher-form__label">Nom*</label>
                  <input
                    id="create-lastname"
                    type="text"
                    className="xos-launcher-form__input"
                    value={createLastName}
                    onChange={(e) => setCreateLastName(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div style={{ display: "flex", gap: "10px" }}>
                <div className="xos-launcher-form__group" style={{ flex: 1 }}>
                  <label htmlFor="create-email" className="xos-launcher-form__label">Email</label>
                  <input
                    id="create-email"
                    type="email"
                    className="xos-launcher-form__input"
                    value={createEmail}
                    onChange={(e) => setCreateEmail(e.target.value)}
                  />
                </div>
                <div className="xos-launcher-form__group" style={{ flex: 1 }}>
                  <label htmlFor="create-phone" className="xos-launcher-form__label">Téléphone</label>
                  <input
                    id="create-phone"
                    type="text"
                    className="xos-launcher-form__input"
                    value={createPhone}
                    onChange={(e) => setCreatePhone(e.target.value)}
                  />
                </div>
              </div>

              <div className="xos-launcher-form__group">
                <label htmlFor="create-account-search" className="xos-launcher-form__label">Associer à un compte (optionnel)</label>
                {createAccount ? (
                  <div className="xos-launcher-form__badge">
                    <span>{createAccount.name}</span>
                    <button
                      type="button"
                      className="xos-launcher-form__badge-remove"
                      onClick={() => setCreateAccount(null)}
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      id="create-account-search"
                      type="text"
                      className="xos-launcher-form__input"
                      placeholder="Rechercher un compte..."
                      value={createAccountQuery}
                      onChange={(e) => setCreateAccountQuery(e.target.value)}
                    />
                    {createAccountLoading && <div className="xos-launcher__status">Recherche…</div>}
                    {createAccountResults.length > 0 && (
                      <div className="xos-launcher-form__autocomplete-list">
                        {createAccountResults.map((acc) => (
                          <div
                            key={acc.id}
                            className="xos-launcher-form__autocomplete-item"
                            onClick={() => {
                              setCreateAccount(acc);
                              setCreateAccountQuery("");
                              setCreateAccountResults([]);
                            }}
                          >
                            <span>{acc.name}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="xos-launcher-form__actions">
                <button
                  type="button"
                  className="xos-launcher-form__button xos-launcher-form__button--secondary"
                  onClick={resetFormState}
                  disabled={createLoading}
                >
                  Annuler
                </button>
                <button
                  type="button"
                  className="xos-launcher-form__button xos-launcher-form__button--primary"
                  onClick={handleCreateSubmit}
                  disabled={createLoading || !createLastName.trim()}
                >
                  {createLoading ? "Création…" : "Créer le contact"}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {!commandMode && (
        <>
          <Command.Input
            value={query}
            onValueChange={setQuery}
            placeholder="Rechercher un compte, contact, opportunité… ou tapez /"
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
            {!isLoading && !error && query.length >= 2 && results.length === 0 && matchingApps.length === 0 && !query.startsWith("/") && (
              <Command.Empty className="xos-launcher__status">
                Aucun résultat.
              </Command.Empty>
            )}
            {!isLoading && !error && query.length < 2 && !query.startsWith("/") && (
              <div className="xos-launcher__status">
                Tapez au moins 2 caractères…
              </div>
            )}

            {/* Custom Command items */}
            {showCommands && (
              <Command.Group heading="Commandes" className="xos-launcher__group">
                {("/log".startsWith(query) || query === "/") && (
                  <Command.Item
                    value="/log"
                    className="xos-launcher__item"
                    onSelect={() => {
                      setCommandMode("log");
                      setQuery("");
                    }}
                  >
                    <span className="xos-launcher__item-icon" aria-hidden="true">✎</span>
                    <span className="xos-launcher__item-name">/log</span>
                    <span className="xos-launcher__item-detail">Consigner une note d'appel Salesforce</span>
                  </Command.Item>
                )}
                {("/create".startsWith(query) || query === "/") && (
                  <Command.Item
                    value="/create"
                    className="xos-launcher__item"
                    onSelect={() => {
                      setCommandMode("create");
                      setQuery("");
                    }}
                  >
                    <span className="xos-launcher__item-icon" aria-hidden="true">⊕</span>
                    <span className="xos-launcher__item-name">/create</span>
                    <span className="xos-launcher__item-detail">Créer un contact express dans Salesforce</span>
                  </Command.Item>
                )}
                {(query.startsWith("/clean") || query === "/") && (
                  <Command.Item
                    value="/clean"
                    className="xos-launcher__item"
                    onSelect={() => {
                      const cleanerApp = getAppManifest("cleaner");
                      if (cleanerApp) {
                        onOpenApp(cleanerApp, cleanArg ? { q: cleanArg } : undefined);
                      }
                      setOpen(false);
                    }}
                  >
                    <span className="xos-launcher__item-icon" aria-hidden="true">◈</span>
                    <span className="xos-launcher__item-name">/clean</span>
                    <span className="xos-launcher__item-detail">
                      Ouvrir le CRM Cleaner{cleanArg ? ` filtré sur "${cleanArg}"` : ""}
                    </span>
                  </Command.Item>
                )}
              </Command.Group>
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
            {!query.startsWith("/") && (["Account", "Contact", "Opportunity"] as const).map((type) => {
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
        </>
      )}
      <div className="xos-launcher__footer">
        <kbd>⌘K</kbd> pour ouvrir · <kbd>↑↓</kbd> naviguer ·{" "}
        <kbd>↵</kbd> ouvrir · <kbd>esc</kbd> fermer
      </div>
    </Command.Dialog>
  );
}
