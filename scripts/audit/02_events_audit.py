#!/usr/bin/env python3
"""
Audit Lot 3.0 — Volumétrie des Events (RDV/démos).
Exploration des types, volumes par commercial × semaine (8 semaines).
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

# ── 1. Describe Event — sub-type fields ──
print("─" * 60)
print("EVENT — Describe (champs de type)")
desc = _fetch(state, "sobjects/Event/describe")
event_type_field = None
event_subtype_field = None
for f in desc.get("fields", []):
    if f.get("name") == "Type":
        event_type_field = f
    if f.get("name") == "EventSubtype":
        event_subtype_field = f

if event_type_field:
    types = [(p.get("value", ""), p.get("active")) for p in event_type_field.get("picklistValues", [])]
    print(f"  Type (actifs): {sorted([v for v, a in types if a])}")
    print(f"  Type (inactifs): {sorted([v for v, a in types if not a])}")
if event_subtype_field:
    subtypes = [(p.get("value", ""), p.get("active")) for p in event_subtype_field.get("picklistValues", [])]
    print(f"  EventSubtype: {[(v, a) for v, a in subtypes]}")

# ── 2. Volumétrie 8 semaines glissantes ──
today = date.today()
eight_weeks_ago = (today - timedelta(weeks=8)).isoformat()

print(f"\n{'─' * 60}")
print(f"EVENTS — 8 semaines glissantes (depuis {eight_weeks_ago})")

soql_events = """
SELECT Id, Subject, Type, EventSubtype, ActivityDate, DurationInMinutes,
       OwnerId, Owner.Name, WhatId, WhoId, CreatedDate, LastModifiedDate
FROM Event
WHERE CreatedDate >= LAST_N_DAYS:56
ORDER BY CreatedDate DESC
"""
event_records = query_all(state, soql_events)
print(f"  Total Events sur 8 semaines: {len(event_records)}")

# ── 3. Distribution par Type ──
type_counter = Counter()
for e in event_records:
    t = e.get("Type") or "None"
    type_counter[t] += 1
print("\n  Répartition par Type:")
for t, count in type_counter.most_common():
    pct = count / len(event_records) * 100 if event_records else 0
    print(f"    {t}: {count} ({pct:.1f}%)")

# ── 4. Top subjects ──
subject_counter = Counter()
for e in event_records:
    subj = e.get("Subject") or ""
    subject_counter[subj] += 1
print("\n  Top 20 sujets:")
for subj, count in subject_counter.most_common(20):
    print(f"    [{count}] {subj[:80]}")

# ── 5. Volumes par owner × semaine ──
def week_label(d):
    iso = d.isocalendar()
    return f"{iso[0]}-W{iso[1]:02d}"

owner_week = {}
for e in event_records:
    d_str = e.get("ActivityDate") or e.get("CreatedDate") or ""
    if not d_str:
        continue
    try:
        d = dt.fromisoformat(d_str[:10]).date()
    except:
        continue
    wl = week_label(d)
    owner_name = (e.get("Owner") or {}).get("Name", "?") if isinstance(e.get("Owner"), dict) else "?"
    key = (owner_name, wl)
    owner_week[key] = owner_week.get(key, 0) + 1

all_owners = sorted(set(own for own, _ in owner_week))
all_weeks = sorted(set(wl for _, wl in owner_week))

print(f"\n  Volume Events par commercial × semaine (8 semaines):")
if all_weeks:
    print(f"  {'Owner':<25} {' | '.join(all_weeks)}")
    for owner in all_owners:
        vals = [str(owner_week.get((owner, wl), 0)) for wl in all_weeks]
        print(f"  {owner:<25} {' | '.join(vals)}")
else:
    print("  Aucun event sur la période.")

# ── 6. Totaux par owner ──
print("\n  Totaux par owner (8 semaines):")
owner_totals = Counter()
for e in event_records:
    owner_name = (e.get("Owner") or {}).get("Name", "?") if isinstance(e.get("Owner"), dict) else "?"
    owner_totals[owner_name] += 1
for owner, count in owner_totals.most_common():
    print(f"    {owner}: {count}")

# ── 7. Durée moyenne ──
durations = [e.get("DurationInMinutes", 0) or 0 for e in event_records]
avg_duration = sum(durations) / len(durations) if durations else 0
print(f"\n  Durée moyenne: {avg_duration:.0f} min")

# ── 8. Save ──
os.makedirs("/tmp/xos-audit", exist_ok=True)
output = {
    "total_events_8weeks": len(event_records),
    "type_distribution": dict(type_counter),
    "top_subjects": dict(subject_counter.most_common(30)),
    "owner_week": {str(k): v for k, v in owner_week.items()},
    "owner_totals": dict(owner_totals),
    "avg_duration_min": round(avg_duration, 1),
}
with open("/tmp/xos-audit/events_audit.json", "w") as f:
    json.dump(output, f, ensure_ascii=False, indent=2)
print(f"\n✅ Sauvegardé dans /tmp/xos-audit/events_audit.json")
