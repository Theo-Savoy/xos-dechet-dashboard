import { RESULTAT_CALL_VALUES, type FilterTree, type ResultatCall } from "../../crm";

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
  outcome: ResultatCall | null;
  comments: string | null;
  sf_task_id: string | null;
  sf_event_id: string | null;
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
  last_call_at?: string | null;
  call_count?: number;
};

export type CallStats = {
  calls_today: number;
  calls_week: number;
  sessions_active: number;
  sessions_completed: number;
};

export type { FilterTree };

export const RESULTAT_OPTIONS: { value: ResultatCall; label: string }[] = RESULTAT_CALL_VALUES.map(
  (value) => ({ value, label: value }),
);
