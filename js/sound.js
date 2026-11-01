// Sound effects synthesised live with the Web Audio API — no audio files.
// The palette follows the type-foundry theme: typing is a short metal-type
// clack, and revealed tiles ring like struck metal — a bright anvil "ting"
// for verdigris (right spot), a warmer brass chime, and a dull pewter thud.
const Sound = (() => {
  const S = GAME_CONFIG.sound;
  let ctx = null;
  let master = null;
  let noiseBuffer = null;
  let enabled = true;

  // Browsers only allow audio after a user gesture, so the context is created
  // lazily on the first sound (which is always triggered by a key or click).
  function audio() {
    if (!enabled) return null;
    if (!ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      ctx = new AudioCtx();
      master = ctx.createGain();
      master.gain.value = S.volume;
      master.connect(ctx.destination);
      noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  }

  // Gain node with a fast attack and exponential decay, feeding `out`.
  function envelope(c, out, start, peak, attack, decay) {
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + attack + decay);
    gain.connect(out);
    return gain;
  }

  // Filtered noise burst — the body of clicks, clacks and flips.
  function burst({ delay = 0, freq, q = 1, peak, decay, type = "bandpass" }) {
    const c = audio();
    if (!c) return;
    const start = c.currentTime + delay;
    const source = c.createBufferSource();
    source.buffer = noiseBuffer;
    const filter = c.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    source.connect(filter);
    filter.connect(envelope(c, master, start, peak, 0.002, decay));
    source.start(start, Math.random() * 0.4);
    source.stop(start + decay + 0.05);
  }

  // Struck-metal tone: a fundamental plus inharmonic partials, like a bell.
  function ring({ delay = 0, freq, peak, decay, partials = [[1, 1]], wave = "sine" }) {
    const c = audio();
    if (!c) return;
    const start = c.currentTime + delay;
    for (const [ratio, level] of partials) {
      const osc = c.createOscillator();
      osc.type = wave;
      osc.frequency.value = freq * ratio;
      osc.connect(envelope(c, master, start, peak * level, 0.004, decay / Math.sqrt(ratio)));
      osc.start(start);
      osc.stop(start + decay + 0.1);
    }
  }

  const BELL = [[1, 1], [2.76, 0.35], [5.4, 0.12]];
  const semitone = (base, steps) => base * Math.pow(2, steps / 12);
  const vary = (value, amount) => value * (1 + (Math.random() * 2 - 1) * amount);

  return {
    get enabled() {
      return enabled;
    },
    setEnabled(on) {
      enabled = Boolean(on);
    },

    type() {
      burst({ freq: vary(2600, 0.12), q: 1.4, peak: 0.55, decay: 0.045 });
      ring({ freq: vary(1700, 0.06), peak: 0.06, decay: 0.03, wave: "triangle" });
    },

    erase() {
      burst({ freq: vary(1300, 0.1), q: 1.2, peak: 0.35, decay: 0.035 });
    },

    // One tile flipping over; `index` raises the pitch along the row so a
    // run of matches climbs a pentatonic scale.
    reveal(state, index = 0) {
      const step = [0, 2, 4, 7, 9, 12, 14, 16][index % 8];
      burst({ freq: 700, q: 0.8, peak: 0.3, decay: 0.06, type: "lowpass" });
      if (state === "correct") {
        ring({ delay: 0.01, freq: semitone(880, step), peak: 0.22, decay: 0.55, partials: BELL });
      } else if (state === "present") {
        ring({ delay: 0.01, freq: semitone(587, step), peak: 0.2, decay: 0.4, partials: [[1, 1], [2, 0.3], [3.9, 0.08]] });
      } else {
        ring({ delay: 0.005, freq: semitone(150, step / 3), peak: 0.28, decay: 0.12, wave: "triangle" });
      }
    },

    invalid() {
      ring({ freq: 110, peak: 0.08, decay: 0.2, partials: [[1, 1], [1.02, 0.8]], wave: "square" });
      burst({ freq: 320, q: 0.7, peak: 0.25, decay: 0.12, type: "lowpass" });
    },

    hint() {
      ring({ freq: 1320, peak: 0.12, decay: 0.35, partials: BELL });
      ring({ delay: 0.09, freq: 1760, peak: 0.1, decay: 0.45, partials: BELL });
    },

    win() {
      [0, 4, 7, 12, 16].forEach((step, i) => {
        ring({ delay: i * 0.09, freq: semitone(659, step), peak: 0.2, decay: 0.8, partials: BELL });
      });
    },

    lose() {
      [7, 3, 0].forEach((step, i) => {
        ring({ delay: i * 0.16, freq: semitone(220, step), peak: 0.18, decay: 0.5, partials: [[1, 1], [2, 0.25]], wave: "triangle" });
      });
    },
  };
})();
