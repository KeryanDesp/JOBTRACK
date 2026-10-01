'use strict';
// Point d'entrée de la fonction Vercel (service « api »). Ce fichier est versionné parce que la
// CLI Vercel vérifie l'existence du point d'entrée avant de lancer le build ; le vrai code,
// `bundle.js`, est produit au build par `scripts/vercel-bundle.sh` et ignoré par git.
module.exports = require('./bundle.js');
