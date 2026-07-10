#!/usr/bin/env python3
"""
Compute déchet scores + resolve owner info, then generate the dashboard HTML.
"""
import json, sys, re, os
from datetime import date, datetime, timedelta
from urllib.parse import quote_plus, urlparse

sys.path.insert(0, "/Users/theosavoy/.hermes/hermes-agent")
from hermes_cli.salesforce_api import ensure_salesforce_state, _authorized_request_json

state = ensure_salesforce_state()

def _fetch(state, path, timeout=120):
    s = str(path)
    if s.startswith("http://") or s.startswith("https://"):
        s = urlparse(s).path
    if s.startswith("/"):
        s = s[1:]
    if "services/data/" in s:
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

# ── Load raw data ──
with open("/tmp/xos-dechet/raw_dechet_opps.json") as f:
    dechet = json.load(f)
with open("/tmp/xos-dechet/raw_all_open.json") as f:
    all_open = json.load(f)

print(f"Loaded {len(dechet)} déchet opps, {len(all_open)} total open")

# ── Resolve owners (UserId → Name + IsActive) ──
owner_ids = list(set(r.get("OwnerId") for r in dechet if r.get("OwnerId")))
print(f"Resolving {len(owner_ids)} unique owners...")

# Build SOQL for User info
if owner_ids:
    ids_csv = ",".join(f"'{oid}'" for oid in owner_ids)
    soql_users = f"SELECT Id, Name, IsActive FROM User WHERE Id IN ({ids_csv})"
    user_records = query_all(state, soql_users)
    users_map = {u["Id"]: {"name": u.get("Name", "?"), "active": u.get("IsActive", False)} for u in user_records}
    print(f"  → resolved {len(users_map)} users")
else:
    users_map = {}

# ── Score each déchet opp ──
today = date.today()

# Known former salespeople
FORMER_SALESPEOPLE = {
    "Julien Bak", "Romain Waeselynck", "Roxane Série", "Antoine Fardet",
    "ibrahima sissoko", "Ibrahima Sissoko"
}

scored = []
for r in dechet:
    # Basic fields
    opp_id = r.get("Id", "")
    opp_name = r.get("Name", "")
    account_name = (r.get("Account") or {}).get("Name", "—") if isinstance(r.get("Account"), dict) else "—"
    account_industry = (r.get("Account") or {}).get("Industry", "—") if isinstance(r.get("Account"), dict) else "—"
    owner_id = r.get("OwnerId", "")
    owner_info = users_map.get(owner_id, {"name": r.get("Owner", {}).get("Name", "?"), "active": True})
    owner_name = owner_info["name"]
    owner_active = owner_info["active"]
    stage = r.get("StageName", "—")
    close_date_str = r.get("CloseDate", "")
    amount = r.get("Amount")
    probability = r.get("Probability", 0)
    type_vente = r.get("Type_de_vente__c", "—")
    created_str = r.get("CreatedDate", "")
    last_activity_str = r.get("LastActivityDate", "")
    last_modified_str = r.get("LastModifiedDate", "")
    has_open_activity = r.get("HasOpenActivity", False)
    expected_revenue = r.get("ExpectedRevenue")
    last_stage_change = r.get("LastStageChangeDate", "")
    
    # Parse dates
    try:
        close_date = datetime.fromisoformat(close_date_str).date() if close_date_str else None
    except:
        close_date = None
    try:
        created_date = datetime.fromisoformat(created_str.replace("Z", "+00:00")).date() if created_str else None
    except:
        created_date = None
    try:
        last_activity = datetime.fromisoformat(last_activity_str).date() if last_activity_str else None
    except:
        last_activity = None
    
    # Days overdue
    days_overdue = (today - close_date).days if close_date else 9999
    
    # Days since last activity
    if last_activity:
        days_since_activity = (today - last_activity).days
    else:
        days_since_activity = 9999  # Never
    
    # Days since creation
    if created_date:
        days_since_creation = (today - created_date).days
    else:
        days_since_creation = 9999
    
    # ── Score de déchet (plus haut = plus prioritaire à nettoyer) ──
    score = 0
    reasons = []
    
    # CloseDate dépassée
    if days_overdue > 0:
        score += min(days_overdue / 30, 12)  # cap at 12 points
        if days_overdue > 365:
            reasons.append("CloseDate dépassée >1 an")
        elif days_overdue > 180:
            reasons.append("CloseDate dépassée 6-12 mois")
        elif days_overdue > 90:
            reasons.append("CloseDate dépassée 3-6 mois")
        else:
            reasons.append("CloseDate dépassée <3 mois")
    
    # Pas d'activité
    if not last_activity:
        score += 8
        reasons.append("Aucune activité jamais enregistrée")
    elif days_since_activity > 365:
        score += 5
        reasons.append("Pas d'activité depuis >1 an")
    elif days_since_activity > 90:
        score += 5
        reasons.append("Pas d'activité depuis >3 mois")
    elif days_since_activity > 30:
        score += 2
        reasons.append("Pas d'activité depuis >30j")
    
    # Pas de montant
    if not amount or amount == 0:
        score += 6
        reasons.append("Pas de montant")
    
    # Probabilité à 0
    if probability == 0:
        score += 3
        reasons.append("Probabilité = 0%")
    
    # Owner inactif
    if not owner_active:
        score += 10
        reasons.append("Owner inactif")
    
    # Ancien commercial
    if owner_name in FORMER_SALESPEOPLE:
        score += 8
        reasons.append("Ancien commercial")
    
    # Très vieux (created > 2 years ago)
    if days_since_creation > 730:
        score += 4
        reasons.append("Créée il y a >2 ans")
    elif days_since_creation > 365:
        score += 2
        reasons.append("Créée il y a >1 an")
    
    # Stage "Suspect enlisé"
    if stage == "Suspect enlisé":
        score += 3
        reasons.append("Stage: Suspect enlisé")
    
    # Amount value contribution (bigger amount = more important to clean)
    if amount and amount > 0:
        score += min(amount / 10000, 5)  # cap at 5 points
    
    # Build SF link
    sf_link = f"https://db0000000d7rdeay.my.salesforce.com/lightning/r/Opportunity/{opp_id}/view"
    
    scored.append({
        "id": opp_id,
        "name": opp_name,
        "account": account_name,
        "industry": account_industry,
        "owner": owner_name,
        "owner_active": owner_active,
        "stage": stage,
        "close_date": close_date_str,
        "days_overdue": days_overdue,
        "amount": amount,
        "probability": probability,
        "type_vente": type_vente,
        "created_date": created_str[:10] if created_str else "",
        "days_since_creation": days_since_creation,
        "last_activity": last_activity_str or "",
        "days_since_activity": days_since_activity,
        "has_open_activity": has_open_activity,
        "expected_revenue": expected_revenue,
        "last_stage_change": (last_stage_change or "")[:10],
        "score": round(score, 1),
        "reasons": reasons,
        "sf_link": sf_link,
    })

# Sort by score descending
scored.sort(key=lambda x: x["score"], reverse=True)

# ── Stats for dashboard ──
total_dechet = len(scored)
total_open = len(all_open)
pct_dechet = round(total_dechet / total_open * 100, 1) if total_open else 0

# CA at risk
ca_at_risk = sum(r["amount"] or 0 for r in scored)
ca_at_risk_str = f"{ca_at_risk:,.0f}€".replace(",", " ")

# Owner breakdown
owner_stats = {}
for r in scored:
    o = r["owner"]
    if o not in owner_stats:
        owner_stats[o] = {"count": 0, "amount": 0, "active": r["owner_active"]}
    owner_stats[o]["count"] += 1
    owner_stats[o]["amount"] += r["amount"] or 0

# Stage breakdown
stage_stats = {}
for r in scored:
    s = r["stage"]
    stage_stats[s] = stage_stats.get(s, 0) + 1

# Overdue buckets
overdue_buckets = {"<30j": 0, "31-90j": 0, "91-180j": 0, "181-365j": 0, ">365j": 0}
for r in scored:
    d = r["days_overdue"]
    if d < 30:
        overdue_buckets["<30j"] += 1
    elif d <= 90:
        overdue_buckets["31-90j"] += 1
    elif d <= 180:
        overdue_buckets["91-180j"] += 1
    elif d <= 365:
        overdue_buckets["181-365j"] += 1
    else:
        overdue_buckets[">365j"] += 1

# Reason breakdown
reason_stats = {}
for r in scored:
    for reason in r["reasons"]:
        # Normalize reason key
        key = reason.split("(")[0].strip().rstrip(":")
        reason_stats[key] = reason_stats.get(key, 0) + 1

# Save computed data
dashboard_data = {
    "generated_at": datetime.now().isoformat(),
    "total_dechet": total_dechet,
    "total_open": total_open,
    "pct_dechet": pct_dechet,
    "ca_at_risk": ca_at_risk,
    "owner_stats": owner_stats,
    "stage_stats": stage_stats,
    "overdue_buckets": overdue_buckets,
    "reason_stats": reason_stats,
    "opps": scored,
}

with open("/tmp/xos-dechet/dashboard_data.json", "w") as f:
    json.dump(dashboard_data, f, ensure_ascii=False, indent=2)

print(f"\n✅ Computed scores for {total_dechet} opps")
print(f"   {pct_dechet}% of open pipeline is déchet")
print(f"   CA at risk: {ca_at_risk_str}")
print(f"   Owners: {len(owner_stats)}")
print(f"   Stages: {stage_stats}")
print(f"   Top reason: {max(reason_stats, key=reason_stats.get)} ({max(reason_stats.values())})")
print(f"   Saved to /tmp/xos-dechet/dashboard_data.json")

# Print top 10
print(f"\n--- Top 10 déchet opps ---")
for i, r in enumerate(scored[:10]):
    amt = f"{r['amount']:,.0f}€" if r['amount'] else "—"
    print(f"  {i+1}. [{r['score']}] {r['name'][:40]} | {r['owner']} | {r['close_date']} | {amt} | {r['days_overdue']}j overdue")