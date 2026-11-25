// steel_brain.js — turns MIDI into a 10-string E9 pedal steel.
// Max `js` (ES5). Outlet 0 → gen~ string params, outlet 1 → steel_neck.js display.
//
// Chords mode: every chord you play is voiced the way a steel player would:
// one bar position + pedals/knee levers. Play legato and the ringing strings
// bend (pedals) or slide (bar) into the new chord instead of being re-picked.
// Strings mode: play it like the real thing — keys pick strings, keys hold
// pedals, the Bar knob / pitch bend moves the bar.

inlets = 1;
outlets = 2;

var OPEN = [66, 63, 68, 64, 59, 56, 54, 52, 50, 47]; // strings 1..10: F# D# G# E B G# F# E D B
var PEDALS = ["A", "B", "C", "LKL", "LKR", "RKL", "RKR"];
var CHANGES = [ // [string index, semitones] per pedal, same order as PEDALS
    [[4, 2], [9, 2]],   // A:   B → C#
    [[2, 1], [5, 1]],   // B:   G# → A
    [[3, 2], [4, 2]],   // C:   E → F#, B → C#
    [[3, 1], [7, 1]],   // LKL: E → F
    [[3, -1], [7, -1]], // LKR: E → D#
    [[0, 1], [6, 1]],   // RKL: F# → G
    [[1, -1], [8, -1]]  // RKR: D# → D, D → C#
];
var RAISES = 1 | 2 | 4 | 8 | 32;
var CAB_DROP = 0.01; // semitones each engaged raise pedal/lever flattens the strings it doesn't move (cabinet flex); tune by ear
var LOW = 47, HIGH = 91, MAX_FRET = 22;
var WINDOW_MS = 12;  // notes this close together form one chord
var GRACE_MS = 60;   // a string released this recently still counts as legato
var STRING_KEYS = { 48: 9, 50: 8, 52: 7, 53: 6, 55: 5, 57: 4, 59: 3, 60: 2, 62: 1, 64: 0 }; // C3..E4 white keys
var PEDAL_KEYS = { 36: 0, 38: 1, 40: 2, 41: 3, 43: 4, 45: 5, 47: 6 };                     // C2..B2 white keys
var MPE_BEND = 48;   // per-note pitch bend range (semitones), the MPE default

function offsets(mask, only) {
    var off = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], up = off.slice(), down = off.slice();
    for (var p = 0; p < 7; p++) {
        if (!(mask & (1 << p)) || (only && !(only & (1 << p)))) continue;
        for (var j = 0; j < CHANGES[p].length; j++) {
            var s = CHANGES[p][j][0], d = CHANGES[p][j][1];
            if (d > 0) up[s] = Math.max(up[s], d); else down[s] = Math.min(down[s], d);
        }
    }
    for (var i = 0; i < 10; i++) off[i] = up[i] + down[i];
    return off;
}

// Pedal combos a player would actually use: any of A/B/C, one left-knee lever, RKL, RKR.
var COMBOS = [];
(function () {
    var knees = [0, 8, 16];
    for (var abc = 0; abc < 8; abc++)
        for (var k = 0; k < 3; k++)
            for (var r = 0; r < 4; r++) COMBOS.push(abc | knees[k] | (r & 1 ? 32 : 0) | (r & 2 ? 64 : 0));
})();
var OFFSETS = {};
function offs(mask) { return OFFSETS[mask] || (OFFSETS[mask] = offsets(mask)); }

// love (the Bend In knob) makes raise pedals cheaper, so the player reaches for them.
function pedalCost(mask, love) {
    var c = 0;
    for (var p = 0; p < 7; p++)
        if (mask & (1 << p)) c += (p < 3 ? 0.8 : 1.2) * (RAISES & (1 << p) ? 1 - love : 1);
    return c;
}

function fold(n) {
    while (n < LOW) n += 12;
    while (n > HIGH) n -= 12;
    return n;
}

var S;
function reset() {
    S = {
        mode: 0, bar: 0, barDial: 0, bendFrets: 0,
        auto: 0, manual: 0, keyPedals: 0, used: 0, // used: latched pedals the current chord needs
        slide: 180, ringMs: 12000, blocks: 0, strum: 12, bendIn: 0.4, vibKnob: 0.25, modwheel: 0, sustain: false,
        keys: {},        // held key → folded note (chords mode) / string (strings mode)
        pending: [],     // [{n, v, tap, ch}] notes waiting for the chord window
        mpe: true,       // MPE switch: off = every channel plays like channel 1
        chan: 1,         // MIDI channel of the message being handled (midiparse sends it first)
        expr: {},        // MPE channel (2..16) → {bend, press, slide} for the note on it
        str: [], sent: [], counter: [],
        prebend: null, now: function () { return new Date().getTime(); }
    };
    for (var i = 0; i < 10; i++) {
        // ch: channel that picked it (0 = released, its MPE expression frozen); mpe/gain/tilt: that expression
        S.str.push({ note: -1, lastNote: -1, releasedAt: -1e9, pluckedAt: -1e9, offset: 0, pre: 0,
                     ch: 0, mpe: 0, gain: 1, tilt: 0.5 });
        S.sent.push(-1); S.counter.push(0);
    }
}
reset();

var chordTask = typeof Task !== "undefined" ? new Task(solve, this) : null;
var bendTask = typeof Task !== "undefined" ? new Task(applyBend, this) : null;

// ── Output helpers ─────────────────────────────────────────────────────────

function mask() { return S.auto | S.manual | S.keyPedals; }
function pedalTime() { return Math.max(60, Math.min(400, S.slide * 0.6)); }

function target(s) {
    var m = mask(), off = offs(m)[s];
    return OPEN[s] + S.bar + S.bendFrets + off + S.str[s].offset + S.str[s].mpe - S.str[s].pre - (off ? 0 : cabDrop(m));
}

function cabDrop(m) {
    var n = 0;
    for (var p = 0; p < 7; p++) if (m & RAISES & (1 << p)) n++;
    return CAB_DROP * n;
}

function sendPitches(glideMs, snap) { // snap: strings about to be picked jump straight to pitch
    for (var s = 0; s < 10; s++) {
        var t = target(s);
        if (t === S.sent[s]) continue;
        outlet(0, "g" + s, snap && snap[s] ? 0 : glideMs);
        outlet(0, "p" + s, t);
        S.sent[s] = t;
    }
    display();
}

function display() {
    var p = [], st = [];
    for (var s = 0; s < 10; s++) p.push(target(s) + S.str[s].pre);
    outlet(1, ["pitches"].concat(p));
    outlet(1, "bar", S.bar + S.bendFrets);
    for (var i = 0; i < 7; i++) {
        var bit = 1 << i;
        st.push((S.manual | S.keyPedals) & bit ? (S.used & bit ? 3 : 2) : S.auto & bit ? 1 : 0);
    }
    outlet(1, ["pedals"].concat(st));
}

function pluckString(s, vel, delayMs) {
    S.counter[s]++;
    S.str[s].pluckedAt = S.now();
    outlet(0, "d" + s, 0);
    outlet(0, "v" + s, vel);
    outlet(0, "w" + s, delayMs);
    outlet(0, "k" + s, S.counter[s]);
    outlet(1, "pluck", s + 1, vel);
}

function damp(s) {
    S.str[s].note = -1;
    S.str[s].ch = 0;
    S.str[s].releasedAt = S.now();
    outlet(0, "d" + s, 1);
    outlet(1, "release", s + 1);
}

// MPE: a string picked on channel 2..16 follows that channel's bend, pressure (level) and
// slide CC 74 (brightness); one picked on channel 1 is plain. Call before sendPitches.
function exprState() {
    for (var s = 0; s < 10; s++) {
        var st = S.str[s], e = st.ch >= 2 ? S.expr[st.ch] : null;
        if (!st.ch) continue;
        st.mpe = e ? e.bend : 0;
        var gain = e && e.press >= 0 ? 0.35 + 0.65 * e.press : 1, tilt = e && e.slide >= 0 ? e.slide : 0.5;
        if (gain !== st.gain) outlet(0, "x" + s, st.gain = gain);
        if (tilt !== st.tilt) outlet(0, "t" + s, st.tilt = tilt);
    }
}

function chanExpr() {
    return S.expr[S.chan] || (S.expr[S.chan] = { bend: 0, press: -1, slide: -1 });
}

function chan(c) { S.chan = S.mpe ? c : 1; }

function mpe(on) { // MPE switch; turning it off makes sounding strings plain
    S.mpe = !!on;
    if (S.mpe) return;
    S.expr = {};
    for (var s = 0; s < 10; s++) if (S.str[s].ch >= 2) S.str[s].ch = 1;
    exprState();
    sendPitches(20);
}

function touch(v) { // channel pressure
    if (S.chan < 2) return;
    chanExpr().press = v / 127;
    exprState();
}

function vibOut() { outlet(0, "vib", Math.max(S.vibKnob, S.modwheel)); }

// ── MIDI input ─────────────────────────────────────────────────────────────

function note(key, vel) {
    if (vel === 0) return noteoff(key);
    if (S.mode === 1) return stringsNoteOn(key, vel / 127);
    var n = fold(key);
    S.keys[key] = n;
    for (var s = 0; s < 10; s++) if (S.str[s].note === n) S.str[s].note = -1; // re-pick a repeated note
    for (var i = 0; i < S.pending.length; i++) if (S.pending[i].n === n) return;
    S.pending.push({ n: n, v: vel / 127, tap: false, ch: S.chan });
    if (S.pending.length === 1) {
        if (chordTask) chordTask.schedule(WINDOW_MS); else solve();
    }
}

function noteoff(key) {
    var n = S.keys[key];
    delete S.keys[key];
    if (n === undefined) {
        if (S.mode === 1 && PEDAL_KEYS[key] !== undefined) {
            S.keyPedals &= ~(1 << PEDAL_KEYS[key]);
            sendPitches(pedalTime());
        }
        return;
    }
    for (var k in S.keys) if (S.keys[k] === n) return; // same note still held by another key
    for (var i = 0; i < S.pending.length; i++) if (S.pending[i].n === n) S.pending[i].tap = true;
    if (S.sustain) return;
    releaseNote(n);
    blockIfIdle();
}

// Last key up (sustain off): palm-block every string, so sympathetic ringing stops with the phrase.
function blockIfIdle() {
    for (var k in S.keys) return;
    if (!S.sustain) outlet(0, "blockall", ++S.blocks);
}

function releaseNote(n) {
    for (var s = 0; s < 10; s++) if (S.str[s].note === n) damp(s);
}

function stringsNoteOn(key, v) {
    if (PEDAL_KEYS[key] !== undefined) {
        S.keyPedals |= 1 << PEDAL_KEYS[key];
        return sendPitches(pedalTime());
    }
    var s = STRING_KEYS[key];
    if (s === undefined) return;
    S.keys[key] = key;
    S.str[s].note = key;
    S.str[s].ch = S.chan;
    exprState();
    var snap = {};
    snap[s] = true;
    sendPitches(20, snap);
    pluckString(s, v, 0);
}

function bend(v) { // midiparse @hires 1 pitch bend, -1..1: ±2 frets on channel 1, that note's string(s) on 2..16
    v = Math.max(-1, Math.min(1, v));
    if (S.chan >= 2) { chanExpr().bend = v * MPE_BEND; exprState(); return sendPitches(10); }
    S.bendFrets = 2 * v;
    sendPitches(20);
}

function cc(num, val) {
    if (num === 1) { S.modwheel = val / 127; vibOut(); }
    else if (num === 11) outlet(0, "volpedal", val / 127);
    else if (num === 74 && S.chan >= 2) { chanExpr().slide = val / 127; exprState(); }
    else if (num === 64) {
        S.sustain = val >= 64;
        if (!S.sustain) {
            var held = {};
            for (var k in S.keys) held[S.keys[k]] = true;
            for (var s = 0; s < 10; s++) if (S.str[s].note >= 0 && !held[S.str[s].note]) damp(s);
            blockIfIdle();
        }
    } else if (num === 123) allOff();
}

function allOff() {
    S.keys = {};
    S.pending = [];
    S.keyPedals = 0;
    for (var s = 0; s < 10; s++) if (S.str[s].note >= 0) damp(s);
    blockIfIdle();
    sendPitches(0);
}

// ── Controls ───────────────────────────────────────────────────────────────

function mode(m) {
    allOff();
    S.mode = m ? 1 : 0;
    S.auto = 0;
    S.used = 0;
    for (var s = 0; s < 10; s++) S.str[s].offset = 0;
    if (S.mode === 1) S.bar = S.barDial;
    outlet(1, "mode", S.mode);
    sendPitches(pedalTime());
}

function bar(f) { // Bar knob / neck drag: moves the bar in both modes
    S.barDial = f;
    S.bar = f;
    for (var s = 0; s < 10; s++) S.str[s].offset = 0;
    sendPitches(40);
}

function pedal(name, on) {
    var i = PEDALS.indexOf(String(name));
    if (i < 0) return;
    if (on) S.manual |= 1 << i; else S.manual &= ~(1 << i);
    S.used &= ~(1 << i);
    sendPitches(pedalTime());
}

function pluck(s, vel) { // click on a string in the neck display (1-based)
    if (s >= 1 && s <= 10) pluckString(s - 1, vel, 0);
}

function slide(ms) { S.slide = ms; }
function ring(ms) { S.ringMs = ms; } // Sustain knob: strings fall 60 dB over this time
function strum(ms) { S.strum = ms; }
function bendin(pct) { S.bendIn = pct / 100; }
function vibrato(pct) { S.vibKnob = pct / 100; vibOut(); }

function init() {
    for (var s = 0; s < 10; s++) S.sent[s] = -1;
    vibOut();
    outlet(1, "mode", S.mode);
    sendPitches(0);
}
function loadbang() { init(); }

// ── The voicing solver ─────────────────────────────────────────────────────

// Score one bar fret + pedal mask for the notes to play. Lower is better.
function evaluate(fret, m, required, old, ctx) {
    var off = offs(m), pitch = [], taken = [], owner = [], i, s;
    for (s = 0; s < 10; s++) { pitch.push(OPEN[s] + fret + off[s]); taken.push(false); owner.push(-1); }

    var dropped = 0, kept = [];
    for (i = 0; i < old.length; i++) {
        s = old[i].s;
        owner[s] = i;
        if (old[i].held && pitch[s] === old[i].n) { taken[s] = true; kept.push(s); }
        else if (old[i].held) dropped++;
    }

    var assign = [], uncovered = [], bonus = 0, reused = 0, used = kept.slice();
    for (i = 0; i < required.length; i++) {
        var n = required[i].n, best = -1, bestScore = 1e9;
        for (s = 0; s < 10; s++) {
            if (taken[s] || pitch[s] !== n) continue;
            var sc = 10;                    // a fresh string
            // ringing string glides; same note again is a re-pick, not a slide
            if (owner[s] >= 0 && ctx.glide && old[owner[s]].n !== n) sc = Math.abs(n - old[owner[s]].n);
            if (sc < bestScore) { bestScore = sc; best = s; }
        }
        if (best < 0) { uncovered.push(i); continue; }
        taken[best] = true;
        used.push(best);
        assign.push({ s: best, i: i, glide: bestScore < 10 });
        if (bestScore < 10) {
            if (old[owner[best]].held) reused++;
            bonus += bestScore <= 2 && fret === ctx.bar ? 2 : bestScore <= 5 ? 1 : 0;
        }
    }

    // Notes no bar/pedal combo covers: bend them behind the bar on a free string.
    var fallback = 0;
    for (i = 0; i < uncovered.length; i++) {
        var u = required[uncovered[i]].n, bs = -1;
        for (s = 0; s < 10; s++)
            if (!taken[s] && Math.abs(pitch[s] - u) <= 4 && (bs < 0 || Math.abs(pitch[s] - u) < Math.abs(pitch[bs] - u))) bs = s;
        if (bs < 0) { fallback += 100; continue; }
        fallback += 20 + 2 * Math.abs(pitch[bs] - u);
        taken[bs] = true;
        used.push(bs);
        assign.push({ s: bs, i: uncovered[i], glide: false, offset: u - pitch[bs] });
    }

    var lo = 10, hi = -1;
    for (i = 0; i < used.length; i++) { lo = Math.min(lo, used[i]); hi = Math.max(hi, used[i]); }
    var changed = 0;
    for (var p = 0; p < 7; p++) if ((m ^ ctx.auto) & (1 << p)) changed++;

    var cost = fallback + 6 * (dropped - reused) - bonus
        + (ctx.legato ? 1 : 0.25) * Math.abs(fret - ctx.bar)
        + pedalCost(m, ctx.love) + (ctx.legato ? 0.3 * changed : 0)
        + 0.03 * fret + (hi > lo ? 0.15 * (hi - lo) : 0);
    return { cost: cost, fret: fret, mask: m, assign: assign, kept: kept };
}

// Only frets where the top (melody) note lands exactly on a string are tried;
// if there are none at all, every fret is.
function findVoicing(required, old, ctx) {
    var best = null, top = required[0].n;
    for (var exact = 1; exact >= 0 && !best; exact--) {
        for (var c = 0; c < COMBOS.length; c++) {
            var m = COMBOS[c] | ctx.manual, off = offs(m);
            for (var f = 0; f <= MAX_FRET; f++) {
                if (exact && !hits(top, f, off)) continue;
                var r = evaluate(f, m, required, old, ctx);
                if (!best || r.cost < best.cost) best = r;
            }
        }
    }
    return best;
}

function hits(n, fret, off) {
    for (var s = 0; s < 10; s++) if (OPEN[s] + fret + off[s] === n) return true;
    return false;
}

function solve() {
    var now = S.now(), i, s;
    var required = S.pending.slice(0, 10).sort(function (a, b) { return b.n - a.n; });
    S.pending = [];
    if (!required.length) return;

    // Strings still ringing under a held key, or released a moment ago, can slide/bend.
    var old = [];
    for (s = 0; s < 10; s++) {
        var st = S.str[s];
        if (st.note >= 0) old.push({ s: s, n: st.note, held: true });
        else if (now - st.releasedAt < GRACE_MS && st.lastNote >= 0) old.push({ s: s, n: st.lastNote, held: false });
    }
    var heldCount = 0;
    for (i = 0; i < old.length; i++) if (old[i].held) heldCount++;
    var legato = old.length > 0;
    // Adding one note on top of a held chord is harmony, not a slide.
    var ctx = {
        bar: S.bar, auto: S.auto, manual: S.manual | S.keyPedals, legato: legato, love: S.bendIn,
        glide: legato && !(required.length === 1 && heldCount >= 2)
    };
    var v = findVoicing(required, old, ctx);

    var barMoved = v.fret !== S.bar;
    S.bar = v.fret;
    S.auto = v.mask & ~ctx.manual;
    for (s = 0; s < 10; s++) { S.str[s].offset = 0; S.str[s].pre = 0; }

    // Held strings that no longer fit the new voicing stop ringing.
    var assigned = {};
    for (i = 0; i < v.assign.length; i++) assigned[v.assign[i].s] = true;
    for (s = 0; s < 10; s++)
        if (S.str[s].note >= 0 && v.kept.indexOf(s) < 0 && !assigned[s]) damp(s);
    for (i = 0; i < v.kept.length; i++) assigned[v.kept[i]] = true;
    S.used = 0;
    for (var p = 0; p < 7; p++)
        for (var j = 0; ctx.manual & (1 << p) && j < CHANGES[p].length; j++)
            if (assigned[CHANGES[p][j][0]]) S.used |= 1 << p;

    // Pedal "cry": sometimes pick the chord unpedaled, then press the pedals.
    var raise = offsets(S.auto, RAISES), plucks = [];
    var bendInNow = S.auto & RAISES && Math.random() < S.bendIn;
    for (i = 0; i < v.assign.length; i++) {
        var a = v.assign[i];
        S.str[a.s].offset = a.offset || 0;
        S.str[a.s].note = required[a.i].n;
        S.str[a.s].lastNote = required[a.i].n;
        S.str[a.s].ch = required[a.i].ch;
        if (a.glide) {
            outlet(0, "d" + a.s, 0);
            if (now - S.str[a.s].pluckedAt > S.ringMs / 3) plucks.push(a); // faded 20 dB+: pick it as it slides
            continue;
        }
        if (bendInNow && raise[a.s] > 0) S.str[a.s].pre = raise[a.s];
        plucks.push(a);
    }

    // Ringing strings glide; strings about to be picked snap to pitch.
    var snap = {};
    for (i = 0; i < plucks.length; i++) if (!plucks[i].glide) snap[plucks[i].s] = true;
    exprState();
    sendPitches(barMoved ? S.slide : pedalTime(), snap);
    plucks.sort(function (x, y) { return y.s - x.s; }); // strum low → high
    for (i = 0; i < plucks.length; i++) {
        var r = required[plucks[i].i];
        pluckString(plucks[i].s, r.v, i * S.strum);
        if (r.tap && !S.sustain) damp(plucks[i].s);
    }
    for (s = 0; s < 10; s++) if (S.str[s].pre) {
        S.prebend = true;
        if (bendTask) bendTask.schedule(plucks.length * S.strum + 90); else applyBend();
        break;
    }
}

function applyBend() {
    for (var s = 0; s < 10; s++) S.str[s].pre = 0;
    S.prebend = null;
    sendPitches(pedalTime());
}

if (typeof module !== "undefined") {
    module.exports = {
        get S() { return S; }, reset: reset, note: note, noteoff: noteoff, solve: solve, applyBend: applyBend,
        bend: bend, cc: cc, chan: chan, touch: touch, mpe: mpe, mode: mode, bar: bar, pedal: pedal, pluck: pluck, init: init,
        bendin: bendin, strum: strum, slide: slide, ring: ring, vibrato: vibrato,
        offsets: offsets, findVoicing: findVoicing, target: target, OPEN: OPEN, COMBOS: COMBOS
    };
}
