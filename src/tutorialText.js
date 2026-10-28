// The tutorial's words, in English and French (see core/tutorial.js for the levels)

import { extend } from './i18n.js';

const EN = {
  'tut.title': 'Tutorial',
  'tut.level': 'Level {n}/{total}',
  'tut.levels': 'All levels',
  'tut.restart': 'Restart',
  'tut.restart.title': 'Start this level again',
  'tut.skip': 'Skip',
  'tut.skip.title': 'Go to the next level',
  'tut.next': 'Next level',
  'tut.exit': 'Leave the tutorial',
  'tut.fold': 'Show or hide the steps',
  'tut.done': 'Level complete!',
  'tut.allDone': 'You know every action. Now make a slope of your own!',
  'tut.finish': 'Back to my slope',
  'tut.designMine': 'Design my slope',
  'tut.stepDone': '✓ {what}',
  'tut.levelDone': '✓ Level complete: {what}',
  'tut.noEdit': 'The tutorial has its own slopes: leave it (✕) to change yours.',
  'tut.welcome': 'Your own slope is kept safe: you’ll be back on it when you leave.',
  'tut.marked': 'The marked tiles show where.',

  'tut.select': 'Select',
  'tut.select.lede': 'Everything starts with a selection: pick tiles, then act on them.',
  'tut.select.pick': 'Select the 7 marked tiles: with the M brush, tap (or click) the one in the middle.',
  'tut.select.clear': 'Clear the selection: tap ✕ on the tile counter (or press Esc).',
  'tut.select.big': 'Switch to the L brush and select the 19 marked tiles. Drag to paint; drag from a selected tile to take tiles off.',

  'tut.raise': 'Raise and lower',
  'tut.raise.lede': 'Each tap lifts or digs the snow 1.5 m. Tiles side by side melt into one hill.',
  'tut.raise.up': 'Raise the marked tiles on the left to +3 m (Shape ▸ Raise, twice).',
  'tut.raise.down': 'Dig the marked tiles on the right to −3 m (Shape ▸ Lower, twice).',

  'tut.flatten': 'Flatten',
  'tut.flatten.lede': 'Flatten levels tiles to one height: on a steep slope it cuts a terrace with banks.',
  'tut.flatten.terrace': 'Select the 19 marked tiles and Flatten them.',
  'tut.flatten.lift': 'Now Raise the terrace once: it stays level, a platform.',

  'tut.smooth': 'Smooth',
  'tut.smooth.lede': 'Smooth takes the rolls and lumps out, a little more each tap.',
  'tut.smooth.bumps': 'These moguls are rough: smooth the marked tiles to 3/3.',

  'tut.pitch': 'Steepen and ease',
  'tut.pitch.lede': 'Steepen makes the slope steeper down the fall line, Ease makes it gentler, up to 3/3.',
  'tut.pitch.steeper': 'Steepen the marked tiles on the left to 2/3.',
  'tut.pitch.gentler': 'Ease the marked tiles on the right to 2/3.',

  'tut.jump': 'Jump',
  'tut.jump.lede': 'A jump is a kicker facing down the slope: the more tiles, the bigger it is.',
  'tut.jump.build': 'Build a jump on the 7 marked tiles (Features ▸ Jump).',
  'tut.jump.start': 'Put the start in line with it: pick Start, then tap the marked tile.',
  'tut.jump.fly': 'Ride it and fly: a second in the air. Hold Jump and let go at the lip to go higher.',

  'tut.drop': 'Drop',
  'tut.drop.lede': 'A drop is a sharp step with a landing below it: you ride off the edge.',
  'tut.drop.build': 'Build a drop on the marked tiles (Features ▸ Drop).',
  'tut.drop.land': 'Ride off it and land on your feet: skis straight when you touch down.',

  'tut.rocks': 'Rocks',
  'tut.rocks.lede': 'Rocks put a band of bare rock across the slope: a little cliff.',
  'tut.rocks.band': 'Put rocks on the marked line (Features ▸ Rocks).',
  'tut.rocks.over': 'Ride off your cliff and land it.',

  'tut.trees': 'Trees and clearings',
  'tut.trees.lede': 'Trees plants pines, denser each tap. Clear keeps a space free of trees.',
  'tut.trees.wood': 'Plant a wood on the marked tiles: Trees twice (2/3).',
  'tut.trees.lane': 'Clear a lane through it along the marked tiles (Nature ▸ Clear).',
  'tut.trees.through': 'Ride down your lane to the finish without hitting a tree.',

  'tut.snow': 'Powder and ice',
  'tut.snow.lede': 'Powder is deep and slow; ice is hard and fast, and the edges barely hold.',
  'tut.snow.powder': 'Put powder on the upper marked tiles (Nature ▸ Powder).',
  'tut.snow.ice': 'Put ice on the lower marked tiles (Nature ▸ Ice).',
  'tut.snow.feel': 'Ride through both: watch the speed drop in the powder and climb on the ice.',

  'tut.copy': 'Copy, paste, rotate',
  'tut.copy.lede': 'Copy what tiles hold, paste it anywhere, and turn jumps and drops.',
  'tut.copy.copy': 'Select the jump on the marked tiles and Copy it (Tools ▸ Copy).',
  'tut.copy.paste': 'Pick Paste, then tap the marked tiles: the copy goes where the outline shows.',
  'tut.copy.turn': 'The new jump is selected: Rotate it once.',

  'tut.erase': 'Erase',
  'tut.erase.lede': 'Erase takes tiles back to the bare slope. Undo (↶) takes back any step.',
  'tut.erase.wipe': 'Clean up the marked tiles: select them all and Erase.',
};

const FR = {
  'tut.title': 'Tutoriel',
  'tut.level': 'Niveau {n}/{total}',
  'tut.levels': 'Tous les niveaux',
  'tut.restart': 'Recommencer',
  'tut.restart.title': 'Reprendre ce niveau au début',
  'tut.skip': 'Passer',
  'tut.skip.title': 'Aller au niveau suivant',
  'tut.next': 'Niveau suivant',
  'tut.exit': 'Quitter le tutoriel',
  'tut.fold': 'Afficher ou masquer les étapes',
  'tut.done': 'Niveau réussi !',
  'tut.allDone': 'Tu connais toutes les actions. À toi de faire ta propre pente !',
  'tut.finish': 'Retour à ma pente',
  'tut.designMine': 'Dessiner ma pente',
  'tut.stepDone': '✓ {what}',
  'tut.levelDone': '✓ Niveau réussi : {what}',
  'tut.noEdit': 'Le tutoriel a ses propres pentes : quitte-le (✕) pour modifier la tienne.',
  'tut.welcome': 'Ta pente est gardée de côté : tu la retrouves en quittant le tutoriel.',
  'tut.marked': 'Les tuiles marquées montrent où.',

  'tut.select': 'Choisir',
  'tut.select.lede': 'Tout commence par une sélection : choisis des tuiles, puis agis dessus.',
  'tut.select.pick': 'Choisis les 7 tuiles marquées : avec le pinceau M, touche (ou clique) celle du milieu.',
  'tut.select.clear': 'Vide la sélection : touche le ✕ du compteur de tuiles (ou Échap).',
  'tut.select.big': 'Passe au pinceau L et choisis les 19 tuiles marquées. Glisse pour peindre ; glisse depuis une tuile choisie pour en retirer.',

  'tut.raise': 'Monter et creuser',
  'tut.raise.lede': 'Chaque appui monte ou creuse la neige de 1,5 m. Les tuiles voisines se fondent en une seule bosse.',
  'tut.raise.up': 'Monte les tuiles marquées de gauche à +3 m (Forme ▸ Monter, deux fois).',
  'tut.raise.down': 'Creuse les tuiles marquées de droite à −3 m (Forme ▸ Creuser, deux fois).',

  'tut.flatten': 'Aplanir',
  'tut.flatten.lede': 'Aplanir met les tuiles à une seule hauteur : sur une pente raide, ça taille une terrasse avec ses talus.',
  'tut.flatten.terrace': 'Choisis les 19 tuiles marquées et aplanis-les.',
  'tut.flatten.lift': 'Maintenant, monte la terrasse une fois : elle reste plane, une plateforme.',

  'tut.smooth': 'Lisser',
  'tut.smooth.lede': 'Lisser efface les bosses et les creux, un peu plus à chaque appui.',
  'tut.smooth.bumps': 'Ces bosses sont rudes : lisse les tuiles marquées jusqu’à 3/3.',

  'tut.pitch': 'Raidir et adoucir',
  'tut.pitch.lede': 'Raidir accentue la pente dans la ligne de pente, Adoucir l’atténue, jusqu’à 3/3.',
  'tut.pitch.steeper': 'Raidis les tuiles marquées de gauche à 2/3.',
  'tut.pitch.gentler': 'Adoucis les tuiles marquées de droite à 2/3.',

  'tut.jump': 'Tremplin',
  'tut.jump.lede': 'Un tremplin est un kicker face à la pente : plus il a de tuiles, plus il est gros.',
  'tut.jump.build': 'Construis un tremplin sur les 7 tuiles marquées (Modules ▸ Tremplin).',
  'tut.jump.start': 'Mets le départ dans son axe : prends Départ, puis touche la tuile marquée.',
  'tut.jump.fly': 'Ride-le et envole-toi : une seconde en l’air. Maintiens Saut et relâche au bord pour monter plus haut.',

  'tut.drop': 'Drop',
  'tut.drop.lede': 'Un drop est une marche franche avec une réception en dessous : tu sautes depuis le bord.',
  'tut.drop.build': 'Construis un drop sur les tuiles marquées (Modules ▸ Drop).',
  'tut.drop.land': 'Saute-le et pose-toi sur tes skis : skis bien droits à la réception.',

  'tut.rocks': 'Rochers',
  'tut.rocks.lede': 'Rochers pose une barre de roche nue en travers de la pente : une petite falaise.',
  'tut.rocks.band': 'Pose des rochers sur la ligne marquée (Modules ▸ Rochers).',
  'tut.rocks.over': 'Saute ta falaise et réceptionne-toi.',

  'tut.trees': 'Arbres et clairières',
  'tut.trees.lede': 'Arbres plante des sapins, plus denses à chaque appui. Dégager garde un espace sans arbres.',
  'tut.trees.wood': 'Plante un bois sur les tuiles marquées : Arbres deux fois (2/3).',
  'tut.trees.lane': 'Dégage un couloir à travers, le long des tuiles marquées (Nature ▸ Dégager).',
  'tut.trees.through': 'Descends ton couloir jusqu’à l’arrivée sans toucher un arbre.',

  'tut.snow': 'Poudreuse et glace',
  'tut.snow.lede': 'La poudreuse est profonde et lente ; la glace est dure et rapide, les carres tiennent à peine.',
  'tut.snow.powder': 'Mets de la poudreuse sur les tuiles marquées du haut (Nature ▸ Poudreuse).',
  'tut.snow.ice': 'Mets de la glace sur les tuiles marquées du bas (Nature ▸ Glace).',
  'tut.snow.feel': 'Traverse les deux : la vitesse baisse dans la poudreuse et grimpe sur la glace.',

  'tut.copy': 'Copier, coller, tourner',
  'tut.copy.lede': 'Copie ce que portent des tuiles, colle-le où tu veux, et tourne tremplins et drops.',
  'tut.copy.copy': 'Choisis le tremplin sur les tuiles marquées et copie-le (Outils ▸ Copier).',
  'tut.copy.paste': 'Prends Coller, puis touche les tuiles marquées : la copie se pose là où le contour l’indique.',
  'tut.copy.turn': 'Le nouveau tremplin est sélectionné : tourne-le une fois.',

  'tut.erase': 'Effacer',
  'tut.erase.lede': 'Effacer remet les tuiles à la pente nue. Annuler (↶) reprend n’importe quelle étape.',
  'tut.erase.wipe': 'Nettoie les tuiles marquées : choisis-les toutes et efface.',
};

export const TUT_STRINGS = { en: EN, fr: FR };
extend(TUT_STRINGS);
