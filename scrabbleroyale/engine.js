// Scrabble Royale engine: pure, deterministic, no I/O. See RULES.md.

                                                                                 

                  
                                   
                                           
                     

                                                                            

                           
             
               
                 
             
                         
                      
                                      
                                                                                
                                                                              
  

                         
                         
                           
                    
                
                   
                
                      
                        
                    
  

                          
                    
               
                                                                                                                                    
                                                                                                     
  

                       
                                                                                       
                                                        
                                                                    
                                                                                                          
                                                                    
                                                         
                                      
                                                         
                                                                                 
                                                                                             

                                                                                                           

// ---- constants ----

const LETTER_VALUES                         = {
  a: 1, b: 3, c: 3, d: 2, e: 1, f: 4, g: 2, h: 4, i: 1, j: 8, k: 5, l: 1, m: 3, n: 1,
  o: 1, p: 3, q: 10, r: 1, s: 1, t: 1, u: 1, v: 4, w: 4, x: 8, y: 4, z: 10,
};
const LETTER_COUNTS                         = {
  a: 9, b: 2, c: 2, d: 4, e: 12, f: 2, g: 3, h: 2, i: 9, j: 1, k: 1, l: 4, m: 2, n: 6,
  o: 8, p: 2, q: 1, r: 6, s: 4, t: 6, u: 4, v: 2, w: 2, x: 1, y: 2, z: 1,
};
const BLANKS_PER_SET = 2;
export const BLANK = '?';

// Standard 15x15 premium layout. '.' none, 'l' double-letter, 'L' triple-letter,
// 'w' double-word, 'W' triple-word. Tiled across the board (mod 15), no center star.
const PREMIUM_ROWS = [
  'W..l...W...l..W',
  '.w...L...L...w.',
  '..w...l.l...w..',
  'l..w...l...w..l',
  '....w.....w....',
  '.L...L...L...L.',
  '..l...l.l...l..',
  'W..l...w...l..W',
  '..l...l.l...l..',
  '.L...L...L...L.',
  '....w.....w....',
  'l..w...l...w..l',
  '..w...l.l...w..',
  '.w...L...L...w.',
  'W..l...W...l..W',
];

export function premiumAt(row        , col        )                              {
  const r = ((row % 15) + 15) % 15;
  const c = ((col % 15) + 15) % 15;
  return PREMIUM_ROWS[r][c]                               ;
}

// ---- setup ----

export function boardSideFor(n        )         {
  let side = Math.max(15, Math.round(8 * Math.sqrt(n)));
  if (side % 2 === 0) side += 1;
  return side;
}

function spawnPositions(n        , side        )                                 {
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const positions                                 = [];
  for (let r = 0; r < rows && positions.length < n; r++) {
    for (let c = 0; c < cols && positions.length < n; c++) {
      const row = Math.min(side - 1, Math.floor(((r + 0.5) * side) / rows));
      const col = Math.min(side - 1, Math.floor(((c + 0.5) * side) / cols));
      positions.push({ row, col });
    }
  }
  return positions;
}

function buildBag(n        )           {
  const sets = Math.ceil(n / 2);
  const bag           = [];
  for (let s = 0; s < sets; s++) {
    for (const letter of Object.keys(LETTER_COUNTS)) {
      for (let i = 0; i < LETTER_COUNTS[letter]; i++) bag.push(letter);
    }
    for (let i = 0; i < BLANKS_PER_SET; i++) bag.push(BLANK);
  }
  return bag;
}

// mulberry32, operating on an explicit numeric state stored on the game state
// (so the engine stays pure / JSON-serializable — no closures in state).
function nextRandom(state           )         {
  state.rngState = (state.rngState + 0x6d2b79f5) | 0;
  let t = state.rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function drawTiles(state           , n        )           {
  const drawn           = [];
  for (let i = 0; i < n && state.bag.length > 0; i++) {
    const idx = Math.floor(nextRandom(state) * state.bag.length);
    drawn.push(state.bag.splice(idx, 1)[0]);
  }
  return drawn;
}

export function createGame(config            )            {
  const n = config.players.length;
  const side = boardSideFor(n);
  const spawns = spawnPositions(n, side);
  const board                    = Array.from({ length: side }, () => new Array(side).fill(null));

  const state            = {
    players: config.players.map((id, i) => ({
      id,
      seat: i,
      rack: [],
      hp: 50,
      hasPlayedEver: false,
      eliminated: false,
      spawn: spawns[i],
    })),
    board,
    boardSide: side,
    bag: buildBag(n),
    rngState: config.seed | 0,
    round: 0,
    staleRounds: 0,
    winner: null,
    gameOver: false,
  };

  if (config.randomSpawns) {
    const slots = spawns.slice();
    for (const p of state.players) {
      const { row, col } = slots.splice(Math.floor(nextRandom(state) * slots.length), 1)[0];
      const jitter = () => Math.floor(nextRandom(state) * 5) - 2;
      p.spawn = { row: Math.max(0, Math.min(side - 1, row + jitter())), col: Math.max(0, Math.min(side - 1, col + jitter())) };
    }
  }

  for (const p of state.players) {
    p.rack = drawTiles(state, 7);
  }
  return state;
}

// ---- damage escalation ----

export function damageMultiplier(round        )         {
  return 1 + 0.5 * Math.floor(round / 5);
}

// Move clock: 10s, minus 1s every 5 rounds, floor 3s. Running out costs TIMEOUT_PENALTY HP.
export function roundSeconds(round        )         {
  return Math.max(3, 10 - Math.floor(round / 5));
}
export const TIMEOUT_PENALTY = 5;

// ---- word lookup helpers (used by both validation/scoring and movegen) ----

                     

function step(dir     )                             {
  return dir === 'H' ? { dr: 0, dc: 1 } : { dr: 1, dc: 0 };
}

// Scans the full contiguous run of occupied cells through (row,col) in dir,
// where `placed` is a Map of "r,c" -> Tile for the not-yet-committed new tiles.
function scanWord(
  board                   ,
  side        ,
  placed                   ,
  row        ,
  col        ,
  dir     ,
)                                                                        {
  const { dr, dc } = step(dir);
  const at = (r        , c        ) => {
    if (r < 0 || c < 0 || r >= side || c >= side) return null;
    const key = `${r},${c}`;
    const p = placed.get(key);
    if (p) return { letter: p.letter.toLowerCase(), isNew: true };
    const cell = board[r][c];
    if (cell) return { letter: cell.letter, isNew: false };
    return null;
  };
  if (!at(row, col)) return null;
  let r = row, c = col;
  while (at(r - dr, c - dc)) { r -= dr; c -= dc; }
  const cells                                                                 = [];
  let cr = r, cc = c;
  while (true) {
    const cell = at(cr, cc);
    if (!cell) break;
    cells.push({ row: cr, col: cc, letter: cell.letter, isNew: cell.isNew });
    cr += dr; cc += dc;
  }
  return cells;
}

function wordText(cells                      )         {
  return cells.map((c) => c.letter).join('');
}

// ---- scoring ----

function scoreWord(
  cells                                                                ,
  placed                   ,
)         {
  let wordMult = 1;
  let sum = 0;
  for (const cell of cells) {
    const isBlankTile = placed.get(`${cell.row},${cell.col}`)?.blank === true;
    const base = isBlankTile ? 0 : (LETTER_VALUES[cell.letter] ?? 0);
    if (cell.isNew) {
      const p = premiumAt(cell.row, cell.col);
      let letterMult = 1;
      if (p === 'l') letterMult = 2;
      else if (p === 'L') letterMult = 3;
      else if (p === 'w') wordMult *= 2;
      else if (p === 'W') wordMult *= 3;
      sum += base * letterMult;
    } else {
      sum += base;
    }
  }
  return sum * wordMult;
}

// Given a candidate play's tiles (not yet on the board), compute every word formed
// (main + cross), validate dictionary membership + min length, and score them.
// Returns null with a reason if anything is invalid.
function wordsAndScore(
  state           ,
  dict             ,
  tiles        ,
)                                                                                                                                                                {
  const placed = new Map              ();
  for (const t of tiles) placed.set(`${t.row},${t.col}`, t);

  const sameRow = tiles.every((t) => t.row === tiles[0].row);
  const sameCol = tiles.every((t) => t.col === tiles[0].col);
  if (!sameRow && !sameCol) return { ok: false, reason: 'tiles must be in one row or column' };
  const mainDir             = tiles.length === 1 ? null : sameRow ? 'H' : 'V';

  const words                                                                                            = [];
  const seen = new Set        ();

  const tryAdd = (row        , col        , dir     ) => {
    const cells = scanWord(state.board, state.boardSide, placed, row, col, dir);
    if (!cells || cells.length < 2) return;
    const sig = `${dir}:${cells[0].row},${cells[0].col}`;
    if (seen.has(sig)) return;
    seen.add(sig);
    const text = wordText(cells);
    if (!dict.has(text)) {
      throw new InvalidWord(text);
    }
    words.push({ text, cells });
  };

  try {
    if (mainDir) {
      tryAdd(tiles[0].row, tiles[0].col, mainDir);
      for (const t of tiles) tryAdd(t.row, t.col, mainDir === 'H' ? 'V' : 'H');
    } else {
      tryAdd(tiles[0].row, tiles[0].col, 'H');
      tryAdd(tiles[0].row, tiles[0].col, 'V');
    }
  } catch (e) {
    if (e instanceof InvalidWord) return { ok: false, reason: `not a word: ${e.word}` };
    throw e;
  }

  if (words.length === 0) return { ok: false, reason: 'no word formed' };

  let score = 0;
  for (const w of words) score += scoreWord(w.cells, placed);
  if (tiles.length === 7) score += 50; // bingo

  return { ok: true, words, score };
}

class InvalidWord extends Error {
  word        ;
  constructor(word        ) {
    super(`invalid word ${word}`);
    this.word = word;
  }
}

// ---- validation ----

// Pre-existing (not-newly-placed) cells in the formed words that aren't already owned
// by playerId, grouped by current owner (null = neutral). Shared by validatePlay's
// damage estimate and resolveRound's actual capture + damage split.
function capturedByOwnerMap(
  state           ,
  playerId        ,
  words                                                             ,
)                                                     {
  const capturedByOwner = new Map                                               ();
  for (const w of words) {
    for (const c of w.cells) {
      if (c.isNew) continue;
      const cell = state.board[c.row][c.col] ;
      if (cell.owner === playerId) continue;
      const list = capturedByOwner.get(cell.owner) ?? [];
      list.push({ row: c.row, col: c.col });
      capturedByOwner.set(cell.owner, list);
    }
  }
  return capturedByOwner;
}

// The damage-split rule: score (scaled by the round's damage multiplier) divided among
// opponents in proportion to how many of their tiles were captured (neutral captures
// don't count toward the split).
function splitDamage(
  capturedByOwner                                                    ,
  score        ,
  round        ,
)                     {
  const opponentEntries = [...capturedByOwner.entries()].filter(
    (e)                                                => e[0] !== null,
  );
  const t = opponentEntries.reduce((sum, [, list]) => sum + list.length, 0);
  if (t === 0) return [];
  const mult = damageMultiplier(round);
  const result                     = [];
  for (const [owner, list] of opponentEntries) {
    const dmg = Math.floor((score * mult * list.length) / t);
    if (dmg > 0) result.push([owner, dmg]);
  }
  return result;
}

// True if any new tile is adjacent (4-directionally) to an already-occupied square.
function touchesExistingTile(state           , tiles        )          {
  const deltas = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (const t of tiles) {
    for (const [dr, dc] of deltas) {
      const nr = t.row + dr, nc = t.col + dc;
      if (nr < 0 || nc < 0 || nr >= state.boardSide || nc >= state.boardSide) continue;
      if (state.board[nr][nc]) return true;
    }
  }
  return false;
}

export function validatePlay(state           , playerId        , move      , dict             )                 {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { ok: false, reason: 'unknown player' };
  if (player.eliminated) return { ok: false, reason: 'player is eliminated' };

  const rack = player.rack.slice();

  if (move.type === 'pass') return { ok: true };

  if (move.type === 'exchange') {
    if (move.letters.length < 1 || move.letters.length > 7) return { ok: false, reason: 'exchange 1-7 tiles' };
    if (state.bag.length < move.letters.length) return { ok: false, reason: 'bag does not hold enough tiles' };
    const remaining = rack.slice();
    for (const letter of move.letters) {
      const idx = remaining.indexOf(letter);
      if (idx < 0) return { ok: false, reason: 'rack does not contain that tile' };
      remaining.splice(idx, 1);
    }
    return { ok: true };
  }

  // play
  const tiles = move.tiles;
  if (!tiles || tiles.length === 0) return { ok: false, reason: 'no tiles placed' };

  const seenPos = new Set        ();
  const remaining = rack.slice();
  for (const t of tiles) {
    if (t.row < 0 || t.col < 0 || t.row >= state.boardSide || t.col >= state.boardSide) {
      return { ok: false, reason: 'tile out of bounds' };
    }
    const key = `${t.row},${t.col}`;
    if (seenPos.has(key)) return { ok: false, reason: 'duplicate tile position' };
    seenPos.add(key);
    if (state.board[t.row][t.col] !== null) return { ok: false, reason: 'square already occupied' };
    const letter = (t.letter ?? '').toLowerCase();
    if (!letter || letter.length !== 1) return { ok: false, reason: 'invalid letter' };
    if (t.blank) {
      const idx = remaining.indexOf(BLANK);
      if (idx < 0) return { ok: false, reason: 'no blank tile available' };
      remaining.splice(idx, 1);
    } else {
      const idx = remaining.indexOf(letter);
      if (idx < 0) return { ok: false, reason: 'tile not in rack' };
      remaining.splice(idx, 1);
    }
  }

  const sameRow = tiles.every((t) => t.row === tiles[0].row);
  const sameCol = tiles.every((t) => t.col === tiles[0].col);
  if (!sameRow && !sameCol) return { ok: false, reason: 'tiles must be in one row or column' };
  if (tiles.length > 1) {
    const dir      = sameRow ? 'H' : 'V';
    const coords = tiles.map((t) => (dir === 'H' ? t.col : t.row)).sort((a, b) => a - b);
    const fixed = dir === 'H' ? tiles[0].row : tiles[0].col;
    for (let i = coords[0]; i <= coords[coords.length - 1]; i++) {
      const has = coords.includes(i);
      if (has) continue;
      const [r, c] = dir === 'H' ? [fixed, i] : [i, fixed];
      if (state.board[r][c] === null) return { ok: false, reason: 'gap in play' };
    }
  }

  const lowered         = tiles.map((t) => ({ ...t, letter: (t.letter ?? '').toLowerCase() }));
  const wr = wordsAndScore(state, dict, lowered);
  if (!wr.ok) return { ok: false, reason: wr.reason };

  const touchesAdjacent = touchesExistingTile(state, tiles);
  if (state.round < OPENING_TICKS && !player.hasPlayedEver) {
    if (touchesAdjacent) return { ok: false, reason: 'opening plays may not touch existing tiles' };
    if (!tiles.some((t) => t.row === player.spawn.row && t.col === player.spawn.col)) {
      return { ok: false, reason: 'opening play must cover your spawn square' };
    }
  } else if (!touchesAdjacent) {
    if (!player.hasPlayedEver) {
      const coversSpawn = tiles.some((t) => t.row === player.spawn.row && t.col === player.spawn.col);
      if (!coversSpawn) return { ok: false, reason: 'first play must cover your spawn square or connect to an existing tile' };
    } else {
      return { ok: false, reason: 'play must connect to an existing tile' };
    }
  }

  const damage = splitDamage(capturedByOwnerMap(state, playerId, wr.words), wr.score, state.round).reduce(
    (sum, [, dmg]) => sum + dmg,
    0,
  );
  return { ok: true, score: wr.score, damage };
}

// ---- shared mutators (used by both the round model and the real-time model) ----

// Validates and lands one play on the live board: captures, damage, draw. Returns true if it landed.
// Any other player's pending tiles on the squares it takes are discarded (they were blocked).
function landPlay(
  state           ,
  playerId        ,
  move                                 ,
  dict             ,
  events             ,
)          {
  const player = state.players.find((pl) => pl.id === playerId) ;
  const result = validatePlay(state, playerId, move, dict);
  if (!result.ok) {
    events.push({ type: 'failed', playerId, move, reason: result.reason });
    return false;
  }
  const lowered         = move.tiles.map((t) => ({ ...t, letter: t.letter.toLowerCase() }));
  const wr = wordsAndScore(state, dict, lowered);
  if (!wr.ok) {
    events.push({ type: 'failed', playerId, move, reason: wr.reason });
    return false;
  }

  for (const t of lowered) {
    const idx = player.rack.indexOf(t.blank ? BLANK : t.letter);
    player.rack.splice(idx, 1);
  }

  const capturedByOwner = capturedByOwnerMap(state, playerId, wr.words);
  for (const positions of capturedByOwner.values()) {
    for (const pos of positions) state.board[pos.row][pos.col] .owner = playerId;
  }
  for (const t of lowered) {
    state.board[t.row][t.col] = { letter: t.letter, blank: !!t.blank, owner: playerId };
  }
  player.hasPlayedEver = true;
  player.pending = [];
  player.lastActRound = state.round;

  events.push({ type: 'placed', playerId, tiles: move.tiles, score: wr.score, words: wr.words.map((w) => w.text) });
  for (const [owner, positions] of capturedByOwner) {
    events.push({ type: 'captured', playerId, from: owner, positions });
  }
  for (const [owner, dmg] of splitDamage(capturedByOwner, wr.score, state.round)) {
    const opp = state.players.find((pl) => pl.id === owner);
    if (opp) {
      opp.hp -= dmg;
      events.push({ type: 'damage', playerId: owner, amount: dmg, by: playerId });
    }
  }
  player.rack.push(...drawTiles(state, Math.max(0, 7 - player.rack.length)));

  for (const other of state.players) {
    if (other.id === playerId || !other.pending?.some((p) => state.board[p.row][p.col])) continue;
    events.push({ type: 'failed', playerId: other.id, move: { type: 'play', tiles: other.pending }, reason: `blocked by ${playerId}` });
    other.pending = [];
  }
  return true;
}

function doExchange(state           , p             , move                                     , dict             , events             ) {
  const result = validatePlay(state, p.id, move, dict);
  if (!result.ok) {
    events.push({ type: 'failed', playerId: p.id, move, reason: result.reason });
    return;
  }
  for (const letter of move.letters) p.rack.splice(p.rack.indexOf(letter), 1);
  state.bag.push(...move.letters);
  p.rack.push(...drawTiles(state, move.letters.length));
  p.lastActRound = state.round;
  events.push({ type: 'exchange', playerId: p.id, count: move.letters.length });
}

// Eliminations (HP <= 0), then winner conditions. `staleLimit` = rounds/ticks without a landing.
function settle(state           , events             , staleLimit        ) {
  const active = () => state.players.filter((p) => !p.eliminated);
  const ownedCount = new Map                ();
  for (const row of state.board) {
    for (const cell of row) {
      if (cell && cell.owner) ownedCount.set(cell.owner, (ownedCount.get(cell.owner) ?? 0) + 1);
    }
  }
  // Damage dealt to each victim, to pick a killer.
  const damageDealt = new Map                             (); // victim -> attacker -> total, first-resolved order preserved by insertion
  for (const ev of events) {
    if (ev.type === 'damage') {
      const m = damageDealt.get(ev.playerId) ?? new Map                ();
      m.set(ev.by, (m.get(ev.by) ?? 0) + ev.amount);
      damageDealt.set(ev.playerId, m);
    }
  }

  const justEliminated                = [];
  for (const p of active()) {
    if (p.hp > 0) continue;

    let killer                = null;
    const dealers = damageDealt.get(p.id);
    if (dealers && dealers.size > 0) {
      let bestAmt = -1;
      for (const [attacker, amt] of dealers) {
        if (amt > bestAmt) { bestAmt = amt; killer = attacker; } // first-resolved wins ties
      }
    }

    p.eliminated = true;
    p.pending = [];
    events.push({ type: 'eliminated', playerId: p.id, reason: 'hp', killer });

    state.bag.push(...p.rack);
    p.rack = [];

    for (let r = 0; r < state.boardSide; r++) {
      for (let c = 0; c < state.boardSide; c++) {
        const cell = state.board[r][c];
        if (cell && cell.owner === p.id) cell.owner = null;
      }
    }
    justEliminated.push(p);
  }

  const remaining = active();
  if (remaining.length === 1) {
    state.winner = remaining[0].id;
    state.gameOver = true;
    events.push({ type: 'winner', playerId: state.winner, reason: 'last-standing' });
  } else if (remaining.length === 0 && justEliminated.length > 0) {
    state.winner = pickTiebreakWinner(justEliminated).id;
    state.gameOver = true;
    events.push({ type: 'winner', playerId: state.winner, reason: 'tiebreak' });
  } else if (state.staleRounds >= staleLimit && remaining.length > 1) {
    state.winner = pickTiebreakWinner(remaining, ownedCount).id;
    state.gameOver = true;
    events.push({ type: 'winner', playerId: state.winner, reason: 'stalemate' });
  }
}

// ---- round resolution (simultaneous model; used by offline self-play and tests) ----

                                                                                                                  

export function resolveRound(
  inState           ,
  moves                      ,
  dict             ,
  timedOut           = [],
)                                            {
  const state = structuredClone(inState);
  const events              = [];
  if (state.gameOver) return { state, events };

  const active = () => state.players.filter((p) => !p.eliminated);

  // 1. Gather play candidates, scored+validated against the start-of-round board.
  const candidates                  = [];
  for (const p of active().sort((a, b) => a.seat - b.seat)) {
    const move = moves[p.id] ?? { type: 'pass' };
    if (move.type !== 'play') continue;
    const result = validatePlay(state, p.id, move, dict);
    if (!result.ok) {
      events.push({ type: 'failed', playerId: p.id, move, reason: result.reason });
      continue;
    }
    candidates.push({ playerId: p.id, move, score: result.score ?? 0, tiebreak: nextRandom(state) });
  }
  candidates.sort((a, b) => b.score - a.score || a.tiebreak - b.tiebreak);

  // 2. Land plays in that order, re-validating + re-scoring against the live board.
  let anyLanded = false;
  for (const cand of candidates) {
    if (landPlay(state, cand.playerId, cand.move, dict, events)) anyLanded = true;
  }

  // 3. Exchanges, after all plays, in seat order.
  for (const p of active().sort((a, b) => a.seat - b.seat)) {
    const move = moves[p.id] ?? { type: 'pass' };
    if (move.type === 'exchange') doExchange(state, p, move, dict, events);
    else if (move.type === 'pass') events.push({ type: 'pass', playerId: p.id });
  }

  // 3b. Timeout penalty for players who didn't move before the clock ran out.
  for (const p of active()) {
    if (!timedOut.includes(p.id)) continue;
    p.hp -= TIMEOUT_PENALTY;
    events.push({ type: 'timeout', playerId: p.id, amount: TIMEOUT_PENALTY });
  }

  // 4. Advance the round and track stalemate: resets whenever a play lands, otherwise
  // counts up; the game ends in a stalemate once it reaches 3.
  state.round += 1;
  state.staleRounds = anyLanded ? 0 : state.staleRounds + 1;

  settle(state, events, 3);
  return { state, events };
}

// ---- real-time model ----
// No rounds: players lay down *pending* tiles (visible to all, reserving squares), then commit.
// A commit re-validates against the live board, so an opponent who lands first can block it.
// `state.round` is a clock tick (TICK_SECONDS) that drives damage escalation and cooldown.
// Cooldown timing itself lives in the caller (realtime.ts) — the engine stays clock-free.

export const TICK_SECONDS = 6;
export const OPENING_TICKS = 5; // opening window: a first play may not touch existing tiles
export const IDLE_TICKS = 5; // no committed action for this many ticks => idle drain
export const IDLE_DRAIN = 1; // HP lost per tick while idle
export const STALE_TICKS = 10; // ticks with no landing anywhere => stalemate

// Seconds a player waits after a commit: 5s, minus 1s per 10 ticks, floor 2s.
export function cooldownSeconds(tick        )         {
  return Math.max(2, 5 - Math.floor(tick / 10));
}

// Replaces the player's pending tiles. Only checks what can be known without the final word:
// bounds, empty squares, one line, and that the rack can supply them. Words are checked at commit.
export function setPending(
  inState           ,
  playerId        ,
  tiles        ,
)                                                            {
  const state = structuredClone(inState);
  const events              = [];
  const player = state.players.find((p) => p.id === playerId);
  const err = (error        ) => ({ state: inState, events, error });
  if (!player || player.eliminated || state.gameOver) return err('cannot place');
  const remaining = player.rack.slice();
  const seen = new Set        ();
  for (const t of tiles) {
    if (t.row < 0 || t.col < 0 || t.row >= state.boardSide || t.col >= state.boardSide) return err('tile out of bounds');
    const key = `${t.row},${t.col}`;
    if (seen.has(key)) return err('duplicate tile position');
    seen.add(key);
    if (state.board[t.row][t.col]) return err('square already occupied');
    const idx = remaining.indexOf(t.blank ? BLANK : (t.letter ?? '').toLowerCase());
    if (idx < 0) return err('tile not in rack');
    remaining.splice(idx, 1);
  }
  if (!tiles.every((t) => t.row === tiles[0].row) && !tiles.every((t) => t.col === tiles[0].col)) {
    return err('tiles must be in one row or column');
  }
  player.pending = tiles.map((t) => ({ ...t, letter: t.letter.toLowerCase() }));
  events.push({ type: 'pending', playerId, tiles: player.pending });
  return { state, events };
}

// Commits the player's pending tiles as a play. Pending is cleared either way.
export function commitPending(
  inState           ,
  playerId        ,
  dict             ,
)                                                                                              {
  const state = structuredClone(inState);
  const events              = [];
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.eliminated || state.gameOver) return { state: inState, events, landed: false, reason: 'cannot commit' };
  const tiles = player.pending ?? [];
  if (tiles.length === 0) return { state: inState, events, landed: false, reason: 'nothing placed' };
  player.pending = [];
  const landed = landPlay(state, playerId, { type: 'play', tiles }, dict, events);
  if (landed) state.staleRounds = 0;
  settle(state, events, STALE_TICKS);
  const failed = events.find((e) => e.type === 'failed' && e.playerId === playerId);
  return { state, events, landed, score: events.find((e) => e.type === 'placed')?.score, reason: failed?.type === 'failed' ? failed.reason : undefined };
}

// Exchange / pass as a real-time action. Counts as activity.
export function actNow(
  inState           ,
  playerId        ,
  move                                              ,
  dict             ,
)                                            {
  const state = structuredClone(inState);
  const events              = [];
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.eliminated || state.gameOver) return { state: inState, events };
  if (move.type === 'exchange') doExchange(state, player, move, dict, events);
  else { player.lastActRound = state.round; events.push({ type: 'pass', playerId }); }
  return { state, events };
}

// One clock tick: escalates damage/cooldown, drains idle players, tracks stalemate.
export function tick(inState           )                                            {
  const state = structuredClone(inState);
  const events              = [];
  if (state.gameOver) return { state, events };
  state.round += 1;
  state.staleRounds += 1;
  for (const p of state.players) {
    if (p.eliminated || state.round - (p.lastActRound ?? 0) < IDLE_TICKS) continue;
    p.hp -= IDLE_DRAIN;
    events.push({ type: 'timeout', playerId: p.id, amount: IDLE_DRAIN });
  }
  settle(state, events, STALE_TICKS);
  return { state, events };
}

function pickTiebreakWinner(players               , ownedCount                      )              {
  return players.slice().sort((a, b) => {
    if (b.hp !== a.hp) return b.hp - a.hp;
    const ta = ownedCount?.get(a.id) ?? 0;
    const tb = ownedCount?.get(b.id) ?? 0;
    if (tb !== ta) return tb - ta;
    return a.seat - b.seat;
  })[0];
}
