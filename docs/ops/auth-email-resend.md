# Auth email — Resend + `xos@hellotheo.fr`

Le SMTP intégré Supabase est **dev-only** : rate-limit bas (quelques emails/heure, variable), livraison limitée aux membres de l’org, pas de SLA. Pour le magic link en prod → **SMTP custom** (Resend recommandé).

Template HTML prêt à coller : [`docs/email/magic-link.html`](../email/magic-link.html)  
Logo servi en prod : `https://xos.hellotheo.fr/email/logo-xos.png` (fichier `public/email/logo-xos.png`).

## Supabase vs Resend — qui fait quoi ?

| | Resend | Supabase |
|---|---|---|
| Rôle | **Transport** SMTP (livraison) | **Contenu** du mail (HTML, sujet) |
| Template magic link | ❌ Ne s’applique pas | ✅ **C’est ici** qu’il faut coller le HTML |
| Dashboard | resend.com → Domains / API keys | supabase.com → **Auth → Email Templates** |

Resend n’a **aucun** template qui override Supabase pour l’auth. Si tu as créé un template dans Resend, il ne sera **jamais** utilisé pour le magic link — seul le template Supabase compte.

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

### 3. Template Magic Link (Supabase — obligatoire)

**Authentication → [Email Templates](https://supabase.com/dashboard/project/vvbslsatsuxgykjczjdt/auth/templates)** :

1. Ouvre **Magic Link or OTP** (c’est celui utilisé par `signInWithOtp` — confirmé dans les logs auth : `mail_type: magic_link`).
2. **Subject** : `Ton accès XOS Portal`
3. **Body** : colle `docs/email/magic-link-body.html` (fragment table-only, sans `<!DOCTYPE>` ni commentaires HTML — évite le fallback silencieux vers le template par défaut). Preview locale : ouvrir `docs/email/magic-link.html` dans un navigateur.
4. **Save** sur ce template (bouton en bas, par template).
5. Renvoie un **nouveau** magic link.

**Important :** customiser Confirm signup / Invite ne suffit pas pour la connexion magic link d’un user existant.

**Si le mail reste l’ancien — diagnostic en 2 min :**

| Test | Résultat | Cause |
|---|---|---|
| Tu changes **seulement le Subject** en `TEST XOS 123`, Save, nouvel envoi | Sujet inchangé | Save non pris (mauvais projet, pas cliqué Save, mauvais onglet) |
| Sujet OK, body toujours default | HTML invalide pour Go templates → Supabase **retombe sur le default sans erreur visible** | Colle `magic-link-body.html` ou le minimal ci-dessous |
| Sujet + body OK | — | Résolu |

Minimal de test (Magic Link body) :

```html
<h2 style="color:#8b5bfa;">XOS Portal — test template</h2>
<p><a href="{{ .ConfirmationURL }}">Entrer</a></p>
```

Si ce minimal passe mais pas le gros template, le HTML complet casse le parseur (commentaires, nesting, etc.).

Variables Supabase : garde exactement `{{ .ConfirmationURL }}` (espaces inclus).

**Si tu vois encore l’ancien mail** : tu n’as pas sauvegardé le bon template, ou le HTML a provoqué un fallback.

### 4. Déployer le logo

Le logo est dans `public/email/logo-xos.png`. Un push sur `main` déclenche Vercel → l’URL publique devient :

`https://xos.hellotheo.fr/email/logo-xos.png`

Vérifier dans le navigateur que l’image charge **avant** le smoke-test mail.

### 5. Smoke test

1. Fenêtre privée → `https://xos.hellotheo.fr`
2. Demander un magic link `@xos-learning.fr`
3. Vérifier : From `XOS Portal <xos@hellotheo.fr>`, logo + bouton, clic → bureau
4. Resend → **Emails** → Delivered

## Spam — pourquoi et quoi faire

Le spam vient presque toujours de la **réputation DNS**, pas du HTML seul.

1. **Resend → Domains → hellotheo.fr** : tout doit être **Verified** (DKIM + SPF / return-path). Un record manquant ou en proxy orange Cloudflare = spam fréquent.
2. **DMARC** (recommandé) : `TXT` sur `_dmarc.hellotheo.fr`  
   `v=DMARC1; p=none; rua=mailto:xos@hellotheo.fr`  
   Puis passer à `p=quarantine` quand la délivrabilité est stable.
3. **Alignement expéditeur** : dans Supabase SMTP, **Sender email** = exactement `xos@hellotheo.fr`, **Sender name** = `XOS Portal` (même domaine que DKIM).
4. **Premiers envois** : domaine neuf → Gmail/Outlook classent souvent en spam ; marquer « Non spam » + ouvrir le mail aide le warm-up.
5. **Éviter** : sujet tout en majuscules, trop de liens, pièces jointes (pas le cas ici).

Vérifier les headers du mail reçu (Gmail → ⋮ → Afficher l’original) : `spf=pass`, `dkim=pass`, `dmarc=pass`.

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
