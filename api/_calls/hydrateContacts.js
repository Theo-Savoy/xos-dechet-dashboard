import { fetchContactBasicsByIds } from "../_crm/salesforce.js";

/** Fills missing email/title on session rows from CRM and persists updates. */
export async function hydrateSessionContactsFromCrm(client, contacts, accessToken, mapping) {
  if (!contacts?.length || !accessToken) return contacts;

  const needsHydration = contacts.filter((contact) => !contact.email || !contact.title);
  if (!needsHydration.length) return contacts;

  const ids = [...new Set(needsHydration.map((contact) => contact.sf_contact_id))];
  const lookup = await fetchContactBasicsByIds(accessToken, ids, mapping);
  if (lookup.error) return contacts;

  const updates = [];
  const enriched = contacts.map((contact) => {
    const basics = lookup.byId.get(contact.sf_contact_id);
    if (!basics) return contact;

    const patch = {};
    if (!contact.email && basics.email) patch.email = basics.email;
    if (!contact.title && basics.title) patch.title = basics.title;
    if (!Object.keys(patch).length) return contact;

    updates.push({ id: contact.id, ...patch });
    return { ...contact, ...patch };
  });

  if (updates.length && client) {
    await Promise.all(
      updates.map((row) => {
        const { id, ...fields } = row;
        return client.from("call_session_contacts").update(fields).eq("id", id);
      }),
    );
  }

  return enriched;
}
