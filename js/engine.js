// Pure game logic — no DOM access, so it can be unit-tested in Node.
(function (root) {
  const STATE = { CORRECT: "correct", PRESENT: "present", ABSENT: "absent" };
  const RANK = { [STATE.ABSENT]: 1, [STATE.PRESENT]: 2, [STATE.CORRECT]: 3 };

  // Scores a guess against the answer. Exact matches are claimed first so that
  // repeated letters are only marked "present" as many times as they remain.
  function evaluateGuess(guess, answer) {
    const result = new Array(answer.length).fill(STATE.ABSENT);
    const remaining = {};

    for (let i = 0; i < answer.length; i++) {
      if (guess[i] === answer[i]) result[i] = STATE.CORRECT;
      else remaining[answer[i]] = (remaining[answer[i]] || 0) + 1;
    }
    for (let i = 0; i < answer.length; i++) {
      if (result[i] === STATE.CORRECT) continue;
      if (remaining[guess[i]] > 0) {
        result[i] = STATE.PRESENT;
        remaining[guess[i]]--;
      }
    }
    return result;
  }

  // FNV-1a — a small deterministic hash used to seed the daily word.
  function hashString(text) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  }

  function dateKey(date = new Date()) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  // Mulberry32 — seeded PRNG so everyone gets the same daily word.
  function createRng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Fisher–Yates shuffle returning a new array.
  function shuffle(items, rng = Math.random) {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  // Best known state per letter across all guesses (for the keyboard).
  function letterStates(rows) {
    const states = {};
    for (const { guess, result } of rows) {
      for (let i = 0; i < guess.length; i++) {
        const letter = guess[i];
        if (!states[letter] || RANK[result[i]] > RANK[states[letter]]) states[letter] = result[i];
      }
    }
    return states;
  }

  // Hard mode: confirmed letters must stay in place and discovered letters
  // must be reused (at least as many times as they were revealed).
  function hardModeViolation(guess, rows) {
    const minCounts = {};
    for (const { guess: prev, result } of rows) {
      const counts = {};
      for (let i = 0; i < prev.length; i++) {
        if (result[i] === STATE.CORRECT && guess[i] !== prev[i]) {
          return `Letter ${i + 1} must be ${prev[i].toUpperCase()}`;
        }
        if (result[i] !== STATE.ABSENT) counts[prev[i]] = (counts[prev[i]] || 0) + 1;
      }
      for (const [letter, n] of Object.entries(counts)) {
        minCounts[letter] = Math.max(minCounts[letter] || 0, n);
      }
    }
    for (const [letter, n] of Object.entries(minCounts)) {
      const used = guess.split("").filter((c) => c === letter).length;
      if (used < n) return `Guess must contain ${letter.toUpperCase()}${n > 1 ? ` ×${n}` : ""}`;
    }
    return null;
  }

  class Game {
    constructor({ answer, maxAttempts, hardMode = false, saved = null }) {
      this.answer = answer;
      this.length = answer.length;
      this.maxAttempts = maxAttempts;
      this.hardMode = hardMode;
      this.rows = saved ? saved.rows : [];
      this.hints = saved ? saved.hints : {};
      this.status = saved ? saved.status : "playing";
    }

    get attemptsUsed() {
      return this.rows.length;
    }

    // Local rule checks only; whether the guess is a real word is checked
    // separately (asynchronously) by the caller before submitting.
    validate(rawGuess) {
      const guess = rawGuess.toLowerCase();
      if (this.status !== "playing") return "Game is over";
      if (guess.length !== this.length) return "Not enough letters";
      if (this.hardMode) return hardModeViolation(guess, this.rows);
      return null;
    }

    submit(rawGuess) {
      const guess = rawGuess.toLowerCase();
      const error = this.validate(guess);
      if (error) return { ok: false, error };

      const result = evaluateGuess(guess, this.answer);
      this.rows.push({ guess, result });
      if (guess === this.answer) this.status = "won";
      else if (this.rows.length >= this.maxAttempts) this.status = "lost";
      return { ok: true, result, status: this.status };
    }

    // Reveals one position the player hasn't already solved or been hinted.
    revealHint(rng = Math.random) {
      if (this.status !== "playing") return null;
      const solved = new Set();
      for (const { result } of this.rows) {
        result.forEach((s, i) => s === STATE.CORRECT && solved.add(i));
      }
      const open = [];
      for (let i = 0; i < this.length; i++) {
        if (!solved.has(i) && !(i in this.hints)) open.push(i);
      }
      if (!open.length) return null;
      const index = open[Math.floor(rng() * open.length)];
      this.hints[index] = this.answer[index];
      return { index, letter: this.answer[index] };
    }

    toJSON() {
      return {
        answer: this.answer,
        maxAttempts: this.maxAttempts,
        hardMode: this.hardMode,
        rows: this.rows,
        hints: this.hints,
        status: this.status,
      };
    }
  }

  const api = {
    STATE,
    evaluateGuess,
    hashString,
    dateKey,
    createRng,
    shuffle,
    letterStates,
    hardModeViolation,
    Game,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Engine = api;
})(this);
