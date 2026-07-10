#!/usr/bin/env python3
"""
Audit Lot 3.0 — Opportunités créées vs gagnées (Pipeline Généré vs Gagné).
Volumes et montants par commercial × semaine (8 semaines).
Lecture seule.
"""
import json, os, sys, re
from datetime import date, datetime as dt, timedelta
from collections import Counter
from urllib.parse import quote_plus

sys.path.insert(0, "/Users/theosavoy/.hermes/hermes-agent")
from hermes_cli.salesforce_api import ensure_salesforce_state, _authorized_request_json

state = ensure_salesforce_state()

def _fetch(state, path, timeout=120):
    s = str(path)
    from urllib.parse import urlparse
    if s.startswith("http://") or s.startswith("https://"):
        s = urlparse(s).path
    if s.startswith("/"):
        s = s[1:]
    m = re.search(r"v\d+\.\d+/", s)
    if m:
        s = s[m.end():]
    return _authorized_request_json(state, s, method="GET", timeout_seconds=timeout)

def query_all(state, soql, timeout=120):
    records = []
    path = f"query?q={quote_plus(soql.replace(chr(10), ' ').strip())}"
    while True:
        payload = _fetch(state, path, timeout=timeout)
        if not isinstance(payload, dict):
            break
        records.extend(payload.get("records") or [])
        if payload.get("done", True):
            break
        nxt = payload.get("nextRecordsUrl")
        if not nxt:
            break
        path = nxt
    return records

# ── 1. Opportunités créées sur 8 semaines glissantes ──
today = date.today()
eight_weeks_ago = (today - timedelta(weeks=8)).isoformat()

print("─" * 60)
print(f"OPPORTUNITÉS CRÉÉES — 8 semaines (depuis {eight_weeks_ago})")

soql_created = """
SELECT Id, Name, Amount, StageName, CreatedDate, CloseDate, IsWon, IsClosed,
       OwnerId, Owner.Name, AccountId, Account.Name
FROM Opportunity
WHERE CreatedDate >= LAST_N_DAYS:56
ORDER BY CreatedDate DESC
"""
created_records = query_all(state, soql_created)
print(f"  Total créées: {len(created_records)}")

def week_label(d):
    iso = d.isocalendar()
    return f"{iso[0]}-W{iso[1]:02d}"

# Agrégation par owner × semaine pour les créées
created_owner_week = {}
created_week_totals = Counter()
for o in created_records:
    created_str = o.get("CreatedDate", "")
    if not created_str:
        continue
    try:
        d = dt.fromisoformat(created_str[:10]).date()
    except:
        continue
    wl = week_label(d)
    owner_name = (o.get("Owner") or {}).get("Name", "?") if isinstance(o.get("Owner"), dict) else "?"
    amt = o.get("Amount") or 0
    key = (owner_name, wl)
    if key not in created_owner_week:
        created_owner_week[key] = {"count": 0, "amount": 0}
    created_owner_week[key]["count"] += 1
    created_owner_week[key]["amount"] += amt
    created_week_totals[wl] += 1

all_owners_created = sorted(set(own for own, _ in created_owner_week))
all_weeks_created = sorted(set(wl for _, wl in created_owner_week))

print("\n  Opportunités créées par commercial × semaine (nombre / montant):")
if all_weeks_created:
    header = f"  {'Owner':<25} {' | '.join(all_weeks_created)}"
    print(header)
    for owner in all_owners_created:
        vals = []
        for wl in all_weeks_created:
            data = created_owner_week.get((owner, wl), {"count": 0, "amount": 0})
            vals.append(f"{data['count']} ({data['amount']:,.0f}€)")
        print(f"  {owner:<25} {' | '.join(vals)}")

# Totaux créées
print("\n  Totaux créées par owner (8 semaines):")
created_owner_totals = {}
for (owner, wl), data in created_owner_week.items():
    if owner not in created_owner_totals:
        created_owner_totals[owner] = {"count": 0, "amount": 0}
    created_owner_totals[owner]["count"] += data["count"]
    created_owner_totals[owner]["amount"] += data["amount"]
for owner in sorted(created_owner_totals, key=lambda o: created_owner_totals[o]["count"], reverse=True):
    print(f"    {owner}: {created_owner_totals[owner]['count']} opps — {created_owner_totals[owner]['amount']:,.0f}€")

# ── 2. Opportunités gagnées sur 8 semaines ──
print(f"\n{'─' * 60}")
print(f"OPPORTUNITÉS GAGNÉES — 8 semaines (depuis {eight_weeks_ago})")

soql_won = """
SELECT Id, Name, Amount, StageName, CreatedDate, CloseDate, IsWon, IsClosed,
       OwnerId, Owner.Name, AccountId, Account.Name
FROM Opportunity
WHERE IsWon = true
  AND CloseDate >= LAST_N_DAYS:56
ORDER BY CloseDate DESC
"""
won_records = query_all(state, soql_won)
print(f"  Total gagnées: {len(won_records)}")

won_owner_week = {}
won_week_totals = Counter()
for o in won_records:
    close_str = o.get("CloseDate", "")
    if not close_str:
        continue
    try:
        d = dt.fromisoformat(close_str).date()
    except:
        continue
    wl = week_label(d)
    owner_name = (o.get("Owner") or {}).get("Name", "?") if isinstance(o.get("Owner"), dict) else "?"
    amt = o.get("Amount") or 0
    key = (owner_name, wl)
    if key not in won_owner_week:
        won_owner_week[key] = {"count": 0, "amount": 0}
    won_owner_week[key]["count"] += 1
    won_owner_week[key]["amount"] += amt
    won_week_totals[wl] += 1

all_owners_won = sorted(set(own for own, _ in won_owner_week))
all_weeks_won = sorted(set(wl for _, wl in won_owner_week))

print("\n  Opportunités gagnées par commercial × semaine (nombre / montant):")
if all_weeks_won:
    header = f"  {'Owner':<25} {' | '.join(all_weeks_won)}"
    print(header)
    for owner in all_owners_won:
        vals = []
        for wl in all_weeks_won:
            data = won_owner_week.get((owner, wl), {"count": 0, "amount": 0})
            vals.append(f"{data['count']} ({data['amount']:,.0f}€)")
        print(f"  {owner:<25} {' | '.join(vals)}")

# Totaux gagnées
print("\n  Totaux gagnées par owner (8 semaines):")
won_owner_totals = {}
for (owner, wl), data in won_owner_week.items():
    if owner not in won_owner_totals:
        won_owner_totals[owner] = {"count": 0, "amount": 0}
    won_owner_totals[owner]["count"] += data["count"]
    won_owner_totals[owner]["amount"] += data["amount"]
for owner in sorted(won_owner_totals, key=lambda o: won_owner_totals[o]["count"], reverse=True):
    print(f"    {owner}: {won_owner_totals[owner]['count']} opps — {won_owner_totals[owner]['amount']:,.0f}€")

# ── 3. Comparaison créées vs gagnées par semaine (tous owners) ──
print(f"\n{'─' * 60}")
print("COMPARAISON CRÉÉES vs GAGNÉES par semaine")
all_weeks = sorted(set(list(created_week_totals.keys()) + list(won_week_totals.keys())))
if all_weeks:
    print(f"  {'Semaine':<12} {'Créées':<10} {'Gagnées':<10} {'Ratio G/C':<12}")
    for wl in all_weeks:
        c = created_week_totals.get(wl, 0)
        g = won_week_totals.get(wl, 0)
        ratio = f"{g/c:.2f}" if c > 0 else "N/A"
        print(f"  {wl:<12} {c:<10} {g:<10} {ratio:<12}")

# Montants
created_montant_week = Counter()
won_montant_week = Counter()
for (owner, wl), data in created_owner_week.items():
    created_montant_week[wl] += data["amount"]
for (owner, wl), data in won_owner_week.items():
    won_montant_week[wl] += data["amount"]

print(f"\n  Montants par semaine:")
print(f"  {'Semaine':<12} {'Créées':<15} {'Gagnées':<15} {'Ratio G/C':<12}")
for wl in all_weeks:
    c = created_montant_week.get(wl, 0)
    g = won_montant_week.get(wl, 0)
    ratio = f"{g/c:.2f}" if c > 0 else "N/A"
    print(f"  {wl:<12} {c:<15,.0f}€ {g:<15,.0f}€ {ratio:<12}")

# ── 4. Statistiques globales ──
total_created = len(created_records)
total_won = len(won_records)
total_created_amount = sum(o.get("Amount", 0) or 0 for o in created_records)
total_won_amount = sum(o.get("Amount", 0) or 0 for o in won_records)
avg_created_amount = total_created_amount / total_created if total_created else 0
avg_won_amount = total_won_amount / total_won if total_won else 0

print(f"\n{'─' * 60}")
print("STATISTIQUES GLOBALES (8 semaines)")
print(f"  Opps créées: {total_created} — montant total: {total_created_amount:,.0f}€ — taille moyenne: {avg_created_amount:,.0f}€")
print(f"  Opps gagnées: {total_won} — montant total: {total_won_amount:,.0f}€ — taille moyenne: {avg_won_amount:,.0f}€")
if total_created > 0:
    print(f"  Taux de closing (nombre): {total_won}/{total_created} = {total_won/total_created*100:.1f}%")
    print(f"  Taux de closing (montant): {total_won_amount/total_created_amount*100:.1f}%")

# ── 5. Save ──
os.makedirs("/tmp/xos-audit", exist_ok=True)
output = {
    "period": f"{eight_weeks_ago} → {today.isoformat()}",
    "total_created": total_created,
    "total_won": total_won,
    "created_amount_total": total_created_amount,
    "won_amount_total": total_won_amount,
    "avg_created_amount": round(avg_created_amount, 1),
    "avg_won_amount": round(avg_won_amount, 1),
    "win_rate_count": round(total_won / total_created * 100, 1) if total_created else 0,
    "win_rate_amount": round(total_won_amount / total_created_amount * 100, 1) if total_created_amount else 0,
    "created_owner_week": {str(k): v for k, v in created_owner_week.items()},
    "won_owner_week": {str(k): v for k, v in won_owner_week.items()},
    "created_week_totals": dict(created_week_totals),
    "won_week_totals": dict(won_week_totals),
    "created_montant_week": dict(created_montant_week),
    "won_montant_week": dict(won_montant_week),
}
with open("/tmp/xos-audit/created_vs_won_audit.json", "w") as f:
    json.dump(output, f, ensure_ascii=False, indent=2)
print(f"\n✅ Sauvegardé dans /tmp/xos-audit/created_vs_won_audit.json")
