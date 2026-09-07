// 程序生成的背景配樂 —— 用 Web Audio 即時合成，天生無版權問題、永遠可用、不佔檔案。
//
// 舊版是「一個和弦循環從頭跑到尾」：四個和弦、一種音色、一種節奏，三分鐘就膩，
// 十分鐘會讓人受不了。現在改成有編制的編曲：
//
//   · **分段**：片頭 → A（旋律進來）→ B（加琶音與節奏，最滿）→ 過門（收薄）→ 片尾（收束）
//     段落由影片進度決定（呼叫端每隔一下丟 progress(0~1) 進來），所以配樂會跟著畫面走。
//   · **分層**：襯底和聲（pad）＋低音（bass）＋琶音（arp）＋旋律（melody）＋節奏（shaker/kick）
//     每一段開關不同的層、密度也不同。
//   · **旋律有走向**：不是把和弦音照順序彈完，是在音階上做有限制的隨機漫步，
//     並且用固定種子 —— 同一趟旅程每次聽到的是同一首。
//   · **和聲會轉**：每一段換一組和弦進行，不會四個和弦繞到底。
//
// 排程用「先看一小段未來」的方式（lookahead scheduler）而不是一拍一個 setTimeout：
// 錄影時主執行緒在畫圖，setTimeout 會漂，音樂會忽快忽慢。

const A4 = 440;
const noteHz = (semi) => A4 * Math.pow(2, (semi - 9) / 12); // semi: 相對 C4 的半音

// 音階（相對主音的半音）
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const PENTA = [0, 2, 4, 7, 9];

// 每一段一組和弦進行 —— 換段就換和聲，這是「不單調」最有效的一招
const PROGS = {
  gentle: {
    intro: [[0, 4, 7, 11]],
    a: [[0, 4, 7, 11], [-3, 0, 4, 9], [-5, -1, 2, 7], [-7, -3, 0, 5]],
    b: [[2, 5, 9, 12], [-3, 0, 4, 7], [5, 9, 12, 16], [0, 4, 7, 11]],
    c: [[-5, -1, 2, 7], [-7, -3, 0, 4], [-2, 2, 5, 9], [0, 4, 7, 11]],
    outro: [[0, 4, 7, 11], [0, 4, 7, 12]],
  },
  bright: {
    intro: [[0, 4, 7]],
    a: [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]],
    b: [[5, 9, 12], [0, 4, 7], [2, 5, 9], [7, 11, 14]],
    c: [[9, 12, 16], [4, 7, 11], [5, 9, 12], [7, 11, 14]],
    outro: [[0, 4, 7], [0, 7, 12]],
  },
  cinematic: {
    intro: [[0, 7, 12]],
    a: [[0, 3, 7, 10], [-4, 0, 3, 8], [-5, -1, 2, 7], [-2, 2, 5, 9]],
    b: [[0, 3, 7, 12], [5, 8, 12, 15], [-4, 0, 3, 7], [3, 7, 10, 14]],
    c: [[-5, -1, 2, 7], [-7, -4, 0, 5], [0, 3, 7, 10], [2, 5, 9, 12]],
    outro: [[0, 3, 7, 12], [0, 7, 12, 19]],
  },
  folk: {
    intro: [[0, 4, 7]],
    a: [[0, 4, 7], [-3, 0, 4], [5, 9, 12], [-5, -1, 2]],
    b: [[5, 9, 12], [7, 11, 14], [0, 4, 7], [-3, 0, 4]],
    c: [[-3, 0, 4], [-5, -1, 2], [0, 4, 7], [7, 11, 14]],
    outro: [[0, 4, 7], [0, 4, 7, 12]],
  },
};

export const STYLES = {
  gentle: { key: 'gentle', label: '🎵 溫柔', bpm: 74, scale: MAJOR, root: 0, padWave: 'sine', melWave: 'triangle', arpWave: 'sine', perc: false, gain: 0.42 },
  bright: { key: 'bright', label: '🎶 輕快', bpm: 112, scale: PENTA, root: 0, padWave: 'triangle', melWave: 'triangle', arpWave: 'triangle', perc: true, gain: 0.44 },
  cinematic: { key: 'cinematic', label: '🎼 電影感', bpm: 62, scale: MINOR, root: -3, padWave: 'sine', melWave: 'sine', arpWave: 'triangle', perc: 'soft', gain: 0.46 },
  folk: { key: 'folk', label: '🪕 民謠', bpm: 92, scale: MAJOR, root: -5, padWave: 'triangle', melWave: 'triangle', arpWave: 'triangle', perc: 'soft', gain: 0.42 },
};

// 段落表：at 是影片進度（0~1）的起點，後面是每一層的密度（0 = 不出現）
//
// 使用者實測回饋：原本 intro 段只有襯底長音、旋律要到 9% 才進來 —— 一支三分鐘的
// 影片等於前十幾秒只有單音，「讓人以為壞掉」。所以**第一秒就要全編制**：
// 旋律、低音、節奏從 0 開始，開頭兩小節還固定彈一段主題（見 MOTIF），
// 一聽就知道音樂正常。安靜的鋪陳改放在中後段（c 段）當對比。
const SECTIONS = [
  { at: 0.00, name: 'open', prog: 'a', pad: 1.0, bass: 1.0, arp: 0.6, mel: 1.0, perc: 0.7 },
  { at: 0.30, name: 'b', prog: 'b', pad: 0.8, bass: 1.0, arp: 1.0, mel: 1.0, perc: 1.0 },
  { at: 0.60, name: 'c', prog: 'c', pad: 1.0, bass: 0.7, arp: 0.4, mel: 0.6, perc: 0.0 },
  { at: 0.82, name: 'lift', prog: 'a', pad: 0.9, bass: 1.0, arp: 0.8, mel: 0.9, perc: 0.8 },
  { at: 0.94, name: 'outro', prog: 'outro', pad: 1.0, bass: 0.5, arp: 0.0, mel: 0.4, perc: 0.0 },
];

// 開頭兩小節的固定主題（音階級數）—— 不靠機率，第一拍就有清楚的旋律
const MOTIF = [4, 5, 7, 4, 2, 4, 0, 2];

function sectionAt(r) {
  let s = SECTIONS[0];
  for (const x of SECTIONS) { if (r >= x.at) s = x; else break; }
  return s;
}

// 固定種子的亂數 —— 同一支影片每次聽到的是同一首
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
}

// duration 只用來讓呼叫端表達意圖；實際的段落切換是靠 progress()。
export function createMusic(styleKey = 'gentle', { seed = 20260907 } = {}) {
  if (!styleKey || styleKey === 'none') return null;
  const S = STYLES[styleKey] || STYLES.gentle;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx();

  // 主匯流：壓一下動態，加一點空間感
  const master = ctx.createGain();
  master.gain.value = 0.0001;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18; comp.ratio.value = 4; comp.attack.value = 0.008; comp.release.value = 0.2;

  const delay = ctx.createDelay(1.0);
  delay.delayTime.value = 60 / S.bpm * 0.75;
  const fb = ctx.createGain(); fb.gain.value = 0.26;
  const wet = ctx.createGain(); wet.gain.value = S.key === 'cinematic' ? 0.34 : 0.22;
  master.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(wet);

  const out = ctx.createGain();
  master.connect(comp); comp.connect(out); wet.connect(out);
  const dest = ctx.createMediaStreamDestination();
  out.connect(dest);
  out.connect(ctx.destination);           // 預覽也聽得到

  // 節奏用的白噪音
  const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.4, ctx.sampleRate);
  { const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }

  const rand = rng(seed);
  const beat = 60 / S.bpm;
  const step = beat / 2;                  // 八分音符
  const STEPS_PER_CHORD = 8;              // 一個和弦四拍

  let progress = 0;
  let nextTime = 0;
  let stepIdx = 0;
  let timer = null;
  let melLast = 0;                        // 旋律上一個音（音階級數），用來限制跳進
  let stopped = false;

  function tone(wave, freq, t, dur, gain, { detune = 0, glide = 0 } = {}) {
    if (!(freq > 0) || gain <= 0.0005) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = wave;
    o.frequency.setValueAtTime(freq * (glide ? Math.pow(2, -glide / 12) : 1), t);
    if (glide) o.frequency.exponentialRampToValueAtTime(freq, t + 0.08);
    o.detune.value = detune;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.12, dur * 0.25));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.06);
  }

  function shaker(t, gain) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 6500; bp.Q.value = 1.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start(t); src.stop(t + 0.12);
  }

  function kick(t, gain) {
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.11);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.26);
  }

  // 把音階級數轉成半音（可以超出一個八度）
  function degToSemi(deg) {
    const sc = S.scale, n = sc.length;
    const oct = Math.floor(deg / n);
    return S.root + sc[((deg % n) + n) % n] + oct * 12;
  }

  function scheduleStep(t) {
    const sec = sectionAt(progress);
    const prog = PROGS[S.key][sec.prog] || PROGS[S.key].a;
    const chordIdx = Math.floor(stepIdx / STEPS_PER_CHORD) % prog.length;
    const chord = prog[chordIdx];
    const inChord = stepIdx % STEPS_PER_CHORD;
    const bar = Math.floor(stepIdx / STEPS_PER_CHORD);

    // 襯底：換和弦時鋪一次長音
    if (inChord === 0 && sec.pad > 0) {
      chord.forEach((n, i) => {
        tone(S.padWave, noteHz(S.root + n), t, beat * 3.6,
          (0.052 + (i === 0 ? 0.022 : 0)) * sec.pad, { detune: i * 3 });
      });
    }
    // 低音：第 1、3 拍
    if (sec.bass > 0 && (inChord === 0 || inChord === 4)) {
      tone('sine', noteHz(S.root + chord[0] - 12), t, beat * 1.7,
        0.10 * sec.bass * (inChord === 0 ? 1 : 0.72));
    }
    // 琶音：每個八分音符走一個和弦音，上上下下
    if (sec.arp > 0) {
      const seq = [...chord, ...chord.slice(1, -1).reverse()];
      const n = seq[inChord % seq.length];
      tone(S.arpWave, noteHz(S.root + n + 12), t, beat * 0.7, 0.036 * sec.arp);
    }
    // 旋律：開頭兩小節走固定主題（一聽就知道音樂正常），之後在音階上做
    // 有限制的隨機漫步，落在和弦音上比較常見
    if (sec.mel > 0 && inChord % 2 === 0) {
      if (bar < 2) {
        const deg = MOTIF[(bar * 4 + inChord / 2) % MOTIF.length];
        melLast = deg;
        tone(S.melWave, noteHz(degToSemi(deg) + 12), t, beat * 1.1, 0.1 * sec.mel);
      } else if (rand() < 0.5 + 0.4 * sec.mel) {
        const jump = [-2, -1, -1, 0, 1, 1, 2, 3][Math.floor(rand() * 8)];
        let deg = melLast + jump;
        if (deg > 9) deg -= 5;
        if (deg < 0) deg += 5;
        melLast = deg;
        const dur = beat * (rand() < 0.3 ? 1.5 : 0.85);
        tone(S.melWave, noteHz(degToSemi(deg) + 12), t, dur, 0.085 * sec.mel, { glide: rand() < 0.25 ? 1 : 0 });
      }
    }
    // 節奏
    if (sec.perc > 0 && S.perc) {
      const soft = S.perc === 'soft';
      if (inChord % 2 === 1) shaker(t, (soft ? 0.035 : 0.06) * sec.perc);
      if (!soft && inChord % 4 === 0) kick(t, 0.14 * sec.perc);
      if (soft && inChord === 0 && bar % 2 === 0) kick(t, 0.08 * sec.perc);
    }
    stepIdx++;
  }

  // lookahead：每 60ms 看未來 250ms，把該排的都排掉
  function pump() {
    if (stopped) return;
    const horizon = ctx.currentTime + 0.25;
    let guard = 0;
    while (nextTime < horizon && guard++ < 64) {
      scheduleStep(nextTime);
      nextTime += step;
    }
    timer = setTimeout(pump, 60);
  }

  return {
    stream: dest.stream,
    style: S.key,
    async start() {
      if (ctx.state === 'suspended') await ctx.resume();
      nextTime = ctx.currentTime + 0.08;
      master.gain.setValueAtTime(0.0001, ctx.currentTime);
      master.gain.exponentialRampToValueAtTime(S.gain, ctx.currentTime + 0.5);   // 半秒內就要聽得到，不要讓人以為沒聲音
      pump();
    },
    // 呼叫端每隔一下告訴我們影片播到哪 —— 段落由這個決定
    progress(r) { progress = Math.max(0, Math.min(1, r || 0)); },
    async fadeOutStop(sec = 1.2) {
      try { master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + sec); } catch { /* noop */ }
      stopped = true;
      clearTimeout(timer);
      await new Promise((r) => setTimeout(r, sec * 1000 + 120));
      try { await ctx.close(); } catch { /* noop */ }
    },
    stop() { stopped = true; clearTimeout(timer); try { ctx.close(); } catch { /* noop */ } },
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
    style: 'file',
    async start() { if (ctx.state === 'suspended') await ctx.resume(); src.start(); },
    progress() { /* 使用者自己的音樂不做編排 */ },
    async fadeOutStop(sec = 1.2) {
      try { gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + sec); } catch { /* noop */ }
      await new Promise((r) => setTimeout(r, sec * 1000 + 100));
      try { src.stop(); await ctx.close(); } catch { /* noop */ }
    },
    stop() { try { src.stop(); ctx.close(); } catch { /* noop */ } },
  };
}
