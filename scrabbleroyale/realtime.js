// Real-time game loop shared by the server and the offline browser game: wraps the pure
// engine with a tick clock, per-player commit cooldowns, and bot players. See RULES.md.
import { createGame, setPending, commitPending, actNow, tick, cooldownSeconds, TICK_SECONDS } from './engine.js';
                                                                    
import { aggressiveBot, greedyBot, randomBot } from './movegen.js';

                                              
                                                    
const DIFFICULTY_PACE                             = { easy: 1.8, medium: 1, hard: 0.6 };

const BOT_NAMES = [
  'Edmund', 'Sigmund', 'Agatha', 'Beatrix', 'Cornelius', 'Dorothea', 'Ignatius', 'Hildegard',
  'Ophelia', 'Barnaby', 'Winifred', 'Archibald', 'Mathilda', 'Percival', 'Rosalind', 'Thaddeus',
  'Imogen', 'Leopold', 'Clementine', 'Ambrose', 'Henrietta', 'Augustin', 'Gertrude', 'Florian',
  'Josephine', 'Octavia', 'Rupert', 'Esmeralda', 'Wilhelmina', 'Bartholomew', 'Philippa', 'Reginald',
];

// `count` distinct-looking bot names in random order (past the list's length they repeat with a number).
export function botNames(count        , rand               = Math.random)           {
  const pool = BOT_NAMES.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return Array.from({ length: count }, (_, i) => pool[i % pool.length] + (i >= pool.length ? ` ${Math.floor(i / pool.length) + 1}` : ''));
}

// Bots alternate kinds by seat: bot1 aggressive, bot2 greedy, ...
export function botKind(id        )          {
  return Number(id.slice(3)) % 2 === 1 ? 'aggressive' : 'greedy';
}

// easy plays any valid word, hard always goes for damage, medium keeps each bot's own kind.
export function botStyle(kind         , difficulty             = 'medium')                   {
  return difficulty === 'easy' ? 'easy' : difficulty === 'hard' ? 'aggressive' : kind;
}
                                                                                                                                    

export class RealtimeGame {
  state           ;
  cooldownUntil = new Map                ();
          timers = new Set                               ();
          ticker                                        = null;
          dict             ;
          bots                         ;
          onUpdate                               ;
          speed        ;
          pace                         = {}; // per-bot delay multiplier: <1 fast, >1 slow
          difficulty            ;

  // `speed` scales every real-time delay (tests use a large value).
  constructor(opts                                                                                                                                                                                                  ) {
    this.dict = opts.dict;
    this.bots = opts.bots ?? {};
    this.onUpdate = opts.onUpdate;
    this.speed = opts.speed ?? 1;
    this.difficulty = opts.difficulty ?? 'medium';
    const base = DIFFICULTY_PACE[this.difficulty];
    Object.keys(this.bots).forEach((id, i) => { this.pace[id] = base * [0.5, 1, 1.8, 0.75, 2.5][i % 5]; });
    this.state = createGame({ players: opts.players, seed: opts.seed, dictionary: opts.dict, randomSpawns: opts.randomSpawns });
  }

  start() {
    this.ticker = setInterval(() => this.apply(tick(this.state)), (TICK_SECONDS * 1000) / this.speed);
    for (const id of Object.keys(this.bots)) this.scheduleBot(id, 2000);
  }

  stop() {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

          apply(r                                           ) {
    this.state = r.state;
    if (r.events.length) this.onUpdate(r.events);
    if (this.state.gameOver) this.stop();
  }

  place(id        , tiles        )            {
    const r = setPending(this.state, id, tiles);
    if (r.error) return { ok: false, reason: r.error };
    this.apply(r);
    return { ok: true, cooldownUntil: this.cooldownUntil.get(id) ?? 0 };
  }

  commit(id        )            {
    const wait = (this.cooldownUntil.get(id) ?? 0) - Date.now();
    if (wait > 0) return { ok: false, reason: 'cooldown', cooldownUntil: this.cooldownUntil.get(id) };
    const r = commitPending(this.state, id, this.dict);
    this.apply(r);
    if (!r.landed) return { ok: false, reason: r.reason ?? 'play failed' };
    return { ok: true, score: r.score, cooldownUntil: this.startCooldown(id) };
  }

  act(id        , move                                              )            {
    const wait = (this.cooldownUntil.get(id) ?? 0) - Date.now();
    if (wait > 0) return { ok: false, reason: 'cooldown', cooldownUntil: this.cooldownUntil.get(id) };
    const r = actNow(this.state, id, move, this.dict);
    this.apply(r);
    const failed = r.events.find((e) => e.type === 'failed' && e.playerId === id);
    if (failed?.type === 'failed') return { ok: false, reason: failed.reason };
    return { ok: true, cooldownUntil: this.startCooldown(id) };
  }

          startCooldown(id        )         {
    const until = Date.now() + (cooldownSeconds(this.state.round) * 1000) / this.speed;
    this.cooldownUntil.set(id, until);
    return until;
  }

          later(ms        , fn            ) {
    const t = setTimeout(() => { this.timers.delete(t); fn(); }, ms / this.speed);
    this.timers.add(t);
  }

  // A bot thinks, lays its word down letter by letter, gives opponents a beat to block it, then commits.
          scheduleBot(id        , thinkMs        ) {
    this.later(thinkMs, () => {
      const p = this.state.players.find((x) => x.id === id);
      if (!p || p.eliminated || this.state.gameOver) return;
      const style = botStyle(this.bots[id], this.difficulty);
      const move = style === 'easy' ? randomBot(this.state, id, this.dict, Math.random)
        : (style === 'aggressive' ? aggressiveBot : greedyBot)(this.state, id, this.dict);
      const pace = this.pace[id] ?? 1;
      const next = () => this.scheduleBot(id, (1500 + Math.random() * 2500) * pace);
      if (move.type !== 'play') {
        const wait = (this.cooldownUntil.get(id) ?? 0) - Date.now();
        if (move.type === 'exchange' && wait <= 0) this.act(id, move);
        return next();
      }
      // Letter by letter (~0.6s each), then a beat for opponents to block it before committing.
      const lay = (n        ) => {
        if (!this.place(id, move.tiles.slice(0, n)).ok) return next();
        if (n < move.tiles.length) return this.later(600 * pace, () => lay(n + 1));
        this.later(1500 * pace, () => { this.commit(id); next(); });
      };
      lay(1);
    });
  }
}
