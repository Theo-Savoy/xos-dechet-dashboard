# XOS — Portail & Dashboard Déchet

Monorepo Vercel : portail **X OS** (React/Vite) + dashboard déchet legacy (`dashboard.html`) + API serverless.

## Structure

```
├── api/                  # Fonctions serverless Vercel (Node + Python)
├── public/
│   ├── dashboard.html    # Dashboard déchet (vanilla JS, préservé tel quel)
│   ├── fonts/            # Polices web (woff2) servies en prod
│   └── logo-xos.png
├── scripts/
│   ├── audit/            # Scripts d'audit Salesforce
│   ├── fetch_dechet_opps.py
│   └── compute_and_score.py
├── src/
│   ├── auth/             # Connexion OTP + session Supabase
│   ├── apps/             # Applications fenêtrées X OS
│   ├── components/ui/    # Design system (Button, Tag, GlassCard…)
│   ├── lib/              # Clients partagés (Supabase, types)
│   └── os/               # Bureau virtuel (dock, fenêtres, launcher)
├── supabase/migrations/
└── middleware.js         # Auth hybride (JWT Supabase + Basic Auth legacy)
```

## Développement

```bash
npm install
npm run dev      # SPA X OS sur http://localhost:5173
npm test         # Vitest
npm run build    # Build production
```

En dev, le registry expose aussi des apps de démo (aperçu, notes, design system).

## Dashboard déchet

Le front legacy charge ses données via `GET /api/refresh` (Python/Salesforce). Il est embarqué dans X OS via l'app **CRM Cleaner** (`iframe` → `/dashboard.html`).

- Refresh automatique : cache CDN 24h
- Bouton Actualiser : bypass cache + `localStorage`

## Authentification

- **X OS** : magic link Supabase (`@xos-learning.fr`), bridge SSO vers cookie `xos_auth`
- **Legacy** : Basic Auth (`xos` / `DASHBOARD_PASSWORD`) pour accès direct au dashboard et API

Variables Vercel : `SF_*`, `DASHBOARD_PASSWORD`, `SUPABASE_*`, `VITE_SUPABASE_*`.

## Polices

Seuls les fichiers `public/fonts/*.woff2` sont servis en production. Les sources OTF/webfont kit (Brockmann, Neue Montreal) restent hors dépôt — voir [docs/fonts.md](docs/fonts.md).

## Documentation

- [Plan d'implémentation X OS](docs/xos_implementation_plan.md)
- [Plan portail](docs/xos_portal_plan.md)
