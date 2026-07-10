import assert from "node:assert/strict";
import {
  boundedLimit,
  buildTargetQuery,
  filterTargetContacts,
  hasRelanceQueryFilters,
  SOQL_FETCH_CAP,
} from "../api/_crm/salesforce.js";
import mapping from "../api/_crm/mapping.js";

const baseFilters = {
  entreprise: { secteurs: ["Finance", "Transports"] },
  contact: {},
  relance: {},
};

const industryQuery = buildTargetQuery(baseFilters, mapping, null);
assert.match(
  industryQuery,
  new RegExp(`Account\\.${mapping.objects.account.fields.industry} IN \\('Finance', 'Transports'\\)`),
);
assert.match(industryQuery, new RegExp(`${mapping.objects.contact.fields.doNotCall} = false`));
assert.match(industryQuery, new RegExp(`${mapping.objects.contact.fields.title}`));
assert.match(industryQuery, new RegExp(`${mapping.objects.contact.fields.linkedin}`));
assert.doesNotMatch(industryQuery, /NOT IN \(SELECT WhoId FROM Task/);
assert.match(industryQuery, /LIMIT 200$/);

const relanceFilters = {
  ...baseFilters,
  relance: {
    jamais_appele: true,
    dernier_appel_avant_jours: 30,
    dernier_appel_dans_jours: 7,
  },
  limit: 100,
};
const relanceQuery = buildTargetQuery(relanceFilters, mapping, null);
assert.doesNotMatch(relanceQuery, /LAST_N_DAYS/);
assert.doesNotMatch(relanceQuery, /NOT IN \(SELECT/);
assert.match(relanceQuery, new RegExp(`LIMIT ${SOQL_FETCH_CAP}$`));
assert.equal(hasRelanceQueryFilters(relanceFilters), true);
assert.equal(boundedLimit(2000), 2000);
assert.equal(boundedLimit(9000), 2000);

const fonctionQuery = buildTargetQuery(
  { ...baseFilters, contact: { fonctions: ["responsable_formation", "directeur_formation"] } },
  mapping,
  null,
);
assert.match(fonctionQuery, /Title LIKE '%responsable%formation%'/);
assert.match(fonctionQuery, /Title IN \('RF'\)/);
assert.match(fonctionQuery, /Title LIKE '%direct%formation%'/);

const rhQuery = buildTargetQuery(
  { ...baseFilters, contact: { fonctions: ["responsable_rh", "directeur_rh"] } },
  mapping,
  null,
);
assert.match(rhQuery, /Title LIKE '%responsable rh%'/);
assert.match(rhQuery, /Title IN \('RRH', 'HRBP', 'Cadre RH'\)/);
assert.match(rhQuery, /Title LIKE '%drh%'/);
assert.match(rhQuery, /Title IN \('CHRO'\)/);

const unknownPresetQuery = buildTargetQuery(
  { ...baseFilters, contact: { fonctions: ["preset_inexistant"] } },
  mapping,
  null,
);
assert.doesNotMatch(unknownPresetQuery, /preset_inexistant/);

const now = new Date("2026-07-10T12:00:00Z");
const records = [
  {
    Id: "003never",
    Tasks: null,
  },
  {
    Id: "003recent",
    Tasks: {
      records: [{ ActivityDate: "2026-07-09", Resultat_call__c: "Appel décroché", CallDurationInSeconds: 30 }],
    },
  },
  {
    Id: "003old",
    Tasks: {
      records: [{ ActivityDate: "2026-05-01", Resultat_call__c: "Appel décroché", CallDurationInSeconds: 30 }],
    },
  },
];

const neverCalled = filterTargetContacts(records, { relance: { jamais_appele: true } }, mapping, now);
assert.deepEqual(neverCalled.map((r) => r.Id), ["003never"]);

const before30 = filterTargetContacts(records, { relance: { dernier_appel_avant_jours: 30 } }, mapping, now);
assert.deepEqual(before30.map((r) => r.Id).sort(), ["003never", "003old"]);

const within7 = filterTargetContacts(records, { relance: { dernier_appel_dans_jours: 7 } }, mapping, now);
assert.deepEqual(within7.map((r) => r.Id), ["003recent"]);

console.log("call-target-query.check.js: OK");
