import assert from "node:assert/strict";
import mapping from "../api/_crm/mapping.js";
import { filterContactsForFollowUp, getFollowUpOutcomes, isValidEventStart, computeHubKpis } from "../api/calls.js";
import { parsePresetId, validatePresetInput } from "../api/_calls/presets.js";

const followUpOutcomes = getFollowUpOutcomes(mapping);
assert.deepEqual(followUpOutcomes, [
  mapping.objects.task.resultSemantic.followUpNoAnswer,
  mapping.objects.task.resultSemantic.followUpVoicemail,
]);

const contacts = [
  { contact_name: "Alice", outcome: "Appel non décroché", status: "called" },
  { contact_name: "Bob", outcome: "Message répondeur", status: "called" },
  { contact_name: "Carol", outcome: "Appel décroché", status: "called" },
  { contact_name: "Dave", outcome: "RDV planifié", status: "called" },
  { contact_name: "Eve", outcome: null, status: "pending" },
  { contact_name: "Frank", outcome: null, status: "skipped" },
];

const filtered = filterContactsForFollowUp(contacts, followUpOutcomes);
assert.equal(filtered.length, 4);
assert.deepEqual(
  filtered.map((contact) => contact.contact_name),
  ["Alice", "Bob", "Eve", "Frank"],
);

const kpis = computeHubKpis([
  { status: "called", outcome: "RDV planifié", marked_npa: false },
  { status: "called", outcome: "Appel argumenté", marked_npa: true },
]);
assert.equal(kpis.calls, 2);
assert.equal(kpis.rdv, 1);
assert.equal(kpis.npa, 1);
assert.equal(kpis.rate_rdv_per_argumente, 50);

assert.equal(validatePresetInput(null).error, "invalid_body");
assert.equal(validatePresetInput({ name: "", filters: {} }).error, "invalid_name");
assert.equal(validatePresetInput({ name: "Prospects", filters: [] }).error, "invalid_filters");
assert.equal(
  validatePresetInput({ name: "Prospects", filters: { relance: [] } }).error,
  "invalid_filters",
);
assert.equal(
  validatePresetInput({ name: "Prospects", filters: {}, shared: "yes" }).error,
  "invalid_shared",
);

const valid = validatePresetInput({
  name: "  Relance Q3  ",
  filters: { relance: { dernier_resultat: followUpOutcomes } },
  shared: true,
});
assert.equal(valid.error, undefined);
assert.equal(valid.name, "Relance Q3");
assert.equal(valid.shared, true);
assert.deepEqual(valid.filters.relance.dernier_resultat, followUpOutcomes);

assert.equal(isValidEventStart("2026-07-10T14:30Z"), true);
assert.equal(isValidEventStart("2026-07-10T14:30:00+02:00"), true);
assert.equal(isValidEventStart("2026-02-30T10:00:00Z"), false);
assert.equal(isValidEventStart("2026-07-10T25:00:00Z"), false);

assert.equal(parsePresetId(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
assert.equal(parsePresetId(String(Number.MAX_SAFE_INTEGER) + "0"), null);

console.log("calls-v2-logic.check.js: OK");
