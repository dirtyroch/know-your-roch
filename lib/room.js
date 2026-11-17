'use strict';

const {
  CATEGORIES, LIMITS, AVATARS, COLORS, PACES, GAME_NAME,
} = require('./config');
const { questionsForCategories, categoryLabel } = require('./questions');
const {
  cleanLine, normName, buildRotation, dealQuestions, scoreExact, scoreNumber,
  scoreJudged, streakBonus, knowsYouBest, podium,
} = require('./logic');

const TYPES = new Set(['choice', 'either', 'number', 'text', 'who']);

function rid() {
  return Math.random().toString(36).slice(2, 10);
}

function validId(id) {
  return typeof id === 'string' && /^[a-z0-9-]{8,40}$/i.test(id);
}

function createRoom(code) {
  return {
    code,
    hostId: null,
    phase: 'lobby',
    players: [],
    custom: [],
    settings: {
      categories: CATEGORIES.map((c) => c.id),
      roundsPerPlayer: LIMITS.defaultRounds,
      pace: 'normal',
    },
    game: null,
    deadline: 0,
    duration: 0,
    created: Date.now(),
  };
}

function fixHost(room) {
  const host = room.players.find((p) => p.id === room.hostId);
  if (host && host.connected) return;
  const next = room.players.find((p) => p.connected);
  if (next) room.hostId = next.id;
  else if (!host) room.hostId = null;
}

function uniqueNick(room, nickname, selfId) {
  const taken = new Set(
    room.players.filter((p) => p.id !== selfId).map((p) => normName(p.nickname)),
  );
  let n = nickname;
  let k = 2;
  while (taken.has(normName(n))) {
    const suffix = ` ${k++}`;
    n = `${nickname.slice(0, LIMITS.maxNickname - suffix.length)}${suffix}`;
  }
  return n;
}

/**
 * Join or reclaim a seat. A matching player id wins. Otherwise the same
 * nickname reclaims that seat (refresh, or a second tab). New nicknames
 * only enter during the lobby, and only until the room is full.
 */
function addPlayer(room, input = {}) {
  const nickname = cleanLine(input.nickname, LIMITS.maxNickname);
  const wantedId = validId(input.playerId) ? input.playerId : null;
  let existing = wantedId ? room.players.find((p) => p.id === wantedId) : null;
  if (!existing && nickname) {
    existing = room.players.find((p) => normName(p.nickname) === normName(nickname));
  }
  if (existing) {
    existing.connected = true;
    if (room.creatorId === existing.id) room.hostId = existing.id;
    if (room.phase === 'lobby' && nickname) {
      const next = uniqueNick(room, nickname, existing.id);
      existing.nickname = next;
    }
    return { ok: true, player: existing, rejoined: true };
  }
  if (!nickname) return { error: 'Pick a nickname first.' };
  if (room.phase !== 'lobby') return { error: 'That game already started. Rejoin with the same nickname.' };
  if (room.players.length >= LIMITS.maxPlayers) return { error: `This room is full (${LIMITS.maxPlayers} players).` };
  const player = {
    id: wantedId || `p${rid()}${Date.now().toString(36)}`,
    nickname: uniqueNick(room, nickname),
    connected: true,
    emoji: AVATARS[room.players.length % AVATARS.length],
    color: COLORS[room.players.length % COLORS.length],
  };
  room.players.push(player);
  if (!room.hostId) room.hostId = player.id;
  return { ok: true, player, rejoined: false };
}

function disconnectPlayer(room, playerId) {
  const p = room.players.find((x) => x.id === playerId);
  if (p) p.connected = false;
  fixHost(room);
}

function releasePlayer(room, playerId) {
  if (room.phase !== 'lobby') return;
  const p = room.players.find((x) => x.id === playerId);
  if (!p || p.connected) return;
  room.players = room.players.filter((x) => x.id !== playerId);
  room.custom = room.custom.filter((c) => c.by !== playerId || c.used);
  fixHost(room);
}

function kickPlayer(room, hostId, targetId) {
  if (room.hostId !== hostId) return { error: 'Only the host can do that.' };
  if (targetId === hostId) return { error: 'The host stays in the game.' };
  if (room.phase !== 'lobby') return { error: 'You can remove players from the lobby.' };
  if (!room.players.some((p) => p.id === targetId)) return { error: 'That player already left.' };
  room.players = room.players.filter((p) => p.id !== targetId);
  room.custom = room.custom.filter((c) => c.by !== targetId);
  return { ok: true };
}

function applySettings(room, hostId, patch = {}) {
  if (room.hostId !== hostId || room.phase !== 'lobby') return { error: 'Only the host can change that in the lobby.' };
  if (Array.isArray(patch.categories)) {
    const ids = [...new Set(patch.categories.filter((id) => CATEGORIES.some((c) => c.id === id)))];
    if (ids.length) room.settings.categories = ids;
  }
  if (patch.roundsPerPlayer != null) {
    const n = Number(patch.roundsPerPlayer);
    if (Number.isInteger(n) && n >= LIMITS.roundsMin && n <= LIMITS.roundsMax) room.settings.roundsPerPlayer = n;
  }
  if (PACES[patch.pace]) room.settings.pace = patch.pace;
  return { ok: true };
}

function validateCustom(spec) {
  const type = spec && spec.type;
  if (!TYPES.has(type)) return { error: 'Pick a question type.' };
  const prompt = cleanLine(spec.prompt, LIMITS.maxPrompt);
  if (prompt.length < 8) return { error: 'Write a little more prompt. Eight characters at least.' };
  const q = { type, prompt, category: 'custom' };
  if (type === 'choice' || type === 'either') {
    const raw = Array.isArray(spec.options) ? spec.options : [];
    const options = raw.map((o) => cleanLine(o, LIMITS.maxOption)).filter(Boolean);
    const need = type === 'either' ? 2 : 3;
    const cap = type === 'either' ? 2 : 4;
    if (options.length < need) return { error: type === 'either' ? 'This-or-that needs two choices.' : 'Add at least three choices.' };
    q.options = options.slice(0, cap);
    const norms = new Set(q.options.map((o) => o.toLowerCase()));
    if (norms.size !== q.options.length) return { error: 'Those choices are the same.' };
  }
  if (type === 'number') {
    const min = Number(spec.min);
    const max = Number(spec.max);
    if (!Number.isInteger(min) || !Number.isInteger(max) || min >= max) return { error: 'Numbers need a low and a high, with room between them.' };
    if (min < -50 || max > 200 || max - min > 120) return { error: 'Keep the number range smaller than that.' };
    q.min = min;
    q.max = max;
    q.unit = cleanLine(spec.unit || '', 18);
  }
  if (type === 'text') q.placeholder = 'A few words';
  return { question: q };
}

function addCustom(room, playerId, spec) {
  const player = room.players.find((p) => p.id === playerId);
  if (!player) return { error: 'Join the room before writing a question.' };
  const mine = room.custom.filter((c) => c.by === playerId && !c.used);
  if (mine.length >= LIMITS.maxCustomEach) return { error: `Up to ${LIMITS.maxCustomEach} questions each. Save a few for later.` };
  const built = validateCustom(spec);
  if (built.error) return built;
  const promptKey = normName(built.question.prompt);
  if (room.custom.some((c) => normName(c.prompt) === promptKey)) return { error: 'Someone already added that one.' };
  const custom = {
    id: `c${rid()}`,
    ...built.question,
    by: playerId,
    byName: player.nickname,
    used: false,
  };
  if (!custom.prompt.includes('{{name}}') && !/^who\b/i.test(custom.prompt)) {
    custom.prompt = `{{name}}: ${custom.prompt}`;
  }
  room.custom.push(custom);
  if (room.game) spliceCustomIntoFuture(room, custom);
  return { ok: true, custom };
}

function spliceCustomIntoFuture(room, custom) {
  const g = room.game;
  if (!g) return;
  for (let i = g.index + 1; i < g.rounds.length; i++) {
    const round = g.rounds[i];
    if (round.question && round.question.by) continue;
    if (round.hotSeatId === custom.by) continue;
    const seat = g.roster.find((p) => p.id === round.hotSeatId);
    round.question = materialize(custom, seat ? seat.nickname : 'They', g.roster);
    custom.used = true;
    return;
  }
}

function removeCustom(room, playerId, customId) {
  const c = room.custom.find((q) => q.id === customId && q.by === playerId && !q.used);
  if (!c) return { error: 'That question is already in the game, or it is not yours.' };
  room.custom = room.custom.filter((q) => q !== c);
  return { ok: true };
}

function materialize(q, hotName, roster) {
  const name = hotName || 'They';
  const prompt = String(q.prompt || '').split('{{name}}').join(name);
  const out = {
    id: q.id,
    type: q.type,
    category: q.category || 'custom',
    categoryLabel: q.category === 'custom' ? 'Custom' : categoryLabel(q.category),
    prompt,
    by: q.by || null,
    byName: q.byName || null,
  };
  if (q.type === 'choice' || q.type === 'either') out.options = (q.options || []).slice();
  if (q.type === 'number') {
    out.min = q.min;
    out.max = q.max;
    out.unit = q.unit || '';
  }
  if (q.type === 'text') out.placeholder = q.placeholder || 'A few words';
  if (q.type === 'who') out.options = roster.map((p) => ({ id: p.id, label: p.nickname }));
  return out;
}

function startGame(room, opts = {}) {
  if (room.phase !== 'lobby') return { error: 'The game already started.' };
  room.players = room.players.filter((p) => p.connected);
  const players = room.players;
  if (players.length < LIMITS.minPlayers) return { error: `Need at least ${LIMITS.minPlayers} players in the room.` };
  if (players.length > LIMITS.maxPlayers) return { error: `Keep it to ${LIMITS.maxPlayers} players.` };
  const roster = players.map((p) => ({ id: p.id, nickname: p.nickname, emoji: p.emoji, color: p.color }));
  let planned;
  if (opts.rounds) {
    planned = opts.rounds.map((r) => ({ hotSeatId: r.hotSeatId, question: r.question }));
  } else {
    const ids = roster.map((p) => p.id);
    const rotation = buildRotation(ids, room.settings.roundsPerPlayer);
    const bank = questionsForCategories(room.settings.categories);
    if (!bank.length) return { error: 'Pick at least one category.' };
    planned = dealQuestions(rotation, bank, room.custom, opts.rng || Math.random);
    if (planned.some((r) => !r.question)) return { error: 'Those categories do not have questions yet.' };
  }
  room.game = {
    roster,
    rounds: planned.map((item) => {
      const seat = roster.find((p) => p.id === item.hotSeatId);
      return {
        hotSeatId: item.hotSeatId,
        question: materialize(item.question, seat ? seat.nickname : 'They', roster),
      };
    }),
    index: 0,
    scores: Object.fromEntries(roster.map((p) => [p.id, 0])),
    streaks: Object.fromEntries(roster.map((p) => [p.id, 0])),
    knows: {},
    answers: {},
    reveal: null,
    awards: null,
  };
  room.phase = 'answer';
  return { ok: true };
}

function currentRound(room) {
  if (!room.game) return null;
  return room.game.rounds[room.game.index] || null;
}

function unitWord(unit, value) {
  if (value === 1 && !unit.includes(' ') && unit.endsWith('s')) return unit.slice(0, -1);
  return unit;
}

function answerLabel(question, value, roster) {
  if (value == null) return 'No guess';
  if (question.type === 'choice' || question.type === 'either') return question.options[value] ?? 'No guess';
  if (question.type === 'who') {
    const hit = (roster || []).find((p) => p.id === value) || (question.options || []).find((o) => o.id === value);
    return hit ? (hit.nickname || hit.label) : 'Someone';
  }
  if (question.type === 'number') {
    const unit = question.unit ? ` ${unitWord(question.unit, value)}` : '';
    return `${value}${unit}`;
  }
  return String(value);
}

function normalizeAnswer(question, value) {
  if (!question) return null;
  if (question.type === 'choice' || question.type === 'either') {
    const i = Number(value);
    if (!Number.isInteger(i) || i < 0 || i >= (question.options || []).length) return null;
    return i;
  }
  if (question.type === 'who') {
    const id = String(value || '');
    if (!(question.options || []).some((o) => o.id === id)) return null;
    return id;
  }
  if (question.type === 'number') {
    const n = Number(value);
    if (!Number.isInteger(n) || n < question.min || n > question.max) return null;
    return n;
  }
  if (question.type === 'text') {
    const t = cleanLine(value, LIMITS.maxText);
    return t.length ? t : null;
  }
  return null;
}

function submitAnswer(room, playerId, raw) {
  if (!room.game || room.phase !== 'answer') return { error: 'Answer time is over.' };
  const round = currentRound(room);
  if (!round) return { error: 'This round is already done.' };
  if (!room.game.roster.some((p) => p.id === playerId)) return { error: 'You are not in this round.' };
  const value = normalizeAnswer(round.question, raw);
  if (value == null) return { error: 'That answer does not fit this question.' };
  room.game.answers[playerId] = value;
  return { ok: true, value };
}

function unlockAnswer(room, playerId) {
  if (!room.game || room.phase !== 'answer') return { error: 'Too late to change it.' };
  if (!room.game.roster.some((p) => p.id === playerId)) return { error: 'You are not in this round.' };
  delete room.game.answers[playerId];
  return { ok: true };
}

function connectedRoster(room) {
  const ids = new Set(room.players.filter((p) => p.connected).map((p) => p.id));
  return room.game.roster.filter((p) => ids.has(p.id));
}

function everyoneLocked(room) {
  if (!room.game || room.phase !== 'answer') return false;
  const round = currentRound(room);
  // A refreshing hot seat must not get skipped just because everyone else locked in.
  if (room.game.answers[round.hotSeatId] == null) return false;
  const need = connectedRoster(room).filter((p) => p.id !== round.hotSeatId);
  return need.every((p) => room.game.answers[p.id] != null);
}

function guesserIds(room) {
  const hot = currentRound(room).hotSeatId;
  return room.game.roster.filter((p) => p.id !== hot).map((p) => p.id);
}

function settle(room, judgedIds) {
  const g = room.game;
  const round = currentRound(room);
  const hot = round.hotSeatId;
  const q = round.question;
  const guessers = guesserIds(room);
  const guesses = {};
  for (const id of guessers) {
    if (g.answers[id] != null) guesses[id] = g.answers[id];
  }
  let base;
  if (q.type === 'number') base = scoreNumber(g.answers[hot], guesses);
  else if (q.type === 'text') base = scoreJudged(guessers, (judgedIds || []).filter((id) => guesses[id] != null));
  else base = scoreExact(g.answers[hot], guesses);

  const results = [];
  for (const id of guessers) {
    const points = base[id] || 0;
    const correct = points > 0;
    if (correct) g.streaks[id] = (g.streaks[id] || 0) + 1;
    else g.streaks[id] = 0;
    const bonus = correct ? streakBonus(g.streaks[id]) : 0;
    const gain = points + bonus;
    g.scores[id] = (g.scores[id] || 0) + gain;
    if (correct) {
      g.knows[id] = g.knows[id] || {};
      g.knows[id][hot] = (g.knows[id][hot] || 0) + 1;
    }
    const person = g.roster.find((p) => p.id === id);
    results.push({
      id,
      nickname: person.nickname,
      emoji: person.emoji,
      color: person.color,
      value: g.answers[id] != null ? g.answers[id] : null,
      label: answerLabel(q, g.answers[id], g.roster),
      correct,
      points,
      bonus,
      gain,
      streak: g.streaks[id],
    });
  }
  g.reveal = {
    skipped: false,
    truth: g.answers[hot],
    truthLabel: answerLabel(q, g.answers[hot], g.roster),
    guesses: results,
  };
}

function closeAnswer(room) {
  if (!room.game || room.phase !== 'answer') return room.phase;
  const round = currentRound(room);
  const truth = room.game.answers[round.hotSeatId];
  if (truth == null) {
    room.game.reveal = {
      skipped: true,
      truth: null,
      truthLabel: null,
      guesses: [],
      message: 'The hot seat did not answer. No points this round.',
    };
    room.phase = 'reveal';
    return 'reveal';
  }
  if (round.question.type === 'text') {
    const any = guesserIds(room).some((id) => room.game.answers[id] != null);
    if (!any) {
      settle(room, []);
      room.phase = 'reveal';
      return 'reveal';
    }
    room.phase = 'judge';
    return 'judge';
  }
  settle(room);
  room.phase = 'reveal';
  return 'reveal';
}

function submitJudgment(room, playerId, ids) {
  if (!room.game || room.phase !== 'judge') return { error: 'Judging is closed.' };
  const round = currentRound(room);
  if (playerId !== round.hotSeatId) return { error: 'Only the hot seat marks the right guesses.' };
  const allowed = new Set(guesserIds(room).filter((id) => room.game.answers[id] != null));
  const picked = [...new Set((Array.isArray(ids) ? ids : []).map(String))].filter((id) => allowed.has(id));
  settle(room, picked);
  room.phase = 'reveal';
  return { ok: true };
}

function advance(room) {
  if (!room.game) return room.phase;
  if (room.phase === 'judge') {
    submitJudgment(room, currentRound(room).hotSeatId, []);
    return room.phase;
  }
  if (room.phase !== 'reveal') return room.phase;
  const g = room.game;
  g.index += 1;
  g.answers = {};
  g.reveal = null;
  if (g.index >= g.rounds.length) {
    g.awards = knowsYouBest(g.knows, g.roster);
    room.phase = 'final';
    return 'final';
  }
  room.phase = 'answer';
  return 'answer';
}

function backToLobby(room) {
  if (room.phase !== 'final') return { error: 'Finish this game first.' };
  room.phase = 'lobby';
  room.game = null;
  room.deadline = 0;
  room.duration = 0;
  for (const c of room.custom) c.used = false;
  room.players = room.players.filter((p) => p.connected);
  fixHost(room);
  return { ok: true };
}

function scoresOf(room) {
  if (!room.game) return {};
  return room.game.scores;
}

function viewFor(room, viewer = {}) {
  const you = viewer.id || null;
  const role = viewer.role || (you ? 'player' : 'tv');
  const g = room.game;
  const scoreOf = (id) => (g && g.scores && g.scores[id] != null ? g.scores[id] : 0);
  const streakOf = (id) => (g && g.streaks && g.streaks[id]) || 0;
  const players = room.players.map((p) => ({
    id: p.id,
    nickname: p.nickname,
    emoji: p.emoji,
    color: p.color,
    connected: p.connected,
    host: p.id === room.hostId,
    score: scoreOf(p.id),
    streak: streakOf(p.id),
  }));
  const view = {
    gameName: GAME_NAME,
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    you,
    role,
    settings: {
      categories: room.settings.categories.slice(),
      roundsPerPlayer: room.settings.roundsPerPlayer,
      pace: room.settings.pace,
    },
    catalog: CATEGORIES,
    limits: {
      minPlayers: LIMITS.minPlayers,
      maxPlayers: LIMITS.maxPlayers,
      roundsMin: LIMITS.roundsMin,
      roundsMax: LIMITS.roundsMax,
      maxCustomEach: LIMITS.maxCustomEach,
    },
    players,
    customs: {
      count: room.custom.filter((c) => !c.used).length,
      mine: room.custom.filter((c) => c.by === you && !c.used).map((c) => ({
        id: c.id, type: c.type, prompt: c.prompt,
      })),
    },
    deadline: room.deadline || 0,
    duration: room.duration || 0,
    serverNow: Date.now(),
    round: null,
    final: null,
  };
  if (!g) return view;
  const round = currentRound(room);
  if (room.phase === 'final' || !round) {
    const rosterPlayers = g.roster.map((p) => ({
      ...p,
      score: g.scores[p.id] || 0,
      connected: room.players.find((x) => x.id === p.id)?.connected !== false,
    }));
    view.final = {
      podium: podium(rosterPlayers),
      awards: (g.awards || knowsYouBest(g.knows, g.roster)).map((a) => ({
        subjectId: a.subjectId,
        subjectName: (g.roster.find((p) => p.id === a.subjectId) || {}).nickname || 'Someone',
        correct: a.correct,
        guessers: a.guesserIds.map((id) => {
          const p = g.roster.find((x) => x.id === id);
          return { id, nickname: p ? p.nickname : 'Someone' };
        }),
      })),
    };
    view.players = g.roster.map((p) => {
      const live = room.players.find((x) => x.id === p.id);
      return {
        id: p.id,
        nickname: p.nickname,
        emoji: p.emoji,
        color: p.color,
        connected: live ? live.connected : false,
        host: p.id === room.hostId,
        score: g.scores[p.id] || 0,
        streak: g.streaks[p.id] || 0,
      };
    });
    return view;
  }
  const hot = g.roster.find((p) => p.id === round.hotSeatId);
  const youAreHot = you === round.hotSeatId;
  const roundView = {
    index: g.index + 1,
    total: g.rounds.length,
    hotSeat: hot,
    youAreHot,
    question: publicQuestion(round.question),
    lockedIds: Object.keys(g.answers),
    yourAnswer: you && Object.prototype.hasOwnProperty.call(g.answers, you) ? g.answers[you] : null,
    judge: null,
    reveal: null,
  };
  if (room.phase === 'judge') {
    roundView.judge = {
      guesses: guesserIds(room)
        .filter((id) => g.answers[id] != null)
        .map((id) => {
          const p = g.roster.find((x) => x.id === id);
          return {
            id,
            nickname: p.nickname,
            emoji: p.emoji,
            color: p.color,
            label: answerLabel(round.question, g.answers[id], g.roster),
          };
        }),
    };
  }
  if (room.phase === 'reveal' && g.reveal) {
    roundView.reveal = {
      skipped: !!g.reveal.skipped,
      message: g.reveal.message || null,
      truthLabel: g.reveal.truthLabel,
      guesses: (g.reveal.guesses || []).map((row) => ({ ...row })),
    };
  }
  view.round = roundView;
  return view;
}

function publicQuestion(q) {
  return {
    id: q.id,
    type: q.type,
    category: q.category,
    categoryLabel: q.categoryLabel,
    prompt: q.prompt,
    byName: q.byName,
    options: q.options ? q.options.map((o) => (typeof o === 'string' ? o : { ...o })) : null,
    min: q.min,
    max: q.max,
    unit: q.unit,
    placeholder: q.placeholder,
  };
}

module.exports = {
  createRoom,
  addPlayer,
  disconnectPlayer,
  releasePlayer,
  kickPlayer,
  applySettings,
  addCustom,
  removeCustom,
  startGame,
  submitAnswer,
  unlockAnswer,
  everyoneLocked,
  closeAnswer,
  submitJudgment,
  advance,
  backToLobby,
  viewFor,
  currentRound,
  answerLabel,
  normalizeAnswer,
  materialize,
  scoresOf,
};
