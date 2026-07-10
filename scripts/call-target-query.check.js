import assert from "node:assert/strict";
import { buildTargetQuery } from "../api/_crm/salesforce.js";
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
assert.match(industryQuery, /LIMIT 200$/);

const followUpQuery = buildTargetQuery(
  {
    ...baseFilters,
    relance: {
      dernier_appel_avant_jours: 30,
      dernier_appel_dans_jours: 7,
      exclure_si_plus_de: { appels: 3, sur_jours: 14 },
    },
    limit: 900,
  },
  mapping,
  null,
);
assert.match(followUpQuery, new RegExp(`${mapping.objects.task.fields.activityDate} >= LAST_N_DAYS:30`));
assert.match(followUpQuery, new RegExp(`${mapping.objects.task.fields.activityDate} = LAST_N_DAYS:7`));
assert.match(followUpQuery, /LIMIT 500$/);

console.log("call-target-query.check.js: OK");
