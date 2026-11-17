'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const {
  GAME_NAME, GAME_TAGLINE, THEME_COLOR, BACKGROUND_COLOR, CATEGORIES, LIMITS, PACES, TIMING,
} = require('./lib/config');
const { makeCode } = require('./lib/logic');
const roomApi = require('./lib/room');
const REACTIONS = require('./public/reactions');

const PORT = process.env.PORT || 4877;
const GRACE_MS = Number(process.env.GRACE_MS || 15000);
const REACT_COOLDOWN_MS = 1000;
const REACTION_IDS = new Set(REACTIONS.map((r) => r.id));
const TS = () => {
  const n = Number(process.env.TIME_SCALE || 1);
  return Number.isFinite(n) && n > 0 ? n : 1;
};

const app = express();
app.disable('x-powered-by');

app.get('/config.js', (_req, res) => {
  res.type('application/javascript');
  res.set('Cache-Control', 'no-cache');
  res.send(`window.KYR_CONFIG = ${JSON.stringify({
    name: GAME_NAME,
    tagline: GAME_TAGLINE,
    themeColor: THEME_COLOR,
    backgroundColor: BACKGROUND_COLOR,
    categories: CATEGORIES,
    limits: {
      minPlayers: LIMITS.minPlayers,
      maxPlayers: LIMITS.maxPlayers,
      roundsMin: LIMITS.roundsMin,
      roundsMax: LIMITS.roundsMax,
      defaultRounds: LIMITS.defaultRounds,
      maxCustomEach: LIMITS.maxCustomEach,
      maxText: LIMITS.maxText,
      maxPrompt: LIMITS.maxPrompt,
      maxOption: LIMITS.maxOption,
    },
  })};\n`);
});

app.get('/manifest.webmanifest', (_req, res) => {
  res.type('application/manifest+json');
  res.set('Cache-Control', 'no-cache');
  res.json({
    id: '/',
    name: GAME_NAME,
    short_name: GAME_NAME,
    description: GAME_TAGLINE,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: BACKGROUND_COLOR,
    theme_color: THEME_COLOR,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  });
});

app.get('/sw.js', (_req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.set('Service-Worker-Allowed', '/');
  res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get(['/health', '/healthz'], (_req, res) => {
  res.json({ ok: true, name: GAME_NAME, rooms: rooms.size });
});
app.get(['/r/:code', '/tv', '/tv/:code'], (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 20000 });
const rooms = new Map();

function scaled(ms) {
  return Math.max(40, Math.round(ms * TS()));
}
function paced(room, seconds) {
  return scaled(seconds * 1000 * (PACES[room.settings.pace] || 1));
}
function ackOf(fn) {
  return typeof fn === 'function' ? fn : () => {};
}
function clearTimer(room) {
  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }
}
function arm(room, ms, fn) {
  clearTimer(room);
  room.duration = ms || 0;
  room.deadline = ms ? Date.now() + ms : 0;
  room.token = (room.token || 0) + 1;
  const token = room.token;
  if (ms && fn) {
    room.timer = setTimeout(() => {
      if (room.token !== token) return;
      room.timer = null;
      fn();
    }, ms);
    if (room.timer.unref) room.timer.unref();
  }
}
function sync(room) {
  for (const [sid, viewer] of room.sockets) {
    const s = io.sockets.sockets.get(sid);
    if (!s) {
      room.sockets.delete(sid);
      continue;
    }
    s.emit('state', roomApi.viewFor(room, viewer));
  }
}
function freshRoom(code) {
  const room = roomApi.createRoom(code);
  room.sockets = new Map();
  room.socketOf = new Map();
  room.grace = new Map();
  room.timer = null;
  room.token = 0;
  return room;
}
function revealWait(room) {
  const n = (room.game && room.game.reveal && room.game.reveal.guesses.length) || 0;
  const seconds = Math.min(TIMING.revealMax, TIMING.revealBase + n * TIMING.revealEach);
  return paced(room, seconds);
}
function beginAnswer(room) {
  arm(room, paced(room, TIMING.answer), () => finishAnswer(room));
  sync(room);
  maybeFinishAnswer(room);
}
function maybeFinishAnswer(room) {
  if (!room.game || room.phase !== 'answer' || !roomApi.everyoneLocked(room)) return;
  const token = room.token;
  clearTimer(room);
  room.timer = setTimeout(() => {
    room.timer = null;
    if (room.token !== token || room.phase !== 'answer' || !roomApi.everyoneLocked(room)) return;
    finishAnswer(room);
  }, scaled(450));
  if (room.timer.unref) room.timer.unref();
}
function finishAnswer(room) {
  const phase = roomApi.closeAnswer(room);
  if (phase === 'judge') beginJudge(room);
  else beginReveal(room);
}
function beginJudge(room) {
  arm(room, paced(room, TIMING.judge), () => {
    roomApi.advance(room);
    beginReveal(room);
  });
  sync(room);
}
function beginReveal(room) {
  arm(room, revealWait(room), () => {
    const next = roomApi.advance(room);
    if (next === 'answer') beginAnswer(room);
    else {
      arm(room, 0);
      sync(room);
    }
  });
  sync(room);
}
function hostSkip(room) {
  if (room.phase === 'answer') return finishAnswer(room);
  if (room.phase === 'judge') {
    roomApi.advance(room);
    return beginReveal(room);
  }
  if (room.phase === 'reveal') {
    const next = roomApi.advance(room);
    if (next === 'answer') return beginAnswer(room);
    arm(room, 0);
    return sync(room);
  }
  return null;
}
function scheduleRelease(room, playerId) {
  const prev = room.grace.get(playerId);
  if (prev) clearTimeout(prev);
  const timer = setTimeout(() => {
    room.grace.delete(playerId);
    if (!rooms.has(room.code)) return;
    roomApi.releasePlayer(room, playerId);
    sync(room);
    cleanupMaybe(room);
  }, GRACE_MS);
  if (timer.unref) timer.unref();
  room.grace.set(playerId, timer);
}
function cancelRelease(room, playerId) {
  const prev = room.grace.get(playerId);
  if (prev) clearTimeout(prev);
  room.grace.delete(playerId);
}
function cleanupMaybe(room) {
  const people = room.players.some((p) => p.connected) || room.sockets.size > 0;
  if (people) return;
  const timer = setTimeout(() => {
    if (!rooms.has(room.code)) return;
    const still = room.players.some((p) => p.connected) || room.sockets.size > 0;
    if (still) return;
    clearTimer(room);
    for (const t of room.grace.values()) clearTimeout(t);
    rooms.delete(room.code);
  }, 10 * 60 * 1000);
  if (timer.unref) timer.unref();
}

io.on('connection', (socket) => {
  let room = null;
  let me = null;

  function bind(next, player, role) {
    room = next;
    me = player;
    if (player) {
      const old = room.socketOf.get(player.id);
      if (old && old !== socket.id) {
        const prev = io.sockets.sockets.get(old);
        if (prev) {
          prev.emit('kicked', { reason: 'This seat is open on another screen now.' });
          prev.leave(room.code);
          room.sockets.delete(prev.id);
        }
      }
      room.socketOf.set(player.id, socket.id);
      cancelRelease(room, player.id);
      player.connected = true;
    }
    socket.join(room.code);
    room.sockets.set(socket.id, { id: player ? player.id : null, role });
  }

  socket.on('create', (data, ack) => {
    const cb = ackOf(ack);
    if (room) return cb({ error: 'You are already in a room.' });
    const code = makeCode(rooms.keys());
    const next = freshRoom(code);
    const res = roomApi.addPlayer(next, data || {});
    if (res.error) return cb(res);
    next.hostId = res.player.id;
    next.creatorId = res.player.id;
    rooms.set(code, next);
    bind(next, res.player, 'player');
    cb({ ok: true, code, you: res.player.id, role: 'player' });
    sync(next);
  });

  socket.on('join', (data, ack) => {
    const cb = ackOf(ack);
    const code = String((data && data.code) || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
    const next = rooms.get(code);
    if (!next) return cb({ error: 'No room with that code. Double-check it?' });
    if (room && room !== next) return cb({ error: 'Leave the room you are in first.' });
    const res = roomApi.addPlayer(next, data || {});
    if (res.error) return cb(res);
    bind(next, res.player, 'player');
    cb({ ok: true, code, you: res.player.id, role: 'player', rejoined: !!res.rejoined });
    sync(next);
    if (next.phase === 'answer') maybeFinishAnswer(next);
  });

  socket.on('watch', (data, ack) => {
    const cb = ackOf(ack);
    const code = String((data && data.code) || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
    const next = rooms.get(code);
    if (!next) return cb({ error: 'No room with that code.' });
    bind(next, null, 'tv');
    cb({ ok: true, code, role: 'tv' });
    sync(next);
  });

  socket.on('settings', (patch) => {
    if (!room || !me || room.hostId !== me.id) return;
    roomApi.applySettings(room, me.id, patch || {});
    sync(room);
  });

  socket.on('custom', (spec, ack) => {
    const cb = ackOf(ack);
    if (!room || !me) return cb({ error: 'Join a room on your phone to add a question.' });
    const res = roomApi.addCustom(room, me.id, spec || {});
    cb(res);
    if (res.ok) sync(room);
  });

  socket.on('custom:remove', (id) => {
    if (!room || !me) return;
    const res = roomApi.removeCustom(room, me.id, id);
    if (res.ok) sync(room);
  });

  socket.on('kick', (id) => {
    if (!room || !me) return;
    const res = roomApi.kickPlayer(room, me.id, id);
    if (!res.ok) return;
    const sid = room.socketOf.get(id);
    const target = sid && io.sockets.sockets.get(sid);
    if (target) {
      target.emit('kicked', { reason: 'The host removed you from the room.' });
      target.leave(room.code);
      room.sockets.delete(target.id);
    }
    room.socketOf.delete(id);
    sync(room);
  });

  socket.on('start', (_data, ack) => {
    const cb = ackOf(ack);
    if (!room || !me) return cb({ error: 'Not in a room.' });
    if (room.hostId !== me.id) return cb({ error: 'Only the host can start.' });
    const res = roomApi.startGame(room);
    cb(res);
    if (res.ok) beginAnswer(room);
  });

  socket.on('answer', (data, ack) => {
    const cb = ackOf(ack);
    if (!room || !me) return cb({ error: 'Not playing.' });
    const res = roomApi.submitAnswer(room, me.id, data && data.value);
    cb(res);
    if (res.ok) {
      sync(room);
      maybeFinishAnswer(room);
    }
  });

  socket.on('unlock', (_data, ack) => {
    const cb = ackOf(ack);
    if (!room || !me) return cb({ error: 'Not playing.' });
    const res = roomApi.unlockAnswer(room, me.id);
    cb(res);
    if (!res.ok) return;
    if (room.phase === 'answer') {
      const ms = Math.max(scaled(2000), (room.deadline || 0) - Date.now());
      arm(room, ms, () => finishAnswer(room));
    }
    sync(room);
  });

  socket.on('judge', (data, ack) => {
    const cb = ackOf(ack);
    if (!room || !me) return cb({ error: 'Not playing.' });
    const res = roomApi.submitJudgment(room, me.id, data && data.ids);
    cb(res);
    if (res.ok) beginReveal(room);
  });

  socket.on('next', () => {
    if (!room || !me || room.hostId !== me.id) return;
    hostSkip(room);
  });

  socket.on('lobby', () => {
    if (!room || !me || room.hostId !== me.id) return;
    const res = roomApi.backToLobby(room);
    if (!res.ok) return;
    arm(room, 0);
    sync(room);
  });

  socket.on('react', (id) => {
    if (!room || typeof id !== 'string' || !REACTION_IDS.has(id)) return;
    const now = Date.now();
    if (socket.data.lastReact && now - socket.data.lastReact < REACT_COOLDOWN_MS) return;
    socket.data.lastReact = now;
    const emoji = REACTIONS.find((r) => r.id === id).emoji;
    io.to(room.code).emit('react', {
      id,
      emoji,
      from: me ? me.id : 'tv',
      nickname: me ? me.nickname : 'Big screen',
    });
  });

  socket.on('leave', () => drop(true));
  socket.on('disconnect', () => drop(false));

  function drop(intentional) {
    if (!room) return;
    const current = room;
    const player = me;
    const sid = socket.id;
    room = null;
    me = null;
    socket.leave(current.code);
    const viewer = current.sockets.get(sid);
    current.sockets.delete(sid);
    if (!player || !viewer || viewer.role === 'tv') {
      sync(current);
      cleanupMaybe(current);
      return;
    }
    if (current.socketOf.get(player.id) !== sid) return;
    current.socketOf.delete(player.id);
    roomApi.disconnectPlayer(current, player.id);
    if (intentional && current.phase === 'lobby') roomApi.releasePlayer(current, player.id);
    else scheduleRelease(current, player.id);
    if (current.phase === 'answer') maybeFinishAnswer(current);
    sync(current);
    cleanupMaybe(current);
  }
});

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`${GAME_NAME} on http://localhost:${PORT}`);
  });
}

module.exports = { app, server, io, rooms, GAME_NAME };
