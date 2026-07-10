#!/usr/bin/env python3
"""
Audit Lot 3.0 — Volumétrie des Tasks.
Exploration des types/sous-types réels, volumes par commercial × semaine (8 semaines).
Lecture seule.
"""
import json, os, sys, re
from datetime import date, datetime, timedelta
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

# ── 1. Découverte des TaskSubtype via describe ──
print("─" * 60)
print("TASKSUBTYPE — Valeurs de picklist")
desc = _fetch(state, "sobjects/Task/describe")
task_subtypes = []
for f in desc.get("fields", []):
    if f.get("name") == "TaskSubtype":
        task_subtypes = [(p.get("value", ""), p.get("active")) for p in f.get("picklistValues", [])]
        break
print(f"  Valeurs actives: {[v for v, a in task_subtypes if a]}")
print(f"  Total (actif/inactif): {len(task_subtypes)}")

# ── 2. Volumétrie globale des Tasks (les 8 dernières semaines) ──
today = date.today()
eight_weeks_ago = (today - timedelta(weeks=8)).isoformat()

print(f"\n{'─' * 60}")
print(f"TASKS — 8 semaines glissantes (depuis {eight_weeks_ago})")

soql_tasks = """
SELECT Id, Subject, TaskSubtype, Status, Priority, ActivityDate,
       OwnerId, Owner.Name, WhatId, WhoId, CreatedDate, LastModifiedDate
FROM Task
WHERE CreatedDate >= LAST_N_DAYS:56
ORDER BY CreatedDate DESC
"""
task_records = query_all(state, soql_tasks)
print(f"  Total Tasks sur 8 semaines: {len(task_records)}")

# ── 3. Distribution par TaskSubtype ──
from collections import Counter
subtype_counter = Counter()
for t in task_records:
    st = t.get("TaskSubtype", "None")
    subtype_counter[st if st else "None"] += 1
print("\n  Répartition TaskSubtype:")
for st, count in subtype_counter.most_common():
    pct = count / len(task_records) * 100 if task_records else 0
    print(f"    {st}: {count} ({pct:.1f}%)")

# ── 4. Pattern Analysis on Subjects ──
# Try to classify tasks from Subject — do they use Call/Email/Meeting patterns?
call_patterns = ["appel", "Appel", "call", "Call", "téléphone", "phone", "PHONE"]
meeting_patterns = ["rdv", "RDV", "rendez", "Rendez", "meet", "Meet", "démo", "démo", "Demo", "visio"]
email_patterns = ["email", "Email", "mail", "Mail", "relance", "Relance"]

subject_classified = {"call": 0, "meeting": 0, "email": 0, "other": 0}
subject_samples = {"call": [], "meeting": [], "email": [], "other": []}

for t in task_records:
    subj = t.get("Subject", "") or ""
    classified = False
    for p in call_patterns:
        if p.lower() in subj.lower():
            subject_classified["call"] += 1
            if len(subject_samples["call"]) < 5:
                subject_samples["call"].append(subj)
            classified = True
            break
    if not classified:
        for p in meeting_patterns:
            if p.lower() in subj.lower():
                subject_classified["meeting"] += 1
                if len(subject_samples["meeting"]) < 5:
                    subject_samples["meeting"].append(subj)
                classified = True
                break
    if not classified:
        for p in email_patterns:
            if p.lower() in subj.lower():
                subject_classified["email"] += 1
                if len(subject_samples["email"]) < 5:
                    subject_samples["email"].append(subj)
                classified = True
                break
    if not classified:
        subject_classified["other"] += 1
        if len(subject_samples["other"]) < 10:
            subject_samples["other"].append(subj)

print("\n  Classification approximative par sujet:")
for cat, count in subject_classified.items():
    pct = count / len(task_records) * 100 if task_records else 0
    print(f"    {cat}: {count} ({pct:.1f}%)")
    if cat != "other" or count > 0:
        print(f"      Échantillons: {subject_samples[cat][:5]}")

# ── 5. Top 30 sujets réels ──
raw_subject_counter = Counter()
for t in task_records:
    subj = t.get("Subject", "") or ""
    raw_subject_counter[subj] += 1

print("\n  Top 30 sujets réels:")
for subj, count in raw_subject_counter.most_common(30):
    print(f"    [{count}] {subj[:80]}")

# ── 6. Volumes par owner × semaine ──
def week_label(d):
    """Returns '2026-W28' style label."""
    iso = d.isocalendar()
    return f"{iso[0]}-W{iso[1]:02d}"

from datetime import datetime as dt

owner_week = {}
for t in task_records:
    d_str = t.get("ActivityDate") or t.get("CreatedDate") or ""
    if not d_str:
        continue
    try:
        d = dt.fromisoformat(d_str[:10]).date()
    except:
        continue
    wl = week_label(d)
    owner_name = (t.get("Owner") or {}).get("Name", "?") if isinstance(t.get("Owner"), dict) else "?"
    key = (owner_name, wl)
    owner_week[key] = owner_week.get(key, 0) + 1

# Sort by owner then week
print("\n  Volume Tasks par commercial × semaine (8 semaines):")
all_owners = sorted(set(own for own, _ in owner_week))
all_weeks = sorted(set(wl for _, wl in owner_week))
print(f"  {'Owner':<25} {' | '.join(all_weeks)}")
for owner in all_owners:
    vals = [str(owner_week.get((owner, wl), 0)) for wl in all_weeks]
    print(f"  {owner:<25} {' | '.join(vals)}")

# ── 7. Totaux par owner sur la période ──
print("\n  Totaux par owner (8 semaines):")
owner_totals = Counter()
for t in task_records:
    owner_name = (t.get("Owner") or {}).get("Name", "?") if isinstance(t.get("Owner"), dict) else "?"
    owner_totals[owner_name] += 1
for owner, count in owner_totals.most_common():
    print(f"    {owner}: {count}")

# ── 8. Save raw data ──
os.makedirs("/tmp/xos-audit", exist_ok=True)
output = {
    "total_tasks_8weeks": len(task_records),
    "subtype_distribution": dict(subtype_counter),
    "subject_pattern_classification": subject_classified,
    "top_subjects": dict(raw_subject_counter.most_common(50)),
    "owner_week": {str(k): v for k, v in owner_week.items()},
    "owner_totals": dict(owner_totals),
}
with open("/tmp/xos-audit/tasks_audit.json", "w") as f:
    json.dump(output, f, ensure_ascii=False, indent=2)
print(f"\n✅ Sauvegardé dans /tmp/xos-audit/tasks_audit.json")
