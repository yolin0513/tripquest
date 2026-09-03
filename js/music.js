// 程序生成的背景配樂 —— 用 Web Audio 即時合成，天生無版權問題、永遠可用、不佔檔案。
// 兩種風格：輕快（arpeggio）、溫柔（pad）。也支援使用者選自己手機裡的音樂檔。

const PROGRESSIONS = {
  gentle: [ [0, 4, 7, 11], [-3, 0, 4, 9], [-5, -1, 2, 7], [-7, -3, 0, 5] ], // Cmaj7 Am7 ... 溫柔
  bright: [ [0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12] ],               // 輕快大調
};
const ROOT = 261.63; // C4
const midi = (semi) => ROOT * Math.pow(2, semi / 12);

export function createMusic(style = 'gentle') {
  if (style === 'none') return null;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx();
  const master = ctx.createGain();
  master.gain.value = 0.0001;

  // 簡單的空間感：feedback delay
  const delay = ctx.createDelay();
  delay.delayTime.value = 0.33;
  const fb = ctx.createGain();
  fb.gain.value = 0.28;
  const wet = ctx.createGain();
  wet.gain.value = 0.25;
  master.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(wet);

  const out = ctx.createGain();
  master.connect(out); wet.connect(out);

  const dest = ctx.createMediaStreamDestination();
  out.connect(dest);
  out.connect(ctx.destination); // 也讓預覽聽得到

  let timer = null;
  let step = 0;
  const prog = PROGRESSIONS[style] || PROGRESSIONS.gentle;
  const bright = style === 'bright';
  const beat = bright ? 0.38 : 0.75;

  function playNote(freq, t, dur, gain) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = bright ? 'triangle' : 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  function tick() {
    const chord = prog[Math.floor(step / (bright ? 4 : 2)) % prog.length];
    const t = ctx.currentTime + 0.05;
    if (bright) {
      const n = chord[step % chord.length];
      playNote(midi(n), t, beat * 1.6, 0.16);
      if (step % 4 === 0) playNote(midi(chord[0] - 12), t, beat * 3, 0.12);
    } else {
      chord.forEach((n, i) => playNote(midi(n), t, beat * 2.4, 0.06 + (i === 0 ? 0.03 : 0)));
    }
    step++;
    timer = setTimeout(tick, beat * 1000);
  }

  return {
    stream: dest.stream,
    async start() {
      if (ctx.state === 'suspended') await ctx.resume();
      master.gain.exponentialRampToValueAtTime(bright ? 0.5 : 0.42, ctx.currentTime + 1.5);
      tick();
    },
    async fadeOutStop(sec = 1.2) {
      try { master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + sec); } catch { /* noop */ }
      clearTimeout(timer);
      await new Promise((r) => setTimeout(r, sec * 1000 + 100));
      try { await ctx.close(); } catch { /* noop */ }
    },
    stop() { clearTimeout(timer); try { ctx.close(); } catch { /* noop */ } },
  };
}

// 使用者自選音樂檔 → 回傳可加進錄影的音訊軌
export async function musicFromFile(file) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx();
  const buf = await ctx.decodeAudioData(await file.arrayBuffer());
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const gain = ctx.createGain();
  gain.gain.value = 0.7;
  const dest = ctx.createMediaStreamDestination();
  src.connect(gain); gain.connect(dest); gain.connect(ctx.destination);
  return {
    stream: dest.stream,
    async start() { if (ctx.state === 'suspended') await ctx.resume(); src.start(); },
    async fadeOutStop(sec = 1.2) {
      try { gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + sec); } catch { /* noop */ }
      await new Promise((r) => setTimeout(r, sec * 1000 + 100));
      try { src.stop(); await ctx.close(); } catch { /* noop */ }
    },
    stop() { try { src.stop(); ctx.close(); } catch { /* noop */ } },
  };
}
