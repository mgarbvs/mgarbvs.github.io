// Legal move generation + bots. Anchor-based search (trie + cross-checks): anchors are
// empty squares adjacent to any tile (plus the player's spawn if they haven't played),
// restricted to a window near the player's own tiles/spawn for speed.
                                                         
import { BLANK, validatePlay } from './engine.js';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz'.split('');

                     
function step(dir     )                             {
  return dir === 'H' ? { dr: 0, dc: 1 } : { dr: 1, dc: 0 };
}

                                                              

function buildTrie(words                  )           {
  const root           = { next: new Map(), end: false };
  for (const w of words) {
    let node = root;
    for (const ch of w) {
      let next = node.next.get(ch);
      if (!next) {
        next = { next: new Map(), end: false };
        node.next.set(ch, next);
      }
      node = next;
    }
    node.end = true;
  }
  return root;
}

const trieCache = new WeakMap                       ();
function getTrie(dict             )           {
  let trie = trieCache.get(dict);
  if (!trie) {
    trie = buildTrie(dict);
    trieCache.set(dict, trie);
  }
  return trie;
}

// Letters that could legally sit at (row,col) given the perpendicular word already on
// the board there, or null if unconstrained (no perpendicular neighbors).
function crossCheckSet(
  state           ,
  dict             ,
  row        ,
  col        ,
  dir     ,
)                     {
  const perp      = dir === 'H' ? 'V' : 'H';
  const { dr, dc } = step(perp);
  const side = state.boardSide;
  let prefix = '';
  let pr = row - dr, pc = col - dc;
  while (pr >= 0 && pc >= 0 && pr < side && pc < side && state.board[pr][pc]) {
    prefix = state.board[pr][pc] .letter + prefix;
    pr -= dr; pc -= dc;
  }
  let suffix = '';
  let sr = row + dr, sc = col + dc;
  while (sr >= 0 && sc >= 0 && sr < side && sc < side && state.board[sr][sc]) {
    suffix += state.board[sr][sc] .letter;
    sr += dr; sc += dc;
  }
  if (!prefix && !suffix) return null;
  const allowed = new Set        ();
  for (const ch of ALPHABET) {
    if (dict.has(prefix + ch + suffix)) allowed.add(ch);
  }
  return allowed;
}

// ponytail: anchors are windowed to Chebyshev distance 3 of an owned tile/spawn for
// speed — bots won't see far-off plays. Full-board search only when the player owns
// nothing and has already played (no anchor point to window around).
const ANCHOR_WINDOW = 3;

function findAnchors(state           , playerId        )                                 {
  const player = state.players.find((p) => p.id === playerId) ;
  const side = state.boardSide;
  const owned                                 = [];
  for (let r = 0; r < side; r++) {
    for (let c = 0; c < side; c++) {
      if (state.board[r][c]?.owner === playerId) owned.push({ row: r, col: c });
    }
  }

  let minR = 0, maxR = side - 1, minC = 0, maxC = side - 1;
  if (owned.length > 0 || !player.hasPlayedEver) {
    const points = owned.length > 0 ? [...owned, player.spawn] : [player.spawn];
    minR = Math.max(0, Math.min(...points.map((p) => p.row)) - ANCHOR_WINDOW);
    maxR = Math.min(side - 1, Math.max(...points.map((p) => p.row)) + ANCHOR_WINDOW);
    minC = Math.max(0, Math.min(...points.map((p) => p.col)) - ANCHOR_WINDOW);
    maxC = Math.min(side - 1, Math.max(...points.map((p) => p.col)) + ANCHOR_WINDOW);
  }

  const anchors                                 = [];
  const seen = new Set        ();
  const deltas = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) {
      if (state.board[r][c] !== null) continue;
      const adjacent = deltas.some(([dr, dc]) => {
        const nr = r + dr, nc = c + dc;
        return nr >= 0 && nc >= 0 && nr < side && nc < side && state.board[nr][nc] !== null;
      });
      if (!adjacent) continue;
      const key = `${r},${c}`;
      seen.add(key);
      anchors.push({ row: r, col: c });
    }
  }
  if (!player.hasPlayedEver && state.board[player.spawn.row][player.spawn.col] === null) {
    const key = `${player.spawn.row},${player.spawn.col}`;
    if (!seen.has(key)) anchors.push(player.spawn);
  }
  return anchors;
}

// DFS from a single empty anchor square, in one direction, using the trie to build
// only words that are valid prefixes, and cross-checks to keep each new tile's
// perpendicular word legal. Every result includes the anchor square.
function searchDirection(
  state           ,
  dict             ,
  trie          ,
  rack          ,
  anchor                              ,
  dir     ,
)           {
  const side = state.boardSide;
  const { dr, dc } = step(dir);
  const board = state.board;
  const results           = [];

  // Mandatory left run: walk back through any existing tiles already touching the anchor.
  let startR = anchor.row, startC = anchor.col;
  while (true) {
    const pr = startR - dr, pc = startC - dc;
    if (pr < 0 || pc < 0 || pr >= side || pc >= side || !board[pr][pc]) break;
    startR = pr; startC = pc;
  }
  // How much further left we could extend with new rack tiles.
  let maxExtra = 0;
  {
    let r = startR - dr, c = startC - dc;
    while (
      r >= 0 && c >= 0 && r < side && c < side &&
      !board[r][c] && maxExtra < rack.length
    ) {
      maxExtra++;
      r -= dr; c -= dc;
    }
  }

  const placedTiles         = [];

  const tryRecord = (node          ) => {
    if (!node.end || placedTiles.length === 0) return;
    if (!placedTiles.some((t) => t.row === anchor.row && t.col === anchor.col)) return;
    results.push(placedTiles.map((t) => ({ ...t })));
  };

  const walk = (r        , c        , node          , remaining          ) => {
    if (r < 0 || c < 0 || r >= side || c >= side) {
      tryRecord(node);
      return;
    }
    const existing = board[r][c];
    if (existing) {
      const next = node.next.get(existing.letter);
      if (!next) return;
      walk(r + dr, c + dc, next, remaining);
      return;
    }
    tryRecord(node);
    const cross = crossCheckSet(state, dict, r, c, dir);
    const tried = new Set        ();
    for (let i = 0; i < remaining.length; i++) {
      const rackTile = remaining[i];
      const letters = rackTile === BLANK ? ALPHABET : [rackTile];
      for (const letter of letters) {
        const branchKey = letter + (rackTile === BLANK ? '?' : '');
        if (tried.has(branchKey)) continue;
        tried.add(branchKey);
        const next = node.next.get(letter);
        if (!next) continue;
        if (cross && !cross.has(letter)) continue;
        const nextRemaining = remaining.slice();
        nextRemaining.splice(i, 1);
        placedTiles.push({ row: r, col: c, letter, blank: rackTile === BLANK });
        walk(r + dr, c + dc, next, nextRemaining);
        placedTiles.pop();
      }
    }
  };

  for (let extra = 0; extra <= maxExtra; extra++) {
    const begR = startR - extra * dr, begC = startC - extra * dc;
    walk(begR, begC, trie, rack);
  }
  return results;
}

                                                                             

export function generateMoves(state           , playerId        , dict             )                  {
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.eliminated) return [];
  const trie = getTrie(dict);
  const anchors = findAnchors(state, playerId);

  const seen = new Set        ();
  const out                  = [];
  for (const anchor of anchors) {
    for (const dir of ['H', 'V']         ) {
      const candidates = searchDirection(state, dict, trie, player.rack, anchor, dir);
      for (const tiles of candidates) {
        const key = tiles
          .slice()
          .sort((a, b) => a.row - b.row || a.col - b.col)
          .map((t) => `${t.row},${t.col},${t.letter}${t.blank ? '!' : ''}`)
          .join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        const move       = { type: 'play', tiles };
        const result = validatePlay(state, playerId, move, dict);
        if (result.ok) out.push({ tiles, score: result.score ?? 0, damage: result.damage ?? 0 });
      }
    }
  }
  return out;
}

function fallbackMove(state           , playerId        )       {
  const player = state.players.find((p) => p.id === playerId) ;
  const n = Math.min(player.rack.length, state.bag.length);
  if (n > 0) return { type: 'exchange', letters: player.rack.slice(0, n) };
  return { type: 'pass' };
}

export function createRng(seed        )               {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomBot(state           , playerId        , dict             , rng              )       {
  const moves = generateMoves(state, playerId, dict);
  if (moves.length === 0) return fallbackMove(state, playerId);
  const pick = moves[Math.floor(rng() * moves.length)];
  return { type: 'play', tiles: pick.tiles };
}

export function greedyBot(state           , playerId        , dict             )       {
  const moves = generateMoves(state, playerId, dict);
  if (moves.length === 0) return fallbackMove(state, playerId);
  let best = moves[0];
  for (const m of moves) if (m.score > best.score) best = m;
  return { type: 'play', tiles: best.tiles };
}

export function aggressiveBot(state           , playerId        , dict             )       {
  const moves = generateMoves(state, playerId, dict);
  if (moves.length === 0) return fallbackMove(state, playerId);
  let best = moves[0];
  for (const m of moves) if (m.score + m.damage > best.score + best.damage) best = m;
  return { type: 'play', tiles: best.tiles };
}
