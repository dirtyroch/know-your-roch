'use strict';

/**
 * The game's display name. Change it here and nowhere else —
 * the server, manifest, and pages all read this constant.
 */
const GAME_NAME = 'Know Your Roch';

const GAME_TAGLINE = 'Guess what they would say. Prove you know your people.';

const THEME_COLOR = '#ff7a3c';
const BACKGROUND_COLOR = '#fff4e8';

const CATEGORIES = [
  { id: 'favorites', label: 'Favorites', blurb: 'The hills they will cheerfully die on.' },
  { id: 'food', label: 'Food', blurb: 'Snacks, breakfasts, and strongly held condiments.' },
  { id: 'childhood', label: 'Childhood', blurb: 'Recess, lost teeth, and stories that get retold.' },
  { id: 'rather', label: 'Would They Rather', blurb: 'Two doors. One very confident answer.' },
  { id: 'habits', label: 'Habits & Quirks', blurb: 'The little things they do without noticing.' },
  { id: 'faith', label: 'Faith & Family', blurb: 'Traditions, kindness, and who feels like home.' },
  { id: 'embarrassing', label: 'Embarrassing', blurb: 'Silly slips only. Still family-friendly.' },
  { id: 'dreams', label: 'Dreams & Future', blurb: 'Someday plans, big and pocket-sized.' },
  { id: 'who', label: "Who's Most Likely", blurb: 'Point at someone in this very room.' },
];

const LIMITS = {
  minPlayers: 2,
  maxPlayers: 10,
  roundsMin: 1,
  roundsMax: 5,
  defaultRounds: 2,
  maxNickname: 16,
  maxPrompt: 110,
  maxOption: 32,
  maxText: 60,
  maxCustomEach: 3,
  codeLength: 4,
};

const POINTS = {
  correct: 100,
  streakStep: 50,
  streakCap: 200,
};

/** Seconds, before pace and TIME_SCALE. */
const TIMING = {
  answer: 50,
  judge: 32,
  revealBase: 5.2,
  revealEach: 0.55,
  revealMax: 16,
};

const PACES = {
  chill: 1.45,
  normal: 1,
  hasty: 0.7,
};

const AVATARS = ['🐦', '🌟', '🍯', '🌙', '🎈', '🍀', '☀️', '🎵', '🧡', '🦋'];
const COLORS = ['#e23d1b', '#e09f00', '#0f8f86', '#d4537e', '#6c5ce7', '#e07a3d', '#1a7fa8', '#c2410c', '#5c8f12', '#b4234a'];

const CODE_CHARS = 'BCDFGHJKLMNPQRSTVWXZ';

module.exports = {
  GAME_NAME,
  GAME_TAGLINE,
  THEME_COLOR,
  BACKGROUND_COLOR,
  CATEGORIES,
  LIMITS,
  POINTS,
  TIMING,
  PACES,
  AVATARS,
  COLORS,
  CODE_CHARS,
};
