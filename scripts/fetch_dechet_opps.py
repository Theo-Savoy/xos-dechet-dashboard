#!/usr/bin/env python3
"""Fetch all 'déchet' opportunities from Salesforce — open opps with CloseDate < today."""
import json, sys, re
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

# Fetch open opps with CloseDate < TODAY
# Also fetch open opps with CloseDate >= TODAY for comparison (to know total open pipeline)
soql_dechet = """
SELECT Id, Name, AccountId, Account.Name, Account.Industry,
       OwnerId, Owner.Name,
       StageName, CloseDate, Amount, Probability,
       Type_de_vente__c, CreatedDate, IsWon, IsClosed,
       LeadSource, CampaignId, Campaign.Name,
       LastActivityDate, LastModifiedDate,
       ExpectedRevenue, Montant_produits_strat_giques__c,
       Type_de_commission__c, HasOpenActivity,
       LastStageChangeDate
FROM Opportunity
WHERE IsClosed = false
  AND CloseDate < TODAY
ORDER BY CloseDate ASC
"""

print("Fetching déchet opps (open + CloseDate < today)...")
dechet_records = query_all(state, soql_dechet)
print(f"  → {len(dechet_records)} opps déchet")

# Also fetch ALL open opps for context
soql_all_open = """
SELECT Id, Name, AccountId, Account.Name,
       OwnerId, Owner.Name,
       StageName, CloseDate, Amount, Probability,
       Type_de_vente__c, CreatedDate, LastActivityDate
FROM Opportunity
WHERE IsClosed = false
ORDER BY CloseDate ASC
"""
print("Fetching all open opps for context...")
all_open = query_all(state, soql_all_open)
print(f"  → {len(all_open)} total open opps")

# Save raw data
import os
os.makedirs("/tmp/xos-dechet", exist_ok=True)
with open("/tmp/xos-dechet/raw_dechet_opps.json", "w") as f:
    json.dump(dechet_records, f, ensure_ascii=False, indent=2)
with open("/tmp/xos-dechet/raw_all_open.json", "w") as f:
    json.dump(all_open, f, ensure_ascii=False, indent=2)

print(f"\nSaved to /tmp/xos-dechet/raw_dechet_opps.json ({len(dechet_records)} records)")
print(f"Saved to /tmp/xos-dechet/raw_all_open.json ({len(all_open)} records)")

# Quick stats
from datetime import date, datetime
today = date.today()
no_activity = 0
no_amount = 0
no_account = 0
no_owner_active = 0
both_bad = 0
for r in dechet_records:
    has_activity = bool(r.get("LastActivityDate"))
    has_amount = bool(r.get("Amount"))
    has_account = bool(r.get("AccountId"))
    if not has_activity:
        no_activity += 1
    if not has_amount:
        no_amount += 1
    if not has_account:
        no_account += 1
    if not has_activity and not has_amount:
        both_bad += 1

print(f"\n--- Quick stats on {len(dechet_records)} déchet opps ---")
print(f"  No LastActivityDate: {no_activity}")
print(f"  No Amount:          {no_amount}")
print(f"  No AccountId:       {no_account}")
print(f"  Both no activity + no amount: {both_bad}")

# Days overdue distribution
overdue_buckets = {"<30j": 0, "31-90j": 0, "91-180j": 0, "181-365j": 0, ">365j": 0}
for r in dechet_records:
    cd = r.get("CloseDate")
    if not cd:
        continue
    try:
        d = datetime.fromisoformat(cd).date()
    except:
        continue
    delta = (today - d).days
    if delta < 30:
        overdue_buckets["<30j"] += 1
    elif delta <= 90:
        overdue_buckets["31-90j"] += 1
    elif delta <= 180:
        overdue_buckets["91-180j"] += 1
    elif delta <= 365:
        overdue_buckets["181-365j"] += 1
    else:
        overdue_buckets[">365j"] += 1

print(f"\n  Overdue distribution:")
for k, v in overdue_buckets.items():
    print(f"    {k}: {v}")