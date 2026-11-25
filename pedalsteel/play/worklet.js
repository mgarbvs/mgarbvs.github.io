// worklet.js: the gen~ engine as an AudioWorklet. Receives {code} once, then batches of [name, value] gen~ params.
import { Engine } from "./engine.js";

class Steel extends AudioWorkletProcessor {
    constructor() {
        super();
        this.eng = null; this.queue = []; this.peak = 0; this.n = 0;
        this.port.onmessage = (e) => {
            try {
                if (e.data.code) { this.eng = new Engine(e.data.code, sampleRate); }
                else this.queue.push(...e.data);
            } catch (err) { this.port.postMessage({ err: String(err) }); }
        };
    }
    process(_in, out) {
        if (!this.eng) return true;
        try {
            for (const [k, v] of this.queue.splice(0)) try { this.eng.set(k, v); } catch (err) { this.port.postMessage({ err: String(err) }); }
            this.eng.process(out[0][0].length, out[0][0], out[0][1]);
        } catch (err) { this.port.postMessage({ err: String(err) }); return false; }
        for (const v of out[0][0]) this.peak = Math.max(this.peak, Math.abs(v));
        if (++this.n % 8 === 0) { this.port.postMessage({ peak: this.peak }); this.peak = 0; } // ~every 23 ms: level meter
        return true;
    }
}
registerProcessor("steel", Steel);
