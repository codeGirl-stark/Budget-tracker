/**
 * Formatage des montants. Le franc CFA n'a pas de centimes : tout est entier,
 * tout est aligné en chasse fixe, et le signe se lit avant le chiffre.
 */

const SYMBOLES = {
  XOF: 'FCFA',
  XAF: 'FCFA',
  EUR: '€',
  USD: '$',
  GBP: '£',
  CAD: 'CA$',
  MAD: 'DH',
  CHF: 'CHF',
};

export function symboleDevise(code) {
  return SYMBOLES[String(code ?? '').toUpperCase()] ?? String(code ?? '');
}

const NF = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const NF_PCT = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 0 });
const NF_PCT1 = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 1 });

const entier = (valeur) => {
  const n = Math.round(Number(valeur));
  return Number.isFinite(n) ? n : 0;
};

/** 400000 → "400 000" (espace fine insécable, comme dans un livre de comptes). */
export function nombre(valeur) {
  return NF.format(entier(valeur));
}

/** 400000 → "400 000 FCFA" */
export function montant(valeur, devise = 'XOF') {
  const symbole = symboleDevise(devise);
  return symbole ? `${nombre(valeur)} ${symbole}` : nombre(valeur);
}

/** Écart : le signe compte autant que le chiffre. −2 000 avec un vrai signe moins. */
export function montantSigne(valeur, devise = null) {
  const n = entier(valeur);
  const signe = n > 0 ? '+' : n < 0 ? '−' : '';
  const corps = nombre(Math.abs(n));
  return devise ? `${signe}${corps} ${symboleDevise(devise)}` : `${signe}${corps}`;
}

/** `null` (pas de base de calcul) se lit "—", jamais "0 %" — ce n'est pas la même chose. */
export function pourcent(ratio, { decimale = false } = {}) {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return '—';
  return (decimale ? NF_PCT1 : NF_PCT).format(ratio);
}

/** Axes de graphiques : 1 250 000 → "1,25 M", 45 000 → "45 k". */
export function compact(valeur) {
  const n = entier(valeur);
  const absolu = Math.abs(n);
  const signe = n < 0 ? '−' : '';
  if (absolu >= 1_000_000) {
    const millions = absolu / 1_000_000;
    return `${signe}${millions.toFixed(millions >= 10 ? 0 : 1).replace('.', ',')} M`;
  }
  if (absolu >= 1000) return `${signe}${Math.round(absolu / 1000)} k`;
  return `${signe}${NF.format(absolu)}`;
}

/** Parsing d'une saisie humaine : "40 000", "40.000", "40000,5" → 40000. */
export function lireMontant(saisie) {
  if (typeof saisie === 'number') return Number.isFinite(saisie) ? Math.max(0, Math.round(saisie)) : 0;
  const nettoye = String(saisie ?? '')
    .replace(/[\s  ]/g, '')
    .replace(/\.(?=\d{3}\b)/g, '')
    .replace(',', '.');
  const n = Number.parseFloat(nettoye);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

export function pluriel(compteur, singulier, plurielMot = `${singulier}s`) {
  return `${nombre(compteur)} ${Math.abs(compteur) >= 2 ? plurielMot : singulier}`;
}
