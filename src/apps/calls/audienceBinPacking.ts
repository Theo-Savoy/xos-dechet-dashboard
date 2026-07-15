/**
 * First-Fit Decreasing par compte : jamais casser un compte, regrouper les
 * comptes dans des séances dont la taille approche `targetSize`, plafonné à
 * `maxSessions`. Un compte qui ne rentre nulle part une fois le plafond
 * atteint est ignoré (avec un warning console).
 */

export type PackableAccount<C> = {
  id: string;
  name: string;
  contacts: C[];
};

export type PackedGroup<C> = {
  accountIds: string[];
  accountNames: string[];
  totalContacts: number;
  contacts: C[];
};

const TOLERANCE_RATIO = 1.2;

export function packAccountsIntoSessions<C>(
  accounts: PackableAccount<C>[],
  targetSize: number,
  maxSessions: number,
): PackedGroup<C>[] {
  const eligible = accounts.filter((account) => account.contacts.length > 0);
  const sorted = [...eligible].sort((a, b) => b.contacts.length - a.contacts.length);
  const tolerance = targetSize * TOLERANCE_RATIO;

  const sessions: { accounts: PackableAccount<C>[]; totalContacts: number }[] = [];

  for (const account of sorted) {
    const count = account.contacts.length;
    const fit = sessions.find((session) => session.totalContacts + count <= tolerance);
    if (fit) {
      fit.accounts.push(account);
      fit.totalContacts += count;
    } else if (sessions.length < maxSessions) {
      sessions.push({ accounts: [account], totalContacts: count });
    } else {
      console.warn(`packAccountsIntoSessions: compte "${account.name}" ignoré (plafond de ${maxSessions} séances atteint)`);
    }
  }

  return sessions
    .filter((session) => session.accounts.length > 0)
    .sort((a, b) => b.totalContacts - a.totalContacts)
    .map((session) => ({
      accountIds: session.accounts.map((account) => account.id),
      accountNames: session.accounts.map((account) => account.name),
      totalContacts: session.totalContacts,
      contacts: session.accounts.flatMap((account) => account.contacts),
    }));
}
