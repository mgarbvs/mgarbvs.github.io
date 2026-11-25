// steel_neck.js
// jsui: draws the neck (10 strings, sliding bar, pedal board) and reports mouse actions.
// Receives state from the "brain" patch on inlet 0, sends mouse actions on outlet 0.

inlets = 1;
outlets = 1;

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

var OPEN = [66, 63, 68, 64, 59, 56, 54, 52, 50, 47];
var NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
var PEDAL_NAMES = ["A", "B", "C", "LKL", "LKR", "RKL", "RKR"];

var HINT_CHORDS = "Play chords on your keys. Hold notes and change chords to hear bends. Click strings, drag the bar.";
var HINT_STRINGS = "White keys C3–E4 pick strings 10→1 · C2–B2 hold pedals & levers · Bar knob / pitch bend slides";
var LEGEND_TEXT = "A: B→C#  B: G#→A  C: E→F#";

// ---- state (set by inlet messages from the brain) ----
var pitchesArr = OPEN.slice(0);
var barTarget = 0;
var barCurrent = 0;
var pedalState = [0, 0, 0, 0, 0, 0, 0];
var glow = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
var glowDecay = [0.985, 0.985, 0.985, 0.985, 0.985, 0.985, 0.985, 0.985, 0.985, 0.985];
var currentMode = 0;

// ---- mouse tracking ----
var neckMouseDown = false;
var neckDownX = 0;

// ---- animation ----
var animRunning = false;
function onTaskFire() {
	var changed = false;
	var diff = barTarget - barCurrent;
	if (Math.abs(diff) > 0.001) {
		barCurrent += diff * 0.35;
		changed = true;
	} else if (barCurrent !== barTarget) {
		barCurrent = barTarget;
	}
	for (var i = 0; i < 10; i++) {
		if (glow[i] > 0.01) {
			glow[i] *= glowDecay[i];
			changed = true;
			if (glow[i] <= 0.01) glow[i] = 0;
		}
	}
	mgraphics.redraw();
	if (!changed) stopAnimating();
}

var animTask = new Task(onTaskFire, this);
animTask.interval = 33;

function ensureAnimating() {
	if (!animRunning) {
		animRunning = true;
		animTask.repeat();
	}
}

function stopAnimating() {
	if (animRunning) {
		animRunning = false;
		animTask.cancel();
	}
}

// ---- geometry ----
function neckGeom() {
	var w = box.rect[2] - box.rect[0];
	var h = box.rect[3] - box.rect[1];
	var sx = w / 470;
	var sy = h / 158;
	var gutter = 30 * sx;
	return {
		w: w,
		h: h,
		sx: sx,
		sy: sy,
		gutter: gutter,
		x0: gutter + 8 * sx,
		x24: w - 10 * sx,
		yTop: 16 * sy,
		yBottom: 96 * sy,
		fretStripTop: 98 * sy,
		fretStripBottom: 110 * sy,
		pedalTop: 114 * sy,
		pedalHeight: 20 * sy,
		hintTop: 140 * sy
	};
}

function fretX(fret, g) {
	return g.x0 + (g.x24 - g.x0) * (fret / 24);
}

function xToFret(x, g) {
	return (x - g.x0) / (g.x24 - g.x0) * 24;
}

function clampFret(fret) {
	fret = Math.round(fret * 100) / 100;
	if (fret < 0) fret = 0;
	if (fret > 22) fret = 22;
	return fret;
}

function stringY(s, g) {
	return g.yTop + (g.yBottom - g.yTop) * ((s - 1) / 9);
}

function pedalRects(g) {
	var y = g.pedalTop;
	var h = g.pedalHeight;
	var x = g.gutter + 8 * g.sx;
	var wSmall = 30 * g.sx;
	var gapSmall = 4 * g.sx;
	var gapBig = 14 * g.sx;
	var wLever = 36 * g.sx;
	var rects = {};
	rects.A = [x, y, wSmall, h]; x += wSmall + gapSmall;
	rects.B = [x, y, wSmall, h]; x += wSmall + gapSmall;
	rects.C = [x, y, wSmall, h]; x += wSmall + gapBig;
	rects.LKL = [x, y, wLever, h]; x += wLever + gapSmall;
	rects.LKR = [x, y, wLever, h]; x += wLever + gapSmall;
	rects.RKL = [x, y, wLever, h]; x += wLever + gapSmall;
	rects.RKR = [x, y, wLever, h];
	return rects;
}

function inNeckArea(x, y, g) {
	return x >= g.gutter && y >= 0 && y <= g.fretStripTop;
}

function inFretStrip(x, y, g) {
	return x >= g.gutter && y > g.fretStripTop && y <= g.fretStripBottom;
}

// ---- color helper ----
function hex2rgb(hex) {
	return [
		parseInt(hex.substr(1, 2), 16) / 255,
		parseInt(hex.substr(3, 2), 16) / 255,
		parseInt(hex.substr(5, 2), 16) / 255
	];
}

function setColor(hex, a) {
	var c = hex2rgb(hex);
	mgraphics.set_source_rgba(c[0], c[1], c[2], a === undefined ? 1 : a);
}

// ---- drawing ----
function drawBackground(g) {
	setColor("#1c1c1c", 1);
	mgraphics.rectangle_rounded(0, 0, g.w, g.h, 4, 4);
	mgraphics.fill();
}

function drawGutter(g) {
	mgraphics.select_font_face("Ableton Sans Medium");
	mgraphics.set_font_size(9);
	for (var s = 1; s <= 10; s++) {
		var pitch = pitchesArr[s - 1];
		var idx = ((Math.round(pitch) % 12) + 12) % 12;
		var name = NOTE_NAMES[idx];
		var changed = Math.round(pitch) !== (OPEN[s - 1] + Math.round(barTarget));
		setColor(changed ? "#ffb035" : "#c8c8c8", 1);
		var y = stringY(s, g);
		mgraphics.move_to(4, y + 3);
		mgraphics.show_text(name);
	}
}

function drawNeckLines(g) {
	setColor("#5a5a5a", 1);
	mgraphics.set_line_width(2);
	mgraphics.move_to(g.x0, g.yTop - 4);
	mgraphics.line_to(g.x0, g.yBottom + 4);
	mgraphics.stroke();

	setColor("#2e2e2e", 1);
	mgraphics.set_line_width(1);
	for (var f = 1; f <= 24; f++) {
		var x = fretX(f, g);
		mgraphics.move_to(x, g.yTop - 4);
		mgraphics.line_to(x, g.yBottom + 4);
		mgraphics.stroke();
	}

	setColor("#3a3a3a", 1);
	var midY = (g.yTop + g.yBottom) / 2;
	var r = 2.5 * g.sx;
	var singleFrets = [3, 5, 7, 9, 15, 17, 19, 21];
	for (var i = 0; i < singleFrets.length; i++) {
		drawDot(fretX(singleFrets[i], g), midY, r);
	}
	drawDot(fretX(12, g), midY - 6 * g.sy, r);
	drawDot(fretX(12, g), midY + 6 * g.sy, r);
	drawDot(fretX(24, g), midY - 6 * g.sy, r);
	drawDot(fretX(24, g), midY + 6 * g.sy, r);
}

function drawDot(cx, cy, r) {
	mgraphics.ellipse(cx - r, cy - r, r * 2, r * 2);
	mgraphics.fill();
}

function drawStrings(g) {
	for (var s = 1; s <= 10; s++) {
		var y = stringY(s, g);
		var width = 0.8 + (s - 1) * (2.0 - 0.8) / 9;
		setColor("#8a8a8a", 1);
		mgraphics.set_line_width(width);
		mgraphics.move_to(g.x0, y);
		mgraphics.line_to(g.w, y);
		mgraphics.stroke();

		var gl = glow[s - 1];
		if (gl > 0.01) {
			setColor("#ffb035", gl);
			mgraphics.set_line_width(width + 1.5);
			mgraphics.move_to(g.x0, y);
			mgraphics.line_to(g.w, y);
			mgraphics.stroke();
		}
	}
}

function drawFretStrip(g) {
	mgraphics.select_font_face("Ableton Sans Medium");
	mgraphics.set_font_size(8);
	setColor("#6a6a6a", 1);
	var frets = [0, 3, 5, 7, 9, 12, 15, 17, 19, 21, 24];
	for (var i = 0; i < frets.length; i++) {
		var x = fretX(frets[i], g);
		mgraphics.move_to(x - 4, g.fretStripTop + 8);
		mgraphics.show_text(String(frets[i]));
	}
}

function drawBar(g) {
	var x = fretX(barCurrent, g);
	var top = g.yTop - 5 * g.sy;
	var bottom = g.yBottom + 5 * g.sy;
	var w = 7 * g.sx;

	var pattern = mgraphics.pattern_create_linear(x - w / 2, 0, x + w / 2, 0);
	pattern.add_color_stop_rgba(0, 0.851, 0.851, 0.851, 1);
	pattern.add_color_stop_rgba(1, 0.549, 0.549, 0.549, 1);
	mgraphics.rectangle_rounded(x - w / 2, top, w, bottom - top, 2, 2);
	mgraphics.set_source(pattern);
	mgraphics.fill();

	mgraphics.select_font_face("Ableton Sans Medium");
	mgraphics.set_font_size(8);
	setColor("#9a9a9a", 1);
	mgraphics.move_to(x + w / 2 + 3, 9 * g.sy);
	mgraphics.show_text("fret " + barCurrent.toFixed(1));
}

function drawPedals(g) {
	var rects = pedalRects(g);
	mgraphics.select_font_face("Ableton Sans Bold");
	mgraphics.set_font_size(9);
	for (var i = 0; i < PEDAL_NAMES.length; i++) {
		var name = PEDAL_NAMES[i];
		var r = rects[name];
		var state = pedalState[i];
		// yours = solid amber; automatic = dark. A border means the current chord uses it.
		var fill = state >= 2 ? "#ffb035" : "#2e2e2e";
		var textColor = state >= 2 ? "#111111" : (state === 1 ? "#ffb035" : "#9a9a9a");

		setColor(fill, 1);
		mgraphics.rectangle_rounded(r[0], r[1], r[2], r[3], 3, 3);
		mgraphics.fill();
		if (state === 1 || state === 3) {
			setColor(state === 3 ? "#ffffff" : "#ffb035", 1);
			mgraphics.set_line_width(1.5);
			mgraphics.rectangle_rounded(r[0] + 0.75, r[1] + 0.75, r[2] - 1.5, r[3] - 1.5, 3, 3);
			mgraphics.stroke();
		}

		setColor(textColor, 1);
		mgraphics.move_to(r[0] + 4, r[1] + r[3] - 6);
		mgraphics.show_text(name);
	}
}

function drawLegend(g) {
	var rects = pedalRects(g);
	var last = rects.RKR;
	var x = last[0] + last[2] + 10;
	mgraphics.select_font_face("Ableton Sans Medium");
	mgraphics.set_font_size(8);
	var measured = mgraphics.text_measure(LEGEND_TEXT);
	if (x + measured[0] <= g.w - 4) {
		setColor("#6a6a6a", 1);
		mgraphics.move_to(x, last[1] + last[3] - 6);
		mgraphics.show_text(LEGEND_TEXT);
	}
}

function drawHint(g) {
	var text = currentMode === 1 ? HINT_STRINGS : HINT_CHORDS;
	mgraphics.select_font_face("Ableton Sans Medium");
	var size = 9;
	mgraphics.set_font_size(size);
	var m = mgraphics.text_measure(text);
	if (m[0] > g.w - 16) {
		size = 8;
		mgraphics.set_font_size(size);
	}
	setColor("#8f8f8f", 1);
	mgraphics.move_to(8, g.hintTop + 8);
	mgraphics.show_text(text);
}

function paint() {
	var g = neckGeom();
	drawBackground(g);
	drawGutter(g);
	drawNeckLines(g);
	drawStrings(g);
	drawFretStrip(g);
	drawBar(g);
	drawPedals(g);
	drawLegend(g);
	drawHint(g);
}

function onresize(w, h) {
	mgraphics.redraw();
}

// ---- inlet message handlers (called by name-dispatch from the brain) ----
function pitches() {
	for (var i = 0; i < 10 && i < arguments.length; i++) {
		pitchesArr[i] = arguments[i];
	}
	mgraphics.redraw();
	ensureAnimating();
}

function bar(f) {
	barTarget = f;
	mgraphics.redraw();
	ensureAnimating();
}

function pedals(a, b, c, lkl, lkr, rkl, rkr) {
	pedalState = [a, b, c, lkl, lkr, rkl, rkr];
	mgraphics.redraw();
	ensureAnimating();
}

function pluck(s, vel) {
	var i = s - 1;
	glow[i] = Math.max(glow[i], 0.35 + 0.65 * vel);
	glowDecay[i] = 0.985;
	mgraphics.redraw();
	ensureAnimating();
}

function release(s) {
	glowDecay[s - 1] = 0.8;
	mgraphics.redraw();
	ensureAnimating();
}

function mode(m) {
	currentMode = m;
	mgraphics.redraw();
	ensureAnimating();
}

// ---- mouse handlers ----
function onclick(x, y, but, cmd, shift, capslock, option, ctrl) {
	var g = neckGeom(); // pedal clicks go to the live.text buttons laid over the pedal board

	if (inFretStrip(x, y, g)) {
		outlet(0, "bar", clampFret(xToFret(x, g)));
		return;
	}

	if (inNeckArea(x, y, g)) {
		neckMouseDown = true;
		neckDownX = x;
		for (var s = 1; s <= 10; s++) {
			if (Math.abs(y - stringY(s, g)) <= 5) {
				outlet(0, "pluck", s, 0.8);
				break;
			}
		}
	}
}

function ondrag(x, y, but, cmd, shift, capslock, option, ctrl) {
	if (but === 0) {
		neckMouseDown = false;
		return;
	}

	if (neckMouseDown) {
		var g = neckGeom();
		var total = Math.abs(x - neckDownX);
		if (total > 2) {
			outlet(0, "bar", clampFret(xToFret(x, g)));
		}
	}
}

if (typeof module !== "undefined") {
	module.exports = {
		paint: paint,
		onclick: onclick,
		ondrag: ondrag,
		onresize: onresize,
		pitches: pitches,
		bar: bar,
		pedals: pedals,
		pluck: pluck,
		release: release,
		mode: mode,
		neckGeom: neckGeom,
		stringY: stringY,
		pedalRects: pedalRects,
		fretX: fretX,
		xToFret: xToFret,
		clampFret: clampFret,
		getState: function () {
			return {
				pitches: pitchesArr,
				barTarget: barTarget,
				barCurrent: barCurrent,
				pedalState: pedalState,
				glow: glow,
				mode: currentMode
			};
		}
	};
}
