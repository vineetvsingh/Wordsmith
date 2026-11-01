// Fetches words live from public APIs — nothing is stored as a word list.
// Answers: a random spelling pattern (e.g. "??r??") is searched on Datamuse,
// common matches are shuffled, and the first one with a dictionary entry wins.
// Guesses: strictly checked — accepted only if the dictionary has an entry,
// or Wiktionary has a standard English sense (or a regular inflection of a
// confirmed base word). Names, acronyms, slang and gibberish are rejected,
// and a guess that can't be verified (service down) is never accepted.
const WordService = (() => {
  const C = GAME_CONFIG;
  const ALPHABET = "abcdefghijklmnopqrstuvwxyz";
  const verdicts = new Map(); // word → pending/settled check, this page session only

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function fetchWithTimeout(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), C.fetchTimeoutMs);
    try {
      return await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  // Retries brief network failures and rate limiting; other responses are
  // returned as-is so callers can tell "not found" apart from "unreachable".
  // A timed-out request isn't retried — waiting again would only add delay.
  async function fetchWithRetry(url) {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetchWithTimeout(url);
        if (res.status !== 429 || attempt >= C.retries) return res;
      } catch (err) {
        if (err.name === "AbortError" || attempt >= C.retries) throw err;
      }
      await wait(C.retryDelayMs * (attempt + 1));
    }
  }

  async function datamuse(params) {
    const query = new URLSearchParams({ md: "f", max: 1000, ...params });
    const res = await fetchWithRetry(`${C.api.datamuse}?${query}`);
    if (!res.ok) throw new Error(`Datamuse HTTP ${res.status}`);
    return res.json();
  }

  function frequency(entry) {
    const tag = (entry.tags || []).find((t) => t.startsWith("f:"));
    return tag ? parseFloat(tag.slice(2)) : 0;
  }

  // Returns { status, partOfSpeech?, definition? } where status is "found",
  // "missing" (404), "broken" (server error — this API consistently fails on
  // some inflected forms like plurals) or "error" (unreachable/rate limited).
  async function lookup(word) {
    try {
      const res = await fetchWithRetry(C.api.dictionary + encodeURIComponent(word));
      if (res.status === 404) return { status: "missing" };
      if (res.status >= 500) return { status: "broken" };
      if (!res.ok) return { status: "error" };
      const meaning = (await res.json())?.[0]?.meanings?.[0];
      return {
        status: "found",
        partOfSpeech: meaning?.partOfSpeech || "",
        definition: meaning?.definitions?.[0]?.definition || "",
      };
    } catch {
      return { status: "error" };
    }
  }

  async function findCandidates(length, rng) {
    for (let attempt = 0; attempt < C.answer.patternAttempts; attempt++) {
      const position = Math.floor(rng() * length);
      const letter = ALPHABET[Math.floor(rng() * ALPHABET.length)];
      const pattern = "?".repeat(position) + letter + "?".repeat(length - position - 1);
      const words = (await datamuse({ sp: pattern }))
        .filter((e) => e.word.length === length && /^[a-z]+$/.test(e.word) && frequency(e) >= C.answer.minFrequency)
        .map((e) => e.word)
        .sort(); // stable order so a seeded rng (daily mode) gives the same pick
      if (words.length >= C.answer.minCandidates) return words;
    }
    throw new Error("No candidate words found");
  }

  // Picks an answer of the given length. Returns { word, info } where info is
  // the dictionary entry (null if the dictionary was unavailable).
  async function pickAnswer(length, { rng = Math.random, exclude = [] } = {}) {
    const skip = new Set(exclude);
    const pool = Engine.shuffle(await findCandidates(length, rng), rng);
    const ordered = [...pool.filter((w) => !skip.has(w)), ...pool.filter((w) => skip.has(w))];
    const toCheck = ordered.slice(0, C.answer.maxChecks);

    // Confirm candidates in order (checked in parallel batches); the first
    // with a dictionary entry wins, so names and plurals are skipped.
    const unreachable = [];
    for (let i = 0; i < toCheck.length; i += C.answer.checkBatch) {
      const batch = toCheck.slice(i, i + C.answer.checkBatch);
      const results = await Promise.all(batch.map(lookup));
      const hit = results.findIndex((r) => r.status === "found");
      if (hit !== -1) return { word: batch[hit], info: results[hit] };
      batch.forEach((word, j) => results[j].status === "error" && unreachable.push(word));
    }
    // Dictionary unreachable: the answer must still be confirmed, so require
    // a standard (non-inflected) Wiktionary entry instead.
    for (const word of unreachable) {
      try {
        if ((await wiktionarySenses(word)).lemma) return { word, info: null };
      } catch {
        break;
      }
    }
    throw new Error("No dictionary word found");
  }

  const stripTags = (html) => String(html).replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

  // Reads Wiktionary's English senses for a word. Returns { lemma, bases }:
  // lemma — it has a standard sense of an accepted part of speech;
  // bases — base words it is a regular inflection of (e.g. "cranes" → "crane").
  // Senses carrying any usage label are ignored: the API hides the label
  // text, so slang/archaic/nonstandard senses can't be told apart from others.
  async function wiktionarySenses(word) {
    const res = await fetchWithRetry(C.api.wiktionary + encodeURIComponent(word));
    if (res.status === 404) return { lemma: false, bases: [] };
    if (!res.ok) throw new Error(`Wiktionary HTTP ${res.status}`);

    const { validation: V } = C;
    let lemma = false;
    const bases = new Set();
    for (const entry of (await res.json()).en || []) {
      if (!V.partsOfSpeech.includes(entry.partOfSpeech)) continue;
      for (const { definition = "" } of entry.definitions || []) {
        if (definition.includes("usage-label-sense")) continue;
        const text = stripTags(definition);
        if (!text || V.rejectedSenses.test(text)) continue;
        if (!definition.includes("form-of-definition")) {
          const usageNoteOnly = definition.includes("use-with-mention");
          if (!usageNoteOnly || !V.glossRequired.includes(entry.partOfSpeech)) lemma = true;
          continue;
        }
        if (!V.inflections.test(text)) continue; // alternative/misspelt forms don't count
        const link = definition.match(/class="form-of-definition-link"[^>]*>([\s\S]*?)<\/span>/);
        const base = link ? stripTags(link[1]).toLowerCase() : "";
        if (/^[a-z]+$/.test(base) && base !== word) bases.add(base);
      }
    }
    return { lemma, bases: [...bases] };
  }

  // Resolves true as soon as any promise resolves true; false once all have
  // settled without one (rejections count as "not confirmed").
  function firstTrue(promises) {
    return new Promise((resolve) => {
      let pending = promises.length;
      if (!pending) resolve(false);
      const settle = (value) => {
        if (value === true) resolve(true);
        else if (--pending === 0) resolve(false);
      };
      for (const p of promises) p.then(settle, () => settle(false));
    });
  }

  // Strict check. true only when a dictionary source positively confirms the
  // word; false when it doesn't; null when that couldn't be determined
  // (services unreachable) — the caller must not accept the guess then.
  // Both dictionaries are queried at once and the first confirmation wins.
  async function checkWord(word) {
    const dict = lookup(word);
    const wikt = wiktionarySenses(word).catch(() => null);
    // An inflected form ("cranes") is only valid if its base word is itself
    // confirmed; that check starts as soon as Wiktionary names the base.
    const viaBase = wikt.then(async (senses) => {
      const results = await Promise.all((senses?.bases || []).map(confirmBase));
      return results.includes(true) ? true : results.includes(null) ? null : false;
    });

    const confirmed = await firstTrue([
      dict.then((r) => r.status === "found"),
      wikt.then((senses) => Boolean(senses?.lemma)),
      viaBase,
    ]);
    if (confirmed) return true;

    // Not confirmed: only a definite "no" if every source actually answered.
    const [entry, senses, base] = await Promise.all([dict, wikt, viaBase]);
    if (!senses || base === null || entry.status === "error") return null;
    return false;
  }

  async function confirmBase(base) {
    const wikt = wiktionarySenses(base).catch(() => null);
    const confirmed = await firstTrue([
      lookup(base).then((r) => r.status === "found"),
      wikt.then((senses) => Boolean(senses?.lemma)),
    ]);
    if (confirmed) return true;
    return (await wikt) ? false : null;
  }

  // Resolves true/false, or null when the word couldn't be verified. Checks
  // are shared while in flight, so a check started early (as soon as the row
  // is full) is reused when the guess is submitted.
  function isValidWord(word) {
    if (!verdicts.has(word)) {
      const check = checkWord(word).then((verdict) => {
        if (verdict === null) verdicts.delete(word); // allow a retry later
        return verdict;
      });
      verdicts.set(word, check);
    }
    return verdicts.get(word);
  }

  return { pickAnswer, isValidWord, lookup };
})();
