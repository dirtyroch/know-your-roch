(function () {
  'use strict';

  const cfg = window.KYR_CONFIG || {
    name: 'Party game',
    tagline: 'Guess what they would say.',
    themeColor: '#ff7a3c',
    categories: [],
    limits: { minPlayers: 2, maxPlayers: 10, roundsMin: 1, roundsMax: 5, defaultRounds: 2, maxCustomEach: 3, maxText: 60 },
  };
  document.title = cfg.name;
  const apple = document.querySelector('meta[name="apple-mobile-web-app-title"]') || document.head.appendChild(Object.assign(document.createElement('meta'), { name: 'apple-mobile-web-app-title' }));
  apple.content = cfg.name;
  const theme = document.querySelector('meta[name="theme-color"]');
  if (theme && cfg.themeColor) theme.content = cfg.themeColor;

  const app = document.getElementById('app');
  const socket = window.io({ transports: ['websocket', 'polling'] });
  const SESSION = 'kyr-session';
  const store = {
    state: null,
    screen: 'home',
    error: '',
    paintKey: '',
    skew: 0,
    yield: false,
    watching: null,
    draft: {
      nickname: '',
      code: '',
      roundKey: '',
      text: '',
      choice: null,
      number: null,
      judge: new Set(),
    },
    installEvent: null,
  };

  function loadSession() {
    try { return JSON.parse(localStorage.getItem(SESSION) || 'null'); } catch { return null; }
  }
  function saveSession(data) {
    try { localStorage.setItem(SESSION, JSON.stringify(data)); } catch { /* ignore */ }
  }
  function clearSession() {
    try { localStorage.removeItem(SESSION); } catch { /* ignore */ }
  }
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function toast(message) {
    store.error = message || '';
    let el = document.querySelector('.toast');
    if (!message) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      app.prepend(el);
    }
    el.textContent = message;
  }

  function playerId() {
    const saved = loadSession();
    if (saved && saved.playerId) return saved.playerId;
    const id = `p${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`.slice(0, 40);
    return id;
  }

  function paintKey(s) {
    const ids = s.players.map((p) => p.id + (p.connected ? '1' : '0') + p.nickname).join(',');
    const answered = s.round && s.round.yourAnswer != null ? '1' : '0';
    const round = s.round ? `${s.phase}:${s.round.index}:${s.round.question.id}:${answered}` : s.phase;
    const settings = s.phase === 'lobby'
      ? `${s.settings.categories.join('.')}:${s.settings.roundsPerPlayer}:${s.settings.pace}:${s.customs.count}:${s.customs.mine.length}`
      : '';
    return [s.code, s.you, s.role, s.hostId, ids, round, settings].join('|');
  }

  function syncDraft(s) {
    if (!s || !s.round) return;
    const key = `${s.round.index}:${s.round.question.id}`;
    if (store.draft.roundKey === key) return;
    store.draft.roundKey = key;
    const q = s.round.question;
    const mine = s.round.yourAnswer;
    store.draft.text = q.type === 'text' && mine != null ? mine : '';
    store.draft.choice = (q.type === 'choice' || q.type === 'either' || q.type === 'who') ? (mine != null ? mine : null) : null;
    store.draft.number = q.type === 'number'
      ? (mine != null ? mine : Math.round((q.min + q.max) / 2))
      : null;
    store.draft.judge = new Set();
  }

  function soundbar() {
    const reactions = window.REACTIONS || [];
    const muted = window.Sfx && Sfx.muted;
    return `<div class="soundbar" role="toolbar" aria-label="Reactions">${reactions.map((r) =>
      `<button type="button" class="react" data-act="react" data-id="${esc(r.id)}" aria-label="${esc(r.label)}">${r.emoji}</button>`).join('')
    }<button type="button" class="react" data-act="mute" aria-label="${muted ? 'Unmute sounds' : 'Mute sounds'}" aria-pressed="${muted ? 'true' : 'false'}">${muted ? '🔇' : '🔊'}</button></div>`;
  }

  function shell(s) {
    const showTimer = s.deadline && (s.phase === 'answer' || s.phase === 'judge' || s.phase === 'reveal');
    return `<header class="topbar">
      <img class="top-mascot" src="/mascot.svg" alt="">
      <div><strong>${esc(s.gameName || cfg.name)}</strong><div class="sub">${esc(s.phase === 'lobby' ? 'Lobby' : phaseLabel(s))}</div></div>
      <div class="timer" ${showTimer ? '' : 'hidden'}>
        <div class="timer-track"><div data-timer-bar></div></div>
        <span data-timer>0</span>
      </div>
    </header>`;
  }
  function phaseLabel(s) {
    if (!s.round) return s.phase === 'final' ? 'Final' : '';
    return `Round ${s.round.index} / ${s.round.total}`;
  }

  function scoreStrip(s) {
    const list = s.players.slice().sort((a, b) => b.score - a.score || a.nickname.localeCompare(b.nickname));
    return `<ul class="scorestrip">${list.map((p) =>
      `<li data-player="${esc(p.id)}" class="${p.connected ? '' : 'off'}"><span class="dot" style="background:${esc(p.color)}"></span>${esc(p.nickname)} <span data-score>${p.score}</span>${p.streak >= 2 ? `<span class="streak">x${p.streak}</span>` : ''}</li>`).join('')}</ul>`;
  }

  function home() {
    const saved = loadSession();
    return `<section class="home">
      <img class="mascot" src="/mascot.svg" alt="">
      <p class="eyebrow">Phones in. No accounts.</p>
      <h1>${esc(cfg.name)}</h1>
      <p class="tag">${esc(cfg.tagline)}</p>
      ${store.error ? `<div class="toast">${esc(store.error)}</div>` : ''}
      <div class="stack">
        <button class="btn" type="button" data-act="goto" data-screen="create">Host a room</button>
        <button class="btn secondary" type="button" data-act="goto" data-screen="join">Join with a code</button>
        <button class="btn ghost" type="button" data-act="goto" data-screen="tv">Open a big screen</button>
      </div>
      ${saved && saved.code ? `<div class="card rejoin"><b>Jump back in</b><p>${esc(saved.nickname || 'You')} in room ${esc(saved.code)}</p><button class="btn" type="button" data-act="rejoin">Rejoin</button></div>` : ''}
      <p class="install" id="install-slot">${installCopy()}</p>
    </section>`;
  }
  function installCopy() {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    if (standalone) return 'You are in the app.';
    if (store.installEvent) return '<button class="btn ghost" type="button" data-act="install">Add to home screen</button>';
    const ios = /iP(hone|ad|od)/.test(navigator.userAgent);
    if (ios) return 'On iPhone: tap Share, then Add to Home Screen. It opens like an app.';
    return 'Add this page to your home screen and it opens like an app.';
  }

  function createScreen() {
    return `<section class="panel">
      <h1>Host</h1>
      <p class="tag">You get a 4-letter code. You are the host, and you play too.</p>
      ${store.error ? `<div class="toast">${esc(store.error)}</div>` : ''}
      <label class="field"><span>Your nickname</span>
        <input name="nickname" maxlength="16" autocomplete="nickname" enterkeyhint="go" value="${esc(store.draft.nickname)}" placeholder="Ada">
      </label>
      <div class="stack" style="margin-top:14px">
        <button class="btn" type="button" data-act="create">Make a room</button>
        <button class="btn ghost" type="button" data-act="goto" data-screen="home">Back</button>
      </div>
    </section>`;
  }
  function joinScreen() {
    return `<section class="panel">
      <h1>Join</h1>
      ${store.error ? `<div class="toast">${esc(store.error)}</div>` : ''}
      <label class="field"><span>Room code</span>
        <input name="code" maxlength="4" autocapitalize="characters" autocomplete="off" value="${esc(store.draft.code)}" placeholder="BIRD">
      </label>
      <label class="field" style="margin-top:12px"><span>Your nickname</span>
        <input name="nickname" maxlength="16" autocomplete="nickname" value="${esc(store.draft.nickname)}" placeholder="Bo">
      </label>
      <div class="stack" style="margin-top:14px">
        <button class="btn" type="button" data-act="join">Join the room</button>
        <button class="btn ghost" type="button" data-act="goto" data-screen="home">Back</button>
      </div>
    </section>`;
  }
  function tvScreen() {
    return `<section class="panel">
      <h1>Big screen</h1>
      <p class="tag">Put this on the TV. Phones still answer in secret.</p>
      ${store.error ? `<div class="toast">${esc(store.error)}</div>` : ''}
      <label class="field"><span>Room code</span>
        <input name="code" maxlength="4" autocapitalize="characters" autocomplete="off" value="${esc(store.draft.code)}" placeholder="BIRD">
      </label>
      <div class="stack" style="margin-top:14px">
        <button class="btn" type="button" data-act="watch">Show the room</button>
        <button class="btn ghost" type="button" data-act="goto" data-screen="home">Back</button>
      </div>
    </section>`;
  }

  function lobby(s) {
    const host = s.you && s.you === s.hostId;
    const tiles = s.code.split('').map((ch) => `<div class="code-tile">${esc(ch)}</div>`).join('');
    const connected = s.players.filter((p) => p.connected).length;
    return `${shell(s)}<main class="main">
      <p class="eyebrow" style="text-align:center">Room code</p>
      <div class="code-row">${tiles}</div>
      <div class="actions">
        <button class="btn small" type="button" data-act="copy">Copy invite link</button>
        <a class="btn small" href="/tv/${esc(s.code)}" target="_blank" rel="noopener">Big screen</a>
      </div>
      <section class="card">
        <h2>Players <span class="sub">${connected} / ${s.limits.maxPlayers}</span></h2>
        <ul class="players">${s.players.map((p) => `<li class="player ${p.connected ? '' : 'off'}" data-player="${esc(p.id)}">
          <span class="dot" style="background:${esc(p.color)}"></span>
          <span>${p.emoji} ${esc(p.nickname)}${p.host ? ' · host' : ''}${p.id === s.you ? ' · you' : ''}</span>
          ${host && !p.host ? `<button class="kick" type="button" data-act="kick" data-id="${esc(p.id)}" aria-label="Remove ${esc(p.nickname)}">✕</button>` : ''}
        </li>`).join('') || '<li>Waiting for phones…</li>'}</ul>
        <p class="hint">Same nickname on refresh hops back into your seat. Need ${s.limits.minPlayers} to start. Up to ${s.limits.maxPlayers}.</p>
      </section>
      ${host ? settingsCard(s) : `<section class="card"><h2>Waiting on the host</h2><p>${esc((s.players.find((p) => p.host) || {}).nickname || 'The host')} picks the categories.</p></section>`}
      ${s.role === 'tv' ? '' : customCard(s)}
      <button class="btn ghost" type="button" data-act="leave" style="margin-top:8px">Leave</button>
    </main>
    ${host ? `<div class="go-bar"><button class="btn" type="button" data-act="start" ${connected >= s.limits.minPlayers ? '' : 'disabled'}>${connected >= s.limits.minPlayers ? 'Start the game' : 'Need 2 players to start'}</button></div>` : ''}
    ${soundbar()}`;
  }

  function settingsCard(s) {
    const cats = (s.catalog || cfg.categories).map((c) => {
      const on = s.settings.categories.includes(c.id);
      return `<button type="button" class="chip ${on ? 'on' : ''}" data-act="cat" data-id="${esc(c.id)}" aria-pressed="${on}"><b>${esc(c.label)}</b><small>${esc(c.blurb)}</small></button>`;
    }).join('');
    const paces = ['chill', 'normal', 'hasty'].map((p) =>
      `<button type="button" class="btn small ${s.settings.pace === p ? 'secondary' : 'ghost'}" data-act="pace" data-pace="${p}">${p}</button>`).join('');
    return `<section class="card">
      <h2>Categories</h2>
      <div class="cats">${cats}</div>
      <div class="stepper" style="margin-top:14px">
        <button class="btn small" type="button" data-act="rounds" data-delta="-1" aria-label="Fewer rounds">−</button>
        <div><span class="sub">Rounds per player</span><b>${s.settings.roundsPerPlayer}</b></div>
        <button class="btn small" type="button" data-act="rounds" data-delta="1" aria-label="More rounds">+</button>
      </div>
      <div class="paces" style="margin-top:12px">${paces}</div>
    </section>`;
  }

function customCard(s, compact) {
  const mine = s.customs.mine.map((c) =>
    `<li>${esc(c.prompt)} <button class="kick" type="button" data-act="drop-custom" data-id="${esc(c.id)}" aria-label="Remove question">✕</button></li>`).join('');
  const heading = compact ? '' : '<h2>Write a question</h2>';
  const body = `
      ${heading}
      <p class="hint">It shows up as “question by you.” Up to ${s.limits.maxCustomEach}. You can add them while you wait, too.</p>
      <form id="custom-form">
        <label class="field"><span>Type</span>
          <select name="ctype">
            <option value="either">This or that</option>
            <option value="choice">Multiple choice</option>
            <option value="number">Number guess</option>
            <option value="who">Who in this room</option>
            <option value="text">Short free answer</option>
          </select>
        </label>
        <label class="field" style="margin-top:10px"><span>Prompt. Use {{name}} for the hot seat.</span>
          <textarea name="cprompt" maxlength="${s.limits.maxPrompt || 110}" placeholder="What would {{name}} put on a pancake?"></textarea>
        </label>
        <div data-for="choice either">
          ${[0, 1, 2, 3].map((i) => `<label class="field optline" data-opt="${i}" style="margin-top:8px"><span>Choice ${i + 1}</span><input name="copt" maxlength="32"></label>`).join('')}
        </div>
        <div data-for="number" class="row" style="margin-top:8px">
          <label class="field"><span>Low</span><input name="cmin" type="number" value="0"></label>
          <label class="field"><span>High</span><input name="cmax" type="number" value="10"></label>
          <label class="field"><span>Unit</span><input name="cunit" maxlength="18" placeholder="hours"></label>
        </div>
        <button class="btn secondary" type="submit" style="margin-top:12px">Add question</button>
      </form>
${mine ? `<ul class="players" style="flex-direction:column;align-items:stretch">${mine}</ul>` : `<p class="hint">${s.customs.count} waiting in the deck.</p>`}
  `;
  if (compact) return `<details class="card"><summary>Write a question while you wait</summary>${body}</details>`;
  return `<section class="card">${body}</section>`;
}

  function questionBlock(s) {
    const q = s.round.question;
    const credit = q.byName ? `<p class="credit">question by ${esc(q.byName)}</p>` : '';
    return `<p class="eyebrow">${esc(q.categoryLabel || '')}</p>
      <div class="hot">Hot seat · ${esc(s.round.hotSeat.emoji || '')} ${esc(s.round.hotSeat.nickname)}</div>
      <h2 class="prompt">${esc(q.prompt)}</h2>
      ${credit}`;
  }

  function answer(s) {
    if (s.role === 'tv') return tvAnswer(s);
    const q = s.round.question;
    const locked = s.round.yourAnswer != null;
    let controls = '';
    if (locked) {
      controls = `<div class="you-note locked-note">Locked in: <b>${esc(labelMine(s))}</b>
        <button class="btn ghost" type="button" data-act="unlock" style="margin-top:10px">Wait, change it</button></div>`;
    } else if (q.type === 'number') {
      controls = `<div class="num-read" data-num>${esc(String(store.draft.number))} ${esc(q.unit || '')}</div>
        <input class="range" type="range" min="${q.min}" max="${q.max}" step="1" value="${store.draft.number}" data-field="number" aria-label="${esc(q.unit || 'Number')}">
        <button class="btn" type="button" data-act="lock">Lock in</button>`;
    } else if (q.type === 'text') {
      controls = `<label class="field"><span>${s.round.youAreHot ? 'Your secret answer' : 'What will they say?'}</span>
        <input data-field="text" maxlength="${cfg.limits.maxText || 60}" placeholder="${esc(q.placeholder || 'A few words')}" value="${esc(store.draft.text)}"></label>
        <button class="btn" type="button" data-act="lock" style="margin-top:10px">Lock in</button>`;
    } else {
      const grid = q.type === 'who' ? 'who-grid' : 'opts';
      controls = `<div class="${grid}">${optionButtons(q, store.draft.choice)}</div>
        <button class="btn" type="button" data-act="lock" style="margin-top:12px">Lock in</button>`;
    }
    const note = s.round.youAreHot
      ? 'This stays secret until the reveal.'
      : `Guess what ${esc(s.round.hotSeat.nickname)} will say.`;
    return `${shell(s)}<main class="main">
      ${scoreStrip(s)}
      ${questionBlock(s)}
      <p class="you-note">${note}</p>
      <div class="card">${controls}</div>
      ${waiting(s)}
      ${locked && s.role !== 'tv' ? customCard(s, true) : ''}
      ${s.you === s.hostId ? '<button class="btn ghost" type="button" data-act="next">Skip ahead</button>' : ''}
    </main>${soundbar()}`;
  }

  function optionButtons(q, selected) {
    if (q.type === 'who') {
      return q.options.map((o) => `<button type="button" class="opt ${selected === o.id ? 'on' : ''}" data-act="pick" data-value="${esc(o.id)}">${esc(o.label)}</button>`).join('');
    }
    return q.options.map((label, i) => `<button type="button" class="opt ${Number(selected) === i ? 'on' : ''}" data-act="pick" data-value="${i}">${esc(label)}</button>`).join('');
  }
  function labelMine(s) {
    const q = s.round.question;
    const v = s.round.yourAnswer;
    if (q.type === 'choice' || q.type === 'either') return q.options[v] || '';
    if (q.type === 'who') return (q.options.find((o) => o.id === v) || {}).label || '';
    if (q.type === 'number') return `${v} ${q.unit || ''}`.trim();
    return v;
  }
  function waiting(s) {
    const locked = new Set(s.round.lockedIds);
    return `<ul class="players">${s.players.map((p) =>
      `<li class="player ${locked.has(p.id) ? '' : 'off'}" data-wait="${esc(p.id)}">${p.emoji} ${esc(p.nickname)} · <span data-status>${locked.has(p.id) ? 'in' : 'thinking'}</span></li>`).join('')}</ul>`;
  }
  function tvAnswer(s) {
    return `${shell(s)}<main class="main">
      ${scoreStrip(s)}
      ${questionBlock(s)}
      <p class="you-note">Phones are answering. Nothing secret shows up here yet.</p>
      ${waiting(s)}
    </main>${soundbar()}`;
  }

  function judge(s) {
    const guesses = (s.round.judge && s.round.judge.guesses) || [];
    const cards = guesses.map((g) => {
      const on = store.draft.judge.has(g.id);
      if (s.round.youAreHot && s.role !== 'tv') {
        return `<button type="button" class="opt ${on ? 'on' : ''}" data-act="mark" data-id="${esc(g.id)}"><span class="who">${esc(g.nickname)} guessed</span><br>${esc(g.label)}</button>`;
      }
      return `<div class="guess-card"><div class="who">${esc(g.nickname)}</div><div class="said">${esc(g.label)}</div></div>`;
    }).join('');
    const help = s.round.youAreHot
      ? 'Tap every guess that counts as right, then confirm. Close enough is fair game.'
      : `${esc(s.round.hotSeat.nickname)} is deciding which guesses count.`;
    return `${shell(s)}<main class="main">
      ${questionBlock(s)}
      <p class="you-note">${help}</p>
      <div class="opts">${cards || '<p>No guesses came in.</p>'}</div>
      ${s.round.youAreHot && s.role !== 'tv' ? '<button class="btn" type="button" data-act="judge" style="margin-top:12px">These count</button>' : ''}
      ${!s.round.youAreHot && s.role !== 'tv' ? customCard(s, true) : ''}
      ${s.you === s.hostId ? '<button class="btn ghost" type="button" data-act="next">Skip ahead</button>' : ''}
    </main>${soundbar()}`;
  }

  function reveal(s) {
    const rev = s.round.reveal;
    if (!rev || rev.skipped) {
      return `${shell(s)}<main class="main">
        ${questionBlock(s)}
        <div class="card skip-note">${esc((rev && rev.message) || 'No points this round.')}</div>
        ${s.you === s.hostId ? '<button class="btn" type="button" data-act="next">Next</button>' : ''}
      </main>${soundbar()}`;
    }
    const cards = rev.guesses.map((g, i) => `<article class="guess-card ${g.correct ? 'correct' : 'miss'}" style="--i:${i}">
      <div class="who">${g.emoji || ''} ${esc(g.nickname)}</div>
      <div class="said">${esc(g.label)}</div>
      <div class="pts">${g.correct ? `+${g.points}` : 'miss'}${g.bonus ? ` · streak +${g.bonus}` : ''}${g.streak >= 2 && g.correct ? ` · x${g.streak}` : ''}</div>
    </article>`).join('');
    return `${shell(s)}<main class="main">
      <div class="stage play" id="stage">
        ${questionBlock(s)}
        ${cards}
        <div class="truth"><span>${esc(s.round.hotSeat.nickname)} said</span><strong>${esc(rev.truthLabel)}</strong></div>
      </div>
      ${s.role !== 'tv' ? customCard(s, true) : ''}
      ${s.you === s.hostId ? '<button class="btn" type="button" data-act="next">Next round</button>' : ''}
    </main>${soundbar()}`;
  }

  function finalScreen(s) {
    const places = s.final.podium;
    const byRank = (rank) => places.filter((p) => p.rank === rank);
    const block = (rank, cls) => byRank(rank).map((p) => `<div class="place ${cls}"><div>${p.emoji || ''}</div><div>${esc(p.nickname)}</div><div class="score">${p.score}</div><div>#${rank}</div></div>`).join('');
    const awards = s.final.awards.map((a) => {
      const who = a.guessers.length ? a.guessers.map((g) => esc(g.nickname)).join(' & ') : 'Nobody landed one yet';
      return `<div class="award"><div><b>${esc(a.subjectName)}</b><div class="sub">Knows you best</div></div><div>${who}${a.correct ? ` · ${a.correct} right` : ''}</div></div>`;
    }).join('');
    return `${shell(s)}<main class="main">
      <p class="eyebrow">That is the game</p>
      <h2 class="prompt">The podium</h2>
      <div class="podium">${block(2, 'second')}${block(1, 'first')}${block(3, 'third')}</div>
      <section class="card"><h2>Knows You Best</h2>${awards}</section>
      ${s.you === s.hostId ? '<button class="btn" type="button" data-act="again">Play again</button>' : '<p class="hint">The host can start another round.</p>'}
      <button class="btn ghost" type="button" data-act="leave">Leave</button>
    </main>${soundbar()}`;
  }

  function renderRoom(s) {
    document.body.classList.toggle('tv', s.role === 'tv');
    if (s.phase === 'lobby') return lobby(s);
    if (s.phase === 'answer') return answer(s);
    if (s.phase === 'judge') return judge(s);
    if (s.phase === 'reveal') return reveal(s);
    if (s.phase === 'final') return finalScreen(s);
    return `${shell(s)}<main class="main"><p>One moment…</p></main>`;
  }

  function renderLocal() {
    document.body.classList.remove('tv');
    if (store.screen === 'create') return createScreen();
    if (store.screen === 'join') return joinScreen();
    if (store.screen === 'tv') return tvScreen();
    return home();
  }

  let revealTimer = null;
  let revealGen = 0;
  function render() {
    const s = store.state;
    if (!s) {
      store.paintKey = '';
      app.innerHTML = renderLocal();
      bindCustomForm();
      return;
    }
    syncDraft(s);
    const key = paintKey(s);
    if (key === store.paintKey) {
      patch(s);
      return;
    }
    store.paintKey = key;
    app.innerHTML = renderRoom(s);
    window.scrollTo(0, 0);
    bindCustomForm();
    tick();
    if (s.phase === 'reveal' && s.round && s.round.reveal && !s.round.reveal.skipped) cueReveal(s);
    if (s.phase === 'final') burst(90);
  }

  function patch(s) {
    if (!s.round) return;
    const locked = new Set(s.round.lockedIds || []);
    document.querySelectorAll('[data-wait]').forEach((el) => {
      const id = el.dataset.wait;
      const status = el.querySelector('[data-status]');
      const inNow = locked.has(id);
      el.classList.toggle('off', !inNow);
      if (status) status.textContent = inNow ? 'in' : 'thinking';
    });
    document.querySelectorAll('[data-score]').forEach((el) => {
      const row = el.closest('[data-player]');
      const p = row && s.players.find((x) => x.id === row.dataset.player);
      if (p) el.textContent = p.score;
    });
  }

  function cueReveal(s) {
    if (revealTimer) clearTimeout(revealTimer);
    const gen = ++revealGen;
    const n = s.round.reveal.guesses.length;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const truthAt = reduce ? 0 : 600 + n * 480;
    const stage = document.getElementById('stage');
    if (reduce && stage) {
      stage.classList.add('show-truth', 'show-scores');
      return;
    }
    if (window.Sfx && !Sfx.muted) Sfx.drumroll();
    revealTimer = setTimeout(() => {
      if (gen !== revealGen) return;
      stage && stage.classList.add('show-truth');
      if (window.Sfx && !Sfx.muted) Sfx.tada();
      setTimeout(() => {
        if (gen !== revealGen) return;
        stage && stage.classList.add('show-scores');
        const mine = s.round.reveal.guesses.find((g) => g.id === s.you);
        if (mine && mine.correct) burst(36);
      }, 650);
    }, truthAt);
  }

  function burst(count) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'confetti';
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    const colors = ['#e23d1b', '#ffc857', '#0f8f86', '#4c3fd0', '#fffdf8', '#ff8fab'];
    const bits = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: -20 - Math.random() * h * 0.5,
      r: 4 + Math.random() * 7,
      v: 2.2 + Math.random() * 3.4,
      spin: (Math.random() - 0.5) * 0.2,
      a: Math.random() * 6,
      color: colors[Math.floor(Math.random() * colors.length)],
    }));
    let frame = 0;
    function step() {
      ctx.clearRect(0, 0, w, h);
      for (const b of bits) {
        b.y += b.v;
        b.a += b.spin;
        b.x += Math.sin(b.a) * 1.1;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.a);
        ctx.fillStyle = b.color;
        ctx.fillRect(-b.r / 2, -b.r / 2, b.r, b.r * 0.55);
        ctx.restore();
      }
      frame += 1;
      if (frame < 180) requestAnimationFrame(step);
      else canvas.remove();
    }
    step();
  }

  function tick() {
    const s = store.state;
    const label = document.querySelector('[data-timer]');
    const bar = document.querySelector('[data-timer-bar]');
    if (!s || !label || !s.deadline) return;
    const left = Math.max(0, s.deadline - (Date.now() + store.skew));
    label.textContent = String(Math.ceil(left / 1000));
    if (bar && s.duration) bar.style.transform = `scaleX(${Math.max(0, Math.min(1, left / s.duration))})`;
  }
  setInterval(tick, 200);

  function readFields() {
    const nick = document.querySelector('input[name="nickname"]');
    const code = document.querySelector('input[name="code"]');
    if (nick) store.draft.nickname = nick.value;
    if (code) store.draft.code = code.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  }

  function bindCustomForm() {
    const form = document.getElementById('custom-form');
    if (!form) return;
    const sync = () => {
      const type = form.querySelector('[name="ctype"]').value;
      form.querySelectorAll('[data-for]').forEach((el) => {
        el.hidden = !el.dataset.for.split(' ').includes(type);
      });
      form.querySelectorAll('[data-opt]').forEach((el) => {
        const i = Number(el.dataset.opt);
        el.hidden = type === 'either' ? i > 1 : type !== 'choice';
      });
    };
    form.querySelector('[name="ctype"]').addEventListener('change', sync);
    sync();
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const type = form.querySelector('[name="ctype"]').value;
      const spec = {
        type,
        prompt: form.querySelector('[name="cprompt"]').value,
        options: [...form.querySelectorAll('[name="copt"]')].map((el) => el.value),
        min: Number(form.querySelector('[name="cmin"]').value),
        max: Number(form.querySelector('[name="cmax"]').value),
        unit: form.querySelector('[name="cunit"]').value,
      };
      if (type === 'either') spec.options = spec.options.slice(0, 2);
      socket.emit('custom', spec, (res) => {
        if (res && res.error) toast(res.error);
        else toast('');
      });
    });
  }

  function currentValue() {
    const q = store.state.round.question;
    if (q.type === 'text') {
      const field = document.querySelector('[data-field="text"]');
      return field ? field.value : store.draft.text;
    }
    if (q.type === 'number') return Number(store.draft.number);
    return store.draft.choice;
  }

  app.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'goto') {
      readFields();
      store.screen = btn.dataset.screen;
      store.error = '';
      store.state = null;
      render();
      return;
    }
    if (act === 'create') return createRoom();
    if (act === 'join' || act === 'rejoin') return joinRoom(act === 'rejoin');
    if (act === 'watch') return watchRoom();
    if (act === 'install' && store.installEvent) {
      store.installEvent.prompt();
      store.installEvent = null;
      return;
    }
    if (act === 'copy') return copyInvite();
    if (act === 'leave') {
      socket.emit('leave');
      clearSession();
      store.state = null;
      store.watching = null;
      store.screen = 'home';
      history.pushState({}, '', '/');
      render();
      return;
    }
    if (!store.state) return;
    if (act === 'cat') return toggleCat(btn.dataset.id);
    if (act === 'rounds') return changeRounds(Number(btn.dataset.delta));
    if (act === 'pace') return socket.emit('settings', { pace: btn.dataset.pace });
    if (act === 'kick') return socket.emit('kick', btn.dataset.id);
    if (act === 'drop-custom') return socket.emit('custom:remove', btn.dataset.id);
    if (act === 'start') return socket.emit('start', {}, (res) => { if (res && res.error) toast(res.error); });
    if (act === 'pick') {
      const q = store.state.round.question;
      store.draft.choice = q.type === 'who' ? btn.dataset.value : Number(btn.dataset.value);
      document.querySelectorAll('.opt').forEach((el) => el.classList.toggle('on', el === btn));
      return;
    }
    if (act === 'lock') return lockIn();
    if (act === 'unlock') return socket.emit('unlock', {}, (res) => { if (res && res.error) toast(res.error); });
    if (act === 'mark') {
      const id = btn.dataset.id;
      if (store.draft.judge.has(id)) store.draft.judge.delete(id);
      else store.draft.judge.add(id);
      btn.classList.toggle('on');
      return;
    }
    if (act === 'judge') {
      return socket.emit('judge', { ids: [...store.draft.judge] }, (res) => { if (res && res.error) toast(res.error); });
    }
    if (act === 'next') return socket.emit('next');
    if (act === 'again') return socket.emit('lobby');
    if (act === 'react') {
      socket.emit('react', btn.dataset.id);
      if (window.Sfx) Sfx.unlock();
      return;
    }
    if (act === 'mute' && window.Sfx) {
      const on = Sfx.toggle();
      btn.textContent = on ? '🔊' : '🔇';
      btn.setAttribute('aria-pressed', on ? 'false' : 'true');
      btn.setAttribute('aria-label', on ? 'Mute sounds' : 'Unmute sounds');
    }
  });

  app.addEventListener('input', (event) => {
    const field = event.target.dataset.field;
    if (field === 'text') store.draft.text = event.target.value;
    if (field === 'number') {
      store.draft.number = Number(event.target.value);
      const read = document.querySelector('[data-num]');
      const unit = store.state && store.state.round ? store.state.round.question.unit : '';
      if (read) read.textContent = `${store.draft.number} ${unit || ''}`.trim();
    }
    if (event.target.name === 'nickname' || event.target.name === 'code') readFields();
  });

  function lockIn() {
    const value = currentValue();
    socket.emit('answer', { value }, (res) => {
      if (res && res.error) toast(res.error);
      else if (window.Sfx && !Sfx.muted) Sfx.lock();
    });
  }
  function toggleCat(id) {
    const s = store.state;
    const has = s.settings.categories.includes(id);
    let categories = has ? s.settings.categories.filter((c) => c !== id) : s.settings.categories.concat(id);
    if (!categories.length) return toast('Keep at least one category.');
    toast('');
    socket.emit('settings', { categories });
  }
  function changeRounds(delta) {
    const s = store.state;
    const next = s.settings.roundsPerPlayer + delta;
    if (next < s.limits.roundsMin || next > s.limits.roundsMax) return;
    socket.emit('settings', { roundsPerPlayer: next });
  }
  async function copyInvite() {
    const link = `${location.origin}/r/${store.state.code}`;
    try {
      await navigator.clipboard.writeText(link);
      toast('Invite link copied.');
    } catch {
      toast(link);
    }
  }

  function createRoom() {
    readFields();
    const nickname = store.draft.nickname.trim();
    if (!nickname) return fail('Pick a nickname first.');
    socket.emit('create', { nickname, playerId: playerId() }, (res) => {
      if (!res || res.error) return fail(res && res.error);
      saveSession({ playerId: res.you, nickname, code: res.code });
      history.pushState({}, '', `/r/${res.code}`);
      store.error = '';
    });
  }
  function joinRoom(fromSaved) {
    readFields();
    const saved = loadSession() || {};
    const code = (fromSaved ? saved.code : store.draft.code).toUpperCase();
    const nickname = (fromSaved ? saved.nickname : store.draft.nickname).trim();
    if (!nickname) return fail('Pick a nickname first.');
    if (!/^[A-Z]{4}$/.test(code)) return fail('Enter the 4-letter code.');
    socket.emit('join', { code, nickname, playerId: saved.playerId || playerId() }, (res) => {
      if (!res || res.error) return fail(res && res.error);
      saveSession({ playerId: res.you, nickname, code: res.code });
      history.pushState({}, '', `/r/${res.code}`);
      store.error = '';
      store.watching = null;
    });
  }
  function watchRoom(codeFromPath) {
    readFields();
    const code = (codeFromPath || store.draft.code || '').toUpperCase();
    if (!/^[A-Z]{4}$/.test(code)) return fail('Enter the 4-letter code.');
    store.watching = code;
    socket.emit('watch', { code }, (res) => {
      if (!res || res.error) return fail(res && res.error);
      history.pushState({}, '', `/tv/${code}`);
      store.error = '';
    });
  }
  function fail(message) {
    store.error = message || 'Try that again.';
    if (!store.state) render();
    else toast(store.error);
  }

  let booted = false;
  function boot() {
    if (store.yield) return;
    const parts = location.pathname.split('/').filter(Boolean);
    if (parts[0] === 'tv') {
      store.screen = 'tv';
      if (parts[1]) watchRoom(parts[1].toUpperCase());
      else render();
      return;
    }
    if (parts[0] === 'r' && parts[1]) {
      const code = parts[1].toUpperCase();
      store.draft.code = code;
      const saved = loadSession();
      if (saved && saved.nickname && (!saved.code || saved.code === code)) {
        store.draft.nickname = saved.nickname;
        app.innerHTML = `<section class="panel"><h1>${esc(cfg.name)}</h1><p class="tag">Joining ${esc(code)}…</p></section>`;
        joinRoom(false);
        return;
      }
      store.screen = 'join';
      render();
      return;
    }
    store.screen = 'home';
    render();
  }

  socket.on('connect', () => {
    if (!booted) {
      booted = true;
      boot();
      return;
    }
    if (store.yield) return;
    if (store.watching) {
      socket.emit('watch', { code: store.watching });
      return;
    }
    const saved = loadSession();
    if (saved && saved.code && saved.nickname) socket.emit('join', saved);
  });
  socket.on('state', (s) => {
    const prev = store.state && store.state.phase;
    store.state = s;
    store.skew = (s.serverNow || Date.now()) - Date.now();
    if (s.you) {
      const nick = (s.players.find((p) => p.id === s.you) || {}).nickname;
      saveSession({ playerId: s.you, nickname: nick || (loadSession() || {}).nickname, code: s.code });
    }
    render();
    if (prev && prev !== s.phase && s.phase === 'final' && window.Sfx && !Sfx.muted) Sfx.winner();
    if (prev && prev !== s.phase && s.phase === 'answer' && window.Sfx && !Sfx.muted) Sfx.pop();
  });
  socket.on('react', (payload) => {
    if (window.Sfx) Sfx.playReaction(payload.id);
    const el = document.createElement('div');
    el.className = 'floater';
    el.textContent = payload.emoji;
    el.style.left = `${12 + Math.random() * 70}%`;
    document.getElementById('floats').appendChild(el);
    setTimeout(() => el.remove(), 1500);
  });
  socket.on('kicked', (payload) => {
    store.yield = true;
    store.state = null;
    store.watching = null;
    clearSession();
    store.screen = 'home';
    store.error = (payload && payload.reason) || 'You left the room.';
    history.pushState({}, '', '/');
    render();
  });
  socket.on('disconnect', () => {
    if (store.state) toast('Reconnecting…');
  });

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    store.installEvent = event;
    if (!store.state && store.screen === 'home') render();
  });
  window.addEventListener('popstate', () => {
    store.state = null;
    store.paintKey = '';
    boot();
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
})();
