// steel.js: glue shared by the page and test.mjs. Runs the unchanged Max scripts (steel_brain.js, steel_neck.js)
// with the Max globals they use shimmed, and mirrors PedalSteel.maxpat's knob wiring (scripts/build_maxpat.py).

// Run a Max js script. g = its globals (outlet, Task, box, mgraphics...). Returns its module.exports.
export function load(src, g) {
    var names = Object.keys(g), mod = { exports: {} };
    Function.apply(null, ["module", "post", "inlets", "outlets"].concat(names, [src])).apply(null, [mod, function () {}, 0, 0].concat(names.map(function (k) { return g[k]; })));
    return mod.exports;
}

// outlet(o, "name", a, b) or outlet(o, ["name", a, b]) -> [o, "name", [a, b]]
export function parseOutlet(args) {
    var r = Array.prototype.slice.call(args, 1);
    if (Array.isArray(r[0])) r = r[0];
    return [args[0], r[0], r.slice(1)];
}

// The device's controls: id, label, min, max, default, brain function (or null), gen~ param (or null). Sustain feeds both.
export var KNOBS = [
    ["bar", "Bar", 0, 22, 0, "bar", null],
    ["slide", "Slide", 20, 1000, 180, "slide", null],
    ["strum", "Strum", 0, 80, 12, "strum", null],
    ["bendin", "Bend In", 0, 100, 40, "bendin", null],
    ["vibrato", "Vibrato", 0, 100, 25, "vibrato", null],
    ["swell", "Swell", 0, 2000, 0, null, "swell"],
    ["sustain", "Sustain", 2000, 30000, 12000, "ring", "sustain"],
    ["tone", "Tone", 0, 100, 60, null, "tone"],
    ["reverb", "Reverb", 0, 100, 30, null, "reverb"],
    ["volume", "Volume", -40, 6, 0, null, "volume"]
];

// Build the brain. toEngine(name, value) gets outlet 0 (gen~ params), toNeck(name, args) gets outlet 1.
export function makeBrain(src, Task, toEngine, toNeck) {
    var b = load(src, { Task: Task, outlet: function () {
        var m = parseOutlet(arguments);
        if (m[0] === 0) toEngine(m[1], m[2][0]); else toNeck(m[1], m[2]);
    } });
    b.setKnob = function (id, v) {
        var k = KNOBS.filter(function (x) { return x[0] === id; })[0];
        if (k[5]) b[k[5]](v);
        if (k[6]) toEngine(k[6], v);
    };
    // Max's load order: every control pushes its value (mpe switch on, mode Chords), then init.
    b.mode(0); b.mpe(1);
    KNOBS.forEach(function (k) { b.setKnob(k[0], k[4]); });
    b.init();
    return b;
}
