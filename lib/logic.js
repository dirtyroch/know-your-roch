'use strict';

const { POINTS, CODE_CHARS, LIMITS } = require('./config');

const BAD = /\b(f+u+c+k\w*|sh+i+t+\w*|bitch\w*|asshole\w*|dick\w*|cocks?\b|cunt\w*|slut\w*|whore\w*|nigg\w*|fag\w*|retard\w*)\b/gi;

function cleanLine(s, max) {
  let t = String(s ?? '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(BAD, 'beep');
  if (max) t = t.slice(0, max);
  return t;
}

function normName(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function shuffle(list, rng = Math.random) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makeCode(taken, rng = Math.random) {
  const set = taken instanceof Set ? taken : new Set(taken || []);
  for (let n = 0; n < 80; n++) {
    let c = '';
    for (let i = 0; i < LIMITS.codeLength; i++) c += CODE_CHARS[Math.floor(rng() * CODE_CHARS.length)];
    if (!set.has(c)) return c;
  }
  throw new Error('Could not mint a room code');
}

/**
 * Round-robin hot seats. With roundsPerPlayer = k, each id appears exactly k times,
 * in the same order every cycle, so nobody sits twice before everyone has sat once.
 */
function buildRotation(ids, roundsPerPlayer) {
  const n = ids.length;
  const turns = Math.max(0, n * roundsPerPlayer);
  const order = [];
  for (let i = 0; i < turns; i++) order.push(ids[i % n]);
  return order;
}

function streakBonus(streak) {
  const n = Number(streak) || 0;
  if (n < 2) return 0;
  return Math.min(POINTS.streakCap, POINTS.streakStep * (n - 1));
}

/** Exact match (choice, this-or-that, who's most likely). Missing guesses are omitted. */
function scoreExact(truth, guesses) {
  const points = {};
  for (const [id, guess] of Object.entries(guesses || {})) {
    points[id] = guess === truth ? POINTS.correct : 0;
  }
  return points;
}

/**
 * Closest absolute distance wins. Every guesser tied for the smallest distance
 * earns full points. Farther guesses earn 0.
 */
function scoreNumber(truth, guesses) {
  const entries = Object.entries(guesses || {});
  const points = Object.fromEntries(entries.map(([id]) => [id, 0]));
  if (!entries.length || truth == null || Number.isNaN(Number(truth))) return points;
  let best = Infinity;
  for (const [, guess] of entries) best = Math.min(best, Math.abs(Number(guess) - Number(truth)));
  for (const [id, guess] of entries) {
    if (Math.abs(Number(guess) - Number(truth)) === best) points[id] = POINTS.correct;
  }
  return points;
}

/** Free-text: the hot seat decides which guesser ids count as right. */
function scoreJudged(guesserIds, judgedIds) {
  const ok = new Set(judgedIds || []);
  const points = {};
  for (const id of guesserIds) points[id] = ok.has(id) ? POINTS.correct : 0;
  return points;
}

/**
 * Drop custom questions onto rounds whose hot seat is not the author when any
 * such round is still open. Bank questions fill the rest, repeating only if
 * the category pool is shorter than the game.
 */
function dealQuestions(rotation, bank, customs, rng = Math.random) {
  const rounds = rotation.map((hotSeatId) => ({ hotSeatId, question: null }));
  const fresh = shuffle((customs || []).filter((c) => c && !c.used), rng);
  for (const custom of fresh) {
    let idx = rounds.findIndex((r) => !r.question && r.hotSeatId !== custom.by);
    if (idx < 0) idx = rounds.findIndex((r) => !r.question);
    if (idx < 0) break;
    rounds[idx].question = custom;
    custom.used = true;
  }
  const bag = shuffle(bank || [], rng);
  if (!bag.length) return rounds;
  let bi = 0;
  for (const round of rounds) {
    if (round.question) continue;
    round.question = bag[bi % bag.length];
    bi += 1;
  }
  return rounds;
}

function knowsYouBest(knows, players) {
  const ids = players.map((p) => (typeof p === 'string' ? p : p.id));
  return ids.map((subject) => {
    let best = 0;
    const guesserIds = [];
    for (const guesser of ids) {
      if (guesser === subject) continue;
      const n = (knows && knows[guesser] && knows[guesser][subject]) || 0;
      if (n > best) {
        best = n;
        guesserIds.length = 0;
        guesserIds.push(guesser);
      } else if (n === best && n > 0) guesserIds.push(guesser);
    }
    return { subjectId: subject, guesserIds, correct: best };
  });
}

function podium(players) {
  const ranked = players.slice().sort((a, b) => b.score - a.score || a.nickname.localeCompare(b.nickname));
  let rank = 0;
  let prev = null;
  return ranked.map((p, i) => {
    if (prev == null || p.score !== prev) rank = i + 1;
    prev = p.score;
    return { ...p, rank };
  });
}

module.exports = {
  cleanLine,
  normName,
  shuffle,
  makeCode,
  buildRotation,
  streakBonus,
  scoreExact,
  scoreNumber,
  scoreJudged,
  dealQuestions,
  knowsYouBest,
  podium,
};
