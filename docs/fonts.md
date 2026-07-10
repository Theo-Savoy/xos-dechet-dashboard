# Polices X OS

## En production

Les seuls fichiers embarqués dans le build sont les **woff2** dans `public/fonts/` :

| Fichier | Usage |
|---------|--------|
| `brockmann-*-webfont.woff2` | Titres et texte (Regular, Medium, SemiBold, Bold) |
| `NeueMontreal-*.woff2` | Chiffres et tableaux (`tabular-nums`) |

Déclarés dans `src/os/theme.css` via `@font-face` avec `font-display: swap`.

## Sources (hors dépôt)

Les kits source (OTF desktop, webfontkit complet, licences) ne sont pas versionnés — le dossier `fonts/` est ignoré par git pour alléger le repo (~3 Mo de fichiers de démo/redondants).

Pour régénérer les woff2 :

1. **Brockmann** — extraire les woff2 depuis le webfont kit (Regular / Medium / SemiBold / Bold uniquement ; ne pas utiliser les OTF desktop, licence distincte).
2. **Neue Montreal** — convertir les OTF (Regular, Medium, Bold) en woff2, par ex. avec [fonttools](https://fonttools.readthedocs.io/) :

```bash
fonttools ttLib.woff2 compress NeueMontreal-Regular.otf -o public/fonts/NeueMontreal-Regular.woff2
```

## Exclusions

- **Aeonik TRIAL** — EULA d'essai, jamais en production.
- **Brockmann desktop OTF** — licence desktop, distincte de la webfont.
