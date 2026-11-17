'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { io: ioc } = require('socket.io-client');
const { server, io, GAME_NAME } = require('../server');
const { GAME_NAME: CONFIG_NAME } = require('../lib/config');
const REACTIONS = require('../public/reactions');

const clients = [];

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ port, path: urlPath }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body, type: res.headers['content-type'] || '' }));
    }).on('error', reject);
  });
}

function connect(port) {
  const socket = ioc(`http://127.0.0.1:${port}`, { transports: ['websocket'] });
  socket.on('state', (state) => { socket._state = state; });
  clients.push(socket);
  return socket;
}

function emit(socket, event, data) {
  return new Promise((resolve) => socket.emit(event, data, resolve));
}

function waitFor(socket, pred, ms = 2500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('state', on);
      reject(new Error(`timed out waiting for state (${socket._state ? socket._state.phase : 'none'})`));
    }, ms);
    const on = (state) => {
      if (!state || !pred(state)) return;
      clearTimeout(timer);
      socket.off('state', on);
      resolve(state);
    };
    socket.on('state', on);
    on(socket._state);
  });
}

let port;

test.before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

test.after(async () => {
  for (const socket of clients) socket.close();
  await new Promise((resolve) => io.close(resolve));
  if (server.listening) await new Promise((resolve) => server.close(resolve));
});

test('health and manifest use the one display name', async () => {
  assert.equal(GAME_NAME, CONFIG_NAME);
  const health = await get(port, '/healthz');
  assert.equal(health.status, 200);
  assert.equal(JSON.parse(health.body).name, CONFIG_NAME);
  const manifest = await get(port, '/manifest.webmanifest');
  const parsed = JSON.parse(manifest.body);
  assert.equal(parsed.name, CONFIG_NAME);
  assert.equal(parsed.display, 'standalone');
  assert.ok(parsed.icons.some((icon) => icon.sizes === '192x192'));
  assert.ok(parsed.icons.some((icon) => icon.purpose === 'maskable'));
  const config = await get(port, '/config.js');
  assert.match(config.body, new RegExp(CONFIG_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const page = await get(port, '/');
  assert.equal(page.status, 200);
  assert.match(page.body, /manifest\.webmanifest/);
  const appJs = await get(port, '/app.js');
  assert.match(appJs.body, /serviceWorker\.register\('\/sw\.js'\)/);
  const worker = await get(port, '/sw.js');
  assert.equal(worker.status, 200);
  assert.match(worker.body, /kyr-shell/);
});

test('every recorded reaction file is on disk', () => {
  assert.ok(REACTIONS.length >= 10);
  for (const reaction of REACTIONS) {
    if (!reaction.file) continue;
    const file = path.join(__dirname, '..', 'public', reaction.file);
    assert.equal(fs.existsSync(file), true, reaction.file);
    assert.ok(fs.statSync(file).size > 1000, reaction.file);
    assert.ok(fs.statSync(file).size < 60000, reaction.file);
  }
});

test('room cap, nickname reconnect, and a scored round', async () => {
  const host = connect(port);
  await new Promise((resolve) => host.on('connect', resolve));
  const created = await emit(host, 'create', { nickname: 'Ada', playerId: 'player-ada01' });
  assert.equal(created.ok, true);
  assert.match(created.code, /^[A-Z]{4}$/);
  const lobby = await waitFor(host, (s) => s.phase === 'lobby' && s.players.length === 1);
  assert.equal(lobby.hostId, created.you);

  const bo = connect(port);
  await new Promise((resolve) => bo.on('connect', resolve));
  const joined = await emit(bo, 'join', { code: created.code, nickname: 'Bo', playerId: 'player-bo0001' });
  assert.equal(joined.ok, true);
  await waitFor(host, (s) => s.players.length === 2);

  bo.close();
  const boAgain = connect(port);
  await new Promise((resolve) => boAgain.on('connect', resolve));
  const rejoined = await emit(boAgain, 'join', { code: created.code, nickname: 'bo' });
  assert.equal(rejoined.rejoined, true);
  assert.equal(rejoined.you, 'player-bo0001');
  const after = await waitFor(host, (s) => s.players.filter((p) => p.connected).length === 2 && s.players.length === 2);
  assert.equal(after.players.length, 2);

  const extras = [];
  for (let i = 0; i < 8; i++) {
    const socket = connect(port);
    await new Promise((resolve) => socket.on('connect', resolve));
    const res = await emit(socket, 'join', { code: created.code, nickname: `Kid${i}`, playerId: `player-k${i}xxxx` });
    assert.equal(res.ok, true, res.error);
    extras.push(socket);
  }
  await waitFor(host, (s) => s.players.length === 10);
  const overflow = connect(port);
  await new Promise((resolve) => overflow.on('connect', resolve));
  const rejected = await emit(overflow, 'join', { code: created.code, nickname: 'Nope', playerId: 'player-nope01' });
  assert.match(rejected.error, /full/i);

  for (const socket of extras) socket.close();
  overflow.close();
  await waitFor(host, (s) => s.players.filter((p) => p.connected).length === 2);

  const started = await emit(host, 'start', {});
  assert.equal(started.error, undefined, started.error);
  const playing = await waitFor(host, (s) => s.phase === 'answer');
  assert.equal(playing.round.hotSeat.id, created.you);
  const value = legal(playing.round.question, playing.players);
  const pending = waitFor(host, (s) => s.phase === 'reveal' || s.phase === 'judge', 4000);
  await emit(host, 'answer', { value });
  await emit(boAgain, 'answer', { value });

  let revealed = await pending;
  if (revealed.phase === 'judge') {
    const guesser = revealed.round.judge.guesses[0];
    await emit(host, 'judge', { ids: guesser ? [guesser.id] : [] });
    revealed = await waitFor(host, (s) => s.phase === 'reveal');
  }
  assert.equal(revealed.phase, 'reveal');
  assert.equal(revealed.round.reveal.skipped, false);
  const boScore = revealed.players.find((p) => p.id === 'player-bo0001').score;
  assert.ok(boScore >= 100, `expected Bo to score, got ${boScore}`);
});

function legal(question, players) {
  if (question.type === 'choice' || question.type === 'either') return 0;
  if (question.type === 'number') return question.min;
  if (question.type === 'who') return players[0].id;
  return 'pancakes';
}
