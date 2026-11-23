export class AudioSynth {
  private ctx: AudioContext | null = null;
  public enabled = true;
  public unlocked = false;

  unlock(): boolean {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return false;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    this.unlocked = true;
    return true;
  }

  toggleMute(): boolean {
    this.enabled = !this.enabled;
    return this.enabled;
  }

  private _triggerServoClack(startTime: number, pitchHz: number, gainAmt: number): void {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(pitchHz, startTime);
    osc.frequency.exponentialRampToValueAtTime(pitchHz * 0.36, startTime + 0.08);
    g.gain.setValueAtTime(0.001, startTime);
    g.gain.linearRampToValueAtTime(gainAmt, startTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0008, startTime + 0.11);
    osc.connect(g);
    g.connect(this.ctx.destination);
    osc.start(startTime);
    osc.stop(startTime + 0.12);
  }

  playSuitUp(): void {
    if (!this.enabled || !this.unlock() || !this.ctx) return;
    const now = this.ctx.currentTime;

    // 1. Hydraulique & réacteur ARC : montée de puissance mécanique grave sur 4.2s
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    osc1.type = 'sawtooth';
    osc2.type = 'triangle';
    osc1.frequency.setValueAtTime(58, now);
    osc1.frequency.exponentialRampToValueAtTime(190, now + 1.6);
    osc1.frequency.exponentialRampToValueAtTime(340, now + 3.4);
    osc1.frequency.exponentialRampToValueAtTime(135, now + 4.15);

    osc2.frequency.setValueAtTime(110, now);
    osc2.frequency.exponentialRampToValueAtTime(480, now + 3.6);

    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(210, now);
    filter.frequency.exponentialRampToValueAtTime(1950, now + 3.2);
    filter.Q.value = 2.6;

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.11, now + 0.25);
    gain.gain.setValueAtTime(0.09, now + 3.2);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 4.2);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 4.25);
    osc2.stop(now + 4.25);

    // 2. Claquements séquentiels d'arrimage Mark 42 (Bottes -> Jambes -> Bassin/Abdos -> Avant-bras/Gantelets -> Torse/Épaules -> Casque -> Visière)
    const clackTimings = [
      [0.38, 320, 0.11],
      [0.62, 360, 0.11],
      [0.98, 440, 0.12],
      [1.36, 480, 0.12],
      [1.76, 560, 0.13],
      [2.16, 640, 0.13],
      [2.56, 710, 0.14],
      [2.96, 520, 0.14],
      [3.38, 820, 0.14],
      [3.74, 920, 0.15],
      [4.02, 390, 0.17],
    ];
    for (const [offset, pitch, vol] of clackTimings) {
      this._triggerServoClack(now + offset, pitch, vol);
    }
  }

  playHelmetServo(opening: boolean): void {
    if (!this.enabled || !this.unlock() || !this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(opening ? 260 : 580, now);
    osc.frequency.exponentialRampToValueAtTime(opening ? 680 : 200, now + 0.26);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.14, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.30);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.32);

    this._triggerServoClack(now + (opening ? 0.04 : 0.22), opening ? 760 : 440, 0.10);
  }

  playRepulsorCharge(): void {
    if (!this.enabled || !this.unlock() || !this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(1650, now + 0.42);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.12, now + 0.12);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.48);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.5);
  }

  playRepulsorBlast(): void {
    if (!this.enabled || !this.unlock() || !this.ctx) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(1400, now);
    osc.frequency.exponentialRampToValueAtTime(65, now + 0.36);

    gain.gain.setValueAtTime(0.24, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.4);

    const bufferSize = Math.floor(this.ctx.sampleRate * 0.25);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(3200, now);
    filter.frequency.exponentialRampToValueAtTime(180, now + 0.24);

    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(0.18, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(this.ctx.destination);
    noise.start(now);
  }

  dispose(): void {
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}
