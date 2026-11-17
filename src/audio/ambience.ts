/**
 * Cinematic audio.
 *
 * Two layers, both generated in the browser so nothing has to be licensed or
 * downloaded:
 *
 *   1. An ambient bed built from Web Audio oscillators — a low drone, a slow
 *      filter sweep, and a sparse plucked motif that shifts scale between
 *      scenes. Entirely synthetic, entirely original.
 *   2. Narration spoken through the browser's own speech synthesiser, with
 *      the same text always shown on screen as a subtitle.
 *
 * No audio files ship with the project and no third-party recordings are
 * used.
 */

type Scale = number[];

/** Raga-flavoured scales, one per scene mood. */
const SCALES: Record<string, Scale> = {
  dawn: [220.0, 246.94, 261.63, 293.66, 329.63],
  day: [196.0, 220.0, 246.94, 261.63, 293.66],
  dusk: [174.61, 196.0, 220.0, 261.63, 311.13],
  night: [146.83, 174.61, 196.0, 220.0, 261.63],
};

export class Ambience {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private oscillators: OscillatorNode[] = [];
  private filter: BiquadFilterNode | null = null;
  private lfo: OscillatorNode | null = null;
  private timer: number | null = null;
  private muted = false;
  private sceneIndex = 0;
  private started = false;

  get isMuted(): boolean {
    return this.muted;
  }

  /**
   * Create the graph and ask the browser to let it run.
   *
   * The graph is built before the context is resumed, and the resume is not
   * awaited: a browser that refuses to start audio — which it is entitled to
   * do until it sees a user gesture — must never be able to stop the journey
   * from starting. If the sound never arrives, the city still does.
   */
  async start(): Promise<void> {
    if (this.started) {
      void this.resume();
      return;
    }
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    try {
      const ctx = new Ctor();
      this.ctx = ctx;

      const master = ctx.createGain();
      master.gain.value = 0;
      master.connect(ctx.destination);
      this.master = master;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 700;
      filter.Q.value = 0.7;
      filter.connect(master);
      this.filter = filter;

      const droneGain = ctx.createGain();
      droneGain.gain.value = 0.14;
      droneGain.connect(filter);

      // Three detuned oscillators make the drone beat slowly against itself.
      for (const detune of [-6, 0, 7]) {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = 110;
        osc.detune.value = detune;
        const g = ctx.createGain();
        g.gain.value = 0.34;
        osc.connect(g).connect(droneGain);
        osc.start();
        this.oscillators.push(osc);
      }

      // A slow sweep across the filter so the bed never sits still.
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.045;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 260;
      lfo.connect(lfoGain).connect(filter.frequency);
      lfo.start();
      this.lfo = lfo;

      this.started = true;
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.5, ctx.currentTime, 1.4);
      this.schedulePluck();
      void this.resume();
    } catch {
      this.ctx = null;
    }
  }

  /** Ask the browser to let the context run. It may refuse; that is fine. */
  private async resume(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      if (ctx.state !== 'running') await ctx.resume();
    } catch {
      /* the browser refused; the journey continues without sound */
    }
  }

  /** A sparse plucked note, scheduled ahead of time. */
  private schedulePluck() {
    if (!this.ctx || !this.master) return;
    const scale = SCALES[this.sceneKey()] ?? SCALES.day;

    const delay = 2200 + Math.random() * 4200;
    this.timer = window.setTimeout(() => {
      this.pluck(scale);
      this.schedulePluck();
    }, delay);
  }

  private sceneKey(): string {
    return ['dawn', 'day', 'dusk', 'night'][this.sceneIndex] ?? 'day';
  }

  private pluck(scale: Scale) {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const now = ctx.currentTime;

    const note = scale[Math.floor(Math.random() * scale.length)];
    const octave = Math.random() < 0.35 ? 2 : 1;

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = note * octave;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.09, now + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 2.6);

    const pan = ctx.createStereoPanner?.();
    osc.connect(g);
    if (pan) {
      pan.pan.value = (Math.random() - 0.5) * 0.7;
      g.connect(pan).connect(master);
    } else {
      g.connect(master);
    }

    osc.start(now);
    osc.stop(now + 2.8);
  }

  /** A soft bell to mark a scene change. */
  chime() {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const now = ctx.currentTime;
    for (const [mult, gainv] of [
      [1, 0.07],
      [2.01, 0.035],
      [3.02, 0.015],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 392 * mult;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(gainv, now + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 3.4);
      osc.connect(g).connect(master);
      osc.start(now);
      osc.stop(now + 3.6);
    }
  }

  /** Switch the mood of the bed to match the current scene. */
  setScene(index: number) {
    this.sceneIndex = index;
    const ctx = this.ctx;
    if (!ctx) return;
    const scale = SCALES[this.sceneKey()] ?? SCALES.day;
    const root = scale[0] / 2;
    const now = ctx.currentTime;
    for (const osc of this.oscillators) {
      osc.frequency.setTargetAtTime(root, now, 1.6);
    }
    this.filter?.frequency.setTargetAtTime(this.sceneKey() === 'night' ? 480 : 760, now, 2);
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    this.master.gain.setTargetAtTime(muted ? 0 : 0.5, ctx.currentTime, 0.35);
    if (muted) this.stopSpeech();
  }

  /** Speak a line of narration. Returns true when speech was started. */
  speak(text: string): boolean {
    if (this.muted) return false;
    const synth = window.speechSynthesis;
    if (!synth || !('SpeechSynthesisUtterance' in window)) return false;
    try {
      synth.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 0.94;
      utter.pitch = 0.95;
      utter.volume = 0.95;
      const voices = synth.getVoices();
      const preferred =
        voices.find((v) => /en-IN/i.test(v.lang)) ??
        voices.find((v) => /^en/i.test(v.lang)) ??
        null;
      if (preferred) utter.voice = preferred;
      synth.speak(utter);
      return true;
    } catch {
      return false;
    }
  }

  stopSpeech() {
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* ignore */
    }
  }

  dispose() {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    this.stopSpeech();
    for (const osc of this.oscillators) {
      try {
        osc.stop();
      } catch {
        /* ignore */
      }
    }
    this.oscillators = [];
    try {
      this.lfo?.stop();
    } catch {
      /* ignore */
      }
    this.ctx?.close();
    this.ctx = null;
    this.started = false;
  }
}

export const ambience = new Ambience();
