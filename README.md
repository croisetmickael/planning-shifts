# Planning Shifts

Calendrier de shifts pour usage interne, inspiré des fonctions de Work Shift Calendar (Shifter).
App web installable (PWA), hors ligne, sans compte ni serveur : les données restent sur l'appareil.

## Utiliser

1. **Shifts** : créer ses types de shifts (nom, horaires, pause, paie, couleur). Une fin avant le début = shift de nuit.
   La durée payée est calculée, ou saisie à la main (ex. `7:30` ou `7,5`).
2. **Peindre** : choisir un shift dans la barre, toucher les jours. Retoucher un jour retire le shift. Deux shifts maximum par jour.
3. **Éditer** : sélectionner des jours, puis copier / coller, effacer, ou répéter un cycle (ex. 2 matins, 2 nuits, 4 repos).
4. **Voir** : toucher un jour pour ajouter heures sup, départ anticipé, revenu en plus, note,
   ou changer la durée d'un shift **pour ce jour seulement** (le shift est alors marqué `*` sur le calendrier).
5. **Stats** et **Année** : heures par période et par type de shift (aucun montant n'est affiché).
6. **☾ / ☀︎** : thème sombre (bleu sur noir) ou clair (blanc et rouge), retenu sur l'appareil.

## Importer / exporter (⚙︎)

| bouton | format | usage |
| --- | --- | --- |
| Exporter (.json) | sauvegarde complète | sauvegarder, changer de téléphone, envoyer à quelqu'un |
| Importer (.json) | sauvegarde complète | restaurer (remplace tout, après confirmation) |
| Tableur (.csv) | une ligne par jour, `;` | Excel, LibreOffice |
| Agenda (.ics) | shifts en événements | Google Agenda, Outlook, Apple Calendrier |
| Importer un agenda (.ics) | événements en notes | jours fériés, congés |
| Imprimer / PDF | page du mois | affichage, partage |

Les données vivent dans le navigateur : **exporter régulièrement**. Sur iPhone, installer l'app sur l'écran
d'accueil (Partager → Sur l'écran d'accueil) pour que les données ne soient pas effacées.

## Lancer en local

```bash
npm start
```

Puis ouvrir http://localhost:8765. Tests : `npm test`.

## Mettre en ligne

Publié sur GitHub Pages depuis la branche `gh-pages`, qui contient le dossier `app/` :
https://croisetmickael.github.io/planning-shifts/

Après une modification : changer `VERSION` dans `app/sw.js`, lancer `npm test`, committer, puis :

```bash
git push && git subtree push --prefix app origin gh-pages
```

## Limites

- Pas d'alarmes avant les shifts (une PWA ne peut pas sonner de façon fiable).
- Pas de synchronisation entre appareils ni de vue équipe : passer par l'export / import.
- Le changement d'heure n'est pas compté dans la durée d'une nuit.
