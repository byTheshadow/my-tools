/* 抓坏猫 v0.5
 * v0.5：关卡表 1-10、警衔解锁、选关界面、进度存档、无尽值班、难度随关卡递增。
 *
 * 以下为 v0.4 记录：
 *
 * 抓坏猫 v0.4
 * 纯本地单页小游戏，无外部请求、无内联脚本。
 * 语法基线：ES2017 / Chrome 61
 *
 * v0.4 变化：
 *   1. 劫狱：每漏网 5 只坏猫拉警报，窗口内按「别捣蛋」才能拦住，否则被劫走一只并扣 20 分。
 *   2. 三个道具：猫薄荷（传送带停 4 秒）、大网（一键抓最多颜色）、加格（临时 +1 格 20 秒）。
 *   3. 合成有概率掉道具；传送带每约 30 秒出现补给箱；背包每种上限 2。
 *   4. 底部道具栏（DOM 按钮）。
 *   5. 感叹号改为只有部分坏猫才有；没有感叹号的猫一定抓得住。
 *   6. 传送带整体下移 20px。
 */
(function () {
  'use strict';

  /* ================= 素材表 ================= */
  /* 改图只改这里。路径按仓库里的实际文件名一字不差地写。 */

  var ART = {
    bg: 'assets/bg.png',
    baby: [
      'assets/cat_bad_baby_black.png.jpg',   // 颜色 0
      'assets/cat_bad_baby_orange.png.jpg'   // 颜色 1
    ],
    berserk: 'assets/cat_bad_berserk.png.jpg',
    boss: 'assets/cat_bad_boss.png.jpg',
    good: [
      'assets/cat_good_1.png.jpg',
      'assets/cat_good_2.png.jpg'
    ],
    itemCatnip: 'assets/item_catnip.png.jpg',
    itemSlot: 'assets/item_slot.png.jpg'
  };

  /* ================= 配置 ================= */

  var CFG = {
    cageSlots: 7,
    mergeNeed: 3,
    maxLevel: 3,
    levelNames: ['', '坏小奶猫', '暴走猫', '坏猫大王'],
    mergeCooldown: 0.16,
    captureHold: 0.55,
    flyDur: 0.3,
    scoreCatch: 5,
    scoreMerge: 60,
    scoreCapture: 500,
    scoreTimeBonus: 10,
    penaltyGood: 15,                 // 误点乖猫扣分
    lockGood: 0.4,                   // 误点乖猫后的"愣住"时间（秒）
    // 警觉度 0 = 头上没有感叹号（一定抓得住）；1/2/3 = 对应个数的感叹号
    missRates: [0, 0.08, 0.22, 0.38],
    alertWeights: [0.35, 0.30, 0.22, 0.13],
    pityAfter: 2,                    // 连续扑空 2 次，第 3 次必中
    releaseHelpRate: 0.3,            // 放走时连带跑一只同伙的概率
    losePenalty: 100,                // 失败扣累计警务分
    loadTimeout: 3.5,                // 素材加载最长等待（秒），超时就先开场

    // ---- v0.4：劫狱 ----
    raidEvery: 5,                    // 每漏网 5 只坏猫触发一次
    raidMin: 1.4,                    // 警报窗口（秒）
    raidMax: 2.0,
    raidPenalty: 20,
    stopMax: 2,                      // 别捣蛋每局次数，也是回充上限

    // ---- v0.4：道具 ----
    itemCap: 2,                      // 每种道具背包上限
    dropRate: 0.12,                  // 每次合成掉道具概率
    chainDropAt: 3,                  // 连锁达到这个数必掉
    catnipTime: 4,
    slotTime: 20,
    netStagger: 0.07,                // 大网抓多只时，每只错开的飞行延迟
    crateFirst: 22,                  // 第一个补给箱出现时间（秒）
    crateEvery: 30,
    crateJitter: 3,

    // ---- v0.5 ----
    bonusTime: 10,                   // 目标 2 只以上的关卡与无尽：每逮捕一只（最后一只除外）加时
    progressKey: 'zhuahuaimao.progress.v1',
    // 警衔：按历史最高累计警务分算；maxLevel 是该警衔能进的最高关卡
    ranks: [
      { name: '见习鱼干保护者', need: 0,    maxLevel: 3 },
      { name: '正式鱼干守护官', need: 3000, maxLevel: 6 },
      { name: '首席鱼干守护长', need: 9000, maxLevel: 999 }
    ],

    storeKey: 'zhuahuaimao.best.v1',
    careerKey: 'zhuahuaimao.career.v1',
    hintKey: 'zhuahuaimao.hints.v1'
  };

  /* ---------- 关卡表 ---------- */
  /* 每关只加一条新规则；越往后扣分越重、扑空越多、传送带越快。抓猫得分不涨，只涨风险。 */

  var LEVEL_BASE = {
    colors: 2,
    spawnEvery: 1.05,
    spawnJitter: 0.35,
    crossTime: 5.4,
    good: false,         // 乖猫
    goodRate: 0.2,
    miss: false,         // 扑空与警觉度
    raid: false,         // 劫狱与别捣蛋
    drops: [],           // 合成会掉落、补给箱会给的道具种类
    crate: false,        // 补给箱
    penaltyGood: 15,     // 误点乖猫扣分
    penaltyRaid: 20,     // 劫狱成功扣分
    missMul: 1,          // 扑空率倍数
    pityAfter: 2,        // 连续扑空几次后必中
    endless: false,
    title: ''
  };

  function mix(a, b) {
    var o = {}, k;
    for (k in a) if (a.hasOwnProperty(k)) o[k] = a[k];
    for (k in b) if (b.hasOwnProperty(k)) o[k] = b[k];
    return o;
  }

  function lv(no, target, o) {
    var d = mix(LEVEL_BASE, o);
    d.no = no;
    d.target = target;
    d.duration = target === 1 ? 90 : (target === 2 ? 150 : 180);
    d.items = d.drops.length > 0;
    d.bonusTime = target >= 2 ? CFG.bonusTime : 0;
    return d;
  }

  var ALL_ITEMS = ['catnip', 'net', 'slot'];
  var FULL = { good: true, miss: true, raid: true };
  var TIER2 = mix(FULL, { goodRate: 0.22, penaltyGood: 20, penaltyRaid: 30, missMul: 1.15 });          // 第 4–6 关
  var TIER3 = mix(FULL, { goodRate: 0.26, penaltyGood: 25, penaltyRaid: 40, missMul: 1.3,
                          pityAfter: 3, crossTime: 4.6, spawnEvery: 0.95 });                              // 第 7–9 关
  var TIER4 = mix(FULL, { goodRate: 0.3, penaltyGood: 35, penaltyRaid: 50, missMul: 1.5,
                          pityAfter: 3, crossTime: 4.2, spawnEvery: 0.9, drops: ALL_ITEMS, crate: true }); // 第 10 关及无尽

  var LEVELS = [
    lv(1, 1, { title: '教学：只管抓猫' }),
    lv(2, 1, { title: '加入乖猫', good: true }),
    lv(3, 1, { title: '加入扑空与警觉度', good: true, miss: true }),
    lv(4, 2, mix(TIER2, { title: '加入劫狱与别捣蛋' })),
    lv(5, 2, mix(TIER2, { title: '传送带加速', crossTime: 5.0 })),
    lv(6, 2, mix(TIER2, { title: '合成会掉落猫薄荷', crossTime: 5.0, drops: ['catnip'] })),
    lv(7, 2, mix(TIER3, { title: '加入大网', drops: ['catnip', 'net'] })),
    lv(8, 3, mix(TIER3, { title: '加入加格', drops: ALL_ITEMS })),
    lv(9, 3, mix(TIER3, { title: '传送带出补给箱', drops: ALL_ITEMS, crate: true })),
    lv(10, 3, mix(TIER4, { title: 'Boss 关：全机制，难度拉满' }))
  ];

  // 无尽值班：从第 10 关的难度起步，每逮捕一只再加一档
  var ENDLESS = mix(LEVELS[9], { no: 0, target: Infinity, duration: 60, bonusTime: CFG.bonusTime, endless: true, title: '无尽值班' });

  function levelDefFor(no) {
    return mix(no === 0 ? ENDLESS : LEVELS[no - 1], {});
  }

  function applyEndless() {
    var t = G.captured, d = G.level;
    d.crossTime = Math.max(3.0, ENDLESS.crossTime - 0.1 * t);
    d.goodRate = Math.min(0.4, ENDLESS.goodRate + 0.01 * t);
    d.missMul = Math.min(2.0, ENDLESS.missMul + 0.03 * t);
    d.spawnEvery = Math.max(0.65, ENDLESS.spawnEvery - 0.02 * t);
    d.penaltyGood = Math.min(50, ENDLESS.penaltyGood + 2 * t);
    d.penaltyRaid = Math.min(70, ENDLESS.penaltyRaid + 3 * t);
  }

  // 图片加载失败时的兜底画法用色。界面文案不出现这些颜色词。
  var BABY = [
    { coat: '#4A5260', shade: '#2E3540', ear: '#6C7686', mark: 'spot' },
    { coat: '#E8903A', shade: '#C26C1C', ear: '#F2B47A', mark: 'stripe' }
  ];
  var BERSERK = { coat: '#B5564A', shade: '#8C3A31', ear: '#D98B7E', mark: 'stripe' };
  var BOSS = { coat: '#8E6BB5', shade: '#6A4A8C', ear: '#B79AD6', mark: 'spot' };

  var GOODS = [
    { coat: '#F3E9D2', shade: '#D8C7A4', ear: '#F2B4B8' },
    { coat: '#CFE6DD', shade: '#9CC4B6', ear: '#F2B4B8' }
  ];

  var COLOR = {
    ink: '#0D1620',
    panel: '#16242F',
    steel: '#2D3F52',
    steelHi: '#3C536B',
    amber: '#F2B134',
    paper: '#EDE6D6',
    dim: '#7A8894',
    stamp: '#CE4B36',
    mint: '#5FB3A1',
    dark: '#121C26'
  };

  var ITEM_KEYS = ['catnip', 'net', 'slot'];
  var ITEM_NAMES = { catnip: '猫薄荷', net: '大网', slot: '加格' };

  // 等级 + 颜色 → 兜底皮肤。lv>=2 不分颜色。
  function skinOf(lv, sp) {
    if (lv >= 3) return BOSS;
    if (lv === 2) return BERSERK;
    return BABY[sp % BABY.length];
  }

  /* ================= DOM ================= */

  var $ = function (id) { return document.getElementById(id); };

  var elLevelNo = $('levelNo');
  var elEscape = $('escapeNum');
  var elLeak = $('leakNum');
  var elScore = $('scoreNum');
  var elTarget = $('targetText');
  var elDots = $('targetDots');
  var elTimeFill = $('timeFill');
  var elTimeText = $('timeText');
  var elTimeBar = elTimeFill.parentNode;
  var elToast = $('toast');
  var elOverlay = $('overlay');
  var elScreenStart = $('screenStart');
  var elScreenEnd = $('screenEnd');
  var elBtnStart = $('btnStart');
  var elBtnAgain = $('btnAgain');
  var elBestStart = $('bestStart');
  var elBestEnd = $('bestEnd');
  var elVerdict = $('verdictMark');
  var elEndTitle = $('endTitle');
  var elEndNote = $('endNote');
  var elTally = $('tally');
  var elScreenHelp = $('screenHelp');
  var elHelpBody = $('helpBody');
  var elBtnHelp = $('btnHelp');
  var elBtnRules = $('btnRules');
  var elBtnRules2 = $('btnRules2');
  var elBtnHelpDone = $('btnHelpDone');
  var elCareerStart = $('careerStart');
  var elBar = $('bar');
  var elScreenLevels = $('screenLevels');
  var elLevelList = $('levelList');
  var elLevelsRank = $('levelsRank');
  var elBtnLevelsBack = $('btnLevelsBack');
  var elBtnNext = $('btnNext');
  var elBtnToLevels = $('btnToLevels');
  var elRankStart = $('rankStart');

  // 道具栏：三个道具 + 别捣蛋
  var TOOL = {
    catnip: { btn: $('btnCatnip'), cnt: $('cntCatnip'), name: $('nameCatnip'), ico: $('icoCatnip'), ictx: null },
    net:    { btn: $('btnNet'),    cnt: $('cntNet'),    name: $('nameNet'),    ico: $('icoNet'),    ictx: null },
    slot:   { btn: $('btnSlot'),   cnt: $('cntSlot'),   name: $('nameSlot'),   ico: $('icoSlot'),   ictx: null },
    stop:   { btn: $('btnStop'),   cnt: $('cntStop'),   name: $('nameStop'),   ico: $('icoStop'),   ictx: null }
  };

  var canvas = $('game');
  var ctx = canvas.getContext('2d');

  /* ================= 工具 ================= */

  function rand(a, b) { return a + Math.random() * (b - a); }
  function randInt(n) { return Math.floor(Math.random() * n); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

  function fmtTime(sec) {
    var s = Math.max(0, Math.ceil(sec));
    var m = Math.floor(s / 60);
    var r = s % 60;
    return m + ':' + (r < 10 ? '0' + r : '' + r);
  }

  function roundRect(c, x, y, w, h, r) {
    var rr = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + rr, y);
    c.lineTo(x + w - rr, y);
    c.quadraticCurveTo(x + w, y, x + w, y + rr);
    c.lineTo(x + w, y + h - rr);
    c.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    c.lineTo(x + rr, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - rr);
    c.lineTo(x, y + rr);
    c.quadraticCurveTo(x, y, x + rr, y);
    c.closePath();
  }

  var reduceMotion = false;
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reduceMotion = mq.matches;
  }

  function buzz(ms) {
    if (reduceMotion) return;
    if (navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) {} }
  }

  function loadBest() {
    try {
      var v = window.localStorage.getItem(CFG.storeKey);
      return v ? parseInt(v, 10) || 0 : 0;
    } catch (e) { return 0; }
  }

  function saveBest(v) {
    try { window.localStorage.setItem(CFG.storeKey, String(v)); } catch (e) {}
  }

  function loadCareer() {
    try {
      var v = window.localStorage.getItem(CFG.careerKey);
      return v ? parseInt(v, 10) || 0 : 0;
    } catch (e) { return 0; }
  }

  function saveCareer(v) {
    try { window.localStorage.setItem(CFG.careerKey, String(v)); } catch (e) {}
  }

  function loadHints() {
    try {
      var v = window.localStorage.getItem(CFG.hintKey);
      var o = v ? JSON.parse(v) : null;
      return o && typeof o === 'object' ? o : {};
    } catch (e) { return {}; }
  }

  function saveHints() {
    try { window.localStorage.setItem(CFG.hintKey, JSON.stringify(hints)); } catch (e) {}
  }

  // 一次性提示的已读记录；网址加 ?reset 可清空，方便反复测试
  var hints = loadHints();
  if (/[?&]reset(=|&|$)/.test(window.location.search)) { hints = {}; saveHints(); }

  function hintOnce(key, text, kind) {
    if (hints[key]) return false;
    hints[key] = 1;
    saveHints();
    toast(text, kind, 2.8);
    return true;
  }

  /* ================= 进度存档、警衔与解锁（v0.5） ================= */

  function loadProgress() {
    var o = null;
    try {
      var v = window.localStorage.getItem(CFG.progressKey);
      o = v ? JSON.parse(v) : null;
    } catch (e) { o = null; }
    if (!o || typeof o !== 'object') o = {};
    var p = {
      cleared: parseInt(o.cleared, 10) || 0,                 // 已通关的最高关卡
      best: (o.best && typeof o.best === 'object') ? o.best : {},
      peak: parseInt(o.peak, 10) || 0,                       // 历史最高累计警务分
      endless: { caps: 0, score: 0 }
    };
    if (o.endless && typeof o.endless === 'object') {
      p.endless.caps = parseInt(o.endless.caps, 10) || 0;
      p.endless.score = parseInt(o.endless.score, 10) || 0;
    }
    return p;
  }

  var DEV_UNLOCK = /[?&]unlock(=|&|$)/.test(window.location.search);   // 网址加 ?unlock：本次全部解锁，用于试玩，不写入存档

  var P = loadProgress();
  P.peak = Math.max(P.peak, loadCareer());
  if (DEV_UNLOCK) { P.cleared = 10; P.peak = Math.max(P.peak, 99999); }

  function saveProgress() {
    if (DEV_UNLOCK) return;
    try { window.localStorage.setItem(CFG.progressKey, JSON.stringify(P)); } catch (e) {}
  }

  function rankIndex(peak) {
    var r = 0;
    for (var i = 0; i < CFG.ranks.length; i++) {
      if (peak >= CFG.ranks[i].need) r = i;
    }
    return r;
  }

  // 进某一关需要的最低警衔（no = 0 表示无尽）
  function rankNeed(no) {
    var n = no === 0 ? 999 : no;
    for (var i = 0; i < CFG.ranks.length; i++) {
      if (CFG.ranks[i].maxLevel >= n) return i;
    }
    return CFG.ranks.length - 1;
  }

  // 解锁 = 上一关已通关 + 警衔够
  function canPlay(no) {
    var need = no === 0 ? 10 : no - 1;
    if (P.cleared < need) return { ok: false, reason: '先通关第 ' + need + ' 关' };
    var ri = rankNeed(no);
    if (rankIndex(P.peak) < ri) {
      return { ok: false, reason: '需要「' + CFG.ranks[ri].name + '」，还差 ' + (CFG.ranks[ri].need - P.peak) + ' 分' };
    }
    return { ok: true, reason: '' };
  }

  function rankLineText() {
    var r = rankIndex(P.peak);
    var nxt = CFG.ranks[r + 1];
    return '警衔：' + CFG.ranks[r].name + '　累计警务分 ' + P.peak +
      (nxt ? '（距「' + nxt.name + '」还差 ' + (nxt.need - P.peak) + ' 分）' : '（已是最高警衔）');
  }

  function refreshRankUI() {
    elRankStart.textContent = CFG.ranks[rankIndex(P.peak)].name;
    elLevelsRank.textContent = rankLineText();
  }

  // 底部道具栏：本关没有的道具按钮不显示；一个都没有就整条收起（画布随之变高）
  function applyBar(def) {
    var any = false, i, k;
    for (i = 0; i < ITEM_KEYS.length; i++) {
      k = ITEM_KEYS[i];
      var on = def.drops.indexOf(k) >= 0;
      TOOL[k].btn.hidden = !on;
      if (on) any = true;
    }
    TOOL.stop.btn.hidden = !def.raid;
    if (def.raid) any = true;
    var was = elBar.hidden;
    elBar.hidden = !any;
    if (was !== elBar.hidden) layout();
  }

  function showLevelHud(def) {
    elLevelNo.textContent = def.endless ? '无尽' : '第 ' + def.no + ' 号';
    if (def.endless) {
      elTarget.textContent = '无尽值班';
      while (elDots.firstChild) elDots.removeChild(elDots.firstChild);
      elDots.textContent = '已逮捕 0';
    } else {
      elTarget.textContent = CFG.levelNames[3] + ' ×' + def.target;
      buildDots(def.target);
    }
  }

  /* ================= 素材加载 ================= */
  /* 每张图独立加载，失败只影响那一张，其余照用。全失败也能玩。 */

  var PIC = {};        // path -> { img, ok }
  var pending = 0;
  var loadDone = false;
  var loadClock = 0;

  function loadPic(path) {
    if (!path) return null;
    if (PIC[path]) return PIC[path];
    var rec = { img: new window.Image(), ok: false, bad: false };
    PIC[path] = rec;
    pending++;
    rec.img.onload = function () {
      rec.ok = rec.img.width > 0 && rec.img.height > 0;
      rec.bad = !rec.ok;
      pending--;
      if (pending <= 0) loadDone = true;
    };
    rec.img.onerror = function () {
      rec.bad = true;
      pending--;
      if (pending <= 0) loadDone = true;
    };
    rec.img.src = path;
    return rec;
  }

  function preload() {
    loadPic(ART.bg);
    for (var i = 0; i < ART.baby.length; i++) loadPic(ART.baby[i]);
    loadPic(ART.berserk);
    loadPic(ART.boss);
    for (var g = 0; g < ART.good.length; g++) loadPic(ART.good[g]);
    loadPic(ART.itemCatnip);
    loadPic(ART.itemSlot);
    if (pending === 0) loadDone = true;
  }

  function picOf(path) {
    var rec = PIC[path];
    return rec && rec.ok ? rec : null;
  }

  function catPic(lv, sp) {
    if (lv >= 3) return picOf(ART.boss);
    if (lv === 2) return picOf(ART.berserk);
    return picOf(ART.baby[sp % ART.baby.length]);
  }

  function goodPic(v) {
    return picOf(ART.good[v % ART.good.length]);
  }

  /* ================= 音效（WebAudio 现场合成） ================= */

  var AudioFX = (function () {
    var ac = null;
    var master = null;

    function init() {
      if (ac) return;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        ac = new AC();
        master = ac.createGain();
        master.gain.value = 0.32;
        master.connect(ac.destination);
      } catch (e) { ac = null; }
    }

    function resume() {
      if (ac && ac.state === 'suspended') { try { ac.resume(); } catch (e) {} }
    }

    function tone(freq, dur, type, vol, slideTo, delay) {
      if (!ac) return;
      var t0 = ac.currentTime + (delay || 0);
      var osc = ac.createOscillator();
      var g = ac.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol || 0.3, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g);
      g.connect(master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.03);
    }

    function noise(dur, vol) {
      if (!ac) return;
      var n = Math.floor(ac.sampleRate * dur);
      var buf = ac.createBuffer(1, n, ac.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      var src = ac.createBufferSource();
      src.buffer = buf;
      var g = ac.createGain();
      g.gain.value = vol || 0.2;
      src.connect(g); g.connect(master);
      src.start();
    }

    return {
      init: init,
      resume: resume,
      grab: function () { tone(520, 0.08, 'triangle', 0.26, 760); },
      land: function () { tone(300, 0.07, 'sine', 0.2); },
      deny: function () { tone(170, 0.14, 'square', 0.16, 110); },
      miss: function () { tone(720, 0.11, 'sine', 0.15, 360); noise(0.05, 0.08); },
      release: function () { tone(480, 0.2, 'triangle', 0.2, 900); },
      merge: function (lv, chain) {
        var base = 440 * Math.pow(1.26, lv - 1) * Math.pow(1.12, Math.min(chain, 5) - 1);
        tone(base, 0.16, 'triangle', 0.3, base * 1.5);
        noise(0.06, 0.12);
      },
      capture: function () {
        noise(0.12, 0.3);
        tone(392, 0.4, 'triangle', 0.3, 0, 0);
        tone(523, 0.4, 'triangle', 0.26, 0, 0.07);
        tone(784, 0.5, 'triangle', 0.24, 0, 0.14);
      },
      escape: function () { tone(240, 0.18, 'sine', 0.14, 160); },
      win: function () {
        var seq = [523, 659, 784, 1047];
        for (var i = 0; i < seq.length; i++) tone(seq[i], 0.35, 'triangle', 0.26, 0, i * 0.1);
      },
      lose: function () {
        tone(330, 0.5, 'sine', 0.22, 150);
        tone(220, 0.6, 'sine', 0.18, 110, 0.08);
      },
      // ---- v0.4 ----
      item: function () {
        tone(660, 0.1, 'triangle', 0.24, 990);
        tone(990, 0.16, 'triangle', 0.2, 0, 0.08);
      },
      net: function () {
        noise(0.18, 0.2);
        tone(400, 0.25, 'triangle', 0.22, 800);
      },
      beep: function () { tone(880, 0.11, 'square', 0.1, 640); },
      block: function () {
        tone(600, 0.1, 'triangle', 0.28, 900);
        tone(900, 0.2, 'triangle', 0.24, 0, 0.08);
      },
      breakout: function () {
        noise(0.15, 0.25);
        tone(200, 0.3, 'sawtooth', 0.18, 90);
      }
    };
  })();

  /* ================= 布局 ================= */

  var L = {};
  var dpr = 1;

  function layout() {
    var rect = canvas.getBoundingClientRect();
    var w = Math.max(240, Math.round(rect.width));
    var h = Math.max(300, Math.round(rect.height));

    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    L.w = w;
    L.h = h;

    L.beltH = Math.min(150, Math.max(96, h * 0.27));
    L.beltTop = Math.round(h * 0.06) + 20;          // v0.4：整体下移 20px，方便单手点
    L.beltBottom = L.beltTop + L.beltH;
    L.beltLine = L.beltTop + L.beltH * 0.46;
    L.catSize = Math.min(L.beltH * 0.66, w * 0.17, 74);

    var pad = 12;
    L.cageH = Math.min(104, Math.max(74, h * 0.18));
    L.cageBottom = h - 10;
    L.cageTop = L.cageBottom - L.cageH;
    L.cageLeft = pad;
    L.cageW = w - pad * 2;
    L.cellGap = 5;
    L.cellH = L.cageH - 22;
    L.cellTop = L.cageTop + 18;
    layoutCells();

    L.chainY = (L.beltBottom + L.cageTop) / 2;
  }

  // 格子宽度随当前格数变化（加格生效时是 8 格）
  function layoutCells() {
    var n = G.slotCount || CFG.cageSlots;
    L.cellW = (L.cageW - L.cellGap * (n - 1)) / n;
    L.cageCat = Math.min(L.cellW * 0.86, L.cellH * 0.78);
  }

  function slotCenter(i) {
    return {
      x: L.cageLeft + i * (L.cellW + L.cellGap) + L.cellW / 2,
      y: L.cellTop + L.cellH / 2
    };
  }

  /* ================= 游戏状态 ================= */

  var G = {
    state: 'idle',           // idle | playing | paused | ending | over
    level: LEVELS[0],
    time: 0,
    timeTotal: 90,           // 时间条的满格值（加时后会变大）
    score: 0,
    captured: 0,
    escaped: 0,
    cats: [],
    slots: [],
    slotCount: CFG.cageSlots,
    flyers: [],
    parts: [],
    floats: [],
    spawnTimer: 0,
    nextSpawn: 1,
    beltOffset: 0,
    chain: 0,
    checkPending: false,
    mergeTimer: 0,
    shake: 0,
    stamp: null,
    catId: 1,
    toldEscape: false,
    clock: 0,
    lock: 0,                 // 误点乖猫后的点击冷却
    sel: -1,                 // 笼满时选中的待放走格子
    runners: [],             // 被放走、正在逃跑的猫
    goodHit: 0,
    missTotal: 0,
    released: 0,

    // v0.4
    inv: { catnip: 0, net: 0, slot: 0 },
    stopLeft: CFG.stopMax,
    leak: 0,                 // 距离下次劫狱已漏网的坏猫数
    alarm: 0,                // 警报剩余窗口（秒）
    alarmDur: 0,
    alarmBeep: 0,
    raided: 0,               // 本局被劫走的猫数
    freeze: 0,               // 猫薄荷剩余秒数
    extra: 0,                // 加格剩余秒数
    shrink: false,           // 加格到期但那格还有猫，等玩家腾位
    crateTimer: 0,
    nextCrate: CFG.crateFirst,
    netFx: null
  };

  function addScore(n) {
    G.score = Math.max(0, G.score + n);
  }

  function resetSlots() {
    G.slots = [];
    for (var i = 0; i < G.slotCount; i++) G.slots.push(null);
  }

  // 每局 / 待机时重置所有 v0.4 状态
  function resetV04() {
    G.inv = { catnip: 0, net: 0, slot: 0 };
    G.stopLeft = CFG.stopMax;
    G.leak = 0;
    G.alarm = 0;
    G.alarmDur = 0;
    G.alarmBeep = 0;
    G.raided = 0;
    G.freeze = 0;
    G.extra = 0;
    G.shrink = false;
    G.slotCount = CFG.cageSlots;
    G.crateTimer = 0;
    G.nextCrate = CFG.crateFirst;
    G.netFx = null;
    layoutCells();
  }

  function startIdle() {
    G.state = 'idle';
    G.level = LEVELS[0];
    G.cats = [];
    G.flyers = [];
    G.parts = [];
    G.floats = [];
    resetV04();
    resetSlots();
    G.spawnTimer = 0;
    G.nextSpawn = 0.5;
    G.timeTotal = G.level.duration;
    applyBar(G.level);
    G.stamp = null;
    G.runners = [];
    G.sel = -1;
    G.lock = 0;
  }

  function startLevel(def) {
    G.state = 'playing';
    G.level = def;
    G.time = def.duration;
    G.timeTotal = def.duration;
    G.score = 0;
    G.captured = 0;
    G.escaped = 0;
    G.cats = [];
    G.flyers = [];
    G.parts = [];
    G.floats = [];
    resetV04();
    resetSlots();
    G.spawnTimer = 0;
    G.nextSpawn = 0.35;
    G.chain = 0;
    G.checkPending = false;
    G.mergeTimer = 0;
    G.shake = 0;
    G.stamp = null;
    G.toldEscape = false;
    G.runners = [];
    G.sel = -1;
    G.lock = 0;
    G.goodHit = 0;
    G.missTotal = 0;
    G.released = 0;

    showLevelHud(def);
    applyBar(def);
    syncHud();
    syncTools();
    drawIcons();
    toast(def.endless ? '无尽值班：抓得越多越难' : '第 ' + def.no + ' 号：' + def.title, 'good', 2.4);
  }

  function buildDots(n) {
    while (elDots.firstChild) elDots.removeChild(elDots.firstChild);
    for (var i = 0; i < n; i++) elDots.appendChild(document.createElement('i'));
  }

  function syncDots() {
    if (G.level.endless) {
      elDots.textContent = '已逮捕 ' + G.captured;
      return;
    }
    var kids = elDots.childNodes;
    for (var i = 0; i < kids.length; i++) {
      if (i < G.captured) kids[i].className = 'on';
      else kids[i].className = '';
    }
  }

  var lastScoreShown = -1;
  var lastTimeShown = -1;
  var lastLeakShown = '';

  function syncHud() {
    if (G.score !== lastScoreShown) {
      elScore.textContent = String(G.score);
      lastScoreShown = G.score;
    }
    elEscape.textContent = String(G.escaped);

    var leakTxt = G.level.raid ? G.leak + '/' + CFG.raidEvery : '-';
    if (leakTxt !== lastLeakShown) {
      elLeak.textContent = leakTxt;
      lastLeakShown = leakTxt;
    }

    var total = G.timeTotal || G.level.duration;
    var ratio = clamp(G.time / total, 0, 1);
    elTimeFill.style.transform = 'scaleX(' + ratio.toFixed(4) + ')';

    var sec = Math.ceil(Math.max(0, G.time));
    if (sec !== lastTimeShown) {
      elTimeText.textContent = fmtTime(G.time);
      lastTimeShown = sec;
    }
    if (G.time <= 15 && G.state === 'playing') elTimeBar.className = 'time-bar low';
    else elTimeBar.className = 'time-bar';
  }

  /* ================= 道具栏（DOM 按钮） ================= */

  var toolCache = {};

  function setText(key, el, txt) {
    if (toolCache[key] !== txt) { toolCache[key] = txt; el.textContent = txt; }
  }

  function setCls(key, el, cls) {
    if (toolCache[key] !== cls) { toolCache[key] = cls; el.className = cls; }
  }

  function syncTools() {
    var i, k, T, active, cls;
    for (i = 0; i < ITEM_KEYS.length; i++) {
      k = ITEM_KEYS[i];
      T = TOOL[k];
      active = false;
      var nm = ITEM_NAMES[k];
      if (k === 'catnip' && G.freeze > 0) { active = true; nm = Math.ceil(G.freeze) + ' 秒'; }
      if (k === 'slot' && G.slotCount > CFG.cageSlots) {
        active = true;
        nm = G.shrink ? '到期' : Math.ceil(G.extra) + ' 秒';
      }
      cls = 'tool' + (G.inv[k] <= 0 ? ' empty' : '') + (active ? ' active' : '') + (pulseUntil[k] > G.clock ? ' pulse' : '');
      setCls('c' + k, T.btn, cls);
      setText('n' + k, T.cnt, String(G.inv[k]));
      setText('t' + k, T.name, nm);
    }
    T = TOOL.stop;
    cls = 'tool tool-stop' + (G.stopLeft <= 0 ? ' empty' : '') + (G.alarm > 0 ? ' alarm' : '');
    setCls('cstop', T.btn, cls);
    setText('nstop', T.cnt, String(G.stopLeft));
  }

  /* ---------- 道具栏图标（小画布；猫薄荷、加格用正式图，其余代码绘制） ---------- */

  function setupIcons() {
    var d = Math.min(window.devicePixelRatio || 1, 2);
    for (var k in TOOL) {
      if (!TOOL.hasOwnProperty(k)) continue;
      var cv = TOOL[k].ico;
      cv.width = Math.round(36 * d);
      cv.height = Math.round(36 * d);
      TOOL[k].ictx = cv.getContext('2d');
      TOOL[k].ictx.setTransform(d, 0, 0, d, 0, 0);
    }
  }

  function fitPic(c, rec, cx, cy, box) {
    var k = Math.min(box / rec.img.width, box / rec.img.height);
    var w = rec.img.width * k, h = rec.img.height * k;
    c.drawImage(rec.img, cx - w / 2, cy - h / 2, w, h);
  }

  function drawIcon(k) {
    var c = TOOL[k].ictx;
    if (!c) return;
    c.clearRect(0, 0, 36, 36);
    var rec, i;

    if (k === 'catnip') {
      rec = picOf(ART.itemCatnip);
      if (rec) { fitPic(c, rec, 18, 18, 34); return; }
      c.save();
      c.translate(18, 31);
      c.strokeStyle = '#4F8F5E';
      c.lineWidth = 2.2;
      c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -10); c.stroke();
      c.fillStyle = '#6CC08A';
      for (i = -1; i <= 1; i++) {
        c.save();
        c.translate(0, -10);
        c.rotate(i * 0.7);
        c.beginPath(); c.ellipse(0, -8, 5, 9.5, 0, 0, 6.3); c.fill();
        c.restore();
      }
      c.restore();
    } else if (k === 'slot') {
      rec = picOf(ART.itemSlot);
      if (rec) { fitPic(c, rec, 18, 18, 34); return; }
      c.strokeStyle = COLOR.amber;
      c.lineWidth = 2.5;
      roundRect(c, 5, 8, 26, 20, 3);
      c.stroke();
      c.beginPath();
      c.moveTo(18, 13); c.lineTo(18, 23);
      c.moveTo(13, 18); c.lineTo(23, 18);
      c.stroke();
    } else if (k === 'net') {
      c.save();
      c.translate(15, 15);
      c.beginPath(); c.arc(0, 0, 11, 0, 6.3); c.clip();
      c.strokeStyle = COLOR.paper;
      c.lineWidth = 1.2;
      for (i = -12; i <= 12; i += 6) {
        c.beginPath();
        c.moveTo(i, -12); c.lineTo(i, 12);
        c.moveTo(-12, i); c.lineTo(12, i);
        c.stroke();
      }
      c.restore();
      c.strokeStyle = COLOR.paper;
      c.lineWidth = 2;
      c.beginPath(); c.arc(15, 15, 11, 0, 6.3); c.stroke();
      c.lineWidth = 3.2;
      c.lineCap = 'round';
      c.beginPath(); c.moveTo(23, 23); c.lineTo(32, 32); c.stroke();
    } else if (k === 'stop') {
      c.fillStyle = COLOR.stamp;
      c.beginPath(); c.arc(18, 18, 13, 0, 6.3); c.fill();
      c.fillStyle = '#FFFFFF';
      roundRect(c, 9, 15, 18, 6, 2);
      c.fill();
    }
  }

  function drawIcons() {
    for (var k in TOOL) {
      if (TOOL.hasOwnProperty(k)) drawIcon(k);
    }
  }

  var pulseUntil = {};

  // 拿到道具时，对应按钮闪一下
  function pulseTool(k) {
    pulseUntil[k] = G.clock + 0.45;
  }

  /* ================= 提示条 ================= */

  var toastTimer = 0;

  function toast(text, kind, dur) {
    elToast.textContent = text;
    elToast.className = 'toast show' + (kind ? ' ' + kind : '');
    toastTimer = dur || 1.1;
  }

  function tickToast(dt) {
    if (toastTimer > 0) {
      toastTimer -= dt;
      if (toastTimer <= 0) elToast.className = 'toast';
    }
  }

  /* ================= 特效 ================= */

  function burst(x, y, n, colors, power) {
    if (reduceMotion) n = Math.min(n, 5);
    for (var i = 0; i < n; i++) {
      var a = rand(0, Math.PI * 2);
      var sp = rand(0.3, 1) * (power || 170);
      G.parts.push({
        x: x, y: y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - rand(20, 90),
        life: rand(0.45, 0.9),
        max: 0.9,
        r: rand(2, 5),
        c: colors[randInt(colors.length)],
        spin: rand(-8, 8),
        rot: rand(0, 6.28),
        star: Math.random() < 0.4
      });
    }
  }

  function floatText(x, y, text, color, size) {
    G.floats.push({ x: x, y: y, text: text, c: color, s: size || 15, life: 0.9 });
  }

  /* ================= 猫的绘制 ================= */
  /* drawCat / drawGood 是统一入口：有图用图，没图退回手绘。 */

  function drawShadow(c, size) {
    c.fillStyle = 'rgba(0,0,0,.28)';
    c.beginPath();
    c.ellipse(0, size * 0.46, size * 0.34, size * 0.07, 0, 0, Math.PI * 2);
    c.fill();
  }

  function drawPic(c, rec, x, y, size, phase, alpha) {
    var iw = rec.img.width, ih = rec.img.height;
    var k = Math.min(size / iw, size / ih);
    var w = iw * k, h = ih * k;

    c.save();
    c.globalAlpha = alpha === undefined ? 1 : alpha;
    c.translate(x, y);
    if (phase) c.rotate(Math.sin(phase) * 0.06);
    drawShadow(c, size);
    c.drawImage(rec.img, -w / 2, -h / 2, w, h);
    c.restore();
  }

  function drawCat(c, x, y, size, sp, lv, phase, alpha) {
    var rec = catPic(lv, sp);
    if (rec) { drawPic(c, rec, x, y, size, phase, alpha); return; }
    drawCatShape(c, x, y, size, sp, lv, phase, alpha);
  }

  function drawGood(c, x, y, size, v, phase, alpha) {
    var rec = goodPic(v);
    if (rec) { drawPic(c, rec, x, y, size, phase, alpha); return; }
    drawGoodShape(c, x, y, size, v, phase, alpha);
  }

  /* ---------- 兜底手绘：坏猫 ---------- */

  function drawCatShape(c, x, y, size, spIdx, lv, phase, alpha) {
    var sk = skinOf(lv, spIdx);
    var s = size / 100;

    c.save();
    c.globalAlpha = alpha === undefined ? 1 : alpha;
    c.translate(x, y);
    c.scale(s, s);
    if (phase) c.rotate(Math.sin(phase) * 0.06);

    c.fillStyle = 'rgba(0,0,0,.28)';
    c.beginPath();
    c.ellipse(0, 46, 34, 7, 0, 0, Math.PI * 2);
    c.fill();

    // 耳朵
    c.fillStyle = sk.shade;
    c.beginPath();
    c.moveTo(-38, -14); c.lineTo(-31, -52); c.lineTo(-5, -26); c.closePath(); c.fill();
    c.beginPath();
    c.moveTo(38, -14); c.lineTo(31, -52); c.lineTo(5, -26); c.closePath(); c.fill();
    c.fillStyle = sk.ear;
    c.beginPath();
    c.moveTo(-32, -18); c.lineTo(-28, -42); c.lineTo(-13, -26); c.closePath(); c.fill();
    c.beginPath();
    c.moveTo(32, -18); c.lineTo(28, -42); c.lineTo(13, -26); c.closePath(); c.fill();

    // 头
    c.fillStyle = sk.coat;
    c.beginPath();
    c.ellipse(0, 2, 42, 39, 0, 0, Math.PI * 2);
    c.fill();

    // 花色
    c.fillStyle = sk.shade;
    if (sk.mark === 'stripe') {
      c.fillRect(-16, -32, 5, 13);
      c.fillRect(-4, -36, 5, 16);
      c.fillRect(8, -32, 5, 13);
    } else {
      c.beginPath(); c.ellipse(-26, -14, 9, 7, -0.3, 0, 6.3); c.fill();
      c.beginPath(); c.ellipse(24, 18, 8, 6, 0.3, 0, 6.3); c.fill();
      c.beginPath(); c.ellipse(-2, -30, 7, 5, 0, 0, 6.3); c.fill();
    }

    // 眼罩（坏猫标志）
    c.fillStyle = '#14202B';
    c.beginPath();
    c.moveTo(-44, -6);
    c.quadraticCurveTo(0, -16, 44, -6);
    c.lineTo(44, 8);
    c.quadraticCurveTo(0, 14, -44, 8);
    c.closePath();
    c.fill();

    // 眼睛
    var blink = Math.sin((phase || 0) * 0.7) > 0.985 ? 0.12 : 1;
    c.fillStyle = '#F7F2E4';
    c.beginPath(); c.ellipse(-17, 0, 9, 8 * blink, 0, 0, 6.3); c.fill();
    c.beginPath(); c.ellipse(17, 0, 9, 8 * blink, 0, 0, 6.3); c.fill();
    if (blink > 0.5) {
      c.fillStyle = '#121C26';
      var pw = lv >= 2 ? 3.2 : 4.4;
      c.beginPath(); c.ellipse(-16, 1, pw, 6, 0, 0, 6.3); c.fill();
      c.beginPath(); c.ellipse(18, 1, pw, 6, 0, 0, 6.3); c.fill();
      c.fillStyle = 'rgba(255,255,255,.85)';
      c.beginPath(); c.arc(-18, -2, 1.6, 0, 6.3); c.fill();
      c.beginPath(); c.arc(16, -2, 1.6, 0, 6.3); c.fill();
    }

    // 怒眉（2 级以上）
    if (lv >= 2) {
      c.strokeStyle = '#14202B';
      c.lineWidth = 4;
      c.lineCap = 'round';
      c.beginPath(); c.moveTo(-29, -16); c.lineTo(-9, -9); c.stroke();
      c.beginPath(); c.moveTo(29, -16); c.lineTo(9, -9); c.stroke();
    }

    // 鼻子与坏笑
    c.fillStyle = '#E2705E';
    c.beginPath();
    c.moveTo(-5, 15); c.lineTo(5, 15); c.lineTo(0, 21); c.closePath(); c.fill();

    c.strokeStyle = '#14202B';
    c.lineWidth = 2.6;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(0, 21);
    c.quadraticCurveTo(9, 30, 19, 22);
    c.stroke();
    c.beginPath();
    c.moveTo(0, 21);
    c.quadraticCurveTo(-5, 27, -12, 24);
    c.stroke();

    if (lv >= 2) {
      c.fillStyle = '#F7F2E4';
      c.beginPath(); c.moveTo(4, 22); c.lineTo(10, 22); c.lineTo(7, 29); c.closePath(); c.fill();
    }

    // 胡须
    c.strokeStyle = 'rgba(247,242,228,.5)';
    c.lineWidth = 1.8;
    c.beginPath(); c.moveTo(-28, 16); c.lineTo(-46, 12); c.stroke();
    c.beginPath(); c.moveTo(-28, 21); c.lineTo(-45, 23); c.stroke();
    c.beginPath(); c.moveTo(28, 16); c.lineTo(46, 12); c.stroke();
    c.beginPath(); c.moveTo(28, 21); c.lineTo(45, 23); c.stroke();

    // 坏猫大王：王冠
    if (lv >= 3) {
      c.fillStyle = COLOR.amber;
      c.beginPath();
      c.moveTo(-26, -40);
      c.lineTo(-18, -58); c.lineTo(-9, -44);
      c.lineTo(0, -62); c.lineTo(9, -44);
      c.lineTo(18, -58); c.lineTo(26, -40);
      c.closePath();
      c.fill();
      c.fillStyle = '#B5831F';
      c.fillRect(-26, -41, 52, 6);
      c.fillStyle = COLOR.stamp;
      c.beginPath(); c.arc(0, -50, 3.4, 0, 6.3); c.fill();
    }

    c.restore();
  }

  /* ---------- 兜底手绘：乖猫 ---------- */

  function drawGoodShape(c, x, y, size, v, phase, alpha) {
    var g = GOODS[v % GOODS.length];
    var s = size / 100;

    c.save();
    c.globalAlpha = alpha === undefined ? 1 : alpha;
    c.translate(x, y);
    c.scale(s, s);
    if (phase) c.rotate(Math.sin(phase) * 0.06);

    c.fillStyle = 'rgba(0,0,0,.28)';
    c.beginPath();
    c.ellipse(0, 46, 34, 7, 0, 0, Math.PI * 2);
    c.fill();

    c.fillStyle = g.shade;
    c.beginPath();
    c.moveTo(-38, -14); c.lineTo(-31, -52); c.lineTo(-5, -26); c.closePath(); c.fill();
    c.beginPath();
    c.moveTo(38, -14); c.lineTo(31, -52); c.lineTo(5, -26); c.closePath(); c.fill();
    c.fillStyle = g.ear;
    c.beginPath();
    c.moveTo(-32, -18); c.lineTo(-28, -42); c.lineTo(-13, -26); c.closePath(); c.fill();
    c.beginPath();
    c.moveTo(32, -18); c.lineTo(28, -42); c.lineTo(13, -26); c.closePath(); c.fill();

    c.fillStyle = g.coat;
    c.beginPath();
    c.ellipse(0, 2, 42, 39, 0, 0, Math.PI * 2);
    c.fill();

    c.fillStyle = 'rgba(240,140,155,.5)';
    c.beginPath(); c.ellipse(-27, 14, 8, 5, 0, 0, 6.3); c.fill();
    c.beginPath(); c.ellipse(27, 14, 8, 5, 0, 0, 6.3); c.fill();

    var blink = Math.sin((phase || 0) * 0.7) > 0.985 ? 0.12 : 1;
    c.fillStyle = '#1B2733';
    c.beginPath(); c.ellipse(-17, -2, 7, 9 * blink, 0, 0, 6.3); c.fill();
    c.beginPath(); c.ellipse(17, -2, 7, 9 * blink, 0, 0, 6.3); c.fill();
    if (blink > 0.5) {
      c.fillStyle = '#FFFFFF';
      c.beginPath(); c.arc(-19.5, -5.5, 2.6, 0, 6.3); c.fill();
      c.beginPath(); c.arc(14.5, -5.5, 2.6, 0, 6.3); c.fill();
      c.beginPath(); c.arc(-15, 1, 1.2, 0, 6.3); c.fill();
      c.beginPath(); c.arc(19, 1, 1.2, 0, 6.3); c.fill();
    }

    c.fillStyle = '#E58A94';
    c.beginPath();
    c.moveTo(-5, 15); c.lineTo(5, 15); c.lineTo(0, 21); c.closePath(); c.fill();
    c.strokeStyle = '#3B2A2A';
    c.lineWidth = 2.6;
    c.lineCap = 'round';
    c.beginPath(); c.moveTo(0, 21); c.quadraticCurveTo(-6, 31, -15, 23); c.stroke();
    c.beginPath(); c.moveTo(0, 21); c.quadraticCurveTo(6, 31, 15, 23); c.stroke();

    c.strokeStyle = 'rgba(60,50,50,.4)';
    c.lineWidth = 1.8;
    c.beginPath(); c.moveTo(-28, 16); c.lineTo(-46, 12); c.stroke();
    c.beginPath(); c.moveTo(-28, 21); c.lineTo(-45, 23); c.stroke();
    c.beginPath(); c.moveTo(28, 16); c.lineTo(46, 12); c.stroke();
    c.beginPath(); c.moveTo(28, 21); c.lineTo(45, 23); c.stroke();

    // 蝴蝶结（乖猫标志）
    c.fillStyle = COLOR.mint;
    c.strokeStyle = '#3F8A7A';
    c.lineWidth = 2;
    c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(0, -38); c.lineTo(-19, -50); c.lineTo(-19, -26); c.closePath();
    c.fill(); c.stroke();
    c.beginPath();
    c.moveTo(0, -38); c.lineTo(19, -50); c.lineTo(19, -26); c.closePath();
    c.fill(); c.stroke();
    c.fillStyle = '#3F8A7A';
    c.beginPath(); c.arc(0, -38, 5, 0, 6.3); c.fill();

    c.restore();
  }

  /* ---------- 补给箱（代码绘制，不需要图） ---------- */

  function drawCrate(c, x, y, size, phase) {
    var s = size / 100;
    var pulse = 0.5 + 0.5 * Math.sin(G.clock * 5);

    c.save();
    c.translate(x, y);

    // 提示光圈
    c.globalAlpha = 0.25 + 0.35 * pulse;
    c.strokeStyle = COLOR.amber;
    c.lineWidth = 2;
    c.beginPath();
    c.arc(0, 0, size * 0.62, 0, 6.3);
    c.stroke();
    c.globalAlpha = 1;

    c.scale(s, s);
    if (phase) c.rotate(Math.sin(phase) * 0.05);

    c.fillStyle = 'rgba(0,0,0,.28)';
    c.beginPath();
    c.ellipse(0, 46, 34, 7, 0, 0, Math.PI * 2);
    c.fill();

    c.fillStyle = '#8A6638';
    roundRect(c, -38, -28, 76, 68, 5);
    c.fill();
    c.fillStyle = '#A5804D';
    roundRect(c, -38, -34, 76, 20, 4);
    c.fill();
    c.strokeStyle = '#5E4423';
    c.lineWidth = 3;
    roundRect(c, -38, -34, 76, 74, 5);
    c.stroke();
    c.fillStyle = COLOR.amber;
    c.fillRect(-8, -34, 16, 74);
    c.fillStyle = '#1A1206';
    c.font = '800 26px -apple-system, "PingFang SC", sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('?', 0, 14);

    c.restore();
  }

  // 警觉度标记：头顶 1-3 个感叹号；连扑空 2 次后变青色并加光圈（下次必中）
  function drawAlertMarks(c, x, y, size, n, pity, t) {
    var col = pity ? COLOR.mint : COLOR.amber;
    var gap = 9;
    var x0 = x - (n - 1) * gap / 2;
    var top = y - size * 0.78;

    c.save();
    if (pity) {
      c.globalAlpha = 0.5 + 0.3 * Math.sin(t * 6);
      c.strokeStyle = COLOR.mint;
      c.lineWidth = 2;
      c.beginPath();
      c.arc(x, y, size * 0.58, 0, 6.3);
      c.stroke();
      c.globalAlpha = 1;
    }
    c.fillStyle = col;
    c.strokeStyle = 'rgba(8,14,20,.85)';
    c.lineWidth = 2;
    for (var i = 0; i < n; i++) {
      var mx = x0 + i * gap;
      roundRect(c, mx - 1.9, top - 9, 3.8, 9, 1.6);
      c.stroke();
      c.fill();
      c.beginPath();
      c.arc(mx, top + 4, 2.1, 0, 6.3);
      c.stroke();
      c.fill();
    }
    c.restore();
  }

  /* ================= 生成与更新 ================= */

  function spawnCat() {
    var def = G.level;
    var size = L.catSize;
    var speed = (L.w + size * 2) / def.crossTime;
    var good = !!def.good && Math.random() < def.goodRate;
    var alert = 0;                       // 0 = 头上没有感叹号
    if (!good && def.miss) {
      var roll = Math.random();
      var acc = 0;
      for (var a = 0; a < CFG.alertWeights.length; a++) {
        acc += CFG.alertWeights[a];
        if (roll < acc) { alert = a; break; }
        alert = a;
      }
    }
    G.cats.push({
      id: G.catId++,
      sp: good ? randInt(GOODS.length) : randInt(def.colors),
      lv: 1,
      good: good,
      crate: false,
      alert: alert,          // 0-3，对应头顶感叹号个数
      miss: 0,               // 已连续扑空次数
      dodge: 0,
      hit: false,            // 乖猫是否已被误点（只扣一次）
      seen: false,
      x: -size,
      speed: speed,
      bob: rand(0, 6.28),
      bounce: 0,
      scale: 1
    });
  }

  function spawnCrate() {
    var size = L.catSize;
    G.cats.push({
      id: G.catId++,
      sp: 0, lv: 1,
      good: false,
      crate: true,
      alert: 0, miss: 0, dodge: 0, hit: false, seen: false,
      x: -size,
      speed: (L.w + size * 2) / G.level.crossTime,
      bob: rand(0, 6.28),
      bounce: 0,
      scale: 1
    });
    hintOnce('crate', '补给箱来了：点它领一个道具', 'good');
  }

  function catY(cat, t) {
    var hop = cat.dodge > 0 ? Math.sin((1 - cat.dodge / 0.3) * Math.PI) * 18 : 0;
    return L.beltLine - L.catSize * 0.14 + Math.sin(t * 2.4 + cat.bob) * 3 - hop;
  }

  // 当前能放猫的格子数：加格到期等腾位期间，加出来的那格不再接新猫
  function capNow() {
    return G.shrink ? CFG.cageSlots : G.slotCount;
  }

  function firstEmptySlot() {
    var n = capNow();
    for (var i = 0; i < n; i++) if (!G.slots[i]) return i;
    return -1;
  }

  function cageCount() {
    var n = 0;
    for (var i = 0; i < G.slots.length; i++) if (G.slots[i]) n++;
    return n;
  }

  // 一只猫入笼：占格、起飞、加分。delay 用于大网错开多只的起飞时间。
  function putInCage(cat, cy, slot, delay) {
    G.slots[slot] = { sp: cat.sp, lv: cat.lv, arriving: true, pop: 0, capture: 0 };
    var to = slotCenter(slot);
    G.flyers.push({
      sp: cat.sp, lv: cat.lv, slot: slot,
      x0: cat.x, y0: cy, x1: to.x, y1: to.y,
      t: -(delay || 0) / CFG.flyDur, dur: CFG.flyDur
    });
    G.score += CFG.scoreCatch;
    burst(cat.x, cy, 6, ['#F2B134', '#EDE6D6'], 110);
  }

  function tryCatch(px, py) {
    if (G.lock > 0) return true;

    var best = -1, bestD = 1e9;
    var r = L.catSize * 0.72;
    for (var i = 0; i < G.cats.length; i++) {
      var c0 = G.cats[i];
      var y0 = catY(c0, G.clock);
      var dx = px - c0.x, dy = py - y0;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < r && d < bestD) { bestD = d; best = i; }
    }
    if (best < 0) return false;

    var cat = G.cats[best];
    var cy = catY(cat, G.clock);

    if (cat.crate) {
      onCrateTap(best, cat, cy);
      return true;
    }

    if (cat.good) {
      onGoodHit(cat, cy);
      return true;
    }

    var slot = firstEmptySlot();
    if (slot < 0) {
      cat.bounce = 0.45;
      AudioFX.deny();
      buzz(30);
      if (!hintOnce('full', '笼子满了：点笼里一只，再点一次放走', 'warn')) {
        toast('笼满了 · 点笼里一只放走', 'warn');
      }
      return true;
    }

    // 只有头上有感叹号的猫才可能扑空；没有感叹号的一定抓得住
    if (G.level.miss && cat.alert > 0 && cat.miss < G.level.pityAfter && Math.random() < Math.min(0.75, CFG.missRates[cat.alert] * G.level.missMul)) {
      onMiss(cat, cy);
      return true;
    }

    G.cats.splice(best, 1);
    putInCage(cat, cy, slot, 0);
    AudioFX.grab();
    buzz(10);
    return true;
  }

  function onGoodHit(cat, cy) {
    cat.bounce = 0.45;
    AudioFX.deny();
    buzz(40);
    if (cat.hit) return;
    cat.hit = true;
    addScore(-G.level.penaltyGood);
    G.goodHit++;
    G.lock = CFG.lockGood;
    floatText(cat.x, Math.max(14, cy - L.catSize * 0.9), '乖猫！−' + G.level.penaltyGood, COLOR.stamp, 16);
    burst(cat.x, cy, 8, [COLOR.mint, COLOR.paper], 120);
    hintOnce('goodHit', '点到乖猫了：扣分，还要愣一下', 'warn');
  }

  function onMiss(cat, cy) {
    cat.miss++;
    cat.dodge = 0.3;
    G.missTotal++;
    AudioFX.miss();
    buzz(12);
    burst(cat.x, cy + L.catSize * 0.3, 5, [COLOR.dim, COLOR.paper], 90);
    floatText(cat.x, Math.max(14, cy - L.catSize * 0.9), '扑空！', COLOR.paper, 16);
    if (cat.miss >= G.level.pityAfter) {
      floatText(cat.x, Math.max(30, cy - L.catSize * 1.15), '下次必中', COLOR.mint, 13);
    }
    hintOnce('miss', '扑空了：猫头上的 ! 越多越警觉，越容易扑空', null);
  }

  /* ---------- 补给箱与道具获得 ---------- */

  // 在没满的道具里随机挑一种；全满返回空
  function pickDrop() {
    var open = [];
    for (var i = 0; i < ITEM_KEYS.length; i++) {
      var key = ITEM_KEYS[i];
      if (G.level.drops.indexOf(key) >= 0 && G.inv[key] < CFG.itemCap) open.push(key);
    }
    return open.length ? open[randInt(open.length)] : null;
  }

  function giveItem(key, x, y) {
    G.inv[key]++;
    floatText(x, Math.max(14, y), '获得 ' + ITEM_NAMES[key], COLOR.mint, 15);
    burst(x, y, 8, [COLOR.mint, COLOR.amber, COLOR.paper], 130);
    AudioFX.item();
    buzz(16);
    pulseTool(key);
    syncTools();
    hintOnce('item', '拿到道具了：点底部的道具按钮使用', 'good');
  }

  function onCrateTap(idx, cat, cy) {
    var key = pickDrop();
    if (!key) {
      cat.bounce = 0.45;
      AudioFX.deny();
      toast('背包满了，先用掉一个', 'warn');
      return;
    }
    G.cats.splice(idx, 1);
    giveItem(key, cat.x, cy - L.catSize * 0.9);
  }

  /* ---------- 放走与同伙 ---------- */

  function slotMovable(j) {
    var sl = G.slots[j];
    return !!sl && !sl.arriving && sl.capture <= 0;
  }

  function movableCount() {
    var n = 0;
    for (var i = 0; i < G.slots.length; i++) if (slotMovable(i)) n++;
    return n;
  }

  function cellAt(x, y) {
    if (y < L.cageTop || y > L.cageBottom) return -1;
    var rel = x - L.cageLeft;
    if (rel < -6 || rel > L.cageW + 6) return -1;
    var i = Math.floor(rel / (L.cellW + L.cellGap));
    return clamp(i, 0, G.slotCount - 1);
  }

  // 优先带走相邻的同伙；相邻没有可带的就随机一只
  function pickAccomplice(i) {
    var adj = [];
    if (i > 0 && slotMovable(i - 1)) adj.push(i - 1);
    if (i < G.slots.length - 1 && slotMovable(i + 1)) adj.push(i + 1);
    if (adj.length) return adj[randInt(adj.length)];
    var any = [];
    for (var j = 0; j < G.slots.length; j++) {
      if (j !== i && slotMovable(j)) any.push(j);
    }
    return any.length ? any[randInt(any.length)] : -1;
  }

  function launchRunner(sl, p, dir, delay) {
    G.runners.push({
      sp: sl.sp, lv: sl.lv,
      x: p.x, y: p.y, y0: p.y,
      vx: dir * rand(230, 300),
      t: -(delay || 0)
    });
    burst(p.x, p.y, 7, [skinOf(sl.lv, sl.sp).coat, COLOR.paper], 130);
  }

  function releaseSlot(i) {
    var sl = G.slots[i];
    var p = slotCenter(i);
    var dir = p.x < L.w / 2 ? -1 : 1;
    G.slots[i] = null;
    G.sel = -1;
    G.released++;
    launchRunner(sl, p, dir, 0);

    var helped = -1;
    if (Math.random() < CFG.releaseHelpRate) helped = pickAccomplice(i);

    if (helped >= 0) {
      var sl2 = G.slots[helped];
      var p2 = slotCenter(helped);
      G.slots[helped] = null;
      launchRunner(sl2, p2, dir, 0.08);
      floatText(p2.x, p2.y - L.cellH * 0.6, '同伙也跑了！', COLOR.stamp, 15);
      toast('它拉着同伙一起跑了', 'warn');
      AudioFX.escape();
      buzz(30);
    } else {
      toast('放走了一只', 'good');
      AudioFX.release();
      buzz(12);
    }
  }

  // 笼满时点笼里的猫：第一次选中，第二次放走。返回 true 表示这次点击已被笼子吃掉
  function handleCageTap(px, py) {
    if (G.state !== 'playing') return false;
    var idx = cellAt(px, py);
    if (idx < 0) {
      G.sel = -1;
      return false;
    }
    if (firstEmptySlot() >= 0) return true;
    if (!slotMovable(idx)) return true;
    if (G.sel === idx) {
      releaseSlot(idx);
    } else {
      G.sel = idx;
      AudioFX.land();
      buzz(8);
    }
    return true;
  }

  /* ---------- 劫狱与别捣蛋 ---------- */

  function onLeak() {
    if (!G.level.raid) return;
    if (G.alarm > 0) return;
    G.leak++;
    if (G.leak >= CFG.raidEvery) {
      G.leak = 0;
      if (movableCount() > 0) startAlarm();   // 笼子里没猫可劫就直接清零
    }
  }

  function startAlarm() {
    G.alarmDur = rand(CFG.raidMin, CFG.raidMax);
    G.alarm = G.alarmDur;
    G.alarmBeep = 0;
    if (!hintOnce('alarm', '劫狱警报！快按底部「别捣蛋」', 'warn')) {
      toast('劫狱警报！快按「别捣蛋」', 'warn', G.alarmDur);
    }
    AudioFX.beep();
    buzz([40, 40, 40]);
  }

  function raidSucceeds() {
    var c = [];
    for (var i = 0; i < G.slots.length; i++) if (slotMovable(i)) c.push(i);
    if (!c.length) return;
    var idx = c[randInt(c.length)];
    var sl = G.slots[idx];
    var p = slotCenter(idx);
    var dir = p.x < L.w / 2 ? -1 : 1;
    G.slots[idx] = null;
    G.raided++;
    launchRunner(sl, p, dir, 0);
    addScore(-G.level.penaltyRaid);
    floatText(p.x, p.y - L.cellH * 0.6, '劫狱！−' + G.level.penaltyRaid, COLOR.stamp, 17);
    toast('被劫走一只！', 'warn');
    G.shake = 0.3;
    AudioFX.breakout();
    buzz([30, 30, 60]);
  }

  function useStop() {
    if (G.state !== 'playing' || !G.level.raid) return;
    if (G.alarm > 0) {
      if (G.stopLeft <= 0) {
        AudioFX.deny();
        toast('别捣蛋用完了', 'warn');
        return;
      }
      G.stopLeft--;
      G.alarm = 0;
      toast('拦住了！', 'good');
      AudioFX.block();
      buzz(20);
    } else {
      // 平时误按不消耗次数
      toast('现在没有劫狱，没消耗次数', null, 0.9);
    }
  }

  /* ---------- 三个道具 ---------- */

  function useItem(key) {
    if (G.state !== 'playing' || !G.level.items || G.level.drops.indexOf(key) < 0) return;
    if (G.inv[key] <= 0) {
      toast('没有' + ITEM_NAMES[key] + '了', 'warn', 0.9);
      return;
    }
    var ok = false;
    if (key === 'catnip') ok = useCatnip();
    else if (key === 'net') ok = useNet();
    else if (key === 'slot') ok = useSlot();
    if (ok) {
      G.inv[key]--;
      syncTools();
    }
  }

  function useCatnip() {
    if (G.freeze > 0) {
      toast('猫薄荷还在起效', 'warn', 0.9);
      return false;
    }
    G.freeze = CFG.catnipTime;
    toast('猫薄荷！传送带停 ' + CFG.catnipTime + ' 秒', 'good');
    AudioFX.item();
    buzz(16);
    return true;
  }

  function useSlot() {
    if (G.slotCount > CFG.cageSlots) {
      toast('加格还在生效', 'warn', 0.9);
      return false;
    }
    G.slotCount = CFG.cageSlots + 1;
    G.extra = CFG.slotTime;
    G.shrink = false;
    G.slots.push(null);
    layoutCells();
    toast('加格！笼子多一格，' + CFG.slotTime + ' 秒', 'good');
    AudioFX.item();
    buzz(16);
    return true;
  }

  function useNet() {
    var empty = firstEmptySlot();
    if (empty < 0) {
      toast('笼子满了，大网用不上', 'warn');
      AudioFX.deny();
      return false;
    }
    var ref = slotCenter(empty);
    var count = [], near = [];
    var i, c0, d;
    for (i = 0; i < BABY.length; i++) { count.push(0); near.push(1e9); }

    for (i = 0; i < G.cats.length; i++) {
      c0 = G.cats[i];
      if (c0.good || c0.crate) continue;
      if (c0.x < 0 || c0.x > L.w) continue;       // 只算已经进画面的
      var dx = c0.x - ref.x, dy = catY(c0, G.clock) - ref.y;
      d = Math.sqrt(dx * dx + dy * dy);
      count[c0.sp]++;
      if (d < near[c0.sp]) near[c0.sp] = d;
    }

    // 数量最多的颜色；并列取离笼子近的
    var pick = -1;
    for (i = 0; i < BABY.length; i++) {
      if (count[i] <= 0) continue;
      if (pick < 0 || count[i] > count[pick] || (count[i] === count[pick] && near[i] < near[pick])) pick = i;
    }
    if (pick < 0) {
      toast('传送带上没有坏猫', 'warn');
      AudioFX.deny();
      return false;
    }

    // 该颜色的猫，越靠右（快溜走的）越先抓
    var cand = [];
    for (i = 0; i < G.cats.length; i++) {
      c0 = G.cats[i];
      if (!c0.good && !c0.crate && c0.sp === pick && c0.x >= 0 && c0.x <= L.w) cand.push(c0);
    }
    cand.sort(function (a, b) { return b.x - a.x; });

    var got = 0;
    for (i = 0; i < cand.length; i++) {
      var slot = firstEmptySlot();
      if (slot < 0) break;
      var cat = cand[i];
      var cy = catY(cat, G.clock);
      var at = G.cats.indexOf(cat);
      if (at >= 0) G.cats.splice(at, 1);
      putInCage(cat, cy, slot, got * CFG.netStagger);
      got++;
    }

    G.netFx = { t: 0, dur: 0.55 };
    toast('大网！抓到 ' + got + ' 只', 'good');
    AudioFX.net();
    buzz([14, 30, 14]);
    return true;
  }

  /* ---------- 加格到期 ---------- */

  function dropExtraCell() {
    G.slots.length = CFG.cageSlots;
    G.slotCount = CFG.cageSlots;
    G.shrink = false;
    G.extra = 0;
    if (G.sel >= CFG.cageSlots) G.sel = -1;
    layoutCells();
  }

  // 加格到期、那格还有猫：只要前 7 格里出现空位（合成、放走、被劫），就把那只猫挪过去
  function settleShrink() {
    var last = G.slotCount - 1;
    if (!G.slots[last]) { dropExtraCell(); return; }
    if (!slotMovable(last)) return;          // 还在入笼或盖章中，等一等
    var e = -1;
    for (var i = 0; i < CFG.cageSlots; i++) {
      if (!G.slots[i]) { e = i; break; }
    }
    if (e < 0) return;
    var sl = G.slots[last];
    G.slots[last] = null;
    G.slots[e] = sl;
    sl.pop = 1;
    var p = slotCenter(e);
    burst(p.x, p.y, 6, [COLOR.amber, COLOR.paper], 100);
    AudioFX.land();
    dropExtraCell();
  }

  function expireExtra() {
    var last = G.slotCount - 1;
    if (!G.slots[last]) { dropExtraCell(); return; }
    G.shrink = true;
    settleShrink();
    if (G.shrink) {
      toast('加格到期：放走一只，或合成腾位', 'warn', 2.6);
      AudioFX.deny();
      buzz(30);
    }
  }

  /* ---------- 合成：1 级看颜色，2 级不看颜色 ---------- */

  function canMerge(s) {
    return s && !s.arriving && s.capture <= 0;
  }

  function resolveOneMerge() {
    // 先找 1 级：同颜色凑 3
    for (var sp = 0; sp < BABY.length; sp++) {
      var hits = [];
      for (var i = 0; i < G.slots.length; i++) {
        var s = G.slots[i];
        if (canMerge(s) && s.lv === 1 && s.sp === sp) hits.push(i);
        if (hits.length === CFG.mergeNeed) break;
      }
      if (hits.length === CFG.mergeNeed) {
        doMerge(hits, sp, 1);
        return true;
      }
    }

    // 再找 2 级：不分颜色，任意 3 只
    var hits2 = [];
    for (var j = 0; j < G.slots.length; j++) {
      var s2 = G.slots[j];
      if (canMerge(s2) && s2.lv === 2) hits2.push(j);
      if (hits2.length === CFG.mergeNeed) break;
    }
    if (hits2.length === CFG.mergeNeed) {
      doMerge(hits2, G.slots[hits2[0]].sp, 2);
      return true;
    }

    return false;
  }

  function doMerge(idx, sp, lv) {
    var target = idx[0];
    var to = slotCenter(target);
    var tint = skinOf(lv, sp).coat;

    for (var i = 1; i < idx.length; i++) {
      var p = slotCenter(idx[i]);
      burst(p.x, p.y, 5, [tint, COLOR.paper], 90);
      G.slots[idx[i]] = null;
    }

    var newLv = lv + 1;
    G.slots[target] = {
      sp: sp, lv: newLv, arriving: false, pop: 1,
      capture: newLv === CFG.maxLevel ? CFG.captureHold : 0
    };

    G.chain++;
    var gain = CFG.scoreMerge * newLv * G.chain;
    G.score += gain;

    burst(to.x, to.y, 16, [skinOf(newLv, sp).coat, COLOR.amber, COLOR.paper], 190);
    var label = G.chain > 1 ? '连锁 ×' + G.chain + '  +' + gain : '+' + gain;
    floatText(to.x, to.y - L.cellH * 0.5, label, G.chain > 1 ? COLOR.amber : COLOR.paper, G.chain > 1 ? 17 : 15);

    if (newLv < CFG.maxLevel) {
      floatText(to.x, L.chainY + 4, CFG.levelNames[newLv] + '！', COLOR.amber, 16);
    }

    AudioFX.merge(newLv, G.chain);
    buzz(G.chain > 1 ? 24 : 14);
    G.shake = Math.min(0.3, 0.1 + G.chain * 0.04);

    // 掉道具：12% 概率；连锁达到 3 必掉。满了的种类不再掉落。
    if (G.level.items) {
      var sure = G.chain === CFG.chainDropAt;
      if (sure || Math.random() < CFG.dropRate) {
        var key = pickDrop();
        if (key) giveItem(key, to.x, to.y - L.cellH * 0.95);
      }
    }
  }

  function doCapture(i) {
    var p = slotCenter(i);
    G.slots[i] = null;
    G.captured++;
    G.score += CFG.scoreCapture;

    G.stamp = { t: 0, dur: 1.0 };
    G.shake = 0.42;
    burst(p.x, p.y, 30, [COLOR.amber, COLOR.stamp, COLOR.paper, '#FFD978'], 300);
    floatText(p.x, p.y - L.cellH * 0.6, '+' + CFG.scoreCapture, COLOR.amber, 19);
    AudioFX.capture();
    buzz([18, 40, 18]);
    syncDots();

    // 逮捕坏猫大王，别捣蛋回充 1 次，上限固定
    if (G.level.raid && G.stopLeft < CFG.stopMax) {
      G.stopLeft++;
      floatText(p.x, p.y - L.cellH * 1.15, '别捣蛋 +1', COLOR.mint, 14);
    }

    // 目标 2 只以上的关卡与无尽：每逮捕一只（最后一只除外）加时
    if (G.level.bonusTime > 0 && G.captured < G.level.target) {
      G.time += G.level.bonusTime;
      G.timeTotal = Math.max(G.timeTotal, G.time);
      floatText(p.x, Math.max(14, p.y - L.cellH * 1.7), '+' + G.level.bonusTime + ' 秒', COLOR.mint, 16);
    }
    if (G.level.endless) applyEndless();

    if (G.captured >= G.level.target) {
      G.state = 'ending';          // 冻结计时与生成，让庆祝动画放完
      G.alarm = 0;
      window.setTimeout(function () { finish(true); }, 950);
    }
  }

  function update(dt) {
    G.clock = (G.clock || 0) + dt;
    var frozen = G.freeze > 0;
    if (!frozen) G.beltOffset = (G.beltOffset + dt * (L.w / G.level.crossTime)) % 44;
    if (G.lock > 0) G.lock -= dt;

    if (!loadDone) {
      loadClock += dt;
      if (loadClock >= CFG.loadTimeout) loadDone = true;
    }
    syncLoadBtn();

    // 生成（猫薄荷期间不出新猫）
    if ((G.state === 'idle' || G.state === 'playing') && !frozen) {
      G.spawnTimer += dt;
      if (G.spawnTimer >= G.nextSpawn) {
        G.spawnTimer = 0;
        G.nextSpawn = G.level.spawnEvery + rand(-G.level.spawnJitter, G.level.spawnJitter);
        spawnCat();
      }
    }

    // 补给箱：约每 30 秒一个（猫薄荷期间不计）
    if (G.state === 'playing' && G.level.crate && !frozen) {
      G.crateTimer += dt;
      if (G.crateTimer >= G.nextCrate) {
        G.crateTimer = 0;
        G.nextCrate = CFG.crateEvery + rand(-CFG.crateJitter, CFG.crateJitter);
        spawnCrate();
      }
    }

    // 传送带上的猫
    for (var i = G.cats.length - 1; i >= 0; i--) {
      var cat = G.cats[i];
      if (!frozen) cat.x += cat.speed * dt;
      if (cat.bounce > 0) {
        cat.bounce -= dt;
        cat.scale = 1 + Math.sin(cat.bounce * 40) * 0.08;
      } else {
        cat.scale = 1;
      }
      if (cat.dodge > 0) cat.dodge -= dt;
      if (cat.good && !cat.seen && G.state === 'playing' && cat.x > L.catSize * 0.6) {
        cat.seen = true;
        hintOnce('good', '戴蝴蝶结的是乖猫，别点它', 'good');
      }
      if (cat.x > L.w + L.catSize) {
        G.cats.splice(i, 1);
        if (G.state === 'playing' && !cat.good && !cat.crate) {
          G.escaped++;
          AudioFX.escape();
          if (!G.toldEscape) {
            G.toldEscape = true;
            toast('跑掉一只', 'warn');
          }
          onLeak();
        }
      }
    }

    // 飞向笼子的猫（t 为负时还没起飞）
    for (var f = G.flyers.length - 1; f >= 0; f--) {
      var fl = G.flyers[f];
      fl.t += dt / fl.dur;
      if (fl.t >= 1) {
        G.flyers.splice(f, 1);
        var s = G.slots[fl.slot];
        if (s && s.arriving) {
          s.arriving = false;
          s.pop = 1;
          G.checkPending = true;
          AudioFX.land();
          var p = slotCenter(fl.slot);
          burst(p.x, p.y + L.cellH * 0.3, 5, [COLOR.steelHi], 80);
        }
      }
    }

    // 合成判定
    if (G.mergeTimer > 0) G.mergeTimer -= dt;
    if (G.checkPending && G.mergeTimer <= 0) {
      if (resolveOneMerge()) {
        G.mergeTimer = CFG.mergeCooldown;
      } else {
        G.checkPending = false;
        G.chain = 0;
      }
    }

    // 笼中状态
    for (var k = 0; k < G.slots.length; k++) {
      var sl = G.slots[k];
      if (!sl) continue;
      if (sl.pop > 0) sl.pop = Math.max(0, sl.pop - dt * 3.4);
      if (sl.capture > 0) {
        sl.capture -= dt;
        if (sl.capture <= 0) doCapture(k);
      }
    }

    // v0.4：猫薄荷、加格、警报倒计时（只在 playing 时走）
    if (G.state === 'playing') {
      if (G.freeze > 0) G.freeze = Math.max(0, G.freeze - dt);

      if (G.slotCount > CFG.cageSlots) {
        if (G.shrink) {
          settleShrink();
        } else {
          G.extra -= dt;
          if (G.extra <= 0) expireExtra();
        }
      }

      if (G.alarm > 0) {
        G.alarm -= dt;
        G.alarmBeep -= dt;
        if (G.alarmBeep <= 0) { G.alarmBeep = 0.3; AudioFX.beep(); }
        if (G.alarm <= 0) {
          G.alarm = 0;
          raidSucceeds();
        }
      }
    }

    // 被放走（或被劫走）的猫
    for (var rn = G.runners.length - 1; rn >= 0; rn--) {
      var rnr = G.runners[rn];
      rnr.t += dt;
      if (rnr.t > 0) rnr.x += rnr.vx * dt * (1 + rnr.t * 1.2);
      rnr.y = rnr.y0 - Math.abs(Math.sin(Math.max(0, rnr.t) * 9)) * 26;
      if (rnr.x < -L.cageCat * 1.5 || rnr.x > L.w + L.cageCat * 1.5) G.runners.splice(rn, 1);
    }

    // 选中的格子失效（笼子不再满、或那只猫已不可动）
    if (G.sel >= 0 && (firstEmptySlot() >= 0 || !slotMovable(G.sel))) G.sel = -1;

    // 粒子
    for (var q = G.parts.length - 1; q >= 0; q--) {
      var pt = G.parts[q];
      pt.life -= dt;
      if (pt.life <= 0) { G.parts.splice(q, 1); continue; }
      pt.vy += 620 * dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.rot += pt.spin * dt;
    }

    // 浮字
    for (var z = G.floats.length - 1; z >= 0; z--) {
      var ft = G.floats[z];
      ft.life -= dt;
      ft.y -= dt * 42;
      if (ft.life <= 0) G.floats.splice(z, 1);
    }

    if (G.shake > 0) G.shake = Math.max(0, G.shake - dt * 1.6);
    if (G.stamp) {
      G.stamp.t += dt;
      if (G.stamp.t >= G.stamp.dur) G.stamp = null;
    }
    if (G.netFx) {
      G.netFx.t += dt;
      if (G.netFx.t >= G.netFx.dur) G.netFx = null;
    }

    // 计时
    if (G.state === 'playing') {
      G.time -= dt;
      if (G.time <= 0) {
        G.time = 0;
        finish(false);
      }
      syncHud();
    }

    tickToast(dt);
  }

  /* ================= 渲染 ================= */

  function render() {
    var w = L.w, h = L.h;
    ctx.clearRect(0, 0, w, h);

    drawBackground();

    ctx.save();
    if (G.shake > 0 && !reduceMotion) {
      var m = G.shake * 11;
      ctx.translate(rand(-m, m), rand(-m, m));
    }

    drawBeltLamp();
    drawBelt();

    // 传送带上的猫
    for (var i = 0; i < G.cats.length; i++) {
      var cat = G.cats[i];
      var cyy = catY(cat, G.clock);
      var csz = L.catSize * cat.scale;
      if (cat.crate) {
        drawCrate(ctx, cat.x, cyy, csz, G.clock * 1.6 + cat.bob);
      } else if (cat.good) {
        drawGood(ctx, cat.x, cyy, csz, cat.sp, G.clock * 1.6 + cat.bob);
      } else {
        drawCat(ctx, cat.x, cyy, csz, cat.sp, cat.lv, G.clock * 1.6 + cat.bob);
        if (G.level.miss && cat.alert > 0) {
          drawAlertMarks(ctx, cat.x, cyy, L.catSize, cat.alert, cat.miss >= G.level.pityAfter, G.clock);
        }
      }
    }

    drawNetFx();
    drawChainGuide();
    drawCage();

    // 飞行中的猫（目标位置每帧重算，加格变化时也不会飞偏）
    for (var f = 0; f < G.flyers.length; f++) {
      var fl = G.flyers[f];
      if (fl.t < 0) continue;
      var to = slotCenter(fl.slot);
      var t = easeOut(clamp(fl.t, 0, 1));
      var x = fl.x0 + (to.x - fl.x0) * t;
      var y = fl.y0 + (to.y - fl.y0) * t - Math.sin(t * Math.PI) * 54;
      var sz = L.catSize + (L.cageCat - L.catSize) * t;
      drawCat(ctx, x, y, sz, fl.sp, fl.lv, 0);
    }

    for (var rn = 0; rn < G.runners.length; rn++) {
      var rr2 = G.runners[rn];
      drawCat(ctx, rr2.x, rr2.y + L.cageCat * 0.06, L.cageCat, rr2.sp, rr2.lv, rr2.t * 14);
    }

    drawParticles();
    drawFloats();
    drawStamp();

    ctx.restore();
  }

  // 背景图按"铺满裁切"放置，没图就留空，露出 CSS 的夜色渐变
  function drawBackground() {
    var rec = picOf(ART.bg);
    if (!rec) return;
    var iw = rec.img.width, ih = rec.img.height;
    var k = Math.max(L.w / iw, L.h / ih);
    var w = iw * k, h = ih * k;
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.drawImage(rec.img, (L.w - w) / 2, (L.h - h) / 2, w, h);
    ctx.restore();
    // 压一层暗色，保证猫和文字看得清
    ctx.fillStyle = 'rgba(8,14,21,.42)';
    ctx.fillRect(0, 0, L.w, L.h);
  }

  function drawBeltLamp() {
    var g = ctx.createRadialGradient(L.w / 2, L.beltTop - 30, 10, L.w / 2, L.beltTop - 30, L.w * 0.78);
    g.addColorStop(0, 'rgba(242,177,52,.17)');
    g.addColorStop(0.55, 'rgba(242,177,52,.05)');
    g.addColorStop(1, 'rgba(242,177,52,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, L.w, L.beltBottom + 40);
  }

  function drawBelt() {
    var top = L.beltTop, hgt = L.beltH, w = L.w;

    var g = ctx.createLinearGradient(0, top, 0, top + hgt);
    g.addColorStop(0, '#36495E');
    g.addColorStop(0.42, COLOR.steel);
    g.addColorStop(1, '#1D2B39');
    ctx.fillStyle = g;
    ctx.fillRect(0, top, w, hgt);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, top, w, hgt);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,.045)';
    ctx.lineWidth = 12;
    for (var x = -hgt - 44 + G.beltOffset; x < w + hgt; x += 44) {
      ctx.beginPath();
      ctx.moveTo(x, top + hgt);
      ctx.lineTo(x + hgt, top);
      ctx.stroke();
    }
    ctx.restore();

    ctx.fillStyle = 'rgba(242,177,52,.55)';
    ctx.fillRect(0, top, w, 2);
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.fillRect(0, top + hgt - 3, w, 3);

    ctx.fillStyle = '#445C76';
    var rr = 6;
    var roll = (G.beltOffset * 0.6) % 26;
    for (var rx = -26 + roll; rx < w + 26; rx += 26) {
      ctx.beginPath();
      ctx.arc(rx, top + hgt + rr - 2, rr, 0, 6.3);
      ctx.fill();
    }

    var gw = Math.min(26, L.w * 0.07);
    var lg = ctx.createLinearGradient(0, 0, gw, 0);
    lg.addColorStop(0, 'rgba(6,11,17,.95)');
    lg.addColorStop(1, 'rgba(6,11,17,0)');
    ctx.fillStyle = lg;
    ctx.fillRect(0, top, gw, hgt);
    var rg = ctx.createLinearGradient(w, 0, w - gw, 0);
    rg.addColorStop(0, 'rgba(6,11,17,.95)');
    rg.addColorStop(1, 'rgba(6,11,17,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(w - gw, top, gw, hgt);

    // 猫薄荷生效：传送带罩一层青色，并标出倒计时
    if (G.freeze > 0) {
      ctx.fillStyle = 'rgba(95,179,161,.14)';
      ctx.fillRect(0, top, w, hgt);
      ctx.fillStyle = COLOR.mint;
      ctx.font = '700 11px -apple-system, "PingFang SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('猫薄荷 · 传送带暂停 ' + Math.ceil(G.freeze) + ' 秒', w / 2, top + hgt - 9);
    }
  }

  // 大网挥过传送带的小动画：一层网格从上往下罩下来再淡出
  function drawNetFx() {
    if (!G.netFx) return;
    var t = clamp(G.netFx.t / G.netFx.dur, 0, 1);
    var cover = L.beltH * easeOut(Math.min(1, t * 2));
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, L.beltTop, L.w, cover);
    ctx.clip();
    ctx.globalAlpha = (1 - t) * 0.75;
    ctx.strokeStyle = COLOR.paper;
    ctx.lineWidth = 1.4;
    var step = 20;
    for (var x = -L.beltH; x < L.w + L.beltH; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, L.beltTop); ctx.lineTo(x + L.beltH, L.beltBottom);
      ctx.moveTo(x + L.beltH, L.beltTop); ctx.lineTo(x, L.beltBottom);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 中部常驻的合成链示意：坏小奶猫 → 暴走猫 → 坏猫大王
  function drawChainGuide() {
    var y = L.chainY;
    var mini = Math.min(34, L.w * 0.085);
    var step = mini * 1.95;
    var cx = L.w / 2;

    ctx.save();
    ctx.globalAlpha = 0.5;

    var xs = [cx - step, cx, cx + step];
    for (var i = 0; i < 3; i++) {
      drawCat(ctx, xs[i], y, mini, 1, i + 1, 0, 1);
    }

    ctx.globalAlpha = 0.6;
    ctx.fillStyle = COLOR.dim;
    ctx.font = '600 11px -apple-system, "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('凑 3', (xs[0] + xs[1]) / 2, y + 2);
    ctx.fillText('凑 3', (xs[1] + xs[2]) / 2, y + 2);

    ctx.globalAlpha = 0.45;
    ctx.font = '600 10px -apple-system, "PingFang SC", sans-serif';
    for (var k = 0; k < 3; k++) {
      ctx.fillStyle = k === 2 ? COLOR.amber : COLOR.dim;
      ctx.fillText(CFG.levelNames[k + 1], xs[k], y + mini * 0.82);
    }

    ctx.globalAlpha = 0.5;
    ctx.fillStyle = COLOR.dim;
    ctx.font = '600 10px -apple-system, "PingFang SC", sans-serif';
    ctx.fillText('坏小奶猫要同颜色凑 3 只', cx, y + mini * 1.38);
    ctx.fillText('暴走猫不分颜色，凑 3 只就行', cx, y + mini * 1.38 + 14);
    ctx.restore();
  }

  function drawCage() {
    var cap = G.slotCount;
    var hasExtra = cap > CFG.cageSlots;
    var pulse = Math.sin(G.clock * 5) * 0.5 + 0.5;
    var alarmPulse = Math.sin(G.clock * 14) * 0.5 + 0.5;
    var alarming = G.alarm > 0 && G.state === 'playing';

    // 警报：笼子红灯闪烁
    if (alarming) {
      ctx.save();
      ctx.globalAlpha = 0.12 + 0.22 * alarmPulse;
      ctx.fillStyle = COLOR.stamp;
      roundRect(ctx, L.cageLeft - 4, L.cageTop + 14, L.cageW + 8, L.cageH - 8, 5);
      ctx.fill();
      ctx.globalAlpha = 0.5 + 0.5 * alarmPulse;
      ctx.strokeStyle = COLOR.stamp;
      ctx.lineWidth = 2.5;
      roundRect(ctx, L.cageLeft - 4, L.cageTop + 14, L.cageW + 8, L.cageH - 8, 5);
      ctx.stroke();
      ctx.globalAlpha = 0.5 + 0.5 * (1 - alarmPulse);
      ctx.fillStyle = COLOR.stamp;
      ctx.beginPath(); ctx.arc(L.cageLeft + 6, L.cageTop + 7, 5, 0, 6.3); ctx.fill();
      ctx.beginPath(); ctx.arc(L.cageLeft + L.cageW - 6, L.cageTop + 7, 5, 0, 6.3); ctx.fill();
      ctx.restore();
    }

    // 标题行
    ctx.font = '600 11px -apple-system, "PingFang SC", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = COLOR.dim;
    ctx.fillText('押解笼', L.cageLeft + 1, L.cageTop + 11);
    if (hasExtra) {
      var tw = ctx.measureText('押解笼 ').width;
      ctx.fillStyle = G.shrink ? COLOR.stamp : COLOR.amber;
      ctx.fillText(G.shrink ? '加格到期' : '+1格 ' + Math.ceil(G.extra) + '秒', L.cageLeft + 1 + tw + 4, L.cageTop + 11);
    }
    ctx.textAlign = 'right';
    var n = cageCount();
    ctx.fillStyle = n >= cap ? COLOR.stamp : COLOR.dim;
    ctx.fillText(n + ' / ' + cap, L.cageLeft + L.cageW - 1, L.cageTop + 11);

    var full = G.state === 'playing' && firstEmptySlot() < 0;
    ctx.textAlign = 'center';
    if (alarming) {
      ctx.globalAlpha = 0.6 + 0.4 * alarmPulse;
      ctx.fillStyle = COLOR.stamp;
      ctx.font = '800 12px -apple-system, "PingFang SC", sans-serif';
      ctx.fillText('警报！快按别捣蛋', L.cageLeft + L.cageW / 2, L.cageTop + 11);
      ctx.globalAlpha = 1;
      ctx.font = '600 11px -apple-system, "PingFang SC", sans-serif';
    } else if (full) {
      if (G.sel >= 0) {
        ctx.fillStyle = COLOR.mint;
        ctx.fillText('再点一次放走 · 可能连带', L.cageLeft + L.cageW / 2, L.cageTop + 11);
      } else {
        ctx.globalAlpha = 0.6 + 0.4 * pulse;
        ctx.fillStyle = COLOR.amber;
        ctx.fillText('满了 · 点笼里一只放走', L.cageLeft + L.cageW / 2, L.cageTop + 11);
        ctx.globalAlpha = 1;
      }
    }

    for (var i = 0; i < cap; i++) {
      var x = L.cageLeft + i * (L.cellW + L.cellGap);
      var y = L.cellTop;
      var s = G.slots[i];
      var isExtra = hasExtra && i === cap - 1;

      ctx.fillStyle = s ? 'rgba(29,46,61,.92)' : 'rgba(20,31,42,.88)';
      roundRect(ctx, x, y, L.cellW, L.cellH, 3);
      ctx.fill();
      ctx.strokeStyle = s ? '#3A5068' : '#223243';
      ctx.lineWidth = 1;
      roundRect(ctx, x + 0.5, y + 0.5, L.cellW - 1, L.cellH - 1, 3);
      ctx.stroke();

      // 加格出来的那一格：琥珀描边；到期等腾位时红色闪烁
      if (isExtra) {
        ctx.save();
        if (G.shrink) {
          ctx.globalAlpha = 0.4 + 0.6 * pulse;
          ctx.strokeStyle = COLOR.stamp;
        } else {
          ctx.globalAlpha = G.extra < 4 ? 0.4 + 0.6 * pulse : 0.9;
          ctx.strokeStyle = COLOR.amber;
        }
        ctx.lineWidth = 2;
        roundRect(ctx, x + 1, y + 1, L.cellW - 2, L.cellH - 2, 3);
        ctx.stroke();
        ctx.restore();
      }

      if (s && !s.arriving) {
        var p = slotCenter(i);
        var pop = s.pop > 0 ? 1 + Math.sin(s.pop * Math.PI) * 0.28 : 1;
        var flash = s.capture > 0 ? (Math.sin(s.capture * 36) * 0.5 + 0.5) : 0;
        drawCat(ctx, p.x, p.y + L.cageCat * 0.06, L.cageCat * pop, s.sp, s.lv, 0);
        if (flash > 0) {
          ctx.save();
          ctx.globalAlpha = flash * 0.5;
          ctx.fillStyle = COLOR.amber;
          roundRect(ctx, x, y, L.cellW, L.cellH, 3);
          ctx.fill();
          ctx.restore();
        }
      }

      // 栅栏前景
      if (s) {
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = '#56708C';
        ctx.lineWidth = 2;
        var bars = 3;
        for (var b = 1; b <= bars; b++) {
          var bx = x + (L.cellW / (bars + 1)) * b;
          ctx.beginPath();
          ctx.moveTo(bx, y + 3);
          ctx.lineTo(bx, y + L.cellH - 3);
          ctx.stroke();
        }
        ctx.restore();
      }

      // 笼满：可放走的格子描边提示；选中的格子青色高亮
      if (full && slotMovable(i)) {
        ctx.save();
        if (G.sel === i) {
          ctx.globalAlpha = 0.22;
          ctx.fillStyle = COLOR.mint;
          roundRect(ctx, x, y, L.cellW, L.cellH, 3);
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.strokeStyle = COLOR.mint;
          ctx.lineWidth = 2.5;
        } else {
          ctx.globalAlpha = 0.25 + 0.4 * pulse;
          ctx.strokeStyle = COLOR.amber;
          ctx.lineWidth = 1.5;
        }
        roundRect(ctx, x + 1, y + 1, L.cellW - 2, L.cellH - 2, 3);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  function drawParticles() {
    for (var i = 0; i < G.parts.length; i++) {
      var p = G.parts[i];
      var a = clamp(p.life / p.max, 0, 1);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = p.c;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      if (p.star) {
        ctx.beginPath();
        for (var k = 0; k < 8; k++) {
          var ang = (Math.PI / 4) * k;
          var rad = k % 2 === 0 ? p.r * 2 : p.r * 0.8;
          var px = Math.cos(ang) * rad, py = Math.sin(ang) * rad;
          if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillRect(-p.r, -p.r, p.r * 2, p.r * 2);
      }
      ctx.restore();
    }
  }

  function drawFloats() {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (var i = 0; i < G.floats.length; i++) {
      var f = G.floats[i];
      ctx.save();
      ctx.globalAlpha = clamp(f.life / 0.9, 0, 1);
      ctx.font = '800 ' + f.s + 'px -apple-system, "PingFang SC", sans-serif';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(8,14,20,.85)';
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.c;
      ctx.fillText(f.text, f.x, f.y);
      ctx.restore();
    }
  }

  function drawStamp() {
    if (!G.stamp) return;
    var t = G.stamp.t / G.stamp.dur;
    var scale, alpha;
    if (t < 0.22) {
      var k = t / 0.22;
      scale = 2.6 - 1.6 * easeOut(k);
      alpha = k;
    } else {
      scale = 1 + Math.sin((t - 0.22) * 10) * 0.02;
      alpha = clamp((1 - t) / 0.4, 0, 1);
    }

    var cx = L.w / 2, cy = L.chainY;
    ctx.save();
    ctx.globalAlpha = alpha * 0.95;
    ctx.translate(cx, cy);
    ctx.rotate(-0.17);
    ctx.scale(scale, scale);

    var bw = Math.min(200, L.w * 0.6), bh = 62;
    ctx.strokeStyle = COLOR.stamp;
    ctx.lineWidth = 5;
    roundRect(ctx, -bw / 2, -bh / 2, bw, bh, 5);
    ctx.stroke();
    ctx.lineWidth = 1.5;
    roundRect(ctx, -bw / 2 + 7, -bh / 2 + 7, bw - 14, bh - 14, 3);
    ctx.stroke();

    ctx.fillStyle = COLOR.stamp;
    ctx.font = '800 30px -apple-system, "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('已逮捕', 4, 1);
    ctx.restore();
  }

  /* ================= 结算 ================= */

  function finish(win) {
    if (G.state !== 'playing' && G.state !== 'ending') return;
    G.state = 'over';
    G.alarm = 0;

    var def = G.level;
    var endless = !!def.endless;
    var timeBonus = win ? Math.floor(G.time) * CFG.scoreTimeBonus : 0;
    var total = G.score + timeBonus;

    var best = loadBest();
    if (total > best) { best = total; saveBest(best); }

    // 累计警务分：赢了加本局总分，输了扣 100；无尽只加不扣
    var career = loadCareer();
    var gain = endless ? total : (win ? total : -CFG.losePenalty);
    var nextCareer = Math.max(0, career + gain);
    saveCareer(nextCareer);
    var diff = nextCareer - career;
    var diffText = diff >= 0 ? '+' + diff : '−' + (-diff);

    // 警衔看历史最高累计分，输了扣分也不掉衔
    var rankBefore = rankIndex(P.peak);
    if (nextCareer > P.peak) P.peak = nextCareer;
    var rankAfter = rankIndex(P.peak);

    var record = false;
    if (endless) {
      if (G.captured > P.endless.caps || (G.captured === P.endless.caps && total > P.endless.score)) {
        P.endless.caps = G.captured;
        P.endless.score = total;
        record = true;
      }
    } else if (win) {
      if (def.no > P.cleared) P.cleared = def.no;
      if (!(P.best[def.no] >= total)) { P.best[def.no] = total; record = true; }
    }
    saveProgress();

    var note;
    if (endless) {
      elVerdict.textContent = '收队';
      elVerdict.className = 'verdict';
      elEndTitle.textContent = '值班结束';
      note = '这一班一共逮捕 ' + G.captured + ' 只坏猫大王。';
    } else {
      elVerdict.textContent = win ? '已结案' : '未结案';
      elVerdict.className = win ? 'verdict' : 'verdict miss';
      elEndTitle.textContent = win ? '全部落网' : '时间到了';
      note = win ? '坏猫大王已收押，剩下的同伙还在外面。' : '坏猫大王还逍遥法外，再蹲守一轮。';
    }
    if (record) note += ' 新纪录！';
    if (rankAfter > rankBefore) note += ' 升衔：「' + CFG.ranks[rankAfter].name + '」。';

    // 通关后：能进下一关就给「下一关」按钮，否则说明差什么
    endNext = -1;
    elBtnNext.hidden = true;
    if (!endless && win) {
      var nn = def.no < 10 ? def.no + 1 : 0;
      var cp = canPlay(nn);
      if (cp.ok) {
        endNext = nn;
        elBtnNext.hidden = false;
        elBtnNext.textContent = nn === 0 ? '无尽值班' : '下一关';
      } else {
        note += ' ' + (nn === 0 ? '无尽值班' : '第 ' + nn + ' 关') + '：' + cp.reason + '。';
      }
    }
    elEndNote.textContent = note;
    elBtnAgain.textContent = endless ? '再来一班' : '再抓一次';

    while (elTally.firstChild) elTally.removeChild(elTally.firstChild);
    addTally('抓捕得分', String(G.score));
    addTally('逮捕坏猫大王', isFinite(def.target) ? G.captured + ' / ' + def.target : String(G.captured));
    addTally('漏网坏猫', String(G.escaped));
    if (def.raid) addTally('被劫走', G.raided + ' 只');
    if (def.good) addTally('误点乖猫', G.goodHit + ' 只');
    if (win) addTally('剩余时间奖励', '+' + timeBonus);
    addTally('总分', String(total), true);
    addTally('累计警务分', nextCareer + '（' + diffText + '）');
    addTally('警衔', CFG.ranks[rankAfter].name);
    if (endless) addTally('无尽最高逮捕', P.endless.caps + ' 只');

    elBestEnd.textContent = String(best);
    elBestStart.textContent = String(best);
    elCareerStart.textContent = String(nextCareer);
    refreshRankUI();

    if (win || endless) AudioFX.win(); else AudioFX.lose();
    buzz(win ? [20, 60, 20, 60] : 120);

    window.setTimeout(function () { showScreen(elScreenEnd); }, 260);
  }

  function addTally(label, value, isSum) {
    var row = document.createElement('div');
    if (isSum) row.className = 'sum';
    var dt = document.createElement('dt');
    dt.textContent = label;
    var dd = document.createElement('dd');
    dd.textContent = value;
    row.appendChild(dt);
    row.appendChild(dd);
    elTally.appendChild(row);
  }

  /* ================= 输入 ================= */

  function canvasPoint(ev) {
    var rect = canvas.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  function onPointerDown(ev) {
    AudioFX.init();
    AudioFX.resume();
    if (G.state !== 'playing') return;
    ev.preventDefault();
    var p = canvasPoint(ev);
    if (handleCageTap(p.x, p.y)) return;
    tryCatch(p.x, p.y);
  }

  if (window.PointerEvent) {
    canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
  } else {
    canvas.addEventListener('touchstart', function (ev) {
      var t = ev.changedTouches[0];
      onPointerDown({ clientX: t.clientX, clientY: t.clientY, preventDefault: function () { ev.preventDefault(); } });
    }, { passive: false });
    canvas.addEventListener('mousedown', onPointerDown, false);
  }

  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); }, false);

  // 道具栏按钮
  function bindTool(key) {
    TOOL[key].btn.addEventListener('click', function () {
      AudioFX.init();
      AudioFX.resume();
      useItem(key);
    }, false);
  }
  for (var bi = 0; bi < ITEM_KEYS.length; bi++) bindTool(ITEM_KEYS[bi]);

  TOOL.stop.btn.addEventListener('click', function () {
    AudioFX.init();
    AudioFX.resume();
    useStop();
  }, false);

  var iconsDone = false;

  function syncLoadBtn() {
    if (loadDone) {
      if (elBtnStart.disabled) {
        elBtnStart.disabled = false;
        elBtnStart.textContent = '开始抓捕';
      }
      if (!iconsDone) {
        iconsDone = true;
        drawIcons();     // 图片加载完（或超时）后，用正式图重画道具图标
      }
    }
  }

  elBtnStart.addEventListener('click', function () {
    AudioFX.init();
    AudioFX.resume();
    if (elBtnStart.disabled) return;
    if (!hints.help) { openHelp('first'); return; }
    openLevels();
  }, false);

  elBtnAgain.addEventListener('click', function () {
    AudioFX.resume();
    beginRound(curNo);
  }, false);

  var curNo = 1;       // 当前关卡号，0 表示无尽
  var endNext = -1;    // 结算页「下一关」要进的关卡号

  function showScreen(el) {
    elScreenStart.hidden = el !== elScreenStart;
    elScreenEnd.hidden = el !== elScreenEnd;
    elScreenHelp.hidden = el !== elScreenHelp;
    elScreenLevels.hidden = el !== elScreenLevels;
    elOverlay.className = 'overlay';
  }

  function beginRound(no) {
    curNo = no;
    elOverlay.className = 'overlay away';
    window.setTimeout(function () {
      elScreenStart.hidden = true;
      elScreenEnd.hidden = true;
      elScreenHelp.hidden = true;
      elScreenLevels.hidden = true;
    }, 320);
    startLevel(levelDefFor(no));
  }

  /* ---------- 选关界面 ---------- */

  function bindLevel(btn, no) {
    btn.addEventListener('click', function () {
      AudioFX.init();
      AudioFX.resume();
      if (canPlay(no).ok) beginRound(no);
    }, false);
  }

  function buildLevelList() {
    while (elLevelList.firstChild) elLevelList.removeChild(elLevelList.firstChild);
    var order = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 0];
    for (var i = 0; i < order.length; i++) {
      var no = order[i];
      var def = no === 0 ? ENDLESS : LEVELS[no - 1];
      var cp = canPlay(no);
      var done = no === 0 ? P.endless.caps > 0 : P.cleared >= no;

      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'lv' + (done ? ' done' : '') + (cp.ok ? '' : ' lock');
      b.disabled = !cp.ok;

      var num = document.createElement('span');
      num.className = 'lv-no';
      num.textContent = no === 0 ? '∞' : String(no);

      var main = document.createElement('span');
      main.className = 'lv-main';
      var title = document.createElement('b');
      title.className = 'lv-title';
      title.textContent = def.title;
      var sub = document.createElement('em');
      sub.className = 'lv-sub';
      sub.textContent = no === 0
        ? '60 秒起步，每逮捕一只 +10 秒，越抓越难'
        : '坏猫大王 ×' + def.target + ' · ' + fmtTime(def.duration) + (def.bonusTime ? ' · 每只 +' + def.bonusTime + ' 秒' : '');
      var note = document.createElement('em');
      note.className = 'lv-note';
      if (!cp.ok) note.textContent = '未解锁：' + cp.reason;
      else if (no === 0) note.textContent = P.endless.caps > 0 ? '最高逮捕 ' + P.endless.caps + ' 只 · ' + P.endless.score + ' 分' : '尚未挑战';
      else note.textContent = done ? '已通关 · 最高 ' + (P.best[no] || 0) + ' 分' : '可出勤';

      main.appendChild(title);
      main.appendChild(sub);
      main.appendChild(note);
      b.appendChild(num);
      b.appendChild(main);
      bindLevel(b, no);
      elLevelList.appendChild(b);
    }
  }

  function openLevels() {
    buildLevelList();
    refreshRankUI();
    showScreen(elScreenLevels);
    elLevelList.scrollTop = 0;
  }

  /* ---------- 玩法说明（首次出勤必读，之后随时可开） ---------- */

  var helpFrom = 'start';

  function openHelp(from) {
    if (from === 'play') {
      if (G.state !== 'playing') return;
      G.state = 'paused';
      elToast.className = 'toast';
    }
    helpFrom = from;
    elScreenStart.hidden = true;
    elScreenEnd.hidden = true;
    elScreenHelp.hidden = false;
    elHelpBody.scrollTop = 0;
    elBtnHelpDone.textContent = from === 'first' ? '明白了，出勤' : (from === 'play' ? '继续抓捕' : '返回');
    elOverlay.className = 'overlay';
  }

  function closeHelp() {
    if (!hints.help) { hints.help = 1; saveHints(); }
    elScreenHelp.hidden = true;
    if (helpFrom === 'first') { openLevels(); return; }
    if (helpFrom === 'play') {
      G.state = 'playing';
      elOverlay.className = 'overlay away';
      return;
    }
    if (helpFrom === 'end') elScreenEnd.hidden = false;
    else elScreenStart.hidden = false;
  }

  elBtnHelp.addEventListener('click', function () { AudioFX.init(); AudioFX.resume(); openHelp('play'); }, false);
  elBtnRules.addEventListener('click', function () { openHelp('start'); }, false);
  elBtnRules2.addEventListener('click', function () { openHelp('end'); }, false);
  elBtnHelpDone.addEventListener('click', function () { AudioFX.resume(); closeHelp(); }, false);

  elBtnLevelsBack.addEventListener('click', function () { showScreen(elScreenStart); }, false);
  elBtnToLevels.addEventListener('click', function () { openLevels(); }, false);
  elBtnNext.addEventListener('click', function () {
    AudioFX.init();
    AudioFX.resume();
    if (endNext >= 0 && canPlay(endNext).ok) beginRound(endNext);
  }, false);

  window.addEventListener('resize', function () { layout(); }, false);
  window.addEventListener('orientationchange', function () {
    window.setTimeout(layout, 220);
  }, false);

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) last = 0;
  }, false);

  /* ================= 主循环 ================= */

  var last = 0;

  function frame(now) {
    if (!last) last = now;
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (G.state !== 'paused') update(dt);
    render();
    syncTools();
    window.requestAnimationFrame(frame);
  }

  /* ================= 启动 ================= */

  preload();
  if (!loadDone) {
    elBtnStart.disabled = true;
    elBtnStart.textContent = '素材加载中…';
  }

  setupIcons();
  layout();
  startIdle();
  drawIcons();
  elBestStart.textContent = String(loadBest());
  elCareerStart.textContent = String(loadCareer());
  showLevelHud(LEVELS[0]);
  refreshRankUI();
  G.time = LEVELS[0].duration;
  G.timeTotal = LEVELS[0].duration;
  syncHud();
  syncTools();
  syncLoadBtn();
  window.requestAnimationFrame(frame);

})();