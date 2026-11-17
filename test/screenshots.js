'use strict';

const fs = require('node:fs');
const puppeteer = require('puppeteer-core');
const { io } = require('socket.io-client');

const BASE = process.env.BASE || 'http://127.0.0.1:4877';
const OUT = '/opt/cursor/artifacts';
fs.mkdirSync(OUT, { recursive: true });

function legal(question, players) {
  if (question.type === 'choice' || question.type === 'either') return 0;
  if (question.type === 'number') return question.min;
  if (question.type === 'who') return players[0].id;
  return 'pancakes';
}

async function shot(page, name) {
  const file = `${OUT}/${name}.png`;
  await page.screenshot({ path: file, fullPage: false });
  console.log('shot', file);
}

async function clickAct(page, act) {
  return page.evaluate((action) => {
    const el = document.querySelector(`[data-act="${action}"]`);
    if (!el || el.disabled) return false;
    el.scrollIntoView({ block: 'center' });
    el.click();
    return true;
  }, act);
}

(async () => {
  const errors = [];
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  page.on('pageerror', (err) => errors.push(String(err)));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.waitForSelector('h1');
  const title = await page.$eval('h1', (el) => el.textContent);
  console.log('title', title);
  await shot(page, '01-home-phone');

  await clickAct(page, 'goto');
  await page.waitForSelector('input[name="nickname"]');
  await page.type('input[name="nickname"]', 'Ada');
  await clickAct(page, 'create');
  await page.waitForFunction(() => document.body.textContent.includes('Room code') || document.querySelector('.code-tile'));
  const code = await page.$$eval('.code-tile', (els) => els.map((el) => el.textContent).join(''));
  console.log('code', code);
  await shot(page, '02-lobby-phone');

  const guest = io(BASE, { transports: ['websocket'] });
  await new Promise((resolve) => guest.on('connect', resolve));
  const joined = await new Promise((resolve) => guest.emit('join', { code, nickname: 'Bo', playerId: 'player-bo-shot' }, resolve));
  if (!joined.ok) throw new Error(joined.error || 'join failed');
  guest.on('state', (s) => {
    guest._state = s;
    if (s.phase === 'answer' && s.round && s.round.yourAnswer == null && guest._sent !== s.round.index) {
      guest._sent = s.round.index;
      guest.emit('answer', { value: legal(s.round.question, s.players) });
    }
    if (s.phase === 'judge' && s.round && s.round.youAreHot && guest._judged !== s.round.index) {
      guest._judged = s.round.index;
      guest.emit('judge', { ids: (s.round.judge.guesses || []).map((g) => g.id) });
    }
  });
  await page.waitForFunction(() => document.body.textContent.includes('Bo'));
  await shot(page, '03-lobby-two');
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.body.textContent.includes('Ada') && document.body.textContent.includes('Bo'), { timeout: 8000 });
  console.log('rejoined after refresh');

  // one round each, so the podium arrives quickly
  await page.evaluate(() => {
    const el = document.querySelector('[data-act="rounds"][data-delta="-1"]');
    if (el) el.click();
  });
  await clickAct(page, 'start');
  await page.waitForSelector('.prompt', { timeout: 8000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, '04-answer-phone');

  async function playTurn() {
    if (await page.$('.opt')) await clickAct(page, 'pick');
    else if (await page.$('[data-field="text"]')) await page.type('[data-field="text"]', 'pancakes');
    if (await page.$('[data-act="lock"]')) await clickAct(page, 'lock');
    if (await page.$('[data-act="mark"]')) {
      await clickAct(page, 'mark');
      await clickAct(page, 'judge');
    }
  }

  for (let i = 0; i < 8; i++) {
    const phase = await page.evaluate(() => {
      const t = document.body.innerText;
      if (t.includes('The podium')) return 'final';
      if (t.includes('said') && document.querySelector('.truth')) return 'reveal';
      if (document.querySelector('[data-act="judge"]')) return 'judge';
      if (document.querySelector('[data-act="lock"]') || document.querySelector('[data-act="unlock"]')) return 'answer';
      return 'other';
    });
    console.log('phase', phase);
    if (phase === 'final') break;
    if (phase === 'answer' || phase === 'judge') await playTurn();
    if (phase === 'reveal') {
      await page.waitForSelector('.stage.show-scores, .skip-note', { timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollTo(0, 0));
      await shot(page, '05-reveal-phone');
      await page.waitForSelector('[data-act="next"]', { timeout: 8000 });
      await clickAct(page, 'next');
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  await page.waitForFunction(() => document.body.innerText.includes('The podium'), { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 400));
  await shot(page, '06-podium-phone');

  const tv = await browser.newPage();
  await tv.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  await tv.goto(`${BASE}/tv/${code}`, { waitUntil: 'networkidle0' });
  await tv.waitForFunction(() => document.body.innerText.includes('podium') || document.querySelector('.code-tile') || document.body.innerText.includes('Knows'), { timeout: 8000 });
  await shot(tv, '07-tv-desktop');

  guest.close();
  console.log('errors', errors);
  await browser.close();
  if (errors.length) process.exitCode = 1;
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
