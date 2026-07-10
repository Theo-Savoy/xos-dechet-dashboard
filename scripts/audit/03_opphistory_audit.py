#!/usr/bin/env python3
"""
Audit Lot 3.0 — Volumétrie OpportunityHistory.
Nommage réel des étapes, progression de pipeline (stage advancement) par semaine.
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

# ── 1. Volumétrie globale OpportunityHistory ──
print("─" * 60)
print("OPPORTUNITYHISTORY — volumétrie globale")
soql_count = "SELECT COUNT() FROM OpportunityHistory"
count_result = query_all(state, soql_count)
total = (count_result[0].get("expr0", 0) if count_result else 0) if isinstance(count_result, list) and count_result else 0
print(f"  Total records: {total}")

# ── 2. Nommage réel des étapes (via describe) ──
print(f"\n{'─' * 60}")
print("OPPORTUNITYSTAGE — étapes actives")
stage_records = query_all(state, """
    SELECT MasterLabel, IsActive, IsClosed, IsWon, SortOrder, DefaultProbability
    FROM OpportunityStage WHERE IsActive = true ORDER BY SortOrder
""")
print(f"  {len(stage_records)} étapes actives:")
for s in stage_records:
    flags = []
    if s.get("IsClosed"):
        flags.append("fermée")
    if s.get("IsWon"):
        flags.append("gagnée")
    flag_str = f" ({', '.join(flags)})" if flags else ""
    print(f"    [{s.get('SortOrder', '?')}] {s.get('MasterLabel', '?')} (prob défaut: {s.get('DefaultProbability', '?')}%){flag_str}")

stage_names = {s.get("MasterLabel"): {"closed": s.get("IsClosed"), "won": s.get("IsWon"), "order": s.get("SortOrder")} for s in stage_records}
print(f"  Noms en base: {set(stage_names.keys())}")
print(f"  Étapes fermées: {[k for k, v in stage_names.items() if v['closed']]}")
print(f"  Étapes ouvertes: {[k for k, v in stage_names.items() if not v['closed']]}")

# ── 3. OpportunityHistory 8 semaines glissantes — stage changes ──
today = date.today()
eight_weeks_ago = (today - timedelta(weeks=8)).isoformat()

print(f"\n{'─' * 60}")
print(f"OPPORTUNITYHISTORY — 8 semaines (depuis {eight_weeks_ago})")

soql_oh = """
SELECT Id, OpportunityId, StageName, Amount, Probability, ExpectedRevenue,
       CloseDate, CreatedDate, CreatedById, CreatedBy.Name
FROM OpportunityHistory
WHERE CreatedDate >= LAST_N_DAYS:56
ORDER BY CreatedDate DESC
"""
oh_records = query_all(state, soql_oh)
print(f"  Records OpportunityHistory sur 8 semaines: {len(oh_records)}")

# ── 4. Distribution des stages reachés ──
stage_counter = Counter()
stage_to_counter = Counter()
for h in oh_records:
    sn = h.get("StageName") or ""
    stage_counter[sn] += 1

print("\n  Répartition par stage atteint:")
for sn, count in stage_counter.most_common():
    pct = count / len(oh_records) * 100 if oh_records else 0
    print(f"    {sn}: {count} ({pct:.1f}%)")

# ── 5. Stages qui ne sont PAS dans les étapes actives ──
unknown_stages = {sn for sn in stage_counter if sn not in stage_names}
if unknown_stages:
    print(f"\n  ⚠️ Étapes inconnues (pas dans les étapes actives): {unknown_stages}")

# ── 6. Progression hebdomadaire — combien d'opps passent à l'étape supérieure chaque semaine? ──
def week_label(d):
    iso = d.isocalendar()
    return f"{iso[0]}-W{iso[1]:02d}"

# Build a stage order index for advancement detection
stage_order = {}
for s in stage_records:
    stage_order[s.get("MasterLabel")] = s.get("SortOrder") or 0

# Count stages reached per week
week_stage = Counter()
for h in oh_records:
    created = h.get("CreatedDate", "")
    if not created:
        continue
    try:
        d = dt.fromisoformat(created[:10]).date()
    except:
        continue
    wl = week_label(d)
    sn = h.get("StageName") or ""
    week_stage[(wl, sn)] += 1

all_weeks = sorted(set(wl for wl, _ in week_stage))
all_stages_seen = sorted(set(sn for _, sn in week_stage),
                         key=lambda x: stage_order.get(x, 999))

print(f"\n  Progression par semaine × stage:")
for stage_name in all_stages_seen:
    vals = [str(week_stage.get((wl, stage_name), 0)) for wl in all_weeks]
    print(f"    {stage_name:<30} {' | '.join(vals)}")

# ── 7. Opportunities uniques touchées sur la période ──
unique_opps = len(set(h.get("OpportunityId") for h in oh_records))
print(f"\n  Opportunités uniques touchées sur 8 semaines: {unique_opps}")

# ── 8. Opps avec progression — combien ont avancé d'étape au moins une fois ?
# For each opp, look at the min sort order and max sort order across their history entries
opp_stages = {}
for h in oh_records:
    oid = h.get("OpportunityId")
    sn = h.get("StageName") or ""
    order = stage_order.get(sn, 0)
    if oid not in opp_stages:
        opp_stages[oid] = {"min_order": order, "max_order": order, "stages": set()}
    opp_stages[oid]["min_order"] = min(opp_stages[oid]["min_order"], order)
    opp_stages[oid]["max_order"] = max(opp_stages[oid]["max_order"], order)
    opp_stages[oid]["stages"].add(sn)

progressed = sum(1 for oid, info in opp_stages.items() if info["max_order"] > info["min_order"])
print(f"  Opps ayant progressé d'étape: {progressed}")
print(f"  Opps restées à la même étape: {len(opp_stages) - progressed}")

# ── 9. Save ──
os.makedirs("/tmp/xos-audit", exist_ok=True)
output = {
    "total_oh_records": total,
    "oh_8weeks_count": len(oh_records),
    "stages_active": {s.get("MasterLabel"): {"closed": s.get("IsClosed"), "won": s.get("IsWon"), "order": s.get("SortOrder")} for s in stage_records},
    "oh_stage_distribution": dict(stage_counter),
    "unknown_stages_in_history": list(unknown_stages),
    "week_stage": {str(k): v for k, v in week_stage.items()},
    "unique_opps_with_history_8w": unique_opps,
    "opps_progressed": progressed,
    "opps_no_progress": len(opp_stages) - progressed,
}
with open("/tmp/xos-audit/opphistory_audit.json", "w") as f:
    json.dump(output, f, ensure_ascii=False, indent=2)
print(f"\n✅ Sauvegardé dans /tmp/xos-audit/opphistory_audit.json")
