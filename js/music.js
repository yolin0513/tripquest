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
    // 預覽的暫停／繼續：suspend 會凍住 ctx.currentTime，排程器自然停在原地
    async pause() { try { await ctx.suspend(); } catch { /* noop */ } },
    async resume() { try { await ctx.resume(); } catch { /* noop */ } },
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

// ---------- 預告片配樂（v1.97.0；規劃 docs/DESIGN_回顧影片預告片風格.md 3.4） ----------
// 跟畫面讀同一張拍點表（js/trailerplan.js 的 planTrailer）：每一個鏡頭的起點都排一個音，所以切點一定在拍子上。
// 上面四種合成配樂不動；這一首另外寫，不放進 STYLES（相簿頁的合成配樂按鈕照 STYLES 列，不該多出這一顆）。
//
// 畫面的時鐘：預覽與錄影用這首時，畫面看 time()（音訊時鐘），不看 performance.now()——錄影時主執行緒在畫圖，
// 兩個時鐘會差開幾十毫秒，快剪一拍 0.6 秒看得出來。音訊時鐘沒在走（瀏覽器不准自動播放、被系統暫停）時
// running() 是 false，呼叫端退回 performance.now()（js/trailer.js 的 clock）。
//
// 拖進度條（seek）：已經排進去的音沒辦法取消，所以每次 seek 換一條新的匯流（bus），舊的那條淡掉、斷開。
export function createTrailerScore(plan, { seed = 20261119 } = {}) {
  if (!plan || !plan.shots?.length) return null;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx();
  const beat = plan.total / plan.beats;
  const STEP = beat / 2;
  const totalSteps = plan.beats * 2;

  const master = ctx.createGain();
  master.gain.value = 0.0001;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16; comp.ratio.value = 5; comp.attack.value = 0.005; comp.release.value = 0.25;
  master.connect(comp);
  const dest = ctx.createMediaStreamDestination();
  comp.connect(dest);
  comp.connect(ctx.destination);

  const noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
  { const d = noiseBuf.getChannelData(0); const r = rng(seed); for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1; }

  let bus = null;
  function newBus() {
    if (bus) {
      const old = bus;
      try { old.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.03); } catch { /* noop */ }
      setTimeout(() => { try { old.disconnect(); } catch { /* noop */ } }, 400);
    }
    bus = ctx.createGain();
    bus.gain.value = 1;
    bus.connect(master);
  }
  newBus();

  function tone(wave, f0, t, dur, gain, { f1 = 0, attack = 0.01 } = {}) {
    if (!(f0 > 0) || gain <= 0.0005) return;
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = wave;
    o.frequency.setValueAtTime(f0, t);
    if (f1 > 0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(attack, dur * 0.5));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(bus);
    o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(t, dur, gain, { type = 'bandpass', f0 = 1000, f1 = 0, q = 1, attack = 0.005 } = {}) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const fl = ctx.createBiquadFilter(); fl.type = type; fl.Q.value = q;
    fl.frequency.setValueAtTime(f0, t);
    if (f1 > 0) fl.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(attack, dur * 0.5));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(fl); fl.connect(g); g.connect(bus);
    src.loop = true;                       // 往上升的聲音有 4.8 秒，雜訊只有 2 秒：循環接著放
    src.start(t); src.stop(t + dur + 0.06);
  }
  const kick = (t, g) => tone('sine', 110, t, 0.32, g, { f1: 38, attack: 0.004 });
  const boom = (t, g) => { tone('sine', 62, t, 3.2, g, { f1: 28, attack: 0.006 }); noise(t, 1.4, g * 0.5, { type: 'lowpass', f0: 600, f1: 80, q: 0.7 }); };
  // 長音：A 小調（A1 55Hz 起），跟著段落換和聲
  const A = (semi) => 55 * Math.pow(2, semi / 12);
  function pad(t, dur, notes, gain) { notes.forEach((n, i) => tone(i ? 'triangle' : 'sine', A(n), t, dur, gain * (i ? 0.55 : 1), { attack: Math.min(0.8, dur * 0.3) })); }

  const secAt = (b) => { for (const s of plan.sections) if (b >= s.b0 && b < s.b1) return s; return null; };
  const shotStart = new Set(plan.shots.map((s) => s.b0));
  const flashBeat = new Set(plan.shots.filter((s) => s.flash).map((s) => s.b0));
  const CHORD = { cold: [0, 7], studio: [0, 7, 12], build: [0, 12, 15, 19], accel: [-2, 10, 14, 17], title: [-4, 8, 12, 15], egg: [12, 19, 24], end: [-4, 8, 12, 15, 19] };

  // 每一個八分音符排一次。section 開頭的長音一次排到段落結束（seek 到段落中間時由 sustainFrom 補上）
  function scheduleStep(s, t) {
    const b = s >> 1, on = (s & 1) === 0;
    const sec = secAt(b);
    if (!sec) return;
    const left = (sec.b1 - b) * beat;
    const name = sec.name;
    if (on && b === sec.b0) {
      if (CHORD[name]) pad(t, left + 0.4, CHORD[name], name === 'build' || name === 'accel' ? 0.05 : 0.07);
      if (name === 'studio') noise(t, left, 0.16, { f0: 300, f1: 5000, q: 1.6, attack: left * 0.7 });
      if (name === 'title') boom(t, 0.55);
      if (name === 'egg') tone('sine', A(48), t, 3.4, 0.06, { attack: 0.01 });
    }
    if (name === 'cold' && on && b === sec.b1 - 1) kick(t, 0.22);                          // 冷開場最後一記輕的重拍
    if (name === 'build' && on) tone('sine', A(12), t, 0.18, 0.09, { attack: 0.004 });      // 規律的脈動
    if (name === 'accel') {
      tone('sine', A(on ? 12 : 24), t, 0.14, on ? 0.1 : 0.05, { attack: 0.004 });          // 節奏加密：半拍一下
      if (on) kick(t, 0.16);
      const riser = sec.b1 - 8;                                                             // 結尾 8 拍往上升
      if (on && b === riser) { noise(t, 8 * beat, 0.12, { f0: 400, f1: 7000, q: 2, attack: 8 * beat * 0.9 }); tone('sawtooth', A(24), t, 8 * beat, 0.03, { f1: A(48), attack: 8 * beat * 0.8 }); }
    }
    if (name === 'montage') {
      if (on) { kick(t, 0.34); tone('sine', A(0), t, beat * 0.9, 0.12, { attack: 0.004 }); }
      if (on && (b - sec.b0) % 2 === 1) noise(t, 0.16, 0.14, { f0: 1800, q: 0.9 });
      if (on && flashBeat.has(b)) noise(t, 0.5, 0.08, { type: 'highpass', f0: 5000, q: 0.5 });
    }
    // 其他段落的切點也落一個輕音，讓「換畫面」聽得到（鋪陳、加速、彩蛋、片尾）
    if (on && shotStart.has(b) && b !== sec.b0 && (name === 'build' || name === 'accel')) tone('triangle', A(31), t, 0.25, 0.035, { attack: 0.004 });
  }
  // 從段落中間開始（seek、從暫停的地方接著播）：把這一段的長音補到段落結束
  function sustainFrom(b, t) {
    const sec = secAt(b);
    if (!sec || b === sec.b0 || !CHORD[sec.name]) return;
    pad(t, (sec.b1 - b) * beat + 0.4, CHORD[sec.name], sec.name === 'build' || sec.name === 'accel' ? 0.05 : 0.07);
  }

  let origin = 0;            // 影片第 0 秒對應的 ctx.currentTime
  let offset = 0;            // 還沒開始時停在第幾秒
  let nextStep = 0;
  let started = false, stopped = false, timer = null;

  function pump() {
    if (stopped) return;
    const horizon = ctx.currentTime + 0.25;
    let guard = 0;
    while (nextStep < totalSteps && origin + nextStep * STEP < horizon && guard++ < 64) {
      const t = origin + nextStep * STEP;
      if (t >= ctx.currentTime - 0.02) scheduleStep(nextStep, Math.max(t, ctx.currentTime));
      nextStep++;
    }
    timer = setTimeout(pump, 60);
  }
  function placeAt(sec) {
    origin = ctx.currentTime + 0.06 - sec;
    nextStep = Math.max(0, Math.ceil(sec / STEP - 1e-6));
    sustainFrom(Math.floor(sec / beat), ctx.currentTime + 0.06);
  }
  const settle = (p, ms) => Promise.race([Promise.resolve(p).catch(() => {}), new Promise((r) => setTimeout(r, ms))]);

  return {
    stream: dest.stream,
    style: 'trailer',
    plan,
    async start() {
      // 不准自動播放的瀏覽器裡 resume() 可能永遠不回來：最多等 1.5 秒，之後由 running() 判斷要不要退回牆上時鐘
      if (ctx.state === 'suspended') await settle(ctx.resume(), 1500);
      started = true;
      placeAt(offset);
      master.gain.setValueAtTime(0.0001, ctx.currentTime);
      master.gain.exponentialRampToValueAtTime(0.5, ctx.currentTime + 0.3);
      pump();
    },
    running() { return started && !stopped && ctx.state === 'running'; },
    time() { return started ? ctx.currentTime - origin : offset; },
    seek(sec) {
      offset = Math.max(0, sec || 0);
      if (!started || stopped) return;
      newBus();
      placeAt(offset);
    },
    progress() { /* 段落由拍點表決定，不看進度 */ },
    async pause() { await settle(ctx.suspend(), 800); },
    async resume() { await settle(ctx.resume(), 800); },
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
    async pause() { try { await ctx.suspend(); } catch { /* noop */ } },
    async resume() { try { await ctx.resume(); } catch { /* noop */ } },
    async fadeOutStop(sec = 1.2) {
      try { gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + sec); } catch { /* noop */ }
      await new Promise((r) => setTimeout(r, sec * 1000 + 100));
      try { src.stop(); } catch { /* noop */ }
      try { await ctx.close(); } catch { /* noop */ }          // src.stop() 丟例外也要關 ctx
    },
    stop() {
      try { src.stop(); } catch { /* noop */ }
      try { ctx.close(); } catch { /* noop */ }
    },
  };
}
