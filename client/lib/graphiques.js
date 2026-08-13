/**
 * Graphiques en SVG pur : pas de librairie, pas de canvas, tout reste
 * lisible, sélectionnable et thémable par les variables CSS.
 */

import { el, svg } from './dom.js';
import { compact, montant, montantSigne, pourcent, nombre } from './format.js';
import { montrerBulle, cacherBulle, contenuBulle } from './composants.js';
import { MOIS, MOIS_COURT } from '/shared/categories.js';

const echelle = (domaine, plage) => {
  const [d0, d1] = domaine;
  const [p0, p1] = plage;
  const etendue = d1 - d0;
  if (etendue === 0) return () => p1;
  return (valeur) => p0 + ((valeur - d0) / etendue) * (p1 - p0);
};

/** Arrondit un maximum à un palier lisible (45 300 → 50 000). */
function plafond(valeur) {
  if (valeur <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(valeur));
  for (const pas of [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]) {
    if (valeur <= pas * magnitude) return pas * magnitude;
  }
  return 10 * magnitude;
}

function graduations(min, max, nombreVoulu = 4) {
  const pas = (max - min) / nombreVoulu;
  return Array.from({ length: nombreVoulu + 1 }, (_, i) => min + i * pas);
}

/* ================================================================== *
 * Revenus vs dépenses par mois, avec le solde cumulé en ligne (§6.1)
 * ================================================================== */

export function grapheAnnuel(lignes, { devise = 'XOF', onmois = null } = {}) {
  const L = 760;
  const H = 320;
  const marge = { haut: 18, droite: 62, bas: 40, gauche: 64 };
  const largeur = L - marge.gauche - marge.droite;
  const hauteur = H - marge.haut - marge.bas;

  const maxMensuel = plafond(Math.max(1, ...lignes.map((l) => Math.max(l.revenu, l.reel))));
  const cumuls = lignes.map((l) => l.soldeCumule);
  const maxCumul = plafond(Math.max(1, ...cumuls, 0));
  const minCumul = Math.min(0, ...cumuls);
  const basCumul = minCumul < 0 ? -plafond(-minCumul) : 0;

  const y = echelle([0, maxMensuel], [marge.haut + hauteur, marge.haut]);
  const yCumul = echelle([basCumul, maxCumul], [marge.haut + hauteur, marge.haut]);
  const largeurCase = largeur / 12;
  const largeurBarre = Math.min(17, largeurCase / 2.6);
  const centre = (i) => marge.gauche + largeurCase * (i + 0.5);

  const racine = svg('svg', {
    viewBox: `0 0 ${L} ${H}`,
    class: 'graphe graphe--annuel',
    role: 'img',
    'aria-label': `Revenus, dépenses et solde cumulé sur les douze mois de l’année`,
  });

  /* Grille horizontale + axe gauche (mensuel) */
  for (const valeur of graduations(0, maxMensuel)) {
    racine.append(
      svg('line', { class: 'graphe__grille', x1: marge.gauche, x2: marge.gauche + largeur, y1: y(valeur), y2: y(valeur) }),
      svg('text', { class: 'graphe__axe graphe__axe--gauche', x: marge.gauche - 10, y: y(valeur) + 4, 'text-anchor': 'end' }, compact(valeur)),
    );
  }

  /* Axe droit (cumul) */
  for (const valeur of graduations(basCumul, maxCumul)) {
    racine.append(
      svg('text', { class: 'graphe__axe graphe__axe--droite', x: marge.gauche + largeur + 10, y: yCumul(valeur) + 4, 'text-anchor': 'start' }, compact(valeur)),
    );
  }

  /* Ligne de zéro du cumul si le solde passe dans le rouge */
  if (basCumul < 0) {
    racine.append(svg('line', {
      class: 'graphe__zero', x1: marge.gauche, x2: marge.gauche + largeur, y1: yCumul(0), y2: yCumul(0),
    }));
  }

  /* Barres */
  lignes.forEach((ligne, i) => {
    const x = centre(i);
    const base = marge.haut + hauteur;
    const paire = [
      { valeur: ligne.revenu, classe: 'revenu', decalage: -largeurBarre - 1.5 },
      { valeur: ligne.reel, classe: 'depense', decalage: 1.5 },
    ];
    for (const { valeur, classe, decalage } of paire) {
      const hauteurBarre = Math.max(valeur > 0 ? 1.5 : 0, base - y(valeur));
      if (hauteurBarre <= 0) continue;
      racine.append(svg('rect', {
        class: `graphe__barre graphe__barre--${classe}`,
        x: x + decalage,
        y: base - hauteurBarre,
        width: largeurBarre,
        height: hauteurBarre,
        rx: 1.5,
        style: `--retard:${i * 34}ms; --hauteur:${hauteurBarre}px`,
      }));
    }
  });

  /* Ligne du solde cumulé, tracée seulement sur les mois renseignés */
  const actifs = lignes.filter((l) => l.actif);
  if (actifs.length > 1) {
    const chemin = actifs
      .map((l, index) => `${index === 0 ? 'M' : 'L'}${centre(l.index).toFixed(1)},${yCumul(l.soldeCumule).toFixed(1)}`)
      .join(' ');
    racine.append(svg('path', { class: 'graphe__ligne', d: chemin, fill: 'none' }));
    for (const ligne of actifs) {
      racine.append(svg('circle', { class: 'graphe__point', cx: centre(ligne.index), cy: yCumul(ligne.soldeCumule), r: 3.2 }));
    }
  }

  /* Étiquettes de mois + zones de survol */
  lignes.forEach((ligne, i) => {
    racine.append(svg('text', {
      class: `graphe__mois${ligne.actif ? '' : ' graphe__mois--vide'}`,
      x: centre(i),
      y: H - 14,
      'text-anchor': 'middle',
    }, MOIS_COURT[i]));

    const zone = svg('rect', {
      class: 'graphe__zone',
      x: marge.gauche + largeurCase * i,
      y: marge.haut,
      width: largeurCase,
      height: hauteur,
      tabindex: onmois ? '0' : null,
      role: onmois ? 'button' : null,
      'aria-label': `${MOIS[i]} : revenus ${montant(ligne.revenu, devise)}, dépenses ${montant(ligne.reel, devise)}, solde cumulé ${montantSigne(ligne.soldeCumule, devise)}`,
    });
    const bulle = (evenement) => {
      const cadre = zone.getBoundingClientRect();
      montrerBulle(contenuBulle(MOIS[i], [
        { label: 'Revenus', valeur: montant(ligne.revenu, devise), ton: 'laiton' },
        { label: 'Dépenses', valeur: montant(ligne.reel, devise), ton: 'brique' },
        { label: 'Solde', valeur: montantSigne(ligne.solde, devise), ton: ligne.solde < 0 ? 'brique' : 'sauge' },
        { label: 'Cumulé', valeur: montantSigne(ligne.soldeCumule, devise) },
      ]), cadre.left + cadre.width / 2, evenement.type === 'focus' ? cadre.top : evenement.clientY);
    };
    zone.addEventListener('mousemove', bulle);
    zone.addEventListener('focus', bulle);
    zone.addEventListener('mouseleave', cacherBulle);
    zone.addEventListener('blur', cacherBulle);
    if (onmois) {
      zone.addEventListener('click', () => onmois(i));
      zone.addEventListener('keydown', (evenement) => {
        if (evenement.key === 'Enter' || evenement.key === ' ') { evenement.preventDefault(); onmois(i); }
      });
    }
    racine.append(zone);
  });

  return el('figure.figure', [
    el('div.figure__cadre', racine),
    el('figcaption.legende', [
      el('span.legende__item', [el('span.legende__puce.legende__puce--revenu'), 'Revenus']),
      el('span.legende__item', [el('span.legende__puce.legende__puce--depense'), 'Dépenses réelles']),
      el('span.legende__item', [el('span.legende__puce.legende__puce--ligne'), 'Solde cumulé (axe droit)']),
    ]),
  ]);
}

/* ================================================================== *
 * Répartition des dépenses réelles par catégorie (§6.1)
 * ================================================================== */

export function grapheRepartition(repartition, { devise = 'XOF' } = {}) {
  const parts = repartition.filter((r) => r.montant > 0);
  const total = parts.reduce((somme, r) => somme + r.montant, 0);

  if (total === 0) {
    return el('div.vide.vide--figure', el('p.vide__texte', 'Aucune dépense enregistrée sur cette période.'));
  }

  const T = 220;
  const rayon = 96;
  const epaisseur = 30;
  const centre = T / 2;
  const rayonMoyen = rayon - epaisseur / 2;
  const circonference = 2 * Math.PI * rayonMoyen;

  const racine = svg('svg', {
    viewBox: `0 0 ${T} ${T}`,
    class: 'graphe graphe--donut',
    role: 'img',
    'aria-label': `Répartition des dépenses : ${parts.map((p) => `${p.categorie.nom} ${pourcent(p.part)}`).join(', ')}`,
  });

  let angleCourant = 0;
  const arcs = parts.map((part, index) => {
    const portion = part.montant / total;
    const arc = svg('circle', {
      class: 'graphe__arc',
      cx: centre,
      cy: centre,
      r: rayonMoyen,
      fill: 'none',
      stroke: `var(--cat-${part.categorie.id})`,
      'stroke-width': epaisseur,
      'stroke-dasharray': `${(portion * circonference).toFixed(2)} ${circonference.toFixed(2)}`,
      'stroke-dashoffset': (-angleCourant * circonference).toFixed(2),
      transform: `rotate(-90 ${centre} ${centre})`,
      style: `--retard:${index * 45}ms`,
    });
    angleCourant += portion;
    return arc;
  });

  racine.append(...arcs);
  racine.append(
    svg('text', { class: 'graphe__donut-total', x: centre, y: centre - 2, 'text-anchor': 'middle' }, compact(total)),
    svg('text', { class: 'graphe__donut-legende', x: centre, y: centre + 16, 'text-anchor': 'middle' }, 'dépensés'),
  );

  const legende = el('ul.repartition', parts.map((part, position) => {
    const ligne = el('li.repartition__ligne', { tabindex: '0' }, [
      el('span.repartition__puce', { style: { background: `var(--cat-${part.categorie.id})` } }),
      el('span.repartition__nom', part.categorie.nom),
      el('span.repartition__part.chiffre', pourcent(part.part)),
      el('span.repartition__montant.chiffre', montant(part.montant, devise)),
    ]);
    const surligner = (actif) => {
      arcs.forEach((arc, i) => {
        arc.classList.toggle('graphe__arc--terne', actif && i !== position);
        arc.classList.toggle('graphe__arc--vif', actif && i === position);
      });
    };
    ligne.addEventListener('mouseenter', () => surligner(true));
    ligne.addEventListener('mouseleave', () => surligner(false));
    ligne.addEventListener('focus', () => surligner(true));
    ligne.addEventListener('blur', () => surligner(false));
    return ligne;
  }));

  return el('div.repartition-bloc', [el('div.repartition-bloc__donut', racine), legende]);
}

/* ================================================================== *
 * Sparkline — évolution d'un taux mois par mois (§10.4)
 * ================================================================== */

export function sparkline(valeurs, { ton = 'ardoise', hauteur = 56, libelle = '' } = {}) {
  const L = 320;
  const H = hauteur;
  const marge = 6;
  const points = valeurs
    .map((valeur, index) => ({ valeur, index }))
    .filter((p) => p.valeur !== null && Number.isFinite(p.valeur));

  if (points.length === 0) {
    return el('div.sparkline.sparkline--vide', 'Pas encore de données');
  }

  const x = echelle([0, 11], [marge, L - marge]);
  const y = echelle([0, 1], [H - marge, marge]);

  const racine = svg('svg', {
    viewBox: `0 0 ${L} ${H}`,
    class: `graphe graphe--sparkline graphe--${ton}`,
    role: 'img',
    'aria-label': libelle || 'Évolution mensuelle',
  });

  racine.append(svg('line', { class: 'sparkline__reference', x1: marge, x2: L - marge, y1: y(1), y2: y(1) }));

  if (points.length > 1) {
    const chemin = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.index).toFixed(1)},${y(p.valeur).toFixed(1)}`).join(' ');
    // Aire seulement s'il y a une variation à lire : sur une courbe plate
    // elle ne dit rien et remplit le cadre d'un gros aplat inutile.
    const varie = points.some((p) => Math.abs(p.valeur - points[0].valeur) > 1e-9);
    if (varie) {
      const aire = `${chemin} L${x(points.at(-1).index).toFixed(1)},${H - marge} L${x(points[0].index).toFixed(1)},${H - marge} Z`;
      racine.append(svg('path', { class: 'sparkline__aire', d: aire }));
    }
    racine.append(svg('path', { class: 'sparkline__trait', d: chemin, fill: 'none' }));
  }

  for (const point of points) {
    const cercle = svg('circle', {
      class: 'sparkline__point',
      cx: x(point.index),
      cy: y(point.valeur),
      r: point.index === points.at(-1).index ? 3.4 : 2.2,
    });
    cercle.addEventListener('mouseenter', (evenement) => {
      const cadre = cercle.getBoundingClientRect();
      montrerBulle(contenuBulle(MOIS[point.index], [{ label: libelle || 'Valeur', valeur: pourcent(point.valeur) }]),
        cadre.left + cadre.width / 2, evenement.clientY);
    });
    cercle.addEventListener('mouseleave', cacherBulle);
    racine.append(cercle);
  }

  return el('div.sparkline', racine);
}

/* ================================================================== *
 * Jauge « prévu vs revenu » — une barre empilée par catégorie (§6.2)
 * ================================================================== */

export function jaugeRepartitionPrevu(lignes, revenu, { devise = 'XOF' } = {}) {
  const prevuTotal = lignes.reduce((somme, l) => somme + l.prevu, 0);
  const base = Math.max(prevuTotal, revenu, 1);

  const segments = lignes.filter((l) => l.prevu > 0).map((ligne) => {
    const segment = el('span.jauge__segment', {
      style: { '--part': `${(ligne.prevu / base) * 100}%`, background: `var(--cat-${ligne.id})` },
      tabindex: '0',
      'aria-label': `${ligne.categorie.nom} : ${montant(ligne.prevu, devise)} prévus`,
    });
    const bulle = (evenement) => {
      const cadre = segment.getBoundingClientRect();
      montrerBulle(contenuBulle(ligne.categorie.nom, [
        { label: 'Prévu', valeur: montant(ligne.prevu, devise) },
        { label: 'Part du revenu', valeur: revenu > 0 ? pourcent(ligne.prevu / revenu) : '—' },
      ]), cadre.left + cadre.width / 2, evenement.clientY ?? cadre.top);
    };
    segment.addEventListener('mousemove', bulle);
    segment.addEventListener('focus', bulle);
    segment.addEventListener('mouseleave', cacherBulle);
    segment.addEventListener('blur', cacherBulle);
    return segment;
  });

  const reste = revenu - prevuTotal;
  if (reste > 0) {
    segments.push(el('span.jauge__segment.jauge__segment--reste', {
      style: { '--part': `${(reste / base) * 100}%` },
      'aria-label': `${montant(reste, devise)} non affectés`,
    }));
  }

  return el('div.jauge', [
    el('div.jauge__piste', segments),
    el('div.jauge__pied', [
      el('span', [el('span.jauge__cle', 'Prévu '), el('span.chiffre', montant(prevuTotal, devise))]),
      el('span', [
        el('span.jauge__cle', reste < 0 ? 'Dépassement ' : 'Non affecté '),
        el(`span.chiffre.chiffre--${reste < 0 ? 'brique' : reste > 0 ? 'laiton' : 'sourdine'}`, montant(Math.abs(reste), devise)),
      ]),
    ]),
  ]);
}

export { nombre };
