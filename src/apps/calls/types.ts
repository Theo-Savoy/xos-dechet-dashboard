import {
  RESULTAT_CALL_VALUES,
  type EffectifTranche,
  type FilterTree,
  type NiveauDecision,
  type ResultatCall,
  type Tier,
  type TypeClient,
} from "../../crm";

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
  is_owner?: boolean;
  shared?: boolean;
  member_count?: number;
  members?: TeamMember[];
  rdv_goal?: number | null;
  engaged_at?: string | null;
};

export type RecallInboxItem = {
  id: number;
  session_id: number;
  session_name: string;
  session_status: SessionStatus;
  contact_name: string;
  account_name: string | null;
  phone: string | null;
  email?: string | null;
  title?: string | null;
  linkedin_url?: string | null;
  sf_contact_id?: string | null;
  sf_account_id?: string | null;
  recall_at: string;
  outcome: ResultatCall | null;
  attempt_count?: number;
  previous_callers?: Array<{
    user_label: string;
    called_at: string;
    outcome: ResultatCall | null;
    session_name: string;
  }>;
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
  /** Present when the contact is shown in the infinite recall queue. */
  origin_session_id?: number;
  origin_session_name?: string;
  previous_callers?: RecallInboxItem["previous_callers"];
  logged_by?: string | null;
  claimed_by?: string | null;
  claimed_at?: string | null;
  claim_active?: boolean;
  claimed_by_label?: string | null;
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
  /** Contact associé à l’opportunité dans Salesforce (OpportunityContactRole). */
  linked_to_contact?: boolean;
};

export type ContactEventItem = {
  id: string;
  subject: string | null;
  start_date_time: string | null;
  record_url: string | null;
  /** Event.WhoId = contact courant. */
  linked_to_contact?: boolean;
};

export type PeerClientAccount = {
  id: string;
  name: string;
  industry: string | null;
  record_url: string | null;
};

export type ContactContext = {
  contact_record_url: string | null;
  account_record_url: string | null;
  email?: string | null;
  title?: string | null;
  account_name?: string | null;
  /** Valeur picklist Type_de_client__c du compte lié. */
  account_customer_type?: string | null;
  /** Salesforce User Id propriétaire du compte (Account.OwnerId). */
  account_owner_sf_user_id?: string | null;
  industry?: string | null;
  peer_clients?: PeerClientAccount[];
  npa: boolean;
  tasks: ContactTaskHistoryItem[];
  opportunities: ContactOpportunityItem[];
  events?: ContactEventItem[];
};

export type SessionDetail = {
  id: number;
  name: string;
  status: SessionStatus;
  created_at: string;
  scheduled_for?: string | null;
  session_type?: SessionType;
  is_owner?: boolean;
  owner_id?: string;
  members?: TeamMember[];
  rdv_goal?: number | null;
  engaged_at?: string | null;
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

export type AccountSearchContact = {
  sf_contact_id: string;
  contact_name: string;
  title: string | null;
  phone: string | null;
  mobile_phone: string | null;
  email: string | null;
  decision_level: NiveauDecision | null;
};

export type AccountSearchHit = {
  id: string;
  name: string;
  industry: string | null;
  owner_name: string | null;
  type_client: TypeClient | null;
  tier: Tier | null;
  effectif: EffectifTranche | null;
  contacts: AccountSearchContact[];
};

export type AccountSearchResult = {
  accounts: AccountSearchHit[];
  truncated: boolean;
  excluded_count?: number;
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

export type TeamMember = {
  user_id: string;
  label: string;
  sf_user_id: string;
};

export type { FilterTree };

export const RESULTAT_OPTIONS: { value: ResultatCall; label: string }[] = RESULTAT_CALL_VALUES.map(
  (value) => ({ value, label: value }),
);
