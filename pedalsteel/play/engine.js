// engine.js: runs the PedalSteel gen~ codebox (engine.genexpr) as plain JS. Shared by worklet.js and test.mjs.
// Port of tests/gen_shim.js (PedalSteelGuitarBench), compiled to one block function with every GenExpr variable
// a local, so it runs fast enough for an AudioWorklet. sr comes from the caller (the AudioContext's rate).

function Delay(n) { this.buf = new Float64Array(n); this.i = 0; this.m = (n & (n - 1)) ? 0 : n - 1; }
Delay.prototype.write = function (x) { this.buf[this.i] = x; this.i = this.m ? (this.i + 1) & this.m : (this.i + 1) % this.buf.length; };
Delay.prototype.read = function (t) { // t samples ago, t=1 = last write; Catmull-Rom cubic
    var b = this.buf, n = b.length, m = this.m, pos = this.i - t, i1 = Math.floor(pos), fr = pos - i1, a, c, d, e;
    if (m) { a = b[(i1 - 1) & m]; c = b[i1 & m]; d = b[(i1 + 1) & m]; e = b[(i1 + 2) & m]; }
    else { a = b[(((i1 - 1) % n) + n) % n]; c = b[((i1 % n) + n) % n]; d = b[(((i1 + 1) % n) + n) % n]; e = b[(((i1 + 2) % n) + n) % n]; }
    return c + 0.5 * fr * (d - a + fr * (2 * a - 5 * c + 4 * d - e + fr * (3 * (c - d) + e - a)));
};

export function Engine(code, sr) {
    var seed = 1; // seeded noise: every run renders the same pick
    var st = this.st = {
        samplerate: sr, twopi: 2 * Math.PI, pi: Math.PI, floor: Math.floor, in1: 0, in2: 0, out1: 0, out2: 0,
        mtof: function (m) { return 440 * Math.pow(2, (m - 69) / 12); },
        clamp: function (x, a, b) { return Math.min(b, Math.max(a, x)); },
        wrap: function (x, a, b) { var r = b - a; return x - r * Math.floor((x - a) / r); },
        noise: function () { seed = (seed * 16807) % 2147483647; return seed / 1073741823.5 - 1; },
        dbtoa: function (d) { return Math.pow(10, d / 20); },
        mod: function (x, y) { return x % y; }, fract: function (x) { return x - Math.floor(x); }, round: Math.round, exp2: function (x) { return Math.pow(2, x); },
        min: Math.min, max: Math.max, sin: Math.sin, cos: Math.cos, exp: Math.exp, tanh: Math.tanh,
        atan2: Math.atan2, log: Math.log, sqrt: Math.sqrt, abs: Math.abs, pow: Math.pow
    };
    var body = [];
    code.split("\n").forEach(function (ln) {
        var m = ln.match(/^(Param|History|Delay) (\w+)\(([^)]*)\);$/);
        if (!m) return body.push(ln);
        st[m[2]] = m[1] === "Delay" ? new Delay(+m[3]) : +m[3];
    });
    var js = body.join("\n").replace(/\/\/.*$/gm, "") // comments out: a trailing "." would hide the next line's first name
        .replace(/\b(\w+)="(\w+)"/g, '"$2"'); // interp="cubic" -> "cubic"
    var KW = { "if": 1, "else": 1, "for": 1, "while": 1, "break": 1, "continue": 1 }, ids = {};
    (js.match(/\b[a-zA-Z_]\w*\b/g) || []).forEach(function (id) { if (!KW[id]) ids[id] = 1; });
    Object.keys(st).forEach(function (id) { ids[id] = 1; });
    Object.keys(ids).forEach(function (id) { if (!(id in st)) st[id] = 0; });
    var names = Object.keys(ids), nums = names.filter(function (id) { return typeof st[id] === "number"; });
    // Block function: every identifier is a local, loaded once per block and written back after it.
    var src = "var " + names.map(function (id) { return id + "=__st." + id; }).join(",") + ";\n" +
        "for (var __j = 0; __j < __N; __j++) {\n" + js + "\n__oL[__j] = out1; __oR[__j] = out2; }\n" +
        nums.map(function (id) { return "__st." + id + "=" + id + ";"; }).join("");
    this.block = new Function("__st", "__N", "__oL", "__oR", src);
}
Engine.prototype.set = function (name, v) {
    if (typeof this.st[name] !== "number") throw new Error("no gen param " + name);
    this.st[name] = v;
};
Engine.prototype.process = function (n, L, R) { this.block(this.st, n, L, R); };
Engine.prototype.run = function (sec) {
    var n = Math.round(sec * this.st.samplerate), L = new Float64Array(n), R = new Float64Array(n);
    this.process(n, L, R);
    return [L, R];
};
