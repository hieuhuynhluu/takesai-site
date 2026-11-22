/* Built from docs/marketing/mockups/premium/index.html. */
// Home page behaviour (M-86): load choreography, nav, menu, reveals, the cut console, the captions tile, pricing.
(function () {
  var root = document.documentElement, reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (id) { return document.getElementById(id); };

  // The hero's entrance starts from the inline script in index.html's head, so it doesn't wait for this file.

  // Nav: glass once the page moves.
  var nav = $('nav'), onScroll = function () { nav.classList.toggle('scrolled', scrollY > 8); };
  addEventListener('scroll', onScroll, { passive: true }); onScroll();

  // Phone menu.
  var mb = $('menu-btn');
  mb.addEventListener('click', function () { var open = root.classList.toggle('menu-open'); mb.setAttribute('aria-expanded', open); });
  $('sheet').addEventListener('click', function (e) { if (e.target.closest('a')) { root.classList.remove('menu-open'); mb.setAttribute('aria-expanded', false); } });

  // Scroll reveal.
  var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }); }, { rootMargin: '0px 0px -5% 0px' });
  document.querySelectorAll('[data-r]').forEach(function (el) { io.observe(el); });

  // The looping demos rest while off screen (home.css pauses a .viz that isn't .live).
  var live = new IntersectionObserver(function (es) { es.forEach(function (e) { e.target.classList.toggle('live', e.isIntersecting); }); });
  document.querySelectorAll('.viz').forEach(function (el) { live.observe(el); });

  // Pointer spotlight.
  document.querySelectorAll('.spot').forEach(function (el) {
    el.addEventListener('pointermove', function (e) { var r = el.getBoundingClientRect(); el.style.setProperty('--mx', (e.clientX - r.left) + 'px'); el.style.setProperty('--my', (e.clientY - r.top) + 'px'); });
  });

  // Batch grid.
  var g = $('grid20'); for (var i = 0; i < 20; i++) { var c = document.createElement('i'); c.style.setProperty('--i', i); g.appendChild(c); } // frames: home.css

  /* ---------- The cut console: a real take, before and after its real cut ----------
     Data and video come from assets/demo/ (tools/make-demo.py: the raw take, the engine's cut list, the word times).
     Before plays the raw take; After plays the cut (cut.mp4), or the raw take skipping what is still cut once a part is back. */
  (function () {
    var con = $('console'), cbody = $('cbody'), track = $('track'), ph = $('ph'), receipt = $('receipt'), modeSet = $('mode');
    var vRaw = $('vraw'), vCut = $('vcut'), cap = $('cap'), tc = $('tc'), hint = $('hint'), vsnd = $('vsnd'), pauseBtn = $('pause');
    var status = $('status'), statusT = $('status-t'), count = $('count'), countL = $('count-l'), rulers = document.querySelectorAll('.ruler span');
    var mm = function (s) { s = Math.max(0, s); return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0'); };
    var undo = '<svg class="undo" viewBox="0 0 16 16"><path d="M6 10.5 2.5 7 6 3.5"/><path d="M2.5 7h7a4 4 0 0 1 4 4v1.5"/></svg>';
    var redo = '<svg class="redo" viewBox="0 0 16 16"><circle cx="4" cy="4" r="2"/><circle cx="4" cy="12" r="2"/><path d="M14 3 5.5 10.5M10 10l4 3M5.5 5.5 8 8"/></svg>';
    var play = '<svg class="play" viewBox="0 0 16 16"><path d="M5 3.5v9l7-4.5z"/></svg>';
    var D, RAW_S, SEGS, CUTS, KEPT1, WAVE, STEP, FRAMES, FA, LINES = [], total, timers = [], raf = 0, phase = 'idle', mode = 'after', visible = false, started = false, paused = false, shown = -1, capKey = '', settleT = 0, resizeT = 0, press = null;
    var later = function (fn, ms) { timers.push(setTimeout(fn, ms)); };

    fetch('assets/demo/demo.json').then(function (r) { return r.json(); }).then(build).catch(function () {});
    // cut.mp4 (preload none) loads once the raw take is buffered, so the two don't split the bandwidth the 3x opening needs.
    var loadCut = function () { if (vCut.preload !== 'auto') vCut.preload = 'auto'; };
    var rawIn = function () { var b = vRaw.buffered; if (b.length && b.end(b.length - 1) >= vRaw.duration - 0.5) loadCut(); };
    vRaw.addEventListener('progress', rawIn); vRaw.addEventListener('suspend', rawIn); // suspend: the download finished or paused

    function build(d) {
      D = d.duration; RAW_S = d.rawS; SEGS = d.segments; CUTS = SEGS.filter(function (sg) { return sg.cut; });
      WAVE = d.wave; STEP = d.waveStep; FRAMES = d.stripFrames; FA = d.stripAspect;
      con.style.setProperty('--n', FRAMES); con.style.setProperty('--fa', d.stripAspect); // the filmstrip sprite (home.css .strip i)
      receipt.innerHTML = '<li class="head"><span>Your video</span><span>' + mm(RAW_S) + '</span></li>';
      SEGS.forEach(function (sg) {
        var len = sg.e - sg.s, el = document.createElement('div');
        el.className = 'clip'; el.style.setProperty('--g', len.toFixed(3));
        el.innerHTML = '<div class="wave"></div><div class="strip"></div>';
        track.insertBefore(el, ph); sg.el = el;
        if (!sg.cut) return;
        var li = document.createElement('li');
        li.className = 'x p';
        li.innerHTML = '<button class="row" type="button"><span class="l">− ' + sg.cut + '</span><span class="v">' + mm(sg.sec) + '</span><span class="rs" aria-hidden="true">' + undo + redo + play + '</span></button>';
        receipt.appendChild(li); sg.li = li; sg.btn = li.querySelector('.row');
        sg.btn.addEventListener('click', function () { lineTap(sg); });
        var on = function () { li.classList.add('hot'); el.classList.add('hot'); }, off = function () { li.classList.remove('hot'); el.classList.remove('hot'); };
        [li, el].forEach(function (n) { n.addEventListener('pointerenter', on); n.addEventListener('pointerleave', off); });
        li.addEventListener('focusin', on); li.addEventListener('focusout', off);
      });
      total = document.createElement('li'); total.className = 'total p'; total.innerHTML = '<span>Your cut</span><span id="tot"></span>';
      receipt.appendChild(total);
      // Caption lines: up to four words, broken at pauses, punctuation and the edges of cut parts.
      var cur = null;
      d.words.forEach(function (w) {
        var sg = segAt(w[0] + 0.01);
        if (!cur || cur.sg !== sg || w[0] - cur.e > 0.45 || cur.w.length >= 4 || /[.?!,]$/.test(cur.w[cur.w.length - 1][2])) { cur = { s: w[0], e: w[1], sg: sg, w: [] }; LINES.push(cur); }
        cur.w.push(w); cur.e = w[1];
      });
      $('m-before').textContent = mm(RAW_S);
      KEPT1 = SEGS.filter(function (sg) { return !sg.cut; })[0];
      fit(true);
      new ResizeObserver(function () { clearTimeout(resizeT); resizeT = setTimeout(fit, 150, true); }).observe(track); // a real resize
      labels();
      if (visible) begin();
    }

    // Each part's bars and frames are counted once per change, for the width the part is heading to, and never while the
    // parts animate (rebuilding them every frame of the 0.9 s made the toggle and the receipt jitter). The frames are
    // flex: 1 and stretch with the part, so a part that shrinks keeps its own until the parts have settled; the bars are one
    // fixed width, so a part gets its new count at once. `now` counts every part at once (the first draw, a resize).
    function fit(now) {
      var on = SEGS.filter(function (sg) { return !sg.el.classList.contains('gone'); }), secs = 0;
      on.forEach(function (sg) { secs += sg.e - sg.s; });
      // Every part on show has the same margin after it (the playhead is the track's last child).
      var wv = getComputedStyle(KEPT1.el.firstChild), bar = { w: parseFloat(wv.getPropertyValue('--bw')), gap: parseFloat(wv.columnGap), pad: parseFloat(wv.paddingLeft) };
      var room = track.clientWidth - on.length * parseFloat(getComputedStyle(KEPT1.el).marginRight), fw = KEPT1.el.lastChild.clientHeight * FA;
      if (room <= 0 || !fw) return;
      clearTimeout(settleT); if (!now) settleT = setTimeout(fit, 950, true); // .clip's flex-grow runs 0.9 s
      // A part too short for one bar is held at one bar's width (.clip's min-width); the rest share what is left by time.
      var least = bar.w + 2 * bar.pad, held = [], more;
      do {
        held = held.concat(more || []);
        var hr = room - held.length * least, hs = secs - held.reduce(function (n, sg) { return n + sg.e - sg.s; }, 0);
        more = on.filter(function (sg) { return held.indexOf(sg) < 0 && hr * (sg.e - sg.s) / hs < least; });
      } while (more.length);
      on.forEach(function (sg) {
        var w = held.indexOf(sg) < 0 ? hr * (sg.e - sg.s) / hs : least;
        sg.el.style.setProperty('--r', (w / 4).toFixed(1) + 'px'); // a narrow part's corners stay a quarter of it: never a pill
        wave(sg, w, bar); strip(sg, w / fw, now);
      });
    }

    // Waveform bars, each the loudest stretch of the take it covers, all one width (`bar`, from the CSS) however wide the
    // part: as many as fit its width `w`, at least one, spread edge to edge (.wave's space-between), so no part has an
    // empty band.
    function wave(sg, w, bar) {
      var len = sg.e - sg.s, bars = Math.max(1, Math.floor((w - 2 * bar.pad + bar.gap) / (bar.w + bar.gap))), out = '';
      if (bars === sg.bars) return;
      sg.bars = bars;
      for (var b = 0; b < bars; b++) {
        var k0 = Math.floor((sg.s + len * b / bars) / STEP), k1 = Math.min(WAVE.length - 1, Math.floor((sg.s + len * (b + 1) / bars) / STEP)), peak = 0;
        for (var k = k0; k <= k1; k++) peak = Math.max(peak, WAVE[k] || 0);
        out += '<i style="--a:' + Math.max(5, Math.round(peak * 100)) + '%"></i>';
      }
      sg.el.firstChild.innerHTML = out;
    }

    // Frames by time, like the waveform: one frame per frame-width of the part (`frames` of them), each the frame at its
    // tile's middle.
    function strip(sg, frames, now) {
      var n = Math.max(1, Math.round(frames)), len = sg.e - sg.s, out = '';
      if (n === sg.tiles || (!now && n < sg.tiles)) return;
      sg.tiles = n;
      for (var i = 0; i < n; i++) out += '<i style="--f:' + Math.min(FRAMES - 1, Math.round((sg.s + len * (i + 0.5) / n) * 2)) + '"></i>';
      sg.el.lastChild.innerHTML = out;
    }

    // ---- time and geometry ----
    function segAt(t) { for (var i = 0; i < SEGS.length; i++) if (t < SEGS[i].e) return SEGS[i]; return SEGS[SEGS.length - 1]; }
    function plays(sg) { return mode === 'before' || !sg.cut || sg.back; }
    function anyBack() { return CUTS.some(function (sg) { return sg.back; }); }
    function afterSecs() { return RAW_S - CUTS.reduce(function (n, sg) { return n + (sg.back ? 0 : sg.sec); }, 0); }
    function active() { return mode === 'before' || anyBack() ? vRaw : vCut; }
    function cutToRaw(t) { var acc = 0, kept = SEGS.filter(function (sg) { return !sg.cut; }); for (var i = 0; i < kept.length; i++) { var l = kept[i].e - kept[i].s; if (t < acc + l || i === kept.length - 1) return kept[i].s + Math.min(l, t - acc); acc += l; } return 0; }
    function rawToCut(t) { var acc = 0; for (var i = 0; i < SEGS.length; i++) { var sg = SEGS[i]; if (sg.cut) continue; if (t < sg.e) return acc + Math.max(0, t - sg.s); acc += sg.e - sg.s; } return acc; }
    function elapsed(t) { var acc = 0; for (var i = 0; i < SEGS.length; i++) { var sg = SEGS[i]; if (!plays(sg)) continue; if (t < sg.e) return acc + Math.max(0, t - sg.s); acc += sg.e - sg.s; } return acc; }
    function firstPlaying(from) { for (var i = 0; i < SEGS.length; i++) if (plays(SEGS[i]) && SEGS[i].e > from) return SEGS[i]; return null; }
    // The playhead runs from a part's left edge to the next part's, through the margin between them, so it glides at one
    // speed and never hops a seam (the playhead is the track's last child; .track is the parts' offset parent).
    function placePH(sg, frac) {
      var el = sg.el, nx = el.nextElementSibling, x = el.offsetLeft, end = nx !== ph ? nx.offsetLeft : x + el.offsetWidth;
      ph.style.transform = 'translateX(' + (x + Math.min(1, Math.max(0, frac)) * (end - x)) + 'px)';
    }

    // ---- labels: the switch, the counter, the ruler, the total ----
    function setCount(v, label) {
      countL.textContent = label;
      if (v === shown) return; shown = v; count.textContent = mm(v);
      count.classList.remove('tick'); void count.offsetWidth; count.classList.add('tick');
    }
    function ruler(t) { rulers.forEach(function (s, i) { s.textContent = mm(Math.round(t * i / 6)); }); }
    function labels() {
      var a = afterSecs();
      $('m-after').textContent = mm(a); $('tot').textContent = mm(a);
      if (mode === 'before') { setCount(RAW_S, 'Raw take'); ruler(RAW_S); } else { setCount(a, 'Your cut'); ruler(a); }
    }
    function setStatus(s, t) { status.dataset.s = s; statusT.textContent = t; }

    // ---- drawing, every frame while a video plays ----
    function draw(t) {
      var sg = segAt(t);
      if (plays(sg)) placePH(sg, (t - sg.s) / (sg.e - sg.s));
      if (mode === 'before') {
        tc.textContent = mm(t) + ' / ' + mm(RAW_S);
        CUTS.forEach(function (c) { var on = c === sg; c.li.classList.toggle('now', on); c.el.classList.toggle('now', on); });
        if (capKey) { cap.innerHTML = ''; capKey = ''; }
      } else {
        tc.textContent = mm(elapsed(t)) + ' / ' + mm(afterSecs());
        caption(t);
      }
    }
    function caption(t) {
      var L = null, k = -1;
      for (var i = 0; i < LINES.length; i++) { var l = LINES[i]; if (t >= l.s - 0.05 && t <= l.e + 0.35 && plays(l.sg)) { L = l; break; } }
      if (L) L.w.forEach(function (w, j) { if (t >= w[0]) k = j; });
      var key = L ? L.s + ':' + k : '';
      if (key === capKey) return; capKey = key;
      cap.innerHTML = L ? L.w.map(function (w, j) { return '<span' + (j === k ? ' class="on"' : '') + '>' + w[2] + '</span>'; }).join(' ') : '';
    }
    function tick() {
      var v = active(), t = v === vCut ? cutToRaw(vCut.currentTime) : vRaw.currentTime;
      if (mode === 'after' && v === vRaw) { // the raw take, skipping what is still cut
        var sg = segAt(t);
        if (!plays(sg) && !vRaw.seeking) { var nx = firstPlaying(sg.e) || firstPlaying(0); vRaw.currentTime = nx.s + 0.01; t = nx.s; }
      }
      if (phase === 'intro') {
        CUTS.forEach(function (c) { if (t >= c.s + 0.05) c.el.classList.add('flag'); });
        if (vRaw.ended || t >= D - 0.06) { draw(D - 0.01); introDone(); return; }
      }
      draw(t);
      raf = requestAnimationFrame(tick);
    }
    function show(v) { [vRaw, vCut].forEach(function (x) { x.classList.toggle('on', x === v); if (x !== v) x.pause(); }); }
    // Plays the active video from a time (seconds in that video), or on from where it is. A video that has ended jumps to its
    // start when play() is called before a seek lands, so after a seek it plays only once the seek is done.
    function go(fromStart, at) {
      cancelAnimationFrame(raf);
      var v = active();
      // No poster on cut.mp4 (a late poster paint would count as the page's largest paint): the raw frame stays until it has one.
      if (v.readyState < 2) v.addEventListener('loadeddata', function () { if (active() === v) show(v); }, { once: true }); else show(v);
      if (fromStart) at = v === vCut ? 0 : mode === 'before' ? 0 : firstPlaying(0).s + 0.01;
      if (at != null) v.currentTime = at;
      ph.classList.add('on');
      draw(v === vCut ? cutToRaw(v.currentTime) : v.currentTime);
      if (paused || !visible || (press && press.on)) return; // a drag on the timeline plays once it is let go
      var start = function () { v.play().catch(function () {}); raf = requestAnimationFrame(tick); };
      if (v.seeking) v.addEventListener('seeked', start, { once: true }); else start();
    }

    // ---- modes ----
    function setMode(m) {
      mode = m;
      modeSet.querySelector('[value="' + m + '"]').checked = true;
      cbody.classList.toggle('before', m === 'before');
      CUTS.forEach(function (sg) {
        sg.el.classList.add('flag');
        sg.el.classList.toggle('gone', m === 'after' && !sg.back);
        sg.el.classList.toggle('back', !!sg.back);
        if (m === 'after') { sg.li.classList.remove('now'); sg.el.classList.remove('now'); }
        sg.btn.setAttribute('aria-label', (m === 'before' ? 'Play ' : sg.back ? 'Cut ' : 'Bring back ') + sg.cut);
      });
      vRaw.playbackRate = 1; vRaw.loop = true;
      labels(); fit();
    }
    function settle() { // everything printed, the cut made, After ready
      timers.forEach(clearTimeout); timers = [];
      CUTS.forEach(function (sg) { sg.li.classList.add('in'); });
      total.classList.add('in'); hint.classList.add('in');
      phase = 'play'; setStatus('ready', 'Cut ready');
    }
    // The opening: Before at 3x with each part turning red as it plays, a still frame while the cut closes up, then After.
    function run() {
      timers.forEach(clearTimeout); timers = []; cancelAnimationFrame(raf);
      CUTS.forEach(function (sg) { sg.back = false; sg.el.classList.remove('gone', 'flag', 'back', 'now'); sg.li.classList.remove('in', 'restored', 'now'); });
      total.classList.remove('in'); hint.classList.remove('in');
      mode = 'before'; modeSet.querySelector('[value="before"]').checked = true; cbody.classList.add('before'); labels();
      CUTS.forEach(function (sg) { sg.el.classList.remove('flag'); });
      fit();
      phase = 'intro'; setStatus('scan', 'Finding cuts'); cap.innerHTML = ''; capKey = '';
      show(vRaw); vRaw.loop = false; vRaw.currentTime = 0; vRaw.playbackRate = 3; ph.classList.add('on'); rawIn(); // a fast connection may have finished the raw take already
      if (!paused) vRaw.play().catch(function () {});
      raf = requestAnimationFrame(tick);
    }
    function introDone() {
      phase = 'cut'; vRaw.pause(); vRaw.playbackRate = 1; setStatus('cut', 'Cutting'); ph.classList.remove('on'); loadCut();
      cbody.classList.remove('before');
      CUTS.forEach(function (sg) { sg.li.classList.remove('now'); sg.el.classList.remove('now'); }); // the playhead has gone: no line is playing
      var gone = 0, n = 0;
      CUTS.forEach(function (sg) {
        later(function () { sg.el.classList.add('flag', 'gone'); fit(); sg.li.classList.add('in'); gone += sg.sec; setCount(RAW_S - gone, 'Your cut'); ruler(RAW_S - gone); }, 300 + n * 260); n++;
      });
      later(function () { total.classList.add('in'); $('tot').textContent = mm(afterSecs()); }, 300 + n * 260 + 150);
      later(function () { settle(); setMode('after'); go(true); }, 300 + n * 260 + 800);
    }
    function begin() {
      if (started || !SEGS) return; started = true;
      if (reduce) { settle(); paused = true; pauseBtn.classList.add('paused'); pauseBtn.setAttribute('aria-label', 'Play'); setMode('after'); go(true); }
      else setTimeout(run, 500);
    }

    // ---- what people can do ----
    function lineTap(sg) {
      if (phase !== 'play') { settle(); }
      if (mode === 'before') { vRaw.playbackRate = 1; vRaw.loop = true; go(false, sg.s + 0.01); return; } // + 0.01 s: the frame make-demo.py keys
      sg.back = !sg.back; sg.li.classList.toggle('restored', sg.back);
      setMode('after'); setStatus('ready', sg.back ? sg.cut + ' is back' : 'Cut ready');
      if (anyBack()) { // play from just before the part, so it is heard in place
        var t0 = sg.back ? Math.max(0, sg.s - 1.5) : sg.s; if (!plays(segAt(t0))) t0 = sg.back ? sg.s : (firstPlaying(sg.e) || firstPlaying(0)).s;
        go(false, t0 + 0.01);
      } else go(true);
    }
    // ---- the timeline: a tap or a drag lands where it is made (site/README.md, "The timelines' taps") ----
    // The take's time under the pointer, over the parts on show: the inverse of placePH, so the playhead lands under it (a
    // seam belongs to the part before it). Measured as drawn, to the fraction of a pixel and with any transform on the way
    // (the console enters scaled, home.css .console-wrap, and a tap can come before it settles).
    function timeAt(x) {
      var on = SEGS.filter(function (sg) { return !sg.el.classList.contains('gone'); }), box = function (el) { return el.getBoundingClientRect(); };
      for (var i = 0; i < on.length; i++) {
        if (i < on.length - 1 && x >= box(on[i + 1].el).left) continue;
        var el = on[i].el, nx = el.nextElementSibling, a = box(el).left, z = nx !== ph ? box(nx).left : box(el).right;
        // 0.02 s short of the part's end, so a seek's + 0.01 s (the keyed frame) never carries it into the next part
        return Math.min(on[i].e - 0.02, on[i].s + Math.min(1, Math.max(0, (x - a) / (z - a))) * (on[i].e - on[i].s));
      }
    }
    // A tap in the opening stops it in Before, at 1x; a tap while the cut closes up finishes it in After (a time that was
    // cut plays from the next kept part). The time is read from the timeline as it was tapped, before the mode changes it.
    function scrub(x) {
      var t = timeAt(x);
      if (phase !== 'play') { var m = phase === 'intro' ? 'before' : 'after'; cancelAnimationFrame(raf); vRaw.pause(); settle(); setMode(m); setStatus(m === 'before' ? 'raw' : 'ready', m === 'before' ? 'Raw take' : 'Cut ready'); }
      go(false, (active() === vCut ? rawToCut(t) : t) + 0.01);
    }
    // A mouse seeks as it presses and scrubs as it drags; a finger seeks when it lifts, or scrubs once it moves sideways, and
    // a finger that moves up or down is scrolling the page (.track is touch-action: pan-y), so it never moves the video.
    function grab(x, drag) { press.on = true; if (drag) track.setPointerCapture(press.id); vRaw.pause(); vCut.pause(); scrub(x); } // a drag keeps the pointer past the track's ends
    track.addEventListener('pointerdown', function (e) {
      if (!SEGS || phase === 'idle' || e.button) return;
      press = { id: e.pointerId, x: e.clientX, y: e.clientY, on: false };
      if (e.pointerType === 'mouse') grab(e.clientX, true);
    });
    track.addEventListener('pointermove', function (e) {
      if (!press || e.pointerId !== press.id) return;
      if (!press.on) { var dx = Math.abs(e.clientX - press.x), dy = Math.abs(e.clientY - press.y); if (dy > 8 && dy >= dx) { press = null; return; } if (dx <= 8) return; }
      if (press.on) scrub(e.clientX); else grab(e.clientX, true);
    });
    track.addEventListener('pointerup', function (e) {
      if (!press || e.pointerId !== press.id) return;
      if (!press.on) grab(e.clientX);
      press = null; go(false);
    });
    track.addEventListener('pointercancel', function () { var was = press && press.on; press = null; if (was) go(false); });
    function pick(m) {
      // After in the opening makes the cut before your eyes, as the opening's end does (founder, 2026-11-22: "if i'm
      // impatient and click "after" before the whole animation plays, I don't get it"): every cut part turns red, then
      // they close up one by one and After plays.
      if (phase === 'intro' && m === 'after') { cancelAnimationFrame(raf); CUTS.forEach(function (sg) { sg.el.classList.add('flag'); }); introDone(); return; }
      if (phase !== 'play') { cancelAnimationFrame(raf); vRaw.pause(); settle(); }
      setMode(m); setStatus(m === 'before' ? 'raw' : 'ready', m === 'before' ? 'Raw take' : 'Cut ready'); go(true);
    }
    modeSet.addEventListener('change', function (e) { pick(e.target.value); });
    // During the opening Before is already chosen, so tapping it fires no change: it stops the opening and stays in Before.
    modeSet.addEventListener('click', function (e) { var inp = e.target.closest('input'); if (inp && SEGS && phase !== 'play' && inp.value === mode) pick(mode); });
    pauseBtn.addEventListener('click', function () {
      paused = !paused; pauseBtn.classList.toggle('paused', paused); pauseBtn.setAttribute('aria-label', paused ? 'Play' : 'Pause');
      if (paused) { cancelAnimationFrame(raf); vRaw.pause(); vCut.pause(); } else if (phase === 'intro') { vRaw.play().catch(function () {}); raf = requestAnimationFrame(tick); } else if (phase === 'play') go(false);
    });
    $('replay').addEventListener('click', function () { if (!SEGS) return; if (reduce) { settle(); setMode('after'); go(true); } else { paused = false; pauseBtn.classList.remove('paused'); run(); } });
    vsnd.addEventListener('click', function () { var m = !vRaw.muted; vRaw.muted = vCut.muted = m; vsnd.setAttribute('aria-pressed', !m); if (!m && paused) pauseBtn.click(); });
    vRaw.addEventListener('ended', function () { if (phase === 'intro') { cancelAnimationFrame(raf); draw(D - 0.01); introDone(); } });
    new IntersectionObserver(function (es) {
      visible = es[0].isIntersecting;
      if (visible && !started) begin();
      else if (started && phase === 'play') { if (visible && !paused) go(false); else { cancelAnimationFrame(raf); vRaw.pause(); vCut.pause(); } }
      else if (started && phase === 'intro') { if (visible && !paused) { vRaw.play().catch(function () {}); raf = requestAnimationFrame(tick); } else { cancelAnimationFrame(raf); vRaw.pause(); } }
    }, { threshold: 0.15 }).observe(con);
  })();

  /* ---------- Captions tile: real word times (ElevenLabs, the 1:42 down-jacket take 46.767 s on, a kept line) ---------- */
  var cv = $('capvid'), cw = $('capwords'), cf = $('capframe'), csnd = $('capsnd'), capRaf = 0;
  var LINES = [[0, 1.05, [["It's", 0.01], ['even', 0.17], ['waterproof,', 0.41]]], [1.05, 1.75, [['so', 1.09], ['it', 1.23], ['repels', 1.33]]], [1.75, 9, [['light', 1.81], ['rain.', 2.07]]]];
  function capDraw(t) {
    var L = LINES.filter(function (l) { return t >= l[0] && t < l[1]; })[0] || LINES[1], k = 0;
    L[2].forEach(function (w, i) { if (t >= w[1]) k = i; });
    cw.innerHTML = '<span class="line">' + L[2].map(function (w, i) { return '<span' + (i === k ? ' class="on"' : '') + '>' + w[0] + '</span>'; }).join(' ') + '</span>';
  }
  function capTick() { capDraw(cv.currentTime); capRaf = requestAnimationFrame(capTick); }
  cv.addEventListener('play', function () { cancelAnimationFrame(capRaf); capTick(); });
  cv.addEventListener('pause', function () { cancelAnimationFrame(capRaf); });
  capDraw(0.7);
  // preload none: the clip loads as it nears the screen (play() fetches it), not with the page.
  new IntersectionObserver(function (es) { if (es[0].isIntersecting && !reduce) cv.play().catch(function () {}); else cv.pause(); }, { rootMargin: '200px 0px' }).observe(cf);
  cf.addEventListener('click', function (e) { if (e.target.closest('button')) return; cv.paused ? cv.play().catch(function () {}) : cv.pause(); });
  csnd.addEventListener('click', function () { cv.muted = !cv.muted; csnd.setAttribute('aria-pressed', !cv.muted); if (!cv.muted && cv.paused) cv.play().catch(function () {}); });
  document.querySelector('.styles').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    cf.dataset.style = b.dataset.style;
    document.querySelectorAll('.styles button').forEach(function (x) { x.setAttribute('aria-checked', x === b); });
    capDraw(cv.currentTime || 0.7);
  });

  /* ---------- Pricing ---------- */
  var form = $('picker'), incl = $('incl');
  // Every plan lists the same rows, so a switch shows exactly what changes.
  var FEATS = ['Auto cut and word-by-word captions', 'Camera, editor and exports', 'Batch: up to 20 videos at once', 'Overlap audio'];
  var EDITS = { starter: '100 edits a month', pro: '300 edits a month', ultimate: 'Unlimited edits' };
  var HAS = { starter: [1, 1, 0, 0], pro: [1, 1, 1, 1], ultimate: [1, 1, 1, 1] };
  var NAMES = { starter: 'Starter', pro: 'Pro', ultimate: 'Ultimate' };
  var check = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7"/></svg>', cross = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5 5 6 6M11 5l-6 6"/></svg>';
  var tween = function (el, to) {
    var from = parseFloat(el.textContent.replace('$', '')) || to, t0 = performance.now(), d = reduce ? 1 : 600;
    (function step(now) { var p = Math.min(1, (now - t0) / d), e = 1 - Math.pow(1 - p, 4); el.textContent = '$' + (from + (to - from) * e).toFixed(2); if (p < 1) requestAnimationFrame(step); })(t0);
  };
  var lastPlan = 'pro', lastPeriod = 'monthly';
  function sync(first) {
    var plan = form.elements.plan.value, period = form.elements.period.value, yearly = period === 'yearly';
    document.querySelectorAll('.chips button').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.plan === plan); });
    if (period !== lastPeriod || first) document.querySelectorAll('.plan .pr').forEach(function (p) {
      var v = p.querySelector('.v'); first ? (v.textContent = '$' + p.dataset[yearly ? 'y' : 'm']) : tween(v, parseFloat(p.dataset[yearly ? 'y' : 'm'])); p.querySelector('small').textContent = yearly ? 'a year' : 'a month'; });
    if (plan !== lastPlan || first) {
      $('incl-name').textContent = NAMES[plan];
      var rows = [[EDITS[plan], 1]].concat(FEATS.map(function (t, i) { return [t, HAS[plan][i]]; }));
      incl.innerHTML = rows.map(function (r, i) { return '<li class="' + (first ? '' : 'in') + (r[1] ? '' : ' no') + '" style="--i:' + i + '">' + (r[1] ? check : cross) + r[0] + (r[1] ? '' : '<span class="sr"> (not included)</span>') + '</li>'; }).join('');
    }
    var price = form.querySelector('[name="plan"]:checked').closest('.plan').querySelector('.pr').dataset[yearly ? 'y' : 'm'];
    var end = new Date(Date.now() + 3 * 864e5).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    $('due-when').textContent = 'From ' + end; $('due-p').textContent = '$' + price + (yearly ? '/yr' : '/mo');
    lastPlan = plan; lastPeriod = period;
  }
  document.querySelector('.chips').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) { form.elements.plan.value = b.dataset.plan; sync(); } });
  form.addEventListener('change', function () { sync(); });
  sync(true);
})();
