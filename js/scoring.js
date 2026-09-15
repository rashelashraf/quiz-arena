/* ---------------------------------------------------------------------------
   scoring.js — how an answer turns into points.

   Two steps, always:
     1. grade()  compares the answer to the key and returns how right it was,
        as a number from 0 (nothing) to 1 (perfect).
     2. score()  turns that, plus the stated confidence and the question's
        difficulty, into points.

   Two scoring rules are available, set per class in Settings.

   "tiers"        Students pick low / medium / high. A right answer pays
                  difficulty x tier. A wrong answer costs difficulty x
                  (tier - 1), so a low-confidence miss is free and a
                  high-confidence miss hurts. Easy to explain in one breath.

   "calibration"  Students state a percentage. Points are two things added
                  together: a plain reward for being right, and a Brier term
                  for how well the stated percentage matched the outcome.

                  The reward part does not depend on the percentage, so it
                  cannot be gamed, and the Brier part is maximised by stating
                  what you actually believe. Together that means the way to
                  earn the most points over a term is to be honest, while
                  points still climb steadily as a student genuinely learns
                  more. Zero sits at an honest guess, so admitting you do not
                  know costs nothing; claiming 95% and missing costs plenty.
--------------------------------------------------------------------------- */

export const DIFFICULTY_WEIGHTS = { 1: 1, 2: 2, 3: 3, 4: 5, 5: 8 };
export const DIFFICULTY_NAMES = { 1: 'Warm-up', 2: 'Easy', 3: 'Medium', 4: 'Hard', 5: 'Stretch' };

export const TIERS = [
  { level: 1, label: 'Not sure', risk: 'no penalty' },
  { level: 2, label: 'Fairly sure', risk: 'small penalty' },
  { level: 3, label: 'Certain', risk: 'big penalty' }
];

/** How many ways a pure guess could go, used to set the zero line. */
function guessBase(q) {
  switch (q.type) {
    case 'true_false': return 2;
    case 'mcq_single': return Math.max(2, (q.options || []).length);
    case 'mcq_multi': return Math.max(3, (q.options || []).length);
    case 'matching': return Math.max(3, (q.left || []).length);
    case 'ordering': return Math.max(3, (q.items || []).length);
    case 'short_answer': return 8;
    default: return 4;
  }
}

/* ---------- grading --------------------------------------------------- */

/**
 * @returns {{fraction:number, correct:boolean, detail:string}}
 *   fraction 0..1, correct true only when fraction is 1.
 */
export function grade(question, key, answer) {
  const partial = question.partialCredit !== false;
  let fraction = 0;
  let detail = '';

  if (answer === null || answer === undefined || answer === '') {
    return { fraction: 0, correct: false, detail: 'No answer' };
  }

  switch (question.type) {
    case 'true_false': {
      fraction = String(answer) === String(key.answer) ? 1 : 0;
      break;
    }

    case 'mcq_single': {
      fraction = Number(answer) === Number(key.answer) ? 1 : 0;
      break;
    }

    case 'mcq_multi': {
      const want = new Set((key.answer || []).map(Number));
      const got = new Set((Array.isArray(answer) ? answer : [answer]).map(Number));
      let hits = 0, misfires = 0;
      got.forEach((v) => (want.has(v) ? hits++ : misfires++));
      if (partial) {
        fraction = Math.max(0, (hits - misfires) / want.size);
      } else {
        fraction = hits === want.size && misfires === 0 ? 1 : 0;
      }
      detail = `${hits}/${want.size} right, ${misfires} extra`;
      break;
    }

    case 'matching': {
      const want = key.answer || [];
      const got = Array.isArray(answer) ? answer : [];
      let hits = 0;
      want.forEach((v, i) => { if (Number(got[i]) === Number(v)) hits++; });
      fraction = partial ? hits / want.length : (hits === want.length ? 1 : 0);
      detail = `${hits}/${want.length} pairs`;
      break;
    }

    case 'ordering': {
      const want = key.answer || [];
      const got = Array.isArray(answer) ? answer : [];
      let hits = 0;
      want.forEach((v, i) => { if (Number(got[i]) === Number(v)) hits++; });
      fraction = partial ? hits / want.length : (hits === want.length ? 1 : 0);
      detail = `${hits}/${want.length} in place`;
      break;
    }

    case 'short_answer': {
      const accepted = Array.isArray(key.answer) ? key.answer : [key.answer];
      const norm = (s) => {
        let t = String(s).trim().replace(/\s+/g, ' ');
        if (!key.caseSensitive) t = t.toLowerCase();
        return t.replace(/[.,;:!?'"()]/g, '');
      };
      const mine = norm(answer);
      fraction = accepted.some((a) => norm(a) === mine) ? 1 : 0;
      break;
    }

    default:
      fraction = 0;
  }

  fraction = Math.max(0, Math.min(1, fraction));
  return { fraction, correct: fraction === 1, detail };
}

/* ---------- points ---------------------------------------------------- */

const DEFAULTS = {
  rule: 'tiers',
  penalty: 1,          // multiplies the wrong-answer cost in tier mode
  weights: DIFFICULTY_WEIGHTS
};

/**
 * @param {object} question
 * @param {number} fraction   0..1 from grade()
 * @param {number} confidence tier 1-3, or percent 0-100 in calibration mode
 * @param {object} settings   { rule, penalty, weights }
 */
export function score(question, fraction, confidence, settings = {}) {
  const s = { ...DEFAULTS, ...settings };
  const d = s.weights[question.difficulty] ?? DIFFICULTY_WEIGHTS[question.difficulty] ?? 2;

  if (s.rule === 'calibration') {
    const p = clamp(Number(confidence) / 100, 0.01, 0.99);
    const brier = 1 - 2 * Math.pow(p - fraction, 2);      // -1..1, peaks when p matches
    const g = 1 / guessBase(question);                    // an honest guess for this type
    const c = 1 + g + 2 * g * g;
    const wCal = 1 / (4 - c);
    const wRight = 3 * wCal;
    return round1(d * (wRight * fraction + wCal * (brier - c)));
  }

  const tier = clamp(Math.round(Number(confidence) || 1), 1, 3);
  const gain = d * tier * fraction;
  const loss = s.penalty * d * (tier - 1) * (1 - fraction);
  return round1(gain - loss);
}

/** What the student stands to win or lose, shown before they commit. */
export function preview(question, confidence, settings = {}) {
  return {
    best: score(question, 1, confidence, settings),
    worst: score(question, 0, confidence, settings)
  };
}

/* ---------- calibration report ---------------------------------------- */

/**
 * Mean Brier score across a student's answers. Lower is better calibrated:
 * 0 is a student whose stated confidence always matched reality.
 * Only meaningful in calibration mode with a handful of answers behind it.
 */
export function brierMean(responses) {
  const usable = responses.filter((r) => typeof r.confidencePct === 'number');
  if (!usable.length) return null;
  const sum = usable.reduce((t, r) => t + Math.pow(r.confidencePct / 100 - r.fraction, 2), 0);
  return round3(sum / usable.length);
}

/** Buckets for the calibration chart: stated confidence vs how often right. */
export function calibrationBuckets(responses) {
  const edges = [0, 30, 45, 60, 75, 90, 101];
  return edges.slice(0, -1).map((lo, i) => {
    const hi = edges[i + 1];
    const inBucket = responses.filter((r) =>
      typeof r.confidencePct === 'number' && r.confidencePct >= lo && r.confidencePct < hi);
    return {
      label: `${lo}-${hi - 1}%`,
      n: inBucket.length,
      stated: inBucket.length ? round1(avg(inBucket.map((r) => r.confidencePct))) : null,
      actual: inBucket.length ? round1(100 * avg(inBucket.map((r) => r.fraction))) : null
    };
  }).filter((b) => b.n > 0);
}

const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const round1 = (n) => Math.round(n * 10) / 10;
const round3 = (n) => Math.round(n * 1000) / 1000;
