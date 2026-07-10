#!/usr/bin/env python3
"""
XOS Lot 4.0 — Audit prospection (lecture seule Salesforce).
Produces structured JSON for the prospection funnel report.

Queries:
  1. Volumétrie Contacts (total, créés par année/mois, contacts avec/sans opportunité)
  2. Remplissage LeadSource (distribution sur Opps + Contacts)
  3. Usage réel des Campagnes (nb, types, membres actifs, campagnes sans membres)
  4. Étapes amont des opportunités (répartition par étape, transitions, stagnation)
"""
import json, sys, re, os
from datetime import date, datetime
from collections import defaultdict
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

def query_count(state, soql):
    """Use COUNT() query."""
    records = query_all(state, soql)
    if records and "expr0" in records[0]:
        return records[0]["expr0"]
    return len(records)

def count_query(state, object_name, where_clause=""):
    soql = f"SELECT COUNT() FROM {object_name}"
    if where_clause:
        soql += " WHERE " + where_clause
    path = f"query?q={quote_plus(soql.replace(chr(10), ' ').strip())}"
    payload = _fetch(state, path)
    return payload.get("totalSize", 0) if isinstance(payload, dict) else 0

results = {}
today = date.today()

# ──────────────────────────────────────────────────────────
# 1. VOLUMÉTRIE CONTACTS
# ──────────────────────────────────────────────────────────
print("=" * 60)
print("1. VOLUMÉTRIE CONTACTS")
print("=" * 60)

total_contacts = count_query(state, "Contact")
print(f"  Total contacts: {total_contacts}")

# Contacts créés par année
soql_contacts_year = """
SELECT CALENDAR_YEAR(CreatedDate) year, COUNT(Id) cnt
FROM Contact
GROUP BY CALENDAR_YEAR(CreatedDate)
ORDER BY CALENDAR_YEAR(CreatedDate) ASC
"""
contacts_by_year_raw = query_all(state, soql_contacts_year)
contacts_by_year = {str(r["year"]): r["cnt"] for r in contacts_by_year_raw if r.get("year")}
print(f"  By year: {contacts_by_year}")

# Contacts créés par mois (2024-2026)
soql_contacts_month = """
SELECT CALENDAR_YEAR(CreatedDate) year, CALENDAR_MONTH(CreatedDate) month, COUNT(Id) cnt
FROM Contact
WHERE CreatedDate >= 2024-01-01T00:00:00Z
GROUP BY CALENDAR_YEAR(CreatedDate), CALENDAR_MONTH(CreatedDate)
ORDER BY CALENDAR_YEAR(CreatedDate) ASC, CALENDAR_MONTH(CreatedDate) ASC
"""
contacts_by_month_raw = query_all(state, soql_contacts_month)
contacts_by_month = [
    {"year": r["year"], "month": r["month"], "count": r["cnt"]}
    for r in contacts_by_month_raw
]
print(f"  Monthly (2024+): {len(contacts_by_month)} months")

# Contacts with at least one Opportunity (via OpportunityContactRole)
# We'll approximate: contacts whose Account has opportunities, OR contacts with OpportunityContactRole
contact_with_opp_count = count_query(state, "Contact",
    "Id IN (SELECT ContactId FROM OpportunityContactRole)")
print(f"  Contacts with OpportunityContactRole: {contact_with_opp_count}")

# Contacts sans aucune opportunité
contact_without_opp = total_contacts - contact_with_opp_count
print(f"  Contacts without any opp: {contact_without_opp}")

# Contacts avec Account
contact_with_account = count_query(state, "Contact", "AccountId != null")
contact_without_account = total_contacts - contact_with_account
print(f"  Contacts with Account: {contact_with_account}")
print(f"  Contacts without Account (orphelins): {contact_without_account}")

# Contacts by Account source/type
soql_contact_sources = """
SELECT LeadSource, COUNT(Id) cnt
FROM Contact
GROUP BY LeadSource
ORDER BY COUNT(Id) DESC
"""
contact_sources_raw = query_all(state, soql_contact_sources)
contact_sources = {r.get("LeadSource") or "(vide)": r["cnt"] for r in contact_sources_raw}
print(f"  Contact LeadSource distribution: {contact_sources}")

# Contacts created by active vs inactive users
soql_contact_owners = """
SELECT OwnerId, Owner.Name, Owner.IsActive, COUNT(Id) cnt
FROM Contact
GROUP BY OwnerId, Owner.Name, Owner.IsActive
ORDER BY COUNT(Id) DESC
"""
contact_owners_raw = query_all(state, soql_contact_owners)
contact_active_owners = sum(r["cnt"] for r in contact_owners_raw if r.get("IsActive"))
contact_inactive_owners = sum(r["cnt"] for r in contact_owners_raw if not r.get("IsActive"))
print(f"  Contacts owned by active users: {contact_active_owners}")
print(f"  Contacts owned by inactive users: {contact_inactive_owners}")

# Top 10 contact creators
contact_creators_top = []
for r in contact_owners_raw[:10]:
    contact_creators_top.append({
        "name": r.get("Name", "?"),
        "active": r.get("IsActive", False),
        "count": r["cnt"]
    })

# Contact fields with non-null rates (Email, Phone, etc.)
contact_email_filled = count_query(state, "Contact", "Email != null")
contact_phone_filled = count_query(state, "Contact", "Phone != null")
contact_title_filled = count_query(state, "Contact", "Title != null")
print(f"  Email filled: {contact_email_filled} ({round(contact_email_filled/total_contacts*100,1)}%)")
print(f"  Phone filled: {contact_phone_filled} ({round(contact_phone_filled/total_contacts*100,1)}%)")
print(f"  Title filled: {contact_title_filled} ({round(contact_title_filled/total_contacts*100,1)}%)")

results["contacts"] = {
    "total": total_contacts,
    "by_year": contacts_by_year,
    "by_month_2024_plus": contacts_by_month,
    "with_opportunity": contact_with_opp_count,
    "without_opportunity": contact_without_opp,
    "with_account": contact_with_account,
    "without_account": contact_without_account,
    "leadsource_distribution": contact_sources,
    "owned_by_active_users": contact_active_owners,
    "owned_by_inactive_users": contact_inactive_owners,
    "top_creators": contact_creators_top,
    "email_filled": contact_email_filled,
    "email_filled_pct": round(contact_email_filled / max(total_contacts, 1) * 100, 1),
    "phone_filled": contact_phone_filled,
    "phone_filled_pct": round(contact_phone_filled / max(total_contacts, 1) * 100, 1),
    "title_filled": contact_title_filled,
    "title_filled_pct": round(contact_title_filled / max(total_contacts, 1) * 100, 1),
}

# ──────────────────────────────────────────────────────────
# 2. REMPLISSAGE LEADSOURCE (Opportunités)
# ──────────────────────────────────────────────────────────
print("\n" + "=" * 60)
print("2. REMPLISSAGE LEADSOURCE — OPPORTUNITÉS")
print("=" * 60)

total_opps = count_query(state, "Opportunity")
opps_with_leadsource = count_query(state, "Opportunity", "LeadSource != null")
opps_without_leadsource = total_opps - opps_with_leadsource
print(f"  Total opps: {total_opps}")
print(f"  LeadSource filled: {opps_with_leadsource} ({round(opps_with_leadsource/max(total_opps,1)*100,1)}%)")
print(f"  LeadSource empty: {opps_without_leadsource} ({round(opps_without_leadsource/max(total_opps,1)*100,1)}%)")

# LeadSource distribution (all opps)
soql_opp_leadsource = """
SELECT LeadSource, COUNT(Id) cnt
FROM Opportunity
GROUP BY LeadSource
ORDER BY COUNT(Id) DESC
"""
opp_leadsource_raw = query_all(state, soql_opp_leadsource)
opp_leadsource_dist = {r.get("LeadSource") or "(vide)": r["cnt"] for r in opp_leadsource_raw}
print(f"  LeadSource distribution: {opp_leadsource_dist}")

# LeadSource on WON opps
soql_won_leadsource = """
SELECT LeadSource, COUNT(Id) cnt, SUM(Amount) total_amount
FROM Opportunity
WHERE IsWon = true
GROUP BY LeadSource
ORDER BY COUNT(Id) DESC
"""
won_leadsource_raw = query_all(state, soql_won_leadsource)
won_leadsource_dist = []
for r in won_leadsource_raw:
    won_leadsource_dist.append({
        "source": r.get("LeadSource") or "(vide)",
        "count": r["cnt"],
        "total_amount": r.get("total_amount") or 0
    })
print(f"  Won opps by LeadSource: {len(won_leadsource_dist)} categories")

# LeadSource on OPEN opps specifically (funnel relevant)
soql_open_leadsource = """
SELECT LeadSource, COUNT(Id) cnt, SUM(Amount) total_amount
FROM Opportunity
WHERE IsClosed = false
GROUP BY LeadSource
ORDER BY COUNT(Id) DESC
"""
open_leadsource_raw = query_all(state, soql_open_leadsource)
open_leadsource_dist = []
for r in open_leadsource_raw:
    open_leadsource_dist.append({
        "source": r.get("LeadSource") or "(vide)",
        "count": r["cnt"],
        "total_amount": r.get("total_amount") or 0
    })

results["leadsource"] = {
    "total_opps": total_opps,
    "filled": opps_with_leadsource,
    "filled_pct": round(opps_with_leadsource / max(total_opps, 1) * 100, 1),
    "empty": opps_without_leadsource,
    "empty_pct": round(opps_without_leadsource / max(total_opps, 1) * 100, 1),
    "all_opps_distribution": opp_leadsource_dist,
    "won_opps_by_source": won_leadsource_dist,
    "open_opps_by_source": open_leadsource_dist,
}

# ──────────────────────────────────────────────────────────
# 3. USAGE RÉEL DES CAMPAGNES
# ──────────────────────────────────────────────────────────
print("\n" + "=" * 60)
print("3. USAGE RÉEL DES CAMPAGNES")
print("=" * 60)

total_campaigns = count_query(state, "Campaign")
total_active_campaigns = count_query(state, "Campaign", "IsActive = true")
print(f"  Total campaigns: {total_campaigns}")
print(f"  Active campaigns: {total_active_campaigns}")

# Campaign types
soql_camp_types = """
SELECT Type, COUNT(Id) cnt
FROM Campaign
GROUP BY Type
ORDER BY COUNT(Id) DESC
"""
camp_types_raw = query_all(state, soql_camp_types)
camp_types = {r.get("Type") or "(vide)": r["cnt"] for r in camp_types_raw}
print(f"  Campaign types: {camp_types}")

# Campaign statuses
soql_camp_status = """
SELECT Status, COUNT(Id) cnt
FROM Campaign
GROUP BY Status
ORDER BY COUNT(Id) DESC
"""
camp_status_raw = query_all(state, soql_camp_status)
camp_statuses = {r.get("Status") or "(vide)": r["cnt"] for r in camp_status_raw}
print(f"  Campaign statuses: {camp_statuses}")

# Campaign members total
total_camp_members = count_query(state, "CampaignMember")
print(f"  Total CampaignMembers: {total_camp_members}")

# Campaigns with most members (top 15)
soql_camp_members = """
SELECT CampaignId, Campaign.Name, Campaign.Type, Campaign.Status,
       Campaign.IsActive, COUNT(Id) member_count
FROM CampaignMember
GROUP BY CampaignId, Campaign.Name, Campaign.Type, Campaign.Status, Campaign.IsActive
ORDER BY COUNT(Id) DESC
LIMIT 15
"""
camp_members_raw = query_all(state, soql_camp_members)
camp_member_counts = []
for r in camp_members_raw:
    camp_member_counts.append({
        "campaign_name": r.get("Name", "?"),
        "campaign_type": r.get("Type") or "(vide)",
        "campaign_status": r.get("Status") or "(vide)",
        "active": r.get("IsActive", False),
        "members": r["member_count"],
    })
print(f"  Top campaign: {camp_member_counts[0] if camp_member_counts else 'none'}")

# Campaigns with zero members (orphans)
# We can approximate: active campaigns without any CampaignMember
campaigns_with_members = count_query(state, "Campaign",
    "Id IN (SELECT CampaignId FROM CampaignMember)")
campaigns_without_members = total_campaigns - campaigns_with_members
print(f"  Campaigns with members: {campaigns_with_members}")
print(f"  Campaigns without members: {campaigns_without_members}")

# Campaigns by year created
soql_camp_year = """
SELECT CALENDAR_YEAR(CreatedDate) year, COUNT(Id) cnt
FROM Campaign
GROUP BY CALENDAR_YEAR(CreatedDate)
ORDER BY CALENDAR_YEAR(CreatedDate) ASC
"""
camp_by_year_raw = query_all(state, soql_camp_year)
camp_by_year = {str(r["year"]): r["cnt"] for r in camp_by_year_raw if r.get("year")}
print(f"  Campaigns by year: {camp_by_year}")

# Campaigns used in opportunities
opps_with_campaign = count_query(state, "Opportunity", "CampaignId != null")
opps_without_campaign = total_opps - opps_with_campaign
print(f"  Opps with CampaignId: {opps_with_campaign} ({round(opps_with_campaign/max(total_opps,1)*100,1)}%)")
print(f"  Opps without CampaignId: {opps_without_campaign}")

# Top campaigns by opportunity count
soql_opp_campaigns = """
SELECT CampaignId, Campaign.Name, Campaign.Type, Campaign.Status, COUNT(Id) cnt
FROM Opportunity
WHERE CampaignId != null
GROUP BY CampaignId, Campaign.Name, Campaign.Type, Campaign.Status
ORDER BY COUNT(Id) DESC
LIMIT 15
"""
opp_campaigns_raw = query_all(state, soql_opp_campaigns)
opp_campaign_counts = []
for r in opp_campaigns_raw:
    opp_campaign_counts.append({
        "campaign_name": r.get("Name", "?"),
        "type": r.get("Type") or "(vide)",
        "status": r.get("Status") or "(vide)",
        "opp_count": r["cnt"],
    })

results["campaigns"] = {
    "total": total_campaigns,
    "active": total_active_campaigns,
    "types": camp_types,
    "statuses": camp_statuses,
    "total_members": total_camp_members,
    "with_members": campaigns_with_members,
    "without_members": campaigns_without_members,
    "top_by_members": camp_member_counts,
    "by_year_created": camp_by_year,
    "opps_with_campaign": opps_with_campaign,
    "opps_with_campaign_pct": round(opps_with_campaign / max(total_opps, 1) * 100, 1),
    "opps_without_campaign": opps_without_campaign,
    "top_campaigns_by_opps": opp_campaign_counts,
}

# ──────────────────────────────────────────────────────────
# 4. ÉTAPES AMONT DES OPPORTUNITÉS
# ──────────────────────────────────────────────────────────
print("\n" + "=" * 60)
print("4. ÉTAPES AMONT DES OPPORTUNITÉS")
print("=" * 60)

# Get all active stages with their sort order
soql_stages = """
SELECT MasterLabel, IsClosed, IsWon, SortOrder, DefaultProbability
FROM OpportunityStage
WHERE IsActive = true
ORDER BY SortOrder
"""
stages_raw = query_all(state, soql_stages)
stages = [
    {
        "label": s.get("MasterLabel", ""),
        "is_closed": s.get("IsClosed", False),
        "is_won": s.get("IsWon", False),
        "sort_order": s.get("SortOrder", 0),
        "default_probability": s.get("DefaultProbability", 0),
    }
    for s in stages_raw
]
print(f"  Active stages: {[s['label'] for s in stages]}")

# Identify upstream stages (non-closed, early sort order)
upstream_stages = [s for s in stages if not s["is_closed"]]
# First 3 open stages are "amont" by default
amont_stages = upstream_stages[:3] if len(upstream_stages) >= 3 else upstream_stages
amont_labels = [s["label"] for s in amont_stages]
qualifiee_stages = upstream_stages[3:] if len(upstream_stages) > 3 else []
qualifiee_labels = [s["label"] for s in qualifiee_stages]
print(f"  Étapes amont (first 3 open): {amont_labels}")
print(f"  Étapes qualifiées (rest of open): {qualifiee_labels}")

# Opp distribution across ALL stages
soql_opp_stages = """
SELECT StageName, IsClosed, IsWon, COUNT(Id) cnt, SUM(Amount) total_amount
FROM Opportunity
GROUP BY StageName, IsClosed, IsWon
ORDER BY COUNT(Id) DESC
"""
opp_stages_raw = query_all(state, soql_opp_stages)
opp_stage_dist = []
total_in_stages = 0
for r in opp_stages_raw:
    opp_stage_dist.append({
        "stage": r.get("StageName", "?"),
        "closed": r.get("IsClosed", False),
        "won": r.get("IsWon", False),
        "count": r["cnt"],
        "total_amount": r.get("total_amount") or 0,
    })
    total_in_stages += r["cnt"]
print(f"  Total opps counted in stages: {total_in_stages}")

# Open opps by stage (for active pipeline view)
soql_open_stages = """
SELECT StageName, COUNT(Id) cnt, SUM(Amount) total_amount
FROM Opportunity
WHERE IsClosed = false
GROUP BY StageName
ORDER BY COUNT(Id) DESC
"""
open_stages_raw = query_all(state, soql_open_stages)
open_stage_dist = []
open_total = 0
for r in open_stages_raw:
    open_stage_dist.append({
        "stage": r.get("StageName", "?"),
        "count": r["cnt"],
        "total_amount": r.get("total_amount") or 0,
    })
    open_total += r["cnt"]
print(f"  Open opps: {open_total}")

# Count opps in amont vs qualifiées
amont_open_count = sum(
    r["count"] for r in open_stage_dist if r["stage"] in amont_labels
)
qualifiee_open_count = sum(
    r["count"] for r in open_stage_dist if r["stage"] in qualifiee_labels
)
print(f"  Open opps in amont stages: {amont_open_count}")
print(f"  Open opps in qualifiée stages: {qualifiee_open_count}")

# Won opps by stage (before winning)
soql_won_stages = """
SELECT StageName, COUNT(Id) cnt, SUM(Amount) total_amount
FROM Opportunity
WHERE IsWon = true
GROUP BY StageName
ORDER BY COUNT(Id) DESC
"""
won_stages_raw = query_all(state, soql_won_stages)
won_stage_dist = []
won_total = 0
for r in won_stages_raw:
    won_stage_dist.append({
        "stage": r.get("StageName", "?"),
        "count": r["cnt"],
        "total_amount": r.get("total_amount") or 0,
    })
    won_total += r["cnt"]
print(f"  Won opps: {won_total}")

# OpportunityHistory volume
opp_history_count = count_query(state, "OpportunityHistory")
print(f"  OpportunityHistory records: {opp_history_count}")

# Opps created per month (2024+)
soql_opp_created_month = """
SELECT CALENDAR_YEAR(CreatedDate) year, CALENDAR_MONTH(CreatedDate) month, COUNT(Id) cnt
FROM Opportunity
WHERE CreatedDate >= 2024-01-01T00:00:00Z
GROUP BY CALENDAR_YEAR(CreatedDate), CALENDAR_MONTH(CreatedDate)
ORDER BY CALENDAR_YEAR(CreatedDate) ASC, CALENDAR_MONTH(CreatedDate) ASC
"""
opp_created_month_raw = query_all(state, soql_opp_created_month)
opp_created_monthly = [
    {"year": r["year"], "month": r["month"], "count": r["cnt"]}
    for r in opp_created_month_raw
]

# Opps won per month (2024+)
soql_opp_won_month = """
SELECT CALENDAR_YEAR(CloseDate) year, CALENDAR_MONTH(CloseDate) month, COUNT(Id) cnt, SUM(Amount) total_amount
FROM Opportunity
WHERE IsWon = true AND CloseDate >= 2024-01-01
GROUP BY CALENDAR_YEAR(CloseDate), CALENDAR_MONTH(CloseDate)
ORDER BY CALENDAR_YEAR(CloseDate) ASC, CALENDAR_MONTH(CloseDate) ASC
"""
opp_won_month_raw = query_all(state, soql_opp_won_month)
opp_won_monthly = [
    {"year": r["year"], "month": r["month"], "count": r["cnt"], "total_amount": r.get("total_amount") or 0}
    for r in opp_won_month_raw
]

# Stage transition: we use OpportunityHistory to count how many opps entered each stage
# in the last 12 months. OldValue/NewValue aren't directly queryable; StageName = the
# stage the opp entered (TO stage). We can count entries per stage.
soql_history_recent = """
SELECT StageName, COUNT(Id) cnt
FROM OpportunityHistory
WHERE CreatedDate >= LAST_N_DAYS:365
GROUP BY StageName
ORDER BY COUNT(Id) DESC
"""
history_recent_raw = query_all(state, soql_history_recent)
print(f"  Recent stage entries (12mo): {len(history_recent_raw)} groups")
history_entries = {r.get("StageName", "?") : r["cnt"] for r in history_recent_raw}

# Time in stage: LastStageChangeDate analysis
# How long have open opps been sitting in their current stage?
soql_stagnation = """
SELECT StageName, Id, LastStageChangeDate, CreatedDate
FROM Opportunity
WHERE IsClosed = false AND LastStageChangeDate != null
ORDER BY LastStageChangeDate ASC
LIMIT 5000
"""
stagnation_raw = query_all(state, soql_stagnation)
stagnation_by_stage = defaultdict(list)
for r in stagnation_raw:
    lscd = r.get("LastStageChangeDate")
    if lscd:
        try:
            dt = datetime.fromisoformat(lscd.replace("Z", "+00:00"))
            days_in_stage = (datetime.now(dt.tzinfo) - dt).days
        except:
            # Try date-only
            try:
                dt = datetime.strptime(lscd[:10], "%Y-%m-%d")
                days_in_stage = (datetime.now() - dt).days
            except:
                days_in_stage = None
        if days_in_stage is not None and days_in_stage >= 0:
            stagnation_by_stage[r.get("StageName", "?")].append(days_in_stage)

stagnation_stats = {}
for stage, days_list in stagnation_by_stage.items():
    if not days_list:
        continue
    days_list.sort()
    n = len(days_list)
    stagnation_stats[stage] = {
        "count": n,
        "avg_days": round(sum(days_list) / n, 1),
        "median_days": days_list[n // 2],
        "p90_days": days_list[int(n * 0.9)] if n >= 10 else days_list[-1],
        "max_days": days_list[-1],
        "min_days": days_list[0],
    }
    print(f"  Stagnation in '{stage}': avg={stagnation_stats[stage]['avg_days']}d, median={stagnation_stats[stage]['median_days']}d, p90={stagnation_stats[stage]['p90_days']}d")

results["opportunity_stages"] = {
    "active_stages": stages,
    "etapes_amont_labels": amont_labels,
    "etapes_qualifiees_labels": qualifiee_labels,
    "all_opps_by_stage": opp_stage_dist,
    "total_opps_stage_counted": total_in_stages,
    "open_opps_by_stage": open_stage_dist,
    "open_total": open_total,
    "open_amont_count": amont_open_count,
    "open_qualifiee_count": qualifiee_open_count,
    "won_opps_by_stage": won_stage_dist,
    "won_total": won_total,
    "opportunity_history_count": opp_history_count,
    "opps_created_monthly_2024": opp_created_monthly,
    "opps_won_monthly_2024": opp_won_monthly,
    "stage_entries_12mo": history_entries,
    "stagnation_by_stage": stagnation_stats,
}

# ──────────────────────────────────────────────────────────
# 5. ENTONNOIR: Contacts → Opps amont → Opps qualifiées
# ──────────────────────────────────────────────────────────
print("\n" + "=" * 60)
print("5. ENTONNOIR: Contacts → Opps amont → Qualifiées")
print("=" * 60)

# How many contacts are linked to at least one opportunity (any stage)?
contacts_linked_to_any_opp = count_query(state, "Contact",
    "Id IN (SELECT ContactId FROM OpportunityContactRole)")
print(f"  Contacts linked to >=1 opp: {contacts_linked_to_any_opp}")

# Contacts linked to open opps specifically
contacts_linked_to_open_opp = count_query(state, "Contact",
    "Id IN (SELECT ContactId FROM OpportunityContactRole WHERE Opportunity.IsClosed = false)")
print(f"  Contacts linked to open opps: {contacts_linked_to_open_opp}")

# Opps that have at least one ContactRole
opps_with_contacts = count_query(state, "Opportunity",
    "Id IN (SELECT OpportunityId FROM OpportunityContactRole)")
print(f"  Opps with ContactRole: {opps_with_contacts}")

# Open opps with ContactRole
open_opps_with_contacts = count_query(state, "Opportunity",
    "Id IN (SELECT OpportunityId FROM OpportunityContactRole) AND IsClosed = false")
print(f"  Open opps with ContactRole: {open_opps_with_contacts}")

# Contacts created vs opps created (monthly alignment)
# Already have both datasets above

results["funnel"] = {
    "total_contacts": total_contacts,
    "contacts_with_any_opp": contacts_linked_to_any_opp,
    "contacts_with_any_opp_pct": round(contacts_linked_to_any_opp / max(total_contacts, 1) * 100, 1),
    "contacts_with_open_opp": contacts_linked_to_open_opp,
    "opps_with_contact_role": opps_with_contacts,
    "open_opps_with_contact_role": open_opps_with_contacts,
    "open_opps_in_amont_stages": amont_open_count,
    "open_opps_in_qualifiee_stages": qualifiee_open_count,
    "funnel_definition": {
        "level_1": "Contacts créés (total général, hors contacts orphelins)",
        "level_2": f"Contacts rattachés à ≥1 opportunité",
        "level_3": f"Opportunités en étapes amont ({', '.join(amont_labels)})",
        "level_4": f"Opportunités en étapes qualifiées ({', '.join(qualifiee_labels)})",
        "level_5": "Opportunités gagnées",
    },
    "funnel_numbers": {
        "contacts_crees": total_contacts,
        "contacts_avec_opp": contacts_linked_to_any_opp,
        "opps_amont": amont_open_count,
        "opps_qualifiees": qualifiee_open_count,
        "opps_gagnees": won_total,
    },
}

# ──────────────────────────────────────────────────────────
# Save results
# ──────────────────────────────────────────────────────────
os.makedirs("/tmp/xos-audit", exist_ok=True)
output_path = "/tmp/xos-audit/audit_prospection.json"
with open(output_path, "w") as f:
    json.dump(results, f, ensure_ascii=False, indent=2)

print(f"\n{'=' * 60}")
print(f"✅ Audit complete — saved to {output_path}")
print(f"{'=' * 60}")
