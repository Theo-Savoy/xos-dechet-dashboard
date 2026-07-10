import assert from "node:assert/strict";
import mapping from "../api/_crm/mapping.js";
import { filterContactsForFollowUp, getFollowUpOutcomes } from "../api/calls.js";
import { validatePresetInput } from "../api/presets.js";

const followUpOutcomes = getFollowUpOutcomes(mapping);
assert.deepEqual(followUpOutcomes, ["Appel non décroché", "Message répondeur"]);

const contacts = [
  { contact_name: "Alice", outcome: "Appel non décroché" },
  { contact_name: "Bob", outcome: "Message répondeur" },
  { contact_name: "Carol", outcome: "Appel décroché" },
  { contact_name: "Dave", outcome: "RDV planifié" },
  { contact_name: "Eve", outcome: null },
];

const filtered = filterContactsForFollowUp(contacts, followUpOutcomes);
assert.equal(filtered.length, 2);
assert.deepEqual(
  filtered.map((contact) => contact.contact_name),
  ["Alice", "Bob"],
);

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

console.log("calls-v2-logic.test.js: OK");
