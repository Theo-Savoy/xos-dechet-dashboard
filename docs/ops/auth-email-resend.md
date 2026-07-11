# Auth email — Resend + `xos@hellotheo.fr`

Le SMTP intégré Supabase est **dev-only** : rate-limit bas (quelques emails/heure, variable), livraison limitée aux membres de l’org, pas de SLA. Pour le magic link en prod → **SMTP custom** (Resend recommandé).

Template HTML prêt à coller : [`docs/email/magic-link.html`](../email/magic-link.html)  
Logo servi en prod : `https://xos.hellotheo.fr/email/logo-xos.png` (fichier `public/email/logo-xos.png`).

## Checklist (ordre)

### 1. Resend — compte + domaine

1. Créer un compte sur [resend.com](https://resend.com).
2. **Domains** → Add `hellotheo.fr` (pas `xos.hellotheo.fr` : on authentifie le domaine racine pour pouvoir envoyer depuis `xos@hellotheo.fr`).
3. Ajouter les records DNS que Resend affiche (chez le registrar / Cloudflare de `hellotheo.fr`) :
   - DKIM (souvent 1–3 CNAME)
   - SPF / Return-Path (CNAME ou TXT selon Resend)
   - optionnel mais recommandé : DMARC (`TXT` `_dmarc` → `v=DMARC1; p=none; rua=mailto:xos@hellotheo.fr`)
4. Attendre le statut **Verified** sur Resend.
5. **API Keys** → Create → copier la clé (`re_…`).

Guide Resend officiel : [Send with Supabase SMTP](https://resend.com/docs/send-with-supabase-smtp).

### 2. Supabase — Custom SMTP

Dashboard projet **xos-portal** → **Authentication** → **SMTP** ([lien direct](https://supabase.com/dashboard/project/vvbslsatsuxgykjczjdt/auth/smtp)) :

| Champ | Valeur |
|---|---|
| Enable custom SMTP | ON |
| Sender email | `xos@hellotheo.fr` |
| Sender name | `XOS Portal` |
| Host | `smtp.resend.com` |
| Port | `465` (SSL) — sinon `587` STARTTLS |
| Username | `resend` |
| Password | API key Resend `re_…` |

Après activation, augmenter aussi le rate-limit email Auth si besoin : **Authentication → Rate Limits** (le plafond SMTP intégré ne s’applique plus ; Resend Free ≈ 100 emails/jour, 3 000/mois).

### 3. Template Magic Link

**Authentication → Email Templates → Magic Link** :

- **Subject** : `Ton accès XOS Portal`
- **Body** : coller le contenu de `docs/email/magic-link.html` (ou au minimum le `<body>…</body>`).
- Ton : conversationnel, léger, marque **XOS Portal**.

Variables : `{{ .ConfirmationURL }}` (et éventuellement `{{ .SiteURL }}`).

Refaire **Confirm signup** / **Invite** avec la même charte si tu les utilises.

### 4. Déployer le logo

Le logo est dans `public/email/logo-xos.png`. Un push sur `main` déclenche Vercel → l’URL publique devient :

`https://xos.hellotheo.fr/email/logo-xos.png`

Vérifier dans le navigateur que l’image charge **avant** le smoke-test mail.

### 5. Smoke test

1. Fenêtre privée → `https://xos.hellotheo.fr`
2. Demander un magic link `@xos-learning.fr`
3. Vérifier : From `XOS Portal <xos@hellotheo.fr>`, logo + bouton, clic → bureau
4. Resend → **Emails** → Delivered

## Ce que tu fais vs ce que l’agent fait

| Toi (manuel) | Agent (repo) |
|---|---|
| Compte Resend + DNS `hellotheo.fr` | Template HTML + logo public |
| Coller SMTP + template dans Supabase | Doc ops (ce fichier) |
| Vérifier deliverability | Commit/deploy quand tu dis OK |

## Notes

- Pas besoin d’Edge Function Resend : Supabase Auth parle SMTP directement.
- Si DNS `hellotheo.fr` est chez Cloudflare : proxy **DNS only** (gris) sur les CNAME Resend.
- Adresse d’envoi = `xos@hellotheo.fr` (domaine vérifié). Pas besoin d’une vraie boîte mailbox pour envoyer ; pour recevoir les réponses, forward/MX séparément si tu veux.
