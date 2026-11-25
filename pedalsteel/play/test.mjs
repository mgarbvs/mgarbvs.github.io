// node test.mjs [sampleRate]: brain -> engine, offline. Benchmarks realtime factor, then plays E major -> legato A major
// and checks the output (non-silent, finite, peak < 1, spectrum matches the chord). Exits non-zero on failure.
import { readFileSync } from "node:fs";
import assert from "node:assert";
import { Engine } from "./engine.js";
import { makeBrain } from "./steel.js";

const SR = +process.argv[2] || 44100, BLK = 128;
const rd = (f) => readFileSync(new URL(f, import.meta.url), "utf8");

function rig() {
    const eng = new Engine(rd("engine.genexpr"), SR);
    let now = 0, tasks = [];
    function Task(fn, ctx) { this.schedule = (ms) => { tasks = tasks.filter((t) => t.o !== this); tasks.push({ o: this, at: now + ms, fn: () => fn.call(ctx) }); }; }
    const brain = makeBrain(rd("steel_brain.js"), Task, (k, v) => eng.set(k, v), () => {});
    brain.S.now = () => now;
    const chunks = [];
    brain.advance = (sec) => { // render, firing the brain's scheduled Tasks (chord window, pre-bend) at their virtual time
        const n = Math.round(sec * SR), L = new Float64Array(n), R = new Float64Array(n);
        for (let i = 0; i < n; i += BLK) {
            for (const t of tasks.filter((t) => t.at <= now)) { tasks = tasks.filter((x) => x !== t); t.fn(); }
            const m = Math.min(BLK, n - i);
            eng.process(m, L.subarray(i), R.subarray(i));
            now += 1000 * m / SR;
        }
        chunks.push(L);
        return L;
    };
    return brain;
}

// Spectrum (Hann, radix-2 FFT) -> magnitudes
function spectrum(x) {
    const N = 32768, re = new Float64Array(N), im = new Float64Array(N), s = x.subarray(x.length - N);
    for (let i = 0; i < N; i++) re[i] = s[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
    for (let i = 1, j = 0; i < N; i++) { let b = N >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; } }
    for (let len = 2; len <= N; len <<= 1) {
        const a = -2 * Math.PI / len;
        for (let i = 0; i < N; i += len) for (let k = 0; k < len / 2; k++) {
            const wr = Math.cos(a * k), wi = Math.sin(a * k), u = i + k, v = u + len / 2;
            const xr = re[v] * wr - im[v] * wi, xi = re[v] * wi + im[v] * wr;
            re[v] = re[u] - xr; im[v] = im[u] - xi; re[u] += xr; im[u] += xi;
        }
    }
    return Float64Array.from({ length: N / 2 }, (_, i) => Math.hypot(re[i], im[i]));
}
const hz = (m) => 440 * 2 ** ((m - 69) / 12), cents = (a, b) => 1200 * Math.log2(a / b);
function checkChord(x, notes, label) {
    let peak = 0, rms = 0;
    for (const v of x) { assert(Number.isFinite(v), label + ": NaN/inf"); peak = Math.max(peak, Math.abs(v)); rms += v * v; }
    rms = Math.sqrt(rms / x.length);
    assert(rms > 0.003, label + ": silent (rms " + rms + ")");
    assert(peak < 1, label + ": peak " + peak);
    const mag = spectrum(x), bin = SR / 65536;
    let top = 0; for (let i = Math.floor(100 / bin); i < 3000 / bin; i++) if (mag[i] > mag[top]) top = i;
    // ponytail: the peak may be a harmonic of a chord note, or the same pitch class an octave down (open strings ring sympathetically)
    const f = top * bin, ok = notes.some((n) => [1, 2, 3, 4, 5, 6, 7, 8].some((h) => Math.abs(cents(f, h * hz(n))) < 30) || [1, 2, 4].some((d) => Math.abs(cents(f, hz(n) / d)) < 30));
    assert(ok, label + ": dominant " + f.toFixed(1) + " Hz is not a harmonic of " + notes);
    const band = Array.from(mag.subarray(Math.floor(100 / bin), Math.floor(1500 / bin))).sort((a, b) => a - b), floor = band[band.length >> 1];
    const found = notes.map((n) => { // strongest bin within 2% of the fundamental, relative to the median level in 100-1500 Hz
        let m = 0; for (let i = Math.floor(hz(n) * 0.98 / bin); i <= Math.ceil(hz(n) * 1.02 / bin); i++) m = Math.max(m, mag[i]);
        return m / floor;
    });
    found.forEach((r, i) => assert(r > 30, label + ": note " + notes[i] + " fundamental missing (" + r.toFixed(1) + "x floor)"));
    console.log(label + ": rms " + rms.toFixed(3) + " peak " + peak.toFixed(3) + " dominant " + f.toFixed(1) + " Hz; fundamentals over floor (dB) " + found.map((r) => (20 * Math.log10(r)).toFixed(0)));
}

// 1. Benchmark: all ten strings picked (Strings mode), 10 s, default knobs.
{
    const b = rig();
    b.mode(1);
    [48, 50, 52, 53, 55, 57, 59, 60, 62, 64].forEach((k) => b.note(k, 100));
    const t0 = performance.now();
    b.advance(10);
    const ms = performance.now() - t0;
    console.log("benchmark @" + SR + " Hz: 10 s of audio in " + ms.toFixed(0) + " ms = " + (10000 / ms).toFixed(1) + "x realtime (" + (ms / 10000).toFixed(3) + " s per audio second)");
}

// 2. E major, then legato A major (A+B pedal bend).
{
    const b = rig();
    b.bendin(0); b.vibrato(0); // deterministic pitch: no random pre-bend, no vibrato
    [59, 64, 68].forEach((n) => b.note(n, 100));
    checkChord(b.advance(1.5), [59, 64, 68], "E major");
    [61, 69].forEach((n) => b.note(n, 100)); b.noteoff(59); b.noteoff(68);
    checkChord(b.advance(1.5), [61, 64, 69], "A major (legato)");
    [61, 64, 69].forEach((n) => b.noteoff(n));
    const tail = b.advance(2);
    for (const v of tail) assert(Number.isFinite(v) && Math.abs(v) < 1, "release tail");
    console.log("all tests passed");
}
