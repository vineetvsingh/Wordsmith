// UI controller: fetches words via WordService, renders the board/keyboard
// from config, handles input, persistence, statistics and modals.
(() => {
  const C = GAME_CONFIG;
  const { Game, STATE, letterStates, dateKey, hashString, createRng } = Engine;
  const $ = (id) => document.getElementById(id);

  // ---------- Storage (all access guarded: may be unavailable) ----------
  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(C.storagePrefix + key);
        return raw ? JSON.parse(raw) : fallback;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(C.storagePrefix + key, JSON.stringify(value));
      } catch {
        /* storage unavailable — game still works, just without persistence */
      }
    },
  };

  // ---------- Settings & stats ----------
  const defaults = { length: C.defaultWordLength, attempts: C.defaultAttempts, mode: "random", hardMode: false };
  let settings = sanitizeSettings({ ...defaults, ...store.get("settings", {}) });

  function sanitizeSettings(s) {
    return {
      length: C.wordLengths.includes(s.length) ? s.length : C.defaultWordLength,
      attempts: C.attemptOptions.includes(s.attempts) ? s.attempts : C.defaultAttempts,
      mode: s.mode === "daily" ? "daily" : "random",
      hardMode: Boolean(s.hardMode),
    };
  }

  const settingsKey = (s = settings) => `${s.mode}-${s.length}x${s.attempts}`;

  function loadStats() {
    const all = store.get("stats", {});
    const blank = { played: 0, won: 0, streak: 0, best: 0, dist: new Array(settings.attempts).fill(0) };
    return { all, current: { ...blank, ...(all[settingsKey()] || {}) } };
  }

  function recordResult(won, attemptsUsed) {
    const { all, current } = loadStats();
    current.played++;
    if (won) {
      current.won++;
      current.streak++;
      current.best = Math.max(current.best, current.streak);
      current.dist[attemptsUsed - 1]++;
    } else {
      current.streak = 0;
    }
    all[settingsKey()] = current;
    store.set("stats", all);
  }

  // ---------- Game lifecycle ----------
  let game = null;
  let answerInfo = null; // dictionary entry for the answer, if available
  let input = "";
  let busy = false; // true while tiles animate or a guess is being checked
  let loadFailed = false;
  let loadToken = 0; // ignores stale fetches when a newer game was requested

  function persist() {
    store.set(`current-${settings.mode}`, {
      key: settingsKey(),
      day: dateKey(),
      game: game.toJSON(),
      info: answerInfo,
      input,
    });
  }

  async function startGame({ resume = true } = {}) {
    const token = ++loadToken;
    const saved = store.get(`current-${settings.mode}`, null);
    const canResume =
      resume &&
      saved &&
      saved.key === settingsKey() &&
      (settings.mode === "random"
        ? saved.game.status === "playing" && saved.game.hardMode === settings.hardMode
        : saved.day === dateKey());

    loadFailed = false;
    if (canResume) {
      game = new Game({ ...saved.game, saved: saved.game });
      answerInfo = saved.info || null;
      input = saved.game.status === "playing" ? saved.input || "" : "";
    } else {
      game = null;
      input = "";
      buildBoard(settings.length, settings.attempts);
      buildKeyboard();
      board.classList.add("loading");
      $("subtitle").textContent = "Fetching a word…";
      $("btn-hint").disabled = true;

      try {
        // Daily mode seeds the random choices with the date so everyone gets
        // the same word; endless mode is fully random.
        const daily = settings.mode === "daily";
        const rng = daily ? createRng(hashString(`${dateKey()}#${settings.length}`)) : Math.random;
        const recent = daily ? [] : store.get("recent", []);
        const { word, info } = await WordService.pickAnswer(settings.length, { rng, exclude: recent });
        if (token !== loadToken) return;
        if (!daily) store.set("recent", [word, ...recent].slice(0, C.recentAnswerMemory));
        game = new Game({ answer: word, maxAttempts: settings.attempts, hardMode: settings.hardMode });
        answerInfo = info;
      } catch {
        if (token !== loadToken) return;
        loadFailed = true;
        board.classList.remove("loading");
        $("subtitle").textContent = "No connection to the word service";
        $("btn-new").textContent = "Try again";
        toast("Couldn’t fetch a word. Check your internet connection, then select Try again.", 3500);
        return;
      }
    }

    board.classList.remove("loading");
    buildBoard(game.length, game.maxAttempts);
    buildKeyboard();
    renderAll();
    updateSubtitle();
    persist();

    if (game.status !== "playing") setTimeout(() => openStats(true), 300);
  }

  // ---------- Rendering ----------
  const board = $("board");
  const keyboard = $("keyboard");

  function buildBoard(cols, rows) {
    board.style.setProperty("--cols", cols);
    board.style.setProperty("--rows", rows);
    board.style.setProperty("--flip-duration", `${C.flipDuration}ms`);
    board.innerHTML = "";
    for (let r = 0; r < rows; r++) {
      const row = document.createElement("div");
      row.className = "row";
      row.setAttribute("role", "row");
      row.style.setProperty("--r", r); // row/column indexes stagger CSS animations
      for (let c = 0; c < cols; c++) {
        const tile = document.createElement("div");
        tile.className = "tile";
        tile.setAttribute("role", "gridcell");
        tile.style.setProperty("--i", c);
        row.appendChild(tile);
      }
      board.appendChild(row);
    }
  }

  function buildKeyboard() {
    keyboard.innerHTML = "";
    for (const line of C.keyboardLayout) {
      const row = document.createElement("div");
      row.className = "key-row";
      for (const token of line.match(/\{\w+\}|./g)) {
        const key = document.createElement("button");
        key.type = "button";
        key.className = "key";
        if (token === "{enter}") {
          key.textContent = "Enter";
          key.dataset.key = "Enter";
          key.classList.add("wide");
        } else if (token === "{back}") {
          key.textContent = "⌫";
          key.dataset.key = "Backspace";
          key.setAttribute("aria-label", "Backspace");
          key.classList.add("wide");
        } else {
          key.textContent = token;
          key.dataset.key = token;
        }
        row.appendChild(key);
      }
      keyboard.appendChild(row);
    }
  }

  function rowTiles(r) {
    return board.children[r].children;
  }

  function renderAll() {
    game.rows.forEach(({ guess, result }, r) => {
      [...rowTiles(r)].forEach((tile, c) => {
        tile.textContent = guess[c];
        tile.dataset.state = result[c];
      });
    });
    renderInputRow();
    renderKeyboard();
    $("btn-hint").disabled = !hintsLeft();
  }

  function renderInputRow() {
    const r = game.attemptsUsed;
    if (game.status !== "playing" || r >= game.maxAttempts) return;
    [...rowTiles(r)].forEach((tile, c) => {
      const letter = input[c];
      const hint = game.hints[c];
      tile.textContent = letter || hint || "";
      tile.toggleAttribute("data-filled", Boolean(letter));
      tile.toggleAttribute("data-hint", !letter && Boolean(hint));
    });
  }

  function renderKeyboard() {
    const states = letterStates(game.rows);
    for (const key of keyboard.querySelectorAll(".key")) {
      const state = states[key.dataset.key];
      if (state) key.dataset.state = state;
      else delete key.dataset.state;
    }
  }

  function updateSubtitle() {
    const mode = settings.mode === "daily" ? "Daily puzzle" : "Endless";
    const hard = settings.hardMode ? ", hard mode" : "";
    $("subtitle").textContent = `${mode}, ${settings.length} letters, ${settings.attempts} guesses${hard}`;
    $("btn-new").textContent = settings.mode === "daily" ? "Switch to endless" : "New word";
  }

  // ---------- Theme ----------
  const THEMES = [
    { value: "system", label: "System" },
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
  ];

  function applyTheme(theme) {
    if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
  }

  function toast(message, ms = 1600) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = message;
    $("toasts").prepend(el);
    setTimeout(() => {
      el.classList.add("out");
      setTimeout(() => el.remove(), 300);
    }, ms);
  }

  function shakeRow() {
    const row = board.children[game.attemptsUsed];
    row.classList.remove("shake");
    void row.offsetWidth; // restart animation
    row.classList.add("shake");
    Sound.invalid();
  }

  // ---------- Input ----------
  function handleKey(key) {
    if (busy || !game || game.status !== "playing" || document.querySelector("dialog[open]")) return;

    if (key === "Enter") return submitGuess();
    if (key === "Backspace" && input) {
      input = input.slice(0, -1);
      Sound.erase();
    } else if (/^[a-z]$/i.test(key) && input.length < game.length) {
      input += key.toLowerCase();
      Sound.type();
      // Start checking the word as soon as the row is full, so the result is
      // usually ready by the time Enter is pressed.
      if (input.length === game.length && input !== game.answer) WordService.isValidWord(input);
    } else {
      return;
    }
    renderInputRow();
    persist();
  }

  async function submitGuess() {
    const current = game;
    const guess = input;
    const error = current.validate(guess);
    if (error) {
      shakeRow();
      toast(error);
      return;
    }

    // Check the word against the live dictionary services.
    busy = true;
    const rowEl = board.children[current.attemptsUsed];
    rowEl.classList.add("checking");
    const valid = guess === current.answer || (await WordService.isValidWord(guess));
    rowEl.classList.remove("checking");
    busy = false;
    if (game !== current) return; // a new game started meanwhile

    // Strict: a guess counts only if it was positively confirmed as a word.
    if (valid === null) {
      shakeRow();
      toast("Couldn't verify that word — check your connection and try again", 2800);
      return;
    }
    if (!valid) {
      shakeRow();
      toast("Not a valid English word");
      return;
    }

    const row = current.attemptsUsed;
    const outcome = current.submit(guess);
    input = "";
    persist();
    revealRow(row, outcome.result, () => {
      renderKeyboard();
      $("btn-hint").disabled = !hintsLeft();
      if (outcome.status === "playing") renderInputRow();
      else finishGame();
    });
  }

  function revealRow(r, result, done) {
    busy = true;
    const tiles = [...rowTiles(r)];
    tiles.forEach((tile, c) => {
      setTimeout(() => {
        tile.classList.add("flip");
        setTimeout(() => {
          tile.removeAttribute("data-filled");
          tile.removeAttribute("data-hint");
          tile.dataset.state = result[c];
          Sound.reveal(result[c], c);
        }, C.flipDuration / 2);
      }, c * C.flipDelay);
    });
    setTimeout(() => {
      tiles.forEach((t) => t.classList.remove("flip"));
      busy = false;
      done();
    }, (tiles.length - 1) * C.flipDelay + C.flipDuration);
  }

  function finishGame() {
    const won = game.status === "won";
    recordResult(won, game.attemptsUsed);
    persist();
    if (won) {
      const praise = ["Genius!", "Brilliant!", "Excellent!", "Great!", "Nice!", "Solid!", "Phew!", "Close one!"];
      toast(praise[Math.min(game.attemptsUsed - 1, praise.length - 1)]);
      [...rowTiles(game.attemptsUsed - 1)].forEach((tile, i) => {
        setTimeout(() => tile.classList.add("win"), i * 90);
      });
      Sound.win();
    } else {
      toast(game.answer.toUpperCase(), 2500);
      Sound.lose();
    }
    setTimeout(() => openStats(true), 1400);
  }

  function hintsLeft() {
    return game && game.status === "playing" ? C.hintsPerGame - Object.keys(game.hints).length : 0;
  }

  function useHint() {
    if (busy || !game) return;
    if (hintsLeft() <= 0) return toast("No hints left this game");
    const hint = game.revealHint();
    if (!hint) return toast("Nothing left to reveal");
    toast(`Letter ${hint.index + 1} is ${hint.letter.toUpperCase()}`, 2200);
    Sound.hint();
    renderAll();
    persist();
  }

  // ---------- Modals ----------
  function buildSegmented(container, name, options, current) {
    container.innerHTML = "";
    for (const { value, label } of options) {
      const wrap = document.createElement("label");
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = name;
      radio.value = value;
      radio.checked = String(value) === String(current);
      const span = document.createElement("span");
      span.textContent = label;
      wrap.append(radio, span);
      container.appendChild(wrap);
    }
  }

  function openSettings() {
    buildSegmented($("opt-length"), "length", C.wordLengths.map((n) => ({ value: n, label: n })), settings.length);
    buildSegmented($("opt-attempts"), "attempts", C.attemptOptions.map((n) => ({ value: n, label: n })), settings.attempts);
    buildSegmented(
      $("opt-mode"),
      "mode",
      [
        { value: "random", label: "Endless" },
        { value: "daily", label: "Daily" },
      ],
      settings.mode
    );
    $("opt-hard").checked = settings.hardMode;
    buildSegmented($("opt-theme"), "theme", THEMES, store.get("theme", "system"));
    $("opt-sound").checked = Sound.enabled;
    $("dlg-settings").showModal();
  }

  function applySettings(event) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.target);
    settings = sanitizeSettings({
      length: Number(form.get("length")),
      attempts: Number(form.get("attempts")),
      mode: form.get("mode"),
      hardMode: $("opt-hard").checked,
    });
    store.set("settings", settings);
    $("dlg-settings").close();
    startGame({ resume: settings.mode === "daily" });
  }

  function openHelp() {
    $("help-goal").textContent = `Find the hidden ${settings.length}-letter word in ${settings.attempts} guesses.`;
    $("help-hints").textContent = C.hintsPerGame;
    $("dlg-help").showModal();
  }

  function openStats(showResult = false) {
    const { current } = loadStats();
    const over = game && game.status !== "playing";
    const finished = showResult && over;

    $("result-panel").hidden = !finished;
    $("result-actions").hidden = !over;
    if (finished) {
      const n = game.attemptsUsed;
      $("result-title").textContent = game.status === "won" ? `Solved in ${n} ${n === 1 ? "guess" : "guesses"}` : "Out of guesses";
      const word = $("result-word");
      word.innerHTML = "";
      [...game.answer].forEach((letter, i) => {
        const tile = document.createElement("span");
        tile.className = "tile mini";
        tile.dataset.state = STATE.CORRECT;
        tile.style.setProperty("--i", i);
        tile.textContent = letter;
        word.appendChild(tile);
      });
      showDefinition(game.answer);
    }
    $("btn-again").textContent = settings.mode === "daily" ? "Play endless" : "Play again";

    const scope = settings.mode === "daily" ? "Daily puzzles" : "Endless games";
    $("stats-scope").textContent = `${scope} with ${settings.length} letters and ${settings.attempts} guesses`;
    const winPct = current.played ? Math.round((current.won / current.played) * 100) : 0;
    $("stat-grid").innerHTML = "";
    for (const [value, label] of [
      [current.played, "Played"],
      [winPct, "Win %"],
      [current.streak, "Streak"],
      [current.best, "Best streak"],
    ]) {
      const cell = document.createElement("div");
      cell.innerHTML = `<div class="value">${value}</div><div class="label">${label}</div>`;
      $("stat-grid").appendChild(cell);
    }

    const dist = $("distribution");
    dist.innerHTML = "";
    const max = Math.max(1, ...current.dist);
    current.dist.forEach((count, i) => {
      const row = document.createElement("div");
      row.className = "dist-row";
      const bar = document.createElement("div");
      bar.className = "dist-bar";
      bar.style.setProperty("--i", i);
      if (game?.status === "won" && game.attemptsUsed === i + 1) bar.classList.add("current");
      bar.style.width = `${Math.max(8, (count / max) * 100)}%`;
      bar.textContent = count;
      row.innerHTML = `<span>${i + 1}</span>`;
      row.appendChild(bar);
      dist.appendChild(row);
    });

    if (!$("dlg-stats").open) $("dlg-stats").showModal();
    if (finished) $("result-title").focus();
  }

  // Uses the dictionary entry fetched with the answer, or looks it up now.
  async function showDefinition(word) {
    const el = $("result-definition");
    el.textContent = "";
    const info = answerInfo?.status === "found" ? answerInfo : await WordService.lookup(word);
    if (info.status === "found" && info.definition && game?.answer === word) {
      el.textContent = `${info.partOfSpeech}: ${info.definition}`;
    }
  }

  async function shareResult() {
    const symbols = { [STATE.CORRECT]: "🟢", [STATE.PRESENT]: "🟡", [STATE.ABSENT]: "⚫" };
    const score = game.status === "won" ? game.attemptsUsed : "X";
    const label = settings.mode === "daily" ? `Daily ${dateKey()}` : "Endless";
    const grid = game.rows.map(({ result }) => result.map((s) => symbols[s]).join("")).join("\n");
    const text = `${C.title} ${label} (${settings.length} letters) ${score}/${game.maxAttempts}${settings.hardMode ? "*" : ""}\n\n${grid}`;
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied to clipboard");
    } catch {
      toast("Couldn't access clipboard");
    }
  }

  function newGame() {
    if (busy) return;
    // In daily mode this button switches to endless (unless retrying a failed load).
    if (settings.mode === "daily" && !loadFailed) {
      settings.mode = "random";
      store.set("settings", settings);
    }
    if ($("dlg-stats").open) $("dlg-stats").close();
    startGame({ resume: false });
  }

  // ---------- Wiring ----------
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Enter" && document.activeElement?.closest(".key, .icon-btn, .btn, .status")) {
      e.preventDefault(); // stop Enter from also "clicking" a focused button
    }
    handleKey(e.key);
  });
  keyboard.addEventListener("click", (e) => {
    const key = e.target.closest(".key");
    if (key) {
      handleKey(key.dataset.key);
      key.blur();
    }
  });
  $("btn-help").addEventListener("click", openHelp);
  $("btn-hint").addEventListener("click", useHint);
  $("btn-stats").addEventListener("click", () => openStats(true));
  $("btn-settings").addEventListener("click", openSettings);
  $("subtitle").addEventListener("click", openSettings);
  $("opt-theme").addEventListener("change", (e) => {
    store.set("theme", e.target.value);
    applyTheme(e.target.value);
  });
  $("opt-sound").addEventListener("change", (e) => {
    store.set("sound", e.target.checked);
    Sound.setEnabled(e.target.checked);
    Sound.reveal("correct", 2); // a sample so the change is audible
  });
  $("btn-new").addEventListener("click", newGame);
  $("btn-again").addEventListener("click", newGame);
  $("btn-share").addEventListener("click", shareResult);
  $("settings-form").addEventListener("submit", applySettings);
  for (const dlg of document.querySelectorAll("dialog")) {
    // Close when clicking the backdrop (outside the dialog box itself).
    dlg.addEventListener("click", (e) => {
      if (e.target !== dlg) return;
      const box = dlg.getBoundingClientRect();
      const inside = e.clientX >= box.left && e.clientX <= box.right && e.clientY >= box.top && e.clientY <= box.bottom;
      if (!inside) dlg.close();
    });
  }

  // ---------- Boot ----------
  // Open connections to the word services early so the first check is fast.
  for (const origin of new Set(Object.values(C.api).map((url) => new URL(url).origin))) {
    const link = document.createElement("link");
    link.rel = "preconnect";
    link.href = origin;
    link.crossOrigin = "anonymous";
    document.head.appendChild(link);
  }
  applyTheme(store.get("theme", "system"));
  Sound.setEnabled(store.get("sound", C.sound.enabled));
  document.title = C.title;
  $("title").textContent = C.title;
  startGame();
  if (!store.get("seenHelp", false)) {
    store.set("seenHelp", true);
    openHelp();
  }
})();
