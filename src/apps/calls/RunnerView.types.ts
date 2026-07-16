import type { ResultatCall } from "../../crm";

export type LogPayload = {
  resultat: ResultatCall;
  comments: string;
  recallAt: string | null;
  doNotCall: boolean;
};

export type DeferPayload = {
  scheduledFor: string;
  targetSessionId: number | null;
  name?: string | null;
};
