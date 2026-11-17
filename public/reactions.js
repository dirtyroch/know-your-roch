// Reaction soundboard. One entry here is one button.
//
// A button can play a recorded clip, a synthesized sound, or both:
//
//   { id: 'boing', emoji: '🏀', label: 'Boing', file: 'sounds/boing.mp3' },
//   { id: 'spark', emoji: '🎉', label: 'Spark', play(fx) { fx.tone({ freq: 520, slide: 400, dur: 0.12 }); } },
//
// id     unique short name the server broadcasts
// emoji  the button
// label  screen-reader name
// file   optional clip under public/ (fetched as /sounds/....mp3). Credits: public/sounds/README.md
// duck   optional [amount, hold]
// gain   optional playback level (default 1)
// play   optional synthesized sound. Helpers: fx.tone, fx.burst, fx.voice, fx.duck
//
// The recorded clips are the same CC0 set used by the sibling game, with credits in
// public/sounds/README.md. The sparkle button is synthesized in the browser.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.REACTIONS = api;
})(typeof window !== 'undefined' ? window : null, function () {
  return [
    { id: 'plop', emoji: '💩', label: 'Plop', file: 'sounds/plop.mp3' },
    { id: 'toot', emoji: '🍑', label: 'Squeak', file: 'sounds/toot.mp3' },
    { id: 'hoo', emoji: '🗣️', label: 'Hype shout', file: 'sounds/hoo.mp3', duck: [0.5, 1.5] },
    { id: 'boo', emoji: '👎', label: 'Boo', file: 'sounds/boo.mp3', duck: [0.55, 1.4] },
    { id: 'yay', emoji: '👍', label: 'Cheer', file: 'sounds/yay.mp3', duck: [0.55, 1.2] },
    { id: 'laugh', emoji: '😂', label: 'Laugh', file: 'sounds/laugh.mp3' },
    { id: 'fire', emoji: '🔥', label: 'Fire', file: 'sounds/fire.mp3' },
    { id: 'skull', emoji: '💀', label: 'Skull', file: 'sounds/skull.mp3' },
    { id: 'clap', emoji: '👏', label: 'Clap', file: 'sounds/clap.mp3' },
    { id: 'gasp', emoji: '😱', label: 'Gasp', file: 'sounds/gasp.mp3' },
    { id: 'spark', emoji: '🎉', label: 'Sparkle', play(fx) {
      fx.tone({ freq: 523, slide: 180, dur: 0.12, vol: 0.12, type: 'triangle' });
      fx.tone({ freq: 784, slide: 220, dur: 0.14, vol: 0.1, type: 'sine', delay: 0.08 });
      fx.tone({ freq: 1046, slide: -80, dur: 0.18, vol: 0.08, type: 'sine', delay: 0.16 });
    } },
  ];
});
