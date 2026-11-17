/**
 * Breve segnale acustico a fine recupero, solo con app in primo piano.
 * Web Audio su iOS rispetta l'interruttore silenzioso e il volume del dispositivo.
 * Il contesto audio va "sbloccato" da un gesto dell'utente (es. Completa serie).
 */
let ctx: AudioContext | null = null;

export function unlockAudio(): void {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null;
  }
}

export function beep(): void {
  if (!ctx || document.visibilityState !== 'visible') return;
  try {
    const t = ctx.currentTime;
    for (const [i, f] of [880, 1175].entries()) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.25, t + i * 0.18 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.18 + 0.16);
      o.connect(g).connect(ctx.destination);
      o.start(t + i * 0.18);
      o.stop(t + i * 0.18 + 0.17);
    }
  } catch {
    /* audio non disponibile: resta il segnale visivo */
  }
}
