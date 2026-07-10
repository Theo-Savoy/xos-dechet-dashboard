export type CallOutcome =
  | "answered"
  | "no_answer"
  | "callback"
  | "not_interested"
  | "wrong_number";

export type ContactStatus = "pending" | "called" | "skipped";

export type SessionStatus = "active" | "completed";

export type SessionSummary = {
  id: number;
  name: string;
  status: SessionStatus;
  created_at: string;
  total: number;
  called: number;
  skipped: number;
  pending: number;
};

export type SessionContact = {
  id: number;
  position: number;
  sf_contact_id: string;
  sf_account_id: string | null;
  contact_name: string;
  account_name: string | null;
  phone: string | null;
  status: ContactStatus;
  outcome: CallOutcome | null;
  comments: string | null;
  sf_task_id: string | null;
  called_at: string | null;
};

export type SessionDetail = {
  id: number;
  name: string;
  status: SessionStatus;
  created_at: string;
};

export type ContactPreview = {
  sf_contact_id: string;
  sf_account_id: string | null;
  contact_name: string;
  account_name: string | null;
  phone: string | null;
};

export type CallStats = {
  calls_today: number;
  calls_week: number;
  sessions_active: number;
  sessions_completed: number;
};

export type CallsListFilters = {
  ownerOnly?: boolean;
  accountId?: string;
  hasPhone?: boolean;
  limit?: number;
};

export const OUTCOME_OPTIONS: { value: CallOutcome; label: string }[] = [
  { value: "answered", label: "Répondu" },
  { value: "no_answer", label: "Pas de réponse" },
  { value: "callback", label: "Rappeler" },
  { value: "not_interested", label: "Pas intéressé" },
  { value: "wrong_number", label: "Mauvais numéro" },
];
