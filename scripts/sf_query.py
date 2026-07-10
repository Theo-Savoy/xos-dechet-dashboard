#!/usr/bin/env python3
"""Dev-only Salesforce query helper (read-only).

Uses the OAuth session already stored by the local Hermes agent — NO credentials
are kept in this repo. Runtime SF access in production goes through the
refresh-token flow in api/*.js; this script is only for local audits/describes.

Requires the Hermes agent venv (it ships the `hermes_cli` package):

    ~/.hermes/hermes-agent/venv/bin/python scripts/sf_query.py "SELECT Id, Name FROM Account LIMIT 3"
    ~/.hermes/hermes-agent/venv/bin/python scripts/sf_query.py --describe Task Resultat_call
"""
import json
import os
import sys

# Allow running under any Python 3.11 by pointing at the Hermes agent package.
HERMES = os.path.expanduser("~/.hermes/hermes-agent")
if HERMES not in sys.path:
    sys.path.insert(0, HERMES)

try:
    from hermes_cli import salesforce_api as sf
except Exception as exc:  # pragma: no cover - environment guard
    sys.exit(
        f"Cannot import hermes_cli ({exc}).\n"
        "Run with the Hermes venv: ~/.hermes/hermes-agent/venv/bin/python scripts/sf_query.py ..."
    )


def main(argv):
    if not argv:
        sys.exit(__doc__)

    state = sf.ensure_salesforce_state()

    if argv[0] == "--describe":
        obj = argv[1]
        needles = [n.lower() for n in argv[2:]]
        data = sf._authorized_request_json(state, f"sobjects/{obj}/describe", timeout_seconds=60)
        fields = [
            {
                "name": f["name"],
                "label": f["label"],
                "type": f["type"],
                "picklist": [p["value"] for p in (f.get("picklistValues") or []) if p.get("active")],
            }
            for f in data.get("fields", [])
            if not needles or any(n in f["name"].lower() for n in needles)
        ]
        print(json.dumps(fields, ensure_ascii=False, indent=1))
        return

    soql = argv[0]
    result = sf._query_all_pages(state, soql, timeout_seconds=60, all_pages=False)
    print(json.dumps(result.get("records", []), ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main(sys.argv[1:])
