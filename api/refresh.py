"""
Vercel Serverless Function — Source unique des données du dashboard XOS déchet.
- Chargement initial de la page : réponse mise en cache par le CDN Vercel 24h
  (s-maxage) => refresh automatique quotidien, sans cron ni stockage.
- Bouton "Actualiser" : appel avec un query param cache-buster => bypass CDN,
  données Salesforce fraîches.
"""

import json
import os
import urllib.request
import urllib.parse
import urllib.error
from datetime import date, datetime
from http.server import BaseHTTPRequestHandler
from zoneinfo import ZoneInfo


def do_refresh():
    """Core logic — returns (status_code, body_dict)."""
    # ── 1. Refresh Salesforce access token ──
    client_id = os.environ.get("SF_CLIENT_ID", "")
    client_secret = os.environ.get("SF_CLIENT_SECRET", "")
    refresh_token = os.environ.get("SF_REFRESH_TOKEN", "")
    login_url = os.environ.get("SF_LOGIN_URL", "https://login.salesforce.com")
    instance_url = os.environ.get("SF_INSTANCE_URL", "https://db0000000d7rdeay.my.salesforce.com")

    if not all([client_id, client_secret, refresh_token]):
        return 500, {"error": "missing_env", "message": "SF credentials not configured"}

    token_url = login_url + "/services/oauth2/token"
    token_data = urllib.parse.urlencode({
        "grant_type": "refresh_token",
        "client_id": client_id,
        "client_secret": client_secret,
        "refresh_token": refresh_token,
    }).encode()

    token_req = urllib.request.Request(token_url, data=token_data, method="POST")
    token_req.add_header("Content-Type", "application/x-www-form-urlencoded")
    with urllib.request.urlopen(token_req, timeout=30) as resp:
        token_resp = json.loads(resp.read().decode())

    access_token = token_resp["access_token"]
    api_version = "v67.0"
    base_url = instance_url + "/services/data/" + api_version

    # ── 2. SOQL helper ──
    def soql_query_all(soql_str):
        records = []
        encoded = urllib.parse.quote_plus(soql_str.replace("\n", " ").strip())
        url = base_url + "/query?q=" + encoded
        while True:
            req = urllib.request.Request(url, method="GET")
            req.add_header("Authorization", "Bearer " + access_token)
            with urllib.request.urlopen(req, timeout=60) as resp:
                payload = json.loads(resp.read().decode())
            records.extend(payload.get("records", []))
            if payload.get("done", True):
                break
            nxt = payload.get("nextRecordsUrl")
            if not nxt:
                break
            url = nxt  # full URL from Salesforce
        return records

    # ── 3. Fetch déchet opps (CloseDate < today) ──
    soql_dechet = (
        "SELECT Id, Name, AccountId, Account.Name, Account.Industry, "
        "OwnerId, Owner.Name, StageName, CloseDate, Amount, Probability, "
        "Type_de_vente__c, CreatedDate, IsWon, IsClosed, LeadSource, "
        "CampaignId, Campaign.Name, LastActivityDate, LastModifiedDate, "
        "ExpectedRevenue, HasOpenActivity, LastStageChangeDate "
        "FROM Opportunity WHERE IsClosed = false AND CloseDate < TODAY "
        "ORDER BY CloseDate ASC"
    )
    dechet_records = soql_query_all(soql_dechet)

    # ── 3b. Fetch montant incoherent opps (Amount 1-100€, any open opp) ──
    # These have an absurdly low amount that doesn't match CRM usage.
    # Exclude opps already in déchet (CloseDate < today) to avoid duplicates.
    soql_incoherent = (
        "SELECT Id, Name, AccountId, Account.Name, Account.Industry, "
        "OwnerId, Owner.Name, StageName, CloseDate, Amount, Probability, "
        "Type_de_vente__c, CreatedDate, IsWon, IsClosed, LeadSource, "
        "CampaignId, Campaign.Name, LastActivityDate, LastModifiedDate, "
        "ExpectedRevenue, HasOpenActivity, LastStageChangeDate "
        "FROM Opportunity WHERE IsClosed = false "
        "AND Amount > 0 AND Amount <= 100 "
        "AND CloseDate >= TODAY "
        "ORDER BY Amount ASC"
    )
    incoherent_records = soql_query_all(soql_incoherent)

    soql_all = (
        "SELECT Id FROM Opportunity WHERE IsClosed = false"
    )
    all_open_count = len(soql_query_all(soql_all))

    # ── 4. Resolve owners (déchet + incoherent) ──
    owner_ids = list(set(
        r.get("OwnerId") for r in dechet_records + incoherent_records if r.get("OwnerId")
    ))
    users_map = {}
    if owner_ids:
        ids_csv = ",".join("'" + oid + "'" for oid in owner_ids)
        user_records = soql_query_all("SELECT Id, Name, IsActive FROM User WHERE Id IN (" + ids_csv + ")")
        users_map = {u["Id"]: {"name": u.get("Name", "?"), "active": u.get("IsActive", False)} for u in user_records}

    # ── 5. Score ──
    today = date.today()
    FORMER = {"Julien Bak", "Romain Waeselynck", "Roxane Serie", "Antoine Fardet", "ibrahima sissoko", "Ibrahima Sissoko"}

    reason_display = {
        "CloseDate depassee >1 an": "CloseDate depass\u00e9e >1 an",
        "CloseDate depassee 6-12 mois": "CloseDate depass\u00e9e 6-12 mois",
        "CloseDate depassee 3-6 mois": "CloseDate depass\u00e9e 3-6 mois",
        "CloseDate depassee <3 mois": "CloseDate depass\u00e9e <3 mois",
        "Aucune activite jamais enregistree": "Aucune activit\u00e9 jamais enregistr\u00e9e",
        "Pas d activite depuis >1 an": "Pas d activit\u00e9 depuis >1 an",
        "Pas d activite depuis >3 mois": "Pas d activit\u00e9 depuis >3 mois",
        "Pas d activite depuis >30j": "Pas d activit\u00e9 depuis >30j",
        "Pas de montant": "Pas de montant",
        "Probabilite = 0%": "Probabilit\u00e9 = 0%",
        "Owner inactif": "Owner inactif",
        "Ancien commercial": "Ancien commercial",
        "Creee il y a >2 ans": "Cr\u00e9\u00e9e il y a >2 ans",
        "Creee il y a >1 an": "Cr\u00e9\u00e9e il y a >1 an",
        "Stage: Suspect enlise": "Stage: Suspect enlis\u00e9",
        "Montant incoherent": "Montant incoh\u00e9rent (\u2264100\u20ac)",
    }

    def score_opp(r, category):
        """Score an opp. category = 'dechet' or 'incoherent'."""
        opp_id = r.get("Id", "")
        owner_id = r.get("OwnerId", "")
        oi = users_map.get(owner_id, {"name": (r.get("Owner") or {}).get("Name", "?"), "active": True})
        on = oi["name"]
        oa = oi["active"]
        stage = r.get("StageName", "")
        cds = r.get("CloseDate", "")
        amt = r.get("Amount")
        prob = r.get("Probability", 0)
        cstr = r.get("CreatedDate", "")
        las = r.get("LastActivityDate", "")

        try: cd = datetime.fromisoformat(cds).date() if cds else None
        except: cd = None
        try: crd = datetime.fromisoformat(cstr.replace("Z", "+00:00")).date() if cstr else None
        except: crd = None
        try: la = datetime.fromisoformat(las).date() if las else None
        except: la = None

        d_ov = (today - cd).days if cd else 9999
        d_ac = (today - la).days if la else 9999
        d_cr = (today - crd).days if crd else 9999

        score = 0
        reasons = []

        if category == "dechet" and d_ov > 0:
            score += min(d_ov / 30, 12)
            if d_ov > 365: reasons.append("CloseDate depassee >1 an")
            elif d_ov > 180: reasons.append("CloseDate depassee 6-12 mois")
            elif d_ov > 90: reasons.append("CloseDate depassee 3-6 mois")
            else: reasons.append("CloseDate depassee <3 mois")

        if category == "incoherent":
            score += 10
            reasons.append("Montant incoherent")

        if not la:
            score += 8; reasons.append("Aucune activite jamais enregistree")
        elif d_ac > 365:
            score += 5; reasons.append("Pas d activite depuis >1 an")
        elif d_ac > 90:
            score += 5; reasons.append("Pas d activite depuis >3 mois")
        elif d_ac > 30:
            score += 2; reasons.append("Pas d activite depuis >30j")

        if category == "dechet" and (not amt or amt == 0):
            score += 6; reasons.append("Pas de montant")

        if prob == 0:
            score += 3; reasons.append("Probabilite = 0%")

        if not oa:
            score += 10; reasons.append("Owner inactif")

        if on in FORMER:
            score += 8; reasons.append("Ancien commercial")

        if d_cr > 730:
            score += 4; reasons.append("Creee il y a >2 ans")
        elif d_cr > 365:
            score += 2; reasons.append("Creee il y a >1 an")

        if stage == "Suspect enlise":
            score += 3; reasons.append("Stage: Suspect enlise")

        if amt and amt > 0 and category == "dechet":
            score += min(amt / 10000, 5)

        display_reasons = [reason_display.get(x, x) for x in reasons]

        return {
            "id": opp_id,
            "name": r.get("Name", ""),
            "account": (r.get("Account") or {}).get("Name", "\u2014") if isinstance(r.get("Account"), dict) else "\u2014",
            "industry": (r.get("Account") or {}).get("Industry", "\u2014") if isinstance(r.get("Account"), dict) else "\u2014",
            "owner": on,
            "owner_active": oa,
            "stage": stage,
            "close_date": cds,
            "days_overdue": d_ov,
            "amount": amt,
            "probability": prob,
            "type_vente": r.get("Type_de_vente__c", "\u2014"),
            "created_date": cstr[:10] if cstr else "",
            "days_since_creation": d_cr,
            "last_activity": las or "",
            "days_since_activity": d_ac,
            "has_open_activity": r.get("HasOpenActivity", False),
            "expected_revenue": r.get("ExpectedRevenue"),
            "last_stage_change": (r.get("LastStageChangeDate") or "")[:10],
            "score": round(score, 1),
            "category": category,
            "reasons": display_reasons,
            "sf_link": "https://db0000000d7rdeay.my.salesforce.com/lightning/r/Opportunity/" + opp_id + "/view",
        }

    # Score déchet opps
    dechet_scored = [score_opp(r, "dechet") for r in dechet_records]
    # Score incoherent opps
    incoherent_scored = [score_opp(r, "incoherent") for r in incoherent_records]

    # Merge and sort by score
    scored = dechet_scored + incoherent_scored
    scored.sort(key=lambda x: x["score"], reverse=True)

    # ── 6. Stats ──
    total_dechet = len(dechet_scored)
    total_incoherent = len(incoherent_scored)
    total_open = all_open_count
    pct_dechet = round((total_dechet + total_incoherent) / total_open * 100, 1) if total_open else 0
    ca_at_risk = sum(o["amount"] or 0 for o in dechet_scored)

    owner_stats = {}
    for o in scored:
        on2 = o["owner"]
        if on2 not in owner_stats:
            owner_stats[on2] = {"count": 0, "amount": 0, "active": o["owner_active"]}
        owner_stats[on2]["count"] += 1
        owner_stats[on2]["amount"] += o["amount"] or 0

    stage_stats = {}
    for o in scored:
        stage_stats[o["stage"]] = stage_stats.get(o["stage"], 0) + 1

    overdue_buckets = {"<30j": 0, "31-90j": 0, "91-180j": 0, "181-365j": 0, ">365j": 0}
    for o in scored:
        d = o["days_overdue"]
        if d < 30: overdue_buckets["<30j"] += 1
        elif d <= 90: overdue_buckets["31-90j"] += 1
        elif d <= 180: overdue_buckets["91-180j"] += 1
        elif d <= 365: overdue_buckets["181-365j"] += 1
        else: overdue_buckets[">365j"] += 1

    reason_stats = {}
    for o in scored:
        for reason in o["reasons"]:
            key = reason.split("(")[0].strip().rstrip(":")
            reason_stats[key] = reason_stats.get(key, 0) + 1

    # ── 7. Meta (étapes actives + utilisateurs actifs, pour les actions en lot) ──
    stage_records = soql_query_all(
        "SELECT MasterLabel, IsClosed, IsWon, SortOrder FROM OpportunityStage "
        "WHERE IsActive = true ORDER BY SortOrder"
    )
    active_user_records = soql_query_all(
        "SELECT Id, Name FROM User WHERE IsActive = true AND UserType = 'Standard' "
        "ORDER BY Name"
    )
    # Valeurs actives de la picklist restreinte Raison_de_perte_V2__c (describe)
    desc_req = urllib.request.Request(base_url + "/sobjects/Opportunity/describe", method="GET")
    desc_req.add_header("Authorization", "Bearer " + access_token)
    with urllib.request.urlopen(desc_req, timeout=60) as resp:
        opp_desc = json.loads(resp.read().decode())
    loss_field = next((f for f in opp_desc.get("fields", []) if f.get("name") == "Raison_de_perte_V2__c"), {})
    loss_reasons = [p.get("value", "") for p in loss_field.get("picklistValues", []) if p.get("active")]
    loss_controller = loss_field.get("controllerName")  # picklist dépendante ?

    # Décodage de la dépendance : pour chaque raison, les valeurs du champ
    # contrôleur (Type_de_vente__c) qui l'autorisent (bitmap validFor base64)
    import base64
    ctrl_field = next((f for f in opp_desc.get("fields", []) if f.get("name") == loss_controller), {})
    ctrl_values = [p.get("value", "") for p in ctrl_field.get("picklistValues", []) if p.get("active")]
    loss_valid_for = {}
    for p in loss_field.get("picklistValues", []):
        if not p.get("active"):
            continue
        vf = p.get("validFor")
        if not vf:
            # validFor absent = pas de restriction (tous les types valides)
            loss_valid_for[p.get("value", "")] = None
            continue
        bits = base64.b64decode(vf)
        loss_valid_for[p.get("value", "")] = [
            ctrl_values[i] for i in range(len(ctrl_values))
            if i // 8 < len(bits) and bits[i // 8] & (0x80 >> (i % 8))
        ]

    meta = {
        "stages": [
            {"name": s.get("MasterLabel", ""), "closed": s.get("IsClosed", False), "won": s.get("IsWon", False)}
            for s in stage_records
        ],
        "users": [{"id": u.get("Id", ""), "name": u.get("Name", "")} for u in active_user_records],
        "loss_reasons": loss_reasons,
        "loss_controller": loss_controller,
        "loss_valid_for": loss_valid_for,
    }

    dashboard_data = {
        "generated_at": datetime.now(ZoneInfo("Europe/Paris")).isoformat(),
        "meta": meta,
        "total_dechet": total_dechet,
        "total_incoherent": total_incoherent,
        "total_open": total_open,
        "pct_dechet": pct_dechet,
        "ca_at_risk": ca_at_risk,
        "owner_stats": owner_stats,
        "stage_stats": stage_stats,
        "overdue_buckets": overdue_buckets,
        "reason_stats": reason_stats,
        "opps": scored,
    }

    return 200, dashboard_data


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            status, body = do_refresh()
        except urllib.error.HTTPError as e:
            err_body = e.read().decode() if e.fp else str(e)
            status = e.code
            body = {"error": "salesforce_api_error", "message": err_body[:500]}
        except Exception as e:
            status = 500
            body = {"error": "internal", "message": str(e)[:500]}

        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        if status == 200:
            # CDN Vercel : cache partagé 24h => refresh auto quotidien.
            # max-age=0 : le navigateur revalide toujours auprès du CDN.
            self.send_header("Cache-Control", "public, max-age=0, s-maxage=86400, stale-while-revalidate=86400")
        else:
            self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(body, ensure_ascii=False).encode("utf-8"))

    def log_message(self, format, *args):
        pass  # Suppress default logging