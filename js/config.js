// Central configuration. Everything the game renders or validates is derived
// from these values at runtime — change them here, nothing else is hardcoded.
const GAME_CONFIG = {
  title: "Wordsmith",

  // Selectable board dimensions.
  wordLengths: [4, 5, 6, 7],
  defaultWordLength: 5,
  attemptOptions: [4, 5, 6, 7, 8],
  defaultAttempts: 6,

  // How many letter hints a player may reveal per game.
  hintsPerGame: 1,

  // Live word APIs. No word list is bundled or downloaded: each answer is
  // fetched when a game starts and each guess is checked when submitted.
  api: {
    // Word search with usage frequency (per million words) — picks answers.
    datamuse: "https://api.datamuse.com/words",
    // Dictionary entries — confirms answers/guesses and supplies definitions.
    dictionary: "https://api.dictionaryapi.dev/api/v2/entries/en/",
    // Wiktionary — second guess check that covers plurals and rarer words.
    wiktionary: "https://en.wiktionary.org/api/rest_v1/page/definition/",
  },
  fetchTimeoutMs: 5000,
  // Retries for rate-limited (HTTP 429) or failed requests, with growing delay.
  retries: 2,
  retryDelayMs: 400,

  answer: {
    minFrequency: 5, // only reasonably common words become answers
    minCandidates: 10, // retry with another search pattern if fewer matches
    patternAttempts: 6, // search patterns to try before giving up
    maxChecks: 12, // candidates to confirm against the dictionary
    checkBatch: 3, // dictionary lookups run in parallel per batch
  },
  // Strict guess validation rules applied to Wiktionary senses (guesses found
  // in the main dictionary are always accepted).
  validation: {
    // Parts of speech that count as real words. Proper nouns, abbreviations,
    // initialisms, phrases, interjections, symbols, etc. are excluded.
    partsOfSpeech: [
      "Noun", "Verb", "Adjective", "Adverb", "Pronoun", "Preposition",
      "Conjunction", "Determiner", "Article", "Numeral", "Participle",
    ],
    // Content words need a real definition; usage notes alone ("Used as a
    // placeholder word…") don't count. Function words (their, which…) are
    // normally described that way, so they're exempt.
    glossRequired: ["Noun", "Verb", "Adjective", "Adverb"],
    // "Form of" senses accepted only when they're regular inflections or
    // standard spelling variants — and only if the base word is confirmed.
    inflections: /^(plural|simple past|past participle|present participle|third-person|comparative|superlative|inflection of|alternative spelling of)\b/i,
    // Senses never accepted (misspellings, letter-case variants, slang forms…).
    rejectedSenses: /^(misspelling|alternative (form|letter-case)|abbreviation|initialism|acronym|eye dialect|pronunciation spelling|nonstandard|obsolete|archaic|elongated|exaggerated)\b/i,
  },

  // Avoid repeating one of the player's recent answers in endless mode.
  recentAnswerMemory: 30,

  // On-screen keyboard rows. {enter} and {back} are special keys.
  keyboardLayout: ["qwertyuiop", "asdfghjkl", "{enter}zxcvbnm{back}"],

  // Synthesised sound effects (players can switch them off in Settings).
  sound: { enabled: true, volume: 0.5 },

  // Timing (ms) for the tile reveal animation.
  flipDelay: 280,
  flipDuration: 500,

  storagePrefix: "wordsmith:v2:",
};
