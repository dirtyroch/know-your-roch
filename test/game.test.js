'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { LIMITS } = require('../lib/config');
const { ALL, validateBank } = require('../lib/questions');
const {
  buildRotation, scoreExact, scoreNumber, scoreJudged, streakBonus, dealQuestions, knowsYouBest,
} = require('../lib/logic');
const {
  createRoom, addPlayer, addCustom, disconnectPlayer, releasePlayer, startGame, submitAnswer,
  closeAnswer, submitJudgment, advance, viewFor, everyoneLocked, backToLobby,
} = require('../lib/room');

function seat(room, id, nickname) {
  const res = addPlayer(room, { playerId: id, nickname });
  assert.equal(res.error, undefined, res.error);
  return res.player;
}

function scripted(rounds, nicks = ['Ada', 'Bo', 'Cy']) {
  const room = createRoom('ROOM');
  const ids = nicks.map((nickname, i) => {
    const id = `player-${i}${nickname.toLowerCase()}`;
    seat(room, id, nickname);
    return id;
  });
  const res = startGame(room, {
    rounds: rounds.map((question, i) => ({ hotSeatId: ids[i % ids.length], question })),
  });
  assert.equal(res.error, undefined, res.error);
  return { room, ids };
}

test('question bank is original, valid, and at least 300', () => {
  const errors = validateBank(ALL);
  assert.deepEqual(errors, []);
  assert.ok(ALL.length >= 300, `expected >= 300 questions, got ${ALL.length}`);
  const types = new Set(ALL.map((q) => q.type));
  for (const type of ['choice', 'either', 'number', 'text', 'who']) assert.ok(types.has(type));
});

test('hot seat rotation gives every player the same number of turns', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const order = buildRotation(ids, 3);
  assert.equal(order.length, 12);
  assert.deepEqual(order.slice(0, 4), ids);
  assert.deepEqual(order.slice(4, 8), ids);
  for (const id of ids) assert.equal(order.filter((x) => x === id).length, 3);

  const room = createRoom('TURN');
  ids.forEach((id, i) => seat(room, `player-${id}xxxx`, `P${i}`));
  room.settings.roundsPerPlayer = 3;
  const started = startGame(room, { rng: () => 0 });
  assert.equal(started.ok, true);
  const played = room.game.rounds.map((r) => r.hotSeatId);
  const expectedIds = ids.map((id) => `player-${id}xxxx`);
  assert.deepEqual(played, buildRotation(expectedIds, 3));
});

test('choice and this-or-that score an exact match only', () => {
  assert.deepEqual(scoreExact(1, { a: 1, b: 0, c: 1 }), { a: 100, b: 0, c: 100 });
  assert.deepEqual(scoreExact('p-bo', { a: 'p-bo', b: 'p-cy' }), { a: 100, b: 0 });
  assert.deepEqual(scoreJudged(['a', 'b', 'c'], ['c']), { a: 0, b: 0, c: 100 });
});

test('number questions pay every guesser tied for closest', () => {
  const tied = scoreNumber(8, { nearLow: 6, nearHigh: 10, far: 0, exact: 8 });
  assert.equal(tied.exact, 100);
  assert.equal(tied.nearLow, 0);
  assert.equal(tied.nearHigh, 0);
  assert.equal(tied.far, 0);

  const share = scoreNumber(8, { low: 6, high: 10, far: 1 });
  assert.equal(share.low, 100);
  assert.equal(share.high, 100);
  assert.equal(share.far, 0);

  const solo = scoreNumber(5, { a: 4, b: 9, c: 1 });
  assert.deepEqual(solo, { a: 100, b: 0, c: 0 });
});

test('streak bonus grows and then caps', () => {
  assert.equal(streakBonus(1), 0);
  assert.equal(streakBonus(2), 50);
  assert.equal(streakBonus(3), 100);
  assert.equal(streakBonus(5), 200);
  assert.equal(streakBonus(9), 200);
});

test('a full round scores closest, streaks, and a skipped hot seat', () => {
  const { room, ids } = scripted([
    { id: 'n1', category: 'habits', type: 'number', prompt: 'How many hours of sleep does {{name}} want?', min: 0, max: 12, unit: 'hours' },
    { id: 'c1', category: 'favorites', type: 'choice', prompt: '{{name}} picks…', options: ['Red', 'Blue', 'Gold'] },
    { id: 't1', category: 'dreams', type: 'text', prompt: '{{name}} would invent…' },
  ]);
  const [ada, bo, cy] = ids;
  assert.equal(room.game.rounds[0].hotSeatId, ada);
  assert.equal(submitAnswer(room, ada, 7).ok, true);
  assert.equal(submitAnswer(room, bo, 6).ok, true);
  assert.equal(submitAnswer(room, cy, 1).ok, true);
  assert.equal(closeAnswer(room), 'reveal');
  assert.equal(room.game.scores[bo], 100);
  assert.equal(room.game.scores[cy], 0);
  assert.equal(room.game.streaks[bo], 1);
  assert.equal(room.game.reveal.truthLabel, '7 hours');

  advance(room);
  assert.equal(room.phase, 'answer');
  assert.equal(room.game.rounds[1].hotSeatId, bo);
  submitAnswer(room, bo, 2);
  submitAnswer(room, ada, 2);
  submitAnswer(room, cy, 0);
  closeAnswer(room);
  assert.equal(room.game.scores[ada], 100);
  assert.equal(room.game.streaks[ada], 1);
  assert.equal(room.game.scores[cy], 0);
  assert.equal(room.game.streaks[cy], 0);
  assert.equal(room.game.streaks[bo], 1);

  advance(room);
  submitAnswer(room, cy, 'a pocket lamp');
  submitAnswer(room, ada, 'a pocket lamp');
  submitAnswer(room, bo, 'a louder kettle');
  assert.equal(closeAnswer(room), 'judge');
  assert.equal(submitJudgment(room, cy, [ada]).ok, true);
  assert.equal(room.game.scores[ada], 250);
  assert.equal(room.game.streaks[ada], 2);
  assert.equal(room.game.scores[bo], 100);
  assert.equal(room.game.streaks[bo], 0);

  advance(room);
  assert.equal(room.phase, 'final');
  const awards = Object.fromEntries(room.game.awards.map((a) => [a.subjectId, a]));
  assert.deepEqual(awards[ada].guesserIds, [bo]);
  assert.deepEqual(awards[bo].guesserIds, [ada]);
  assert.deepEqual(awards[cy].guesserIds, [ada]);
  assert.equal(knowsYouBest(room.game.knows, ids).length, 3);
});

test('free-text points only the guesses the hot seat accepts', () => {
  const { room, ids } = scripted([
    { id: 't1', category: 'food', type: 'text', prompt: '{{name}} would eat…' },
  ], ['Ada', 'Bo']);
  const [ada, bo] = ids;
  submitAnswer(room, ada, 'soup');
  submitAnswer(room, bo, 'soup');
  closeAnswer(room);
  submitJudgment(room, ada, []);
  assert.equal(room.game.scores[bo], 0);
  assert.equal(room.game.streaks[bo], 0);
  assert.equal(room.game.reveal.guesses[0].correct, false);
});

test('the hot seat answer stays secret until the reveal', () => {
  const { room, ids } = scripted([
    { id: 't1', category: 'dreams', type: 'text', prompt: '{{name}} would name it…' },
    { id: 'c1', category: 'favorites', type: 'choice', prompt: '{{name}} picks…', options: ['Red', 'Blue'] },
  ], ['Ada', 'Bo']);
  const [ada, bo] = ids;
  submitAnswer(room, ada, 'lantern-secret');
  const hidden = viewFor(room, { id: bo, role: 'player' });
  assert.equal(JSON.stringify(hidden).includes('lantern-secret'), false);
  assert.equal(hidden.round.reveal, null);
  assert.equal(hidden.round.yourAnswer, null);
  const seat = viewFor(room, { id: ada, role: 'player' });
  assert.equal(seat.round.yourAnswer, 'lantern-secret');
  const tv = viewFor(room, { role: 'tv' });
  assert.equal(JSON.stringify(tv).includes('lantern-secret'), false);
  assert.equal(everyoneLocked(room), false);
  submitAnswer(room, bo, 'a bell');
  assert.equal(everyoneLocked(room), true);
  closeAnswer(room);
  const duringJudge = viewFor(room, { id: bo, role: 'player' });
  assert.equal(JSON.stringify(duringJudge).includes('lantern-secret'), false);
  assert.ok(duringJudge.round.judge.guesses.some((g) => g.label === 'a bell'));
  submitJudgment(room, ada, []);
  const shown = viewFor(room, { id: bo, role: 'player' });
  assert.equal(shown.round.reveal.truthLabel, 'lantern-secret');
  assert.equal(shown.round.reveal.guesses[0].correct, false);
});

test('room holds at most 10 players and needs 2 to start', () => {
  const room = createRoom('FULL');
  for (let i = 0; i < LIMITS.maxPlayers; i++) {
    const res = addPlayer(room, { playerId: `player-${i}ok`, nickname: `Kid${i}` });
    assert.equal(res.ok, true);
  }
  assert.equal(room.players.length, 10);
  const extra = addPlayer(room, { playerId: 'player-extra', nickname: 'Extra' });
  assert.match(extra.error, /full/i);
  assert.equal(room.players.length, 10);

  const tiny = createRoom('TINY');
  seat(tiny, 'player-solo', 'Solo');
  assert.match(startGame(tiny).error, /at least 2/i);
});

test('the same nickname rejoins the same seat after a refresh', () => {
  const room = createRoom('BACK');
  const first = seat(room, 'player-ada1', 'Ada');
  seat(room, 'player-bo01', 'Bo');
  disconnectPlayer(room, first.id);
  assert.equal(room.players.length, 2);
  const again = addPlayer(room, { nickname: 'ada' });
  assert.equal(again.rejoined, true);
  assert.equal(again.player.id, first.id);
  assert.equal(again.player.connected, true);
  assert.equal(room.players.length, 2);

  const byId = addPlayer(room, { playerId: 'player-bo01', nickname: 'Bo' });
  assert.equal(byId.rejoined, true);
  assert.equal(byId.player.id, 'player-bo01');
  assert.equal(room.players.length, 2);

  disconnectPlayer(room, first.id);
  releasePlayer(room, first.id);
  assert.equal(room.players.length, 1);
  const newbie = addPlayer(room, { nickname: 'Ada' });
  assert.equal(newbie.rejoined, false);
  assert.equal(room.players.length, 2);
});

test('the room creator gets host back after a refresh', () => {
  const room = createRoom('HOST');
  const ada = seat(room, 'player-ada1', 'Ada');
  room.hostId = ada.id;
  room.creatorId = ada.id;
  const bo = seat(room, 'player-bo01', 'Bo');
  disconnectPlayer(room, ada.id);
  assert.equal(room.hostId, bo.id);
  const again = addPlayer(room, { nickname: 'Ada' });
  assert.equal(again.rejoined, true);
  assert.equal(room.hostId, ada.id);
});

test('a disconnected seat still counts toward the cap until they are released', () => {
  const room = createRoom('HOLD');
  for (let i = 0; i < LIMITS.maxPlayers; i++) seat(room, `player-h${i}xx`, `H${i}`);
  disconnectPlayer(room, 'player-h0xx');
  const blocked = addPlayer(room, { nickname: 'New' });
  assert.match(blocked.error, /full/i);
  releasePlayer(room, 'player-h0xx');
  const freed = addPlayer(room, { nickname: 'New' });
  assert.equal(freed.ok, true);
  assert.equal(room.players.length, 10);
});

test('custom questions are credited and avoid their author when another seat is free', () => {
  const room = createRoom('CUST');
  const ada = seat(room, 'player-ada9', 'Ada');
  const bo = seat(room, 'player-bo99', 'Bo');
  room.settings.roundsPerPlayer = 2;
  const added = addCustom(room, ada.id, {
    type: 'either',
    prompt: 'Would they rather nap or explore?',
    options: ['Nap', 'Explore'],
  });
  assert.equal(added.ok, true);
  assert.match(added.custom.prompt, /\{\{name\}\}/);
  startGame(room, { rng: () => 0 });
  const customRounds = room.game.rounds.filter((r) => r.question.by === ada.id);
  assert.equal(customRounds.length, 1);
  assert.notEqual(customRounds[0].hotSeatId, ada.id);
  assert.equal(customRounds[0].hotSeatId, bo.id);
  assert.equal(customRounds[0].question.byName, 'Ada');
  assert.match(customRounds[0].question.prompt, /Bo/);
});

test('skipping a silent hot seat does not wipe streaks', () => {
  const { room, ids } = scripted([
    { id: 'c1', category: 'favorites', type: 'choice', prompt: '{{name}} picks…', options: ['Red', 'Blue'] },
    { id: 'c2', category: 'favorites', type: 'choice', prompt: '{{name}} picks again…', options: ['Red', 'Blue'] },
  ], ['Ada', 'Bo']);
  const [ada, bo] = ids;
  submitAnswer(room, ada, 0);
  submitAnswer(room, bo, 0);
  closeAnswer(room);
  assert.equal(room.game.streaks[bo], 1);
  advance(room);
  closeAnswer(room);
  assert.equal(room.game.reveal.skipped, true);
  assert.equal(room.game.streaks[bo], 1);
  assert.equal(room.game.scores[bo], 100);
});

test('play again returns a finished room to the lobby', () => {
  const { room } = scripted([
    { id: 'c1', category: 'favorites', type: 'either', prompt: '{{name}} picks…', options: ['Tea', 'Cocoa'] },
  ], ['Ada', 'Bo']);
  closeAnswer(room);
  advance(room);
  assert.equal(room.phase, 'final');
  assert.equal(backToLobby(room).ok, true);
  assert.equal(room.phase, 'lobby');
  assert.equal(room.game, null);
});
