import { RESULTAT_CALL_VALUES, type FilterTree, type ResultatCall } from "../../crm";

export type ContactStatus = "pending" | "called" | "skipped";

export type SessionStatus = "active" | "completed";

export type SessionType = "prospection" | "suivi_opportunites" | "suivi_clients" | "relance";

export const SESSION_TYPE_OPTIONS: { value: SessionType; label: string }[] = [
  { value: "prospection", label: "Prospection" },
  { value: "suivi_opportunites", label: "Suivi opportunités" },
  { value: "suivi_clients", label: "Suivi clients" },
  { value: "relance", label: "Relance" },
];

export function sessionTypeLabel(type: SessionType | string | null | undefined): string {
  return SESSION_TYPE_OPTIONS.find((opt) => opt.value === type)?.label ?? "Prospection";
}

export type SessionSummary = {
  id: number;
  name: string;
  status: SessionStatus;
  created_at: string;
  scheduled_for: string | null;
  session_type: SessionType;
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
  email?: string | null;
  title: string | null;
  linkedin_url: string | null;
  status: ContactStatus;
  outcome: ResultatCall | null;
  comments: string | null;
  sf_task_id: string | null;
  sf_event_id: string | null;
  called_at: string | null;
  recall_at?: string | null;
  attempt_count?: number;
  marked_npa?: boolean;
  sf_contact_url?: string | null;
  sf_account_url?: string | null;
};

export type ContactTaskHistoryItem = {
  id: string;
  activity_date: string | null;
  result: string | null;
  subject: string | null;
  description: string | null;
  record_url: string | null;
};

export type ContactOpportunityItem = {
  id: string;
  name: string;
  stage_name: string | null;
  is_closed: boolean;
  is_won: boolean;
  amount: number | null;
  close_date: string | null;
  record_url: string | null;
};

export type ContactContext = {
  contact_record_url: string | null;
  account_record_url: string | null;
  npa: boolean;
  tasks: ContactTaskHistoryItem[];
  opportunities: ContactOpportunityItem[];
};

export type SessionDetail = {
  id: number;
  name: string;
  status: SessionStatus;
  created_at: string;
  scheduled_for?: string | null;
  session_type?: SessionType;
};

export type ContactPreview = {
  sf_contact_id: string;
  sf_account_id: string | null;
  contact_name: string;
  account_name: string | null;
  phone: string | null;
  title?: string | null;
  linkedin_url?: string | null;
  email?: string | null;
  mobile_phone?: string | null;
  last_call_at?: string | null;
  call_count?: number;
};

export type PeriodKpis = {
  calls: number;
  decroche: number;
  argumente: number;
  rdv: number;
  npa: number;
  rate_decroche: number;
  rate_argumente: number;
  rate_rdv_per_decroche: number;
  rate_rdv_per_argumente: number;
};

export type CallStats = {
  calls_today: number;
  calls_week: number;
  sessions_active: number;
  sessions_completed: number;
  week?: PeriodKpis;
  month?: PeriodKpis;
};

export type { FilterTree };

export const RESULTAT_OPTIONS: { value: ResultatCall; label: string }[] = RESULTAT_CALL_VALUES.map(
  (value) => ({ value, label: value }),
);
