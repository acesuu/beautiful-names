/* Beautiful Names Memorizer: all state lives in localStorage. */
(() => {
  "use strict";

  // ---------- data ----------
  const BOOK = window.BOOK || { chapters: [] };
  const NAMES = [];
  BOOK.chapters.forEach((ch) => {
    ch.names.forEach((n, i) => {
      NAMES.push({ ...n, id: `${ch.chapter}-${i}`, num: NAMES.length + 1, chapter: ch.chapter, ch });
    });
  });
  const BY_ID = Object.fromEntries(NAMES.map((n) => [n.id, n]));
  const TOTAL = NAMES.length;

  // ---------- dates ----------
  const dayStr = (d = new Date()) => {
    const z = (x) => String(x).padStart(2, "0");
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
  };
  const addDays = (s, n) => {
    const [y, m, d] = s.split("-").map(Number);
    return dayStr(new Date(y, m - 1, d + n));
  };
  const today = () => dayStr();
  const prettyDate = (s) => {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  };

  // ---------- state ----------
  const KEY = "asmaa-memorizer-v1";
  const defaultState = () => ({
    settings: { perDay: 2, cardFront: "arabic" },
    names: {}, // id -> {status, learnedAt, interval, due, reps, lapses}
    plans: {}, // date -> [ids]
    log: {}, // date -> {learned, reviewed}
  });
  let S;
  try {
    S = Object.assign(defaultState(), JSON.parse(localStorage.getItem(KEY) || "{}"));
    S.settings = Object.assign(defaultState().settings, S.settings);
  } catch {
    S = defaultState();
  }
  const save = () => {
    localStorage.setItem(KEY, JSON.stringify(S));
    if (window.Cloud?.user) window.Cloud.schedulePush();
  };

  // Combine progress from two devices without losing anything.
  const RANK = { new: 0, learning: 1, memorized: 2 };
  function mergeStates(a, b) {
    const out = defaultState();
    // settings: whichever was changed most recently
    out.settings = (b.settingsAt || 0) > (a.settingsAt || 0) ? { ...a.settings, ...b.settings } : { ...b.settings, ...a.settings };
    out.settingsAt = Math.max(a.settingsAt || 0, b.settingsAt || 0);
    // names: keep the more advanced record (more reviews, then higher status)
    for (const id of new Set([...Object.keys(a.names || {}), ...Object.keys(b.names || {})])) {
      const x = a.names?.[id], y = b.names?.[id];
      if (!x || !y) { out.names[id] = x || y; continue; }
      const score = (n) => (n.reps || 0) * 10 + (RANK[n.status] || 0);
      out.names[id] = score(y) > score(x) ? y : score(x) > score(y) ? x : ((y.due || "") > (x.due || "") ? y : x);
    }
    for (const d of new Set([...Object.keys(a.log || {}), ...Object.keys(b.log || {})])) {
      const x = a.log?.[d] || {}, y = b.log?.[d] || {};
      out.log[d] = { learned: Math.max(x.learned || 0, y.learned || 0), reviewed: Math.max(x.reviewed || 0, y.reviewed || 0) };
    }
    for (const key of ["plans", "extra"]) {
      out[key] = {};
      for (const d of new Set([...Object.keys(a[key] || {}), ...Object.keys(b[key] || {})])) {
        out[key][d] = [...new Set([...(a[key]?.[d] || []), ...(b[key]?.[d] || [])])];
      }
    }
    return out;
  }

  const st = (id) => S.names[id] || { status: "new" };
  const statusOf = (id) => st(id).status;
  const logToday = () => (S.log[today()] ||= { learned: 0, reviewed: 0 });
  const memorizedIds = () => NAMES.filter((n) => statusOf(n.id) === "memorized").map((n) => n.id);
  const dueIds = () =>
    NAMES.filter((n) => {
      const s = st(n.id);
      return s.status === "memorized" && s.due && s.due <= today();
    }).map((n) => n.id);

  // ---------- daily plan ----------
  function nextUnlearned(exclude, count) {
    const out = [];
    // names already started ("learning") come first, then new ones in book order
    for (const pass of ["learning", "new"]) {
      for (const n of NAMES) {
        if (out.length >= count) return out;
        if (statusOf(n.id) === pass && !exclude.has(n.id)) out.push(n.id);
      }
    }
    return out;
  }

  function ensurePlan() {
    const t = today();
    const per = S.settings.perDay;
    let plan = S.plans[t];
    if (!plan) {
      plan = nextUnlearned(new Set(), per);
    } else {
      // reconcile with goal changes: keep completed ones, top up / trim the rest
      const done = plan.filter((id) => statusOf(id) === "memorized");
      const pending = plan.filter((id) => statusOf(id) !== "memorized");
      const room = Math.max(0, per - done.length);
      let keep = pending.slice(0, room);
      if (keep.length < room) keep = keep.concat(nextUnlearned(new Set(plan), room - keep.length));
      plan = done.concat(keep);
      // keep extra names the user explicitly added
      plan = plan.concat((S.plans[t] || []).filter((id) => !plan.includes(id) && S.extra?.[t]?.includes(id)));
    }
    S.plans[t] = plan;
    save();
    return plan;
  }

  function addToToday(ids) {
    const t = today();
    const plan = ensurePlan();
    S.extra ||= {};
    S.extra[t] ||= [];
    ids.forEach((id) => {
      if (!plan.includes(id)) plan.push(id);
      if (!S.extra[t].includes(id)) S.extra[t].push(id);
    });
    S.plans[t] = plan;
    save();
  }

  // ---------- scheduling ----------
  function markMemorized(id) {
    const s = st(id);
    const wasMemorized = s.status === "memorized";
    S.names[id] = { ...s, status: "memorized", learnedAt: s.learnedAt || today(), interval: 1, due: addDays(today(), 1), reps: (s.reps || 0) + 1, lapses: s.lapses || 0 };
    if (!wasMemorized) logToday().learned++;
    save();
  }
  function markLearning(id) {
    const s = st(id);
    if (s.status === "memorized") return;
    S.names[id] = { ...s, status: "learning" };
    save();
  }
  function resetName(id) {
    delete S.names[id];
    save();
  }
  function grade(id, g) {
    const s = { ...st(id) };
    const iv = s.interval || 1;
    if (g === "again") {
      s.interval = 1;
      s.lapses = (s.lapses || 0) + 1;
      s.due = today();
    } else {
      const mult = { hard: 1.3, good: 2.5, easy: 3.5 }[g];
      s.interval = Math.min(180, Math.max(iv + (g === "hard" ? 0 : 1), Math.round(iv * mult)));
      s.due = addDays(today(), s.interval);
    }
    s.reps = (s.reps || 0) + 1;
    S.names[id] = s;
    logToday().reviewed++;
    save();
  }

  // ---------- stats ----------
  function streak() {
    const active = (d) => {
      const l = S.log[d];
      return l && (l.learned > 0 || l.reviewed > 0);
    };
    let d = active(today()) ? today() : addDays(today(), -1);
    let n = 0;
    while (active(d)) {
      n++;
      d = addDays(d, -1);
    }
    return n;
  }

  // ---------- helpers ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const $ = (sel, root = document) => root.querySelector(sel);
  const shuffle = (a) => {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  function toast(msg) {
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }
  const badge = (id) => {
    const s = statusOf(id);
    return `<span class="badge ${s}">${s === "new" ? "Not started" : s}</span>`;
  };
  const otherNamesInChapter = (n) => n.ch.names.length > 1
    ? `<p class="small muted">Explained together with: ${n.ch.names.filter((x) => x.translit !== n.translit).map((x) => esc(x.translit)).join(", ")}</p>`
    : "";

  function nameHead(n, big = true) {
    return `<div class="name-head">
      <div class="chapter-tag">Name ${n.num} of ${TOTAL} · Chapter ${n.chapter}</div>
      <div class="name-ar ar" lang="ar" ${big ? "" : 'style="font-size:2.4rem"'}>${esc(n.arabic)}</div>
      <div class="name-tr">${esc(n.translit)}</div>
      <div class="name-mean">${esc(n.meaning)}</div>
    </div>`;
  }
  function keyPointsHtml(ch) {
    return `<h3>Key points</h3><ul class="points">${ch.keyPoints.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>`;
  }
  function evidenceHtml(ch) {
    if (!ch.evidence?.length) return "";
    return `<h3 style="margin-top:1rem">Evidence</h3>${ch.evidence
      .map((e) => `<div class="evidence">${esc(e.text)}${e.ref ? `<cite>${esc(e.ref)}</cite>` : ""}</div>`)
      .join("")}`;
  }
  function fullTextHtml(ch, open = false) {
    const body = ch.blocks
      .map((b) => (b.type === "quote"
        ? `<blockquote>${esc(b.text)}${b.ref ? `<cite>${esc(b.ref)}</cite>` : ""}</blockquote>`
        : `<p>${esc(b.text)}</p>`))
      .join("");
    return `<details class="full" ${open ? "open" : ""}><summary>Read the full explanation from the book (Chapter ${ch.chapter})</summary><div class="full-text">${body}</div></details>`;
  }
  function recallHtml(ch) {
    if (!ch.recall?.length) return "";
    return `<details class="full"><summary>Practice questions (${ch.recall.length})</summary><div class="full-text">${ch.recall
      .map((r) => `<div style="margin-bottom:.8rem"><b>Q: ${esc(r.q)}</b><details><summary class="small muted" style="cursor:pointer">Show answer</summary><p style="margin-top:.4rem">${esc(r.a)}</p></details></div>`)
      .join("")}</div></details>`;
  }
  function studyCard(n, { actions = true } = {}) {
    const s = statusOf(n.id);
    return `<div class="card">
      ${nameHead(n)}
      ${otherNamesInChapter(n)}
      ${keyPointsHtml(n.ch)}
      ${evidenceHtml(n.ch)}
      ${recallHtml(n.ch)}
      ${fullTextHtml(n.ch)}
      ${actions ? `<div class="row" style="margin-top:1.2rem">
        ${badge(n.id)}<span class="spacer"></span>
        ${s !== "memorized" ? `<button class="btn" data-act="add-today" data-id="${n.id}">Add to today</button>` : ""}
        ${s !== "memorized" ? `<button class="btn primary" data-act="test-one" data-id="${n.id}">Test me on this Name</button>` : `<button class="btn ghost" data-act="reset" data-id="${n.id}">Reset progress</button>`}
        ${s !== "memorized" ? `<button class="btn ghost" data-act="mark-mem" data-id="${n.id}">I already know it</button>` : ""}
      </div>` : ""}
    </div>`;
  }

  // ---------- modal ----------
  function openModal(html) {
    $("#modalBody").innerHTML = html;
    $("#modal").hidden = false;
  }
  function closeModal() {
    $("#modal").hidden = true;
  }

  // ---------- views ----------
  let session = null; // flashcard session
  let quiz = null;
  let browseFilter = { q: "", status: "all" };

  function vDashboard() {
    const plan = ensurePlan();
    const mem = memorizedIds().length;
    const learning = NAMES.filter((n) => statusOf(n.id) === "learning").length;
    const due = dueIds().length;
    const doneToday = plan.filter((id) => statusOf(id) === "memorized").length;
    const remaining = TOTAL - mem;
    const per = S.settings.perDay;
    // names still pending today finish today; the rest go at `per` per day starting tomorrow
    const afterToday = remaining - (plan.length - doneToday);
    const finish = prettyDate(addDays(today(), Math.max(0, Math.ceil(afterToday / per))));
    const pct = TOTAL ? mem / TOTAL : 0;
    const C = 2 * Math.PI * 70;

    const days = [...Array(14)].map((_, i) => addDays(today(), i - 13));
    const vals = days.map((d) => S.log[d]?.learned || 0);
    const max = Math.max(1, ...vals);

    return `<div class="stack">
      <div class="card hero">
        <div class="ring">
          <svg width="170" height="170" viewBox="0 0 170 170"><circle class="track" cx="85" cy="85" r="70" fill="none" stroke-width="14"/>
          <circle class="bar" cx="85" cy="85" r="70" fill="none" stroke-width="14" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}"/></svg>
          <div class="ring-label"><b>${mem}</b><span>of ${TOTAL} memorized</span></div>
        </div>
        <div>
          <h2>Assalaamu 'alaykum 👋</h2>
          <p class="muted">You've memorized <b>${mem}</b> of the ${TOTAL} Names explained in the book (${Math.round(pct * 100)}%).
          ${remaining ? `At <b>${per}</b> name${per > 1 ? "s" : ""} a day you'll finish around <b>${finish}</b>.` : "You've memorized every Name. Keep reviewing to retain them."}</p>
          <div class="row" style="margin-bottom:.4rem"><b>Today: ${doneToday} / ${plan.length}</b><span class="muted small">names memorized</span></div>
          <div class="bar-line"><div style="width:${plan.length ? (doneToday / plan.length) * 100 : 100}%"></div></div>
          <div class="row" style="margin-top:1rem">
            <a class="btn primary" href="#today">${doneToday >= plan.length && plan.length ? "Today's names ✓" : "Start today's lesson"}</a>
            <a class="btn" href="#review">Review${due ? ` (${due} due)` : ""}</a>
            <a class="btn ghost" href="#quiz">Quick quiz</a>
          </div>
        </div>
      </div>

      <div class="grid grid-3">
        <div class="card stat"><div class="v">${streak()} 🔥</div><div class="l">day streak</div></div>
        <div class="card stat"><div class="v">${due}</div><div class="l">reviews due today</div></div>
        <div class="card stat"><div class="v">${learning}</div><div class="l">names in progress</div></div>
      </div>

      <div class="card">
        <h3>How many Names per day?</h3>
        <p class="muted small">Pick a daily goal. You can change it any time; today's list updates straight away.</p>
        ${goalPicker()}
      </div>

      <div class="card">
        <h3>Names memorized, last 14 days</h3>
        <div class="history">${days
          .map((d, i) => `<div class="col" title="${prettyDate(d)}: ${vals[i]} memorized"><div class="small muted">${vals[i] || ""}</div><div class="b ${vals[i] ? "" : "zero"}" style="height:${(vals[i] / max) * 60}px"></div><div class="d">${Number(d.slice(8))}</div></div>`)
          .join("")}</div>
      </div>
    </div>`;
  }

  function goalPicker() {
    const per = S.settings.perDay;
    return `<div class="goal-picker">
      ${[1, 2, 3, 4, 5, 7, 10].map((n) => `<button class="n ${n === per ? "active" : ""}" data-act="set-goal" data-n="${n}">${n}</button>`).join("")}
      <span class="muted small">or custom:</span>
      <input type="number" min="1" max="${TOTAL}" value="${per}" id="goalInput">
      <button class="btn small" data-act="set-goal-custom">Set</button>
    </div>`;
  }

  function vToday() {
    const plan = ensurePlan();
    if (!TOTAL) return `<div class="card empty">No data loaded.</div>`;
    const done = plan.filter((id) => statusOf(id) === "memorized").length;
    const pending = plan.filter((id) => statusOf(id) !== "memorized");
    const allDone = memorizedIds().length === TOTAL;
    return `<div class="stack">
      <div class="card">
        <div class="row"><h2 style="margin:0">Today's Names</h2><span class="spacer"></span><span class="muted">${prettyDate(today())}</span></div>
        <p class="muted">Study each Name (meaning, key points and evidence), then test yourself. A Name counts as memorized once you recall it in the test.</p>
        <div class="row" style="margin-bottom:.4rem"><b>${done} / ${plan.length} memorized</b></div>
        <div class="bar-line"><div style="width:${plan.length ? (done / plan.length) * 100 : 100}%"></div></div>
        <div style="margin-top:1rem">${goalPicker()}</div>
      </div>
      ${plan.length ? `<div class="today-list">${plan
        .map((id) => {
          const n = BY_ID[id];
          const ok = statusOf(id) === "memorized";
          return `<div class="today-item" data-act="open-study" data-id="${id}">
            <div class="check ${ok ? "done" : ""}">${ok ? "✓" : ""}</div>
            <div class="ar" lang="ar">${esc(n.arabic)}</div>
            <div class="t"><b>${esc(n.translit)}</b><span class="muted small">${esc(n.meaning)} · Ch. ${n.chapter}</span></div>
            ${badge(id)}
          </div>`;
        })
        .join("")}</div>` : ""}
      <div class="row today-actions">
        ${pending.length ? `<button class="btn primary" data-act="test-today">Test me on today's ${pending.length} Name${pending.length > 1 ? "s" : ""}</button>` : ""}
        ${!allDone ? `<button class="btn" data-act="more-today">+ Learn one more today</button>` : ""}
      </div>
      ${!pending.length && plan.length ? `<div class="card empty"><div class="big">🌿</div><h3>Today's goal complete. Alhamdulillaah!</h3><p class="muted">Keep the Names fresh with a review or a quiz.</p><a class="btn" href="#review">Go to review</a></div>` : ""}
      ${allDone ? `<div class="card empty"><div class="big">🎉</div><h3>You've memorized all ${TOTAL} Names in the book.</h3><p class="muted">Reviews will keep coming up so you retain them.</p></div>` : ""}
    </div>`;
  }

  function vStudy(id) {
    const n = BY_ID[id];
    if (!n) return vToday();
    const plan = ensurePlan();
    const i = plan.indexOf(id);
    const nav = i >= 0
      ? `<div class="row" style="margin-bottom:1rem"><a class="btn ghost" href="#today">← Today</a><span class="spacer"></span>
          ${i > 0 ? `<a class="btn small" href="#study/${plan[i - 1]}">‹ Prev</a>` : ""}
          <span class="muted small">${i + 1} / ${plan.length}</span>
          ${i < plan.length - 1 ? `<a class="btn small" href="#study/${plan[i + 1]}">Next ›</a>` : ""}</div>`
      : `<div class="row" style="margin-bottom:1rem"><a class="btn ghost" href="#browse">← All Names</a></div>`;
    if (statusOf(id) === "new") markLearning(id);
    return nav + studyCard(n);
  }

  // ----- flashcard sessions (learn test & review) -----
  function startSession(type, ids) {
    session = { type, queue: type === "review" ? shuffle(ids) : ids.slice(), pos: 0, revealed: false, stats: { ok: 0, again: 0 }, seen: ids.length };
    location.hash = type === "review" ? "#review/session" : "#learn";
    render();
  }

  function cardFront(n) {
    if (S.settings.cardFront === "meaning") {
      return `<div class="prompt"><div class="chapter-tag">Which Name means…</div>
        <div class="name-tr" style="font-size:1.6rem;margin:.6rem 0">${esc(n.meaning)}</div>
        <p class="muted">Recall the Name in Arabic, then its key points and evidence.</p></div>`;
    }
    return `<div class="prompt"><div class="chapter-tag">What do you know about this Name?</div>
      <div class="name-ar ar" lang="ar">${esc(n.arabic)}</div><div class="name-tr">${esc(n.translit)}</div>
      <p class="muted" style="margin-top:.6rem">Say its meaning, the key points and the evidence from memory, then reveal.</p></div>`;
  }

  function vSession() {
    if (!session) return null;
    const s = session;
    if (s.pos >= s.queue.length) {
      const isRev = s.type === "review";
      const res = `<div class="card empty flash-wrap"><div class="big">${isRev ? "✅" : "🌟"}</div>
        <h3>${isRev ? "Review complete" : "Test complete"}</h3>
        <p class="muted">${isRev ? `${s.stats.ok} recalled · ${s.stats.again} to strengthen` : `${s.stats.ok} Name${s.stats.ok === 1 ? "" : "s"} memorized`}</p>
        <div class="row" style="justify-content:center"><a class="btn primary" href="#dashboard">Dashboard</a><a class="btn" href="#today">Today</a></div></div>`;
      session = null;
      return res;
    }
    const n = BY_ID[s.queue[s.pos]];
    const dots = s.queue.map((_, i) => `<i class="${i < s.pos ? "on" : ""}"></i>`).join("");
    const answer = s.revealed
      ? `<div class="answer">${S.settings.cardFront === "meaning" ? nameHead(n, false) : `<div class="name-mean" style="text-align:center;font-size:1.2rem;color:var(--ink);font-weight:600">${esc(n.meaning)}</div>`}
          ${keyPointsHtml(n.ch)}${evidenceHtml(n.ch)}${fullTextHtml(n.ch)}</div>
        <div class="grade-row">${s.type === "review"
          ? `<button class="btn bad" data-act="grade" data-g="again">Forgot</button>
             <button class="btn" data-act="grade" data-g="hard">Hard</button>
             <button class="btn good" data-act="grade" data-g="good">Good</button>
             <button class="btn primary" data-act="grade" data-g="easy">Easy</button>`
          : `<button class="btn bad" data-act="learn-no">Not yet, show again</button>
             <button class="btn primary" data-act="learn-yes">I remembered it ✓</button>`}</div>`
      : `<div class="grade-row"><button class="btn primary" data-act="reveal">Show answer</button></div>`;
    return `<div class="flash-wrap">
      <div class="row" style="margin-bottom:.6rem"><a class="btn ghost small" href="${s.type === "review" ? "#review" : "#today"}">✕ End</a><span class="spacer"></span>
      <span class="muted small">${s.type === "review" ? "Review" : "Memorization test"} · ${s.pos + 1} / ${s.queue.length}</span></div>
      <div class="progress-dots">${dots}</div>
      <div class="card flash">${cardFront(n)}${answer}</div>
      <p class="muted small" style="text-align:center;margin-top:.8rem">Shortcuts: Space = reveal${s.type === "review" ? ", 1-4 = grade" : ", 1 = not yet, 2 = remembered"}</p>
    </div>`;
  }

  function vReview() {
    const due = dueIds();
    const mem = memorizedIds();
    const upcoming = NAMES.filter((n) => statusOf(n.id) === "memorized" && st(n.id).due > today())
      .sort((a, b) => st(a.id).due.localeCompare(st(b.id).due)).slice(0, 8);
    return `<div class="stack">
      <div class="card">
        <h2>Review</h2>
        <p class="muted">Memorized Names come back for review at growing intervals (1 day, 3 days, about a week, and so on). Grade yourself honestly: <b>Forgot</b> brings a Name back tomorrow, <b>Easy</b> pushes it further out.</p>
        ${due.length
          ? `<button class="btn primary" data-act="start-review">Start review (${due.length} due)</button>`
          : `<p><b>Nothing due right now.</b> ${mem.length ? "" : "Memorize some Names first from the Today tab."}</p>`}
        ${mem.length ? `<button class="btn" data-act="review-all" style="margin-left:.4rem">Review all ${mem.length} memorized anyway</button>` : ""}
      </div>
      ${upcoming.length ? `<div class="card"><h3>Coming up</h3>${upcoming
        .map((n) => `<div class="row" style="padding:.35rem 0;border-bottom:1px solid var(--line)"><span class="ar" lang="ar" style="font-size:1.3rem;min-width:4rem">${esc(n.arabic)}</span><span>${esc(n.translit)}</span><span class="spacer"></span><span class="muted small">${prettyDate(st(n.id).due)}</span></div>`)
        .join("")}</div>` : ""}
    </div>`;
  }

  // ----- quiz -----
  function buildQuiz(mode, pool, count) {
    let ids = pool === "memorized" ? memorizedIds() : NAMES.map((n) => n.id);
    if (mode === "book") {
      const chs = [...new Set(ids.map((id) => BY_ID[id].chapter))];
      const qs = shuffle(chs.flatMap((c) => BOOK.chapters.find((x) => x.chapter === c).recall.map((r) => ({ ...r, chapter: c })))).slice(0, count);
      return { mode, pool, items: qs, pos: 0, score: 0, answered: null };
    }
    ids = shuffle(ids).slice(0, count);
    const items = ids.map((id) => {
      const n = BY_ID[id];
      const key = mode === "ar2en" ? "meaning" : "translit";
      const seen = new Set([n[key].toLowerCase()]);
      const distract = [];
      for (const o of shuffle(NAMES)) {
        if (distract.length >= 3) break;
        const v = o[key].toLowerCase();
        if (o.id === id || seen.has(v) || o.meaning.toLowerCase() === n.meaning.toLowerCase()) continue;
        seen.add(v);
        distract.push(o.id);
      }
      return { id, options: shuffle([id, ...distract]) };
    });
    return { mode, pool, items, pos: 0, score: 0, answered: null };
  }

  function vQuiz() {
    if (!quiz) {
      const memCount = memorizedIds().length;
      return `<div class="card stack">
        <h2>Quiz</h2>
        <div><h3>Question type</h3><div class="seg" id="qMode">
          <button data-v="ar2en" class="active">Name → Meaning</button>
          <button data-v="en2ar">Meaning → Name</button>
          <button data-v="book">Questions from the book</button></div></div>
        <div><h3>Which Names?</h3><div class="seg" id="qPool">
          <button data-v="memorized" class="${memCount >= 4 ? "active" : ""}" ${memCount < 4 ? "disabled title='Memorize at least 4 Names first'" : ""}>Memorized only (${memCount})</button>
          <button data-v="all" class="${memCount >= 4 ? "" : "active"}">All ${TOTAL} Names</button></div></div>
        <div><h3>How many questions?</h3><div class="seg" id="qCount">
          ${[5, 10, 20, 50].map((n) => `<button data-v="${n}" class="${n === 10 ? "active" : ""}">${n}</button>`).join("")}</div></div>
        <div><button class="btn primary" data-act="quiz-start">Start quiz</button></div>
      </div>`;
    }
    const q = quiz;
    if (q.pos >= q.items.length) {
      const pct = q.items.length ? Math.round((q.score / q.items.length) * 100) : 0;
      return `<div class="card empty"><div class="big">${pct >= 80 ? "🏆" : pct >= 50 ? "👍" : "📖"}</div>
        <h3>${q.mode === "book" ? `You marked ${q.score} of ${q.items.length} correct` : `Score: ${q.score} / ${q.items.length} (${pct}%)`}</h3>
        <p class="muted">${q.mode !== "book" && q.pool === "memorized" ? "Memorized Names you got wrong have been put back into today's review." : ""}</p>
        <div class="row" style="justify-content:center"><button class="btn primary" data-act="quiz-again">New quiz</button><a class="btn" href="#dashboard">Dashboard</a></div></div>`;
    }
    const head = `<div class="row" style="margin-bottom:.6rem"><button class="btn ghost small" data-act="quiz-quit">✕ Quit</button><span class="spacer"></span><span class="muted small">Question ${q.pos + 1} / ${q.items.length} · Score ${q.score}</span></div>`;
    const it = q.items[q.pos];
    if (q.mode === "book") {
      return `<div class="flash-wrap">${head}<div class="card flash"><div class="chapter-tag">Chapter ${it.chapter}: ${esc(BOOK.chapters.find((c) => c.chapter === it.chapter).names.map((n) => n.translit).join(", "))}</div>
        <h3 style="margin-top:.6rem">${esc(it.q)}</h3>
        ${q.answered === null
          ? `<div class="grade-row"><button class="btn primary" data-act="reveal-book">Show answer</button></div>`
          : `<div class="answer"><p>${esc(it.a)}</p></div><div class="grade-row"><button class="btn bad" data-act="book-grade" data-ok="0">I got it wrong</button><button class="btn primary" data-act="book-grade" data-ok="1">I got it right</button></div>`}
      </div></div>`;
    }
    const n = BY_ID[it.id];
    const prompt = q.mode === "ar2en"
      ? `<div class="chapter-tag">What does this Name mean?</div><div class="name-ar ar" lang="ar">${esc(n.arabic)}</div><div class="name-tr">${esc(n.translit)}</div>`
      : `<div class="chapter-tag">Which Name means…</div><div class="name-tr" style="font-size:1.5rem;margin:.8rem 0">${esc(n.meaning)}</div>`;
    const opts = it.options
      .map((oid, i) => {
        const o = BY_ID[oid];
        let cls = "";
        if (q.answered !== null) cls = oid === it.id ? "correct" : oid === q.answered ? "wrong" : "";
        const label = q.mode === "ar2en" ? esc(o.meaning) : `<span class="ar" lang="ar">${esc(o.arabic)}</span> &nbsp; ${esc(o.translit)}`;
        return `<button class="option ${cls}" data-act="quiz-pick" data-id="${oid}" ${q.answered !== null ? "disabled" : ""}><span class="muted small">${i + 1}.</span> ${label}</button>`;
      })
      .join("");
    return `<div class="flash-wrap">${head}<div class="card"><div class="prompt" style="text-align:center">${prompt}</div>
      <div class="options">${opts}</div>
      ${q.answered !== null ? `<div class="answer"><b>${esc(n.translit)}: ${esc(n.meaning)}</b><ul class="points small" style="margin-top:.4rem">${n.ch.keyPoints.slice(0, 2).map((p) => `<li>${esc(p)}</li>`).join("")}</ul></div>
      <div class="grade-row"><button class="btn primary" data-act="quiz-next">Next →</button></div>` : ""}
    </div></div>`;
  }

  function vBrowse() {
    const q = browseFilter.q.trim().toLowerCase();
    const list = NAMES.filter((n) => {
      if (browseFilter.status !== "all" && statusOf(n.id) !== browseFilter.status) return false;
      if (!q) return true;
      return [n.translit, n.meaning, n.arabic, `chapter ${n.chapter}`].some((s) => s.toLowerCase().includes(q));
    });
    const counts = { all: TOTAL, new: 0, learning: 0, memorized: 0 };
    NAMES.forEach((n) => counts[statusOf(n.id)]++);
    return `<div class="stack">
      <div class="card">
        <input class="search" id="search" placeholder="Search by name, meaning or Arabic…" value="${esc(browseFilter.q)}">
        <div class="seg" id="bFilter" style="margin-top:.8rem">
          ${[["all", "All"], ["new", "Not started"], ["learning", "Learning"], ["memorized", "Memorized"]]
            .map(([v, l]) => `<button data-v="${v}" class="${browseFilter.status === v ? "active" : ""}">${l} (${counts[v]})</button>`).join("")}
        </div>
      </div>
      <div class="name-grid">${list
        .map((n) => `<div class="name-tile" data-act="open-modal" data-id="${n.id}"><span class="num">${n.num}</span>${statusOf(n.id) !== "new" ? badge(n.id) : ""}
          <div class="ar" lang="ar">${esc(n.arabic)}</div><div class="tr">${esc(n.translit)}</div><div class="mn">${esc(n.meaning)}</div></div>`)
        .join("") || `<p class="muted">No Names match.</p>`}</div>
    </div>`;
  }

  function vSettings() {
    return `<div class="stack">
      <div class="card"><h3>Daily goal</h3><p class="muted small">How many new Names to memorize each day.</p>${goalPicker()}</div>
      <div class="card"><h3>Flashcard front side</h3><p class="muted small">What you see first when testing yourself.</p>
        <div class="seg" id="frontSeg">
          <button data-v="arabic" class="${S.settings.cardFront === "arabic" ? "active" : ""}">Arabic Name → recall meaning</button>
          <button data-v="meaning" class="${S.settings.cardFront === "meaning" ? "active" : ""}">Meaning → recall Name</button>
        </div></div>
      <div class="card"><h3>Backup</h3><p class="muted small">${C().user ? "You're signed in, so your progress is already saved to your account. You can also download a copy." : `Progress is stored in this browser. ${C().status !== "unconfigured" ? '<a href="#profile">Sign in with Google</a> to keep it in the cloud, or export a copy.' : "Export it to keep a backup or move it to another device."}`}</p>
        <div class="row"><button class="btn" data-act="export">Export progress</button>
        <label class="btn">Import progress<input type="file" accept="application/json" id="importFile" hidden></label></div></div>
      <div class="card"><h3>Reset</h3><p class="muted small">Erase all progress and start again.</p><button class="btn bad" data-act="reset-all">Reset everything</button></div>
    </div>`;
  }

  // ---------- account / cloud ----------
  const C = () => window.Cloud || { status: "unconfigured" };
  function statsSummary() {
    const activeDates = Object.keys(S.log).filter((d) => S.log[d].learned > 0 || S.log[d].reviewed > 0).sort();
    const week = {};
    for (let i = 0; i < 7; i++) {
      const d = addDays(today(), -i);
      if (S.log[d]?.learned) week[d] = S.log[d].learned;
    }
    return {
      memorized: memorizedIds().length, total: TOTAL, streak: streak(), perDay: S.settings.perDay,
      lastActive: activeDates[activeDates.length - 1] || "",
      week, // names memorized per day over the last 7 days
      reviews: Object.values(S.log).reduce((s, l) => s + (l.reviewed || 0), 0),
    };
  }
  function avatar(u, size = 32) {
    const initial = esc((u.displayName || u.email || "?").trim()[0].toUpperCase());
    return u.photoURL
      ? `<img class="avatar" src="${esc(u.photoURL)}" width="${size}" height="${size}" alt="" referrerpolicy="no-referrer">`
      : `<span class="avatar avatar-txt" style="width:${size}px;height:${size}px">${initial}</span>`;
  }
  function authArea() {
    const c = C();
    if (c.status === "unconfigured") return "";
    if (c.status === "loading") return `<span class="muted small">Loading…</span>`;
    if (c.status === "error") return `<span class="small" title="${esc(c.error)}" style="color:var(--warn)">Offline</span>`;
    if (!c.user) return `<button class="btn google-btn" data-act="sign-in">${GOOGLE_G} Sign in</button>`;
    return `<a class="user-chip" href="#profile" title="Your profile">${avatar(c.user)}<span>${esc((c.user.displayName || c.user.email).split(" ")[0])}</span>
      <span class="sync-dot ${c.status === "syncing" ? "busy" : c.error ? "err" : ""}" title="${c.error ? esc(c.error) : "Synced"}"></span></a>`;
  }
  const GOOGLE_G = `<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.7-6c-2.1 1.4-4.9 2.3-8.2 2.3-6.2 0-11.5-4.1-13.4-9.8l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>`;

  function vProfile() {
    const c = C();
    if (c.status === "unconfigured")
      return `<div class="card empty"><h3>Accounts aren't set up on this copy of the site.</h3><p class="muted">Your progress is saved in this browser.</p></div>`;
    if (!c.user)
      return `<div class="card empty"><div class="big">☁️</div><h3>Sign in to save your progress in the cloud</h3>
        <p class="muted">Your memorization progress will be kept with your Google account and synced across all your devices.
        Anything you've already done on this device will be kept and merged in.</p>
        <button class="btn google-btn big-btn" data-act="sign-in">${GOOGLE_G} Sign in with Google</button></div>`;
    const u = c.user;
    const st = statsSummary();
    const created = u.metadata?.creationTime ? new Date(u.metadata.creationTime).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : "";
    const reviews = Object.values(S.log).reduce((s, l) => s + (l.reviewed || 0), 0);
    const activeDays = Object.values(S.log).filter((l) => l.learned || l.reviewed).length;
    return `<div class="stack">
      <div class="card profile-head">
        ${avatar(u, 84)}
        <div><h2 style="margin:0">${esc(u.displayName || "Your profile")}</h2>
        <div class="muted">${esc(u.email || "")}</div>
        ${created ? `<div class="muted small">Member since ${created}</div>` : ""}</div>
        <span class="spacer"></span>
        <button class="btn" data-act="sign-out">Sign out</button>
      </div>
      <div class="grid grid-3">
        <div class="card stat"><div class="v">${st.memorized} / ${TOTAL}</div><div class="l">Names memorized</div></div>
        <div class="card stat"><div class="v">${st.streak} 🔥</div><div class="l">day streak</div></div>
        <div class="card stat"><div class="v">${activeDays}</div><div class="l">active days</div></div>
        <div class="card stat"><div class="v">${reviews}</div><div class="l">reviews done</div></div>
        <div class="card stat"><div class="v">${st.perDay}</div><div class="l">daily goal</div></div>
        <div class="card stat"><div class="v">${Math.round((st.memorized / TOTAL) * 100)}%</div><div class="l">of the book</div></div>
      </div>
      <div class="card"><h3>Cloud sync</h3>
        <p class="muted small">${c.error ? `<span style="color:var(--warn)">Sync problem: ${esc(c.error)}</span>` : c.status === "syncing" ? "Syncing…" : `Your progress is saved to your account${c.lastSync ? `, last synced ${c.lastSync.toLocaleTimeString()}` : ""}. It updates automatically on all devices where you're signed in.`}</p></div>
    </div>`;
  }

  window.App = {
    getState: () => S,
    getStats: statsSummary,
    mergeRemote(remote) {
      S = mergeStates(S, Object.assign(defaultState(), remote));
      localStorage.setItem(KEY, JSON.stringify(S));
      if (!session && !quiz) render();
      else refreshAuth();
    },
    refreshAuth,
  };
  function refreshAuth() {
    const el = $("#authArea");
    if (el) el.innerHTML = authArea();
    const typing = document.activeElement?.tagName === "INPUT" && $("#app").contains(document.activeElement);
    if ((location.hash === "#profile" || location.hash === "#leaderboard") && !typing) render();
  }

  // ---------- leaderboard ----------
  let lbTab = "memorized";
  const LB_TABS = {
    memorized: { label: "Names memorized", unit: (v) => `${v} / ${TOTAL}` },
    streak: { label: "Streak", unit: (v) => `${v} day${v === 1 ? "" : "s"} 🔥` },
    week: { label: "This week", unit: (v) => `+${v}` },
  };
  function lbValue(e, tab) {
    if (tab === "memorized") return e.memorized || 0;
    if (tab === "streak") return e.lastActive && e.lastActive >= addDays(today(), -1) ? e.streak || 0 : 0; // broken streaks count as 0
    const from = addDays(today(), -6);
    return Object.entries(e.week || {}).reduce((s, [d, n]) => (d >= from ? s + n : s), 0);
  }
  function lbAvatar(e, size = 40) {
    return e.photo
      ? `<img class="avatar" src="${esc(e.photo)}" width="${size}" height="${size}" alt="" referrerpolicy="no-referrer" loading="lazy">`
      : `<span class="avatar avatar-txt" style="width:${size}px;height:${size}px">${esc((e.name || "?").trim()[0]?.toUpperCase() || "?")}</span>`;
  }
  function vLeaderboard() {
    const c = C();
    const head = `<div class="card lb-hero"><div class="lb-trophy">🏆</div><div><h2 style="margin:0">Leaderboard</h2>
      <p class="muted small" style="margin:0">Encourage each other in learning Allaah's Beautiful Names.</p></div></div>`;
    if (c.status === "unconfigured" || c.status === "error")
      return head + `<div class="card empty" style="margin-top:.75rem"><p class="muted">The leaderboard needs an internet connection and an account.</p></div>`;
    if (!c.user)
      return `<div class="stack">${head}<div class="card empty"><h3>Sign in to see the leaderboard</h3>
        <p class="muted">Sign in with Google, then choose whether to join with a display name of your choice.</p>
        <button class="btn google-btn big-btn" data-act="sign-in">${GOOGLE_G} Sign in with Google</button></div></div>`;
    const lb = c.lb;
    if (!lb.loading && !lb.error && (!lb.fetchedAt || Date.now() - lb.fetchedAt > 60000)) setTimeout(c.fetchLeaderboard);
    const errBox = lb.error ? `<div class="card row" style="border-color:var(--warn);color:var(--warn)"><span style="flex:1">${esc(lb.error)}</span><button class="btn small" data-act="lb-refresh">Retry</button></div>` : "";

    const joinCard = !lb.joined
      ? `<div class="card"><h3>Join the leaderboard</h3>
          <p class="muted small">Only the display name below${c.user.photoURL ? ", your photo (optional)" : ""} and your progress numbers are shown to other signed-in users. Your email is never shown. You can leave at any time.</p>
          <div class="lb-form">
            <label class="small muted" for="lbName">Display name</label>
            <input id="lbName" class="search" maxlength="30" value="${esc(lb.name)}">
            ${c.user.photoURL ? `<label class="lb-check"><input type="checkbox" id="lbPhoto" ${lb.showPhoto ? "checked" : ""}> Show my Google profile photo</label>` : ""}
            <button class="btn primary" data-act="lb-join">Join leaderboard</button>
          </div></div>`
      : "";

    let list = "";
    if (lb.loading && !lb.entries) list = `<div class="card empty"><p class="muted">Loading…</p></div>`;
    else if (lb.entries) {
      const meId = c.user.uid;
      const rows = lb.entries
        .map((e) => ({ ...e, v: lbValue(e, lbTab) }))
        .sort((a, b) => b.v - a.v || (b.memorized || 0) - (a.memorized || 0) || (a.name || "").localeCompare(b.name || ""));
      // standard competition ranking (1, 2, 2, 4)
      rows.forEach((r, i) => (r.rank = i && rows[i - 1].v === r.v ? rows[i - 1].rank : i + 1));
      const me = rows.find((r) => r.uid === meId);
      const medal = (r) => (r.v > 0 && r.rank <= 3 ? ["🥇", "🥈", "🥉"][r.rank - 1] : r.rank);
      const rowHtml = (r) => `<li class="lb-row ${r.uid === meId ? "me" : ""} ${r.rank <= 3 && r.v > 0 ? "top" : ""}">
          <span class="lb-rank">${medal(r)}</span>${lbAvatar(r)}
          <span class="lb-name">${esc(r.name)}${r.uid === meId ? ' <span class="badge memorized">You</span>' : ""}
            ${lbTab !== "memorized" ? `<span class="small muted">${r.memorized || 0} memorized</span>` : `<span class="lb-bar"><i style="width:${((r.memorized || 0) / TOTAL) * 100}%"></i></span>`}</span>
          <span class="lb-val">${LB_TABS[lbTab].unit(r.v)}</span></li>`;
      const shown = rows.slice(0, 100);
      list = `<div class="card">
        <div class="row" style="margin-bottom:.8rem">
          <div class="seg" id="lbTabs">${Object.entries(LB_TABS).map(([k, t]) => `<button data-v="${k}" class="${k === lbTab ? "active" : ""}">${t.label}</button>`).join("")}</div>
          <span class="spacer"></span>
          <button class="btn ghost small" data-act="lb-refresh" ${lb.loading ? "disabled" : ""}>${lb.loading ? "Refreshing…" : "↻ Refresh"}</button>
        </div>
        ${me ? `<p class="small" style="margin:.2rem 0 .8rem">You're <b>#${me.rank}</b> of ${rows.length}.</p>` : ""}
        ${rows.length ? `<ol class="lb-list">${shown.map(rowHtml).join("")}</ol>` : `<p class="muted">No one has joined yet. Be the first!</p>`}
        ${me && !shown.includes(me) ? `<ol class="lb-list" style="margin-top:.5rem;border-top:1px dashed var(--line);padding-top:.5rem">${rowHtml(me)}</ol>` : ""}
        ${lbTab === "streak" ? `<p class="small muted" style="margin-top:.8rem">A streak counts days in a row with any learning or review.</p>` : ""}
        ${lbTab === "week" ? `<p class="small muted" style="margin-top:.8rem">Names memorized in the last 7 days.</p>` : ""}
      </div>`;
    }

    const manage = lb.joined
      ? `<details class="card"><summary style="cursor:pointer;font-weight:600">Leaderboard settings</summary>
          <div class="lb-form" style="margin-top:.8rem">
            <label class="small muted" for="lbName">Display name</label>
            <input id="lbName" class="search" maxlength="30" value="${esc(lb.name)}">
            ${c.user.photoURL ? `<label class="lb-check"><input type="checkbox" id="lbPhoto" ${lb.showPhoto ? "checked" : ""}> Show my Google profile photo</label>` : ""}
            <div class="row"><button class="btn primary" data-act="lb-save">Save</button><button class="btn bad" data-act="lb-leave">Leave leaderboard</button></div>
          </div></details>`
      : "";
    return `<div class="stack">${head}${errBox}${joinCard}${list}${manage}</div>`;
  }

  // ---------- router ----------
  function render() {
    const hash = location.hash.slice(1) || "dashboard";
    const [view, arg] = hash.split("/");
    let html;
    if (view === "learn" || (view === "review" && arg === "session")) html = vSession() ?? (view === "learn" ? vToday() : vReview());
    else if (view === "study") html = vStudy(arg);
    else html = ({ dashboard: vDashboard, today: vToday, review: vReview, quiz: vQuiz, browse: vBrowse, settings: vSettings, profile: vProfile, leaderboard: vLeaderboard }[view] || vDashboard)();
    $("#app").innerHTML = html;

    const tab = view === "study" || view === "learn" ? "today" : view === "profile" ? "" : view;
    document.querySelectorAll("#tabs button, #bottomNav button").forEach((b) => b.classList.toggle("active", b.dataset.view === tab));
    document.querySelectorAll("[data-view-link]").forEach((a) => a.classList.toggle("active", a.dataset.viewLink === tab));
    const due = dueIds().length;
    const db = $("#dueBadge");
    db.hidden = !due;
    db.textContent = due;
    $("#dueDot").hidden = !due;
    // "focus mode": a flashcard session or quiz in progress hides the bottom tab bar on phones
    document.body.classList.toggle("focus", !!session || (view === "quiz" && !!quiz));
    refreshAuthArea();
  }
  function refreshAuthArea() {
    const el = $("#authArea");
    if (el) el.innerHTML = authArea();
  }

  function setGoal(n) {
    n = Math.max(1, Math.min(TOTAL, Math.round(Number(n)) || 1));
    S.settings.perDay = n;
    S.settingsAt = Date.now();
    save();
    ensurePlan();
    toast(`Daily goal: ${n} Name${n > 1 ? "s" : ""} per day`);
    render();
  }

  // ---------- events ----------
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) return closeModal();
    const tabBtn = e.target.closest("#tabs button, #bottomNav button");
    if (tabBtn) {
      if (tabBtn.dataset.view === "quiz") quiz = null;
      location.hash = tabBtn.dataset.view;
      return;
    }
    const seg = e.target.closest(".seg button");
    if (seg && !seg.disabled) {
      seg.parentElement.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === seg));
      const pid = seg.parentElement.id;
      if (pid === "bFilter") { browseFilter.status = seg.dataset.v; render(); }
      if (pid === "lbTabs") { lbTab = seg.dataset.v; render(); }
      if (pid === "frontSeg") { S.settings.cardFront = seg.dataset.v; S.settingsAt = Date.now(); save(); }
      return;
    }
    const el = e.target.closest("[data-act]");
    if (!el) return;
    const id = el.dataset.id;
    switch (el.dataset.act) {
      case "sign-in": return window.Cloud?.signIn?.();
      case "sign-out":
        if (!confirm("Sign out? Your progress stays saved in your account.")) return;
        return window.Cloud.signOut().then(() => { location.hash = "dashboard"; });
      case "lb-join":
        return C().joinLeaderboard($("#lbName").value, $("#lbPhoto")?.checked ?? false).then(() => toast("You've joined the leaderboard"));
      case "lb-save":
        return C().updateLeaderboardProfile($("#lbName").value, $("#lbPhoto")?.checked ?? false).then(() => toast("Saved"));
      case "lb-leave":
        if (!confirm("Leave the leaderboard? Your entry will be removed. Your own progress is not affected.")) return;
        return C().leaveLeaderboard().then(() => toast("You've left the leaderboard"));
      case "lb-refresh": return C().fetchLeaderboard();
      case "set-goal": return setGoal(el.dataset.n);
      case "set-goal-custom": return setGoal($("#goalInput").value);
      case "open-study": location.hash = `study/${id}`; return;
      case "open-modal": return openModal(studyCard(BY_ID[id]));
      case "add-today":
        addToToday([id]);
        closeModal();
        toast(`${BY_ID[id].translit} added to today`);
        location.hash = "today";
        return render();
      case "test-one":
        closeModal();
        return startSession("learn", [id]);
      case "mark-mem":
        markMemorized(id);
        closeModal();
        toast(`${BY_ID[id].translit} marked as memorized`);
        return render();
      case "reset":
        if (!confirm("Reset progress for this Name?")) return;
        resetName(id);
        closeModal();
        return render();
      case "test-today": {
        const ids = ensurePlan().filter((x) => statusOf(x) !== "memorized");
        ids.forEach(markLearning);
        return startSession("learn", ids);
      }
      case "more-today": {
        const plan = ensurePlan();
        const nxt = nextUnlearned(new Set(plan), 1);
        if (nxt.length) { addToToday(nxt); toast(`${BY_ID[nxt[0]].translit} added`); }
        return render();
      }
      case "reveal": session.revealed = true; return render();
      case "learn-yes": {
        const nid = session.queue[session.pos];
        markMemorized(nid);
        session.stats.ok++;
        session.pos++;
        session.revealed = false;
        return render();
      }
      case "learn-no": {
        const nid = session.queue[session.pos];
        markLearning(nid);
        session.queue.push(nid);
        session.pos++;
        session.revealed = false;
        return render();
      }
      case "grade": {
        const nid = session.queue[session.pos];
        grade(nid, el.dataset.g);
        if (el.dataset.g === "again") { session.stats.again++; session.queue.push(nid); } else session.stats.ok++;
        session.pos++;
        session.revealed = false;
        return render();
      }
      case "start-review": return startSession("review", dueIds());
      case "review-all": return startSession("review", memorizedIds());
      case "quiz-start": {
        const get = (sel) => $(`#${sel} button.active`)?.dataset.v;
        quiz = buildQuiz(get("qMode"), get("qPool") || "all", Number(get("qCount")));
        if (!quiz.items.length) { quiz = null; toast("No questions available yet"); }
        return render();
      }
      case "quiz-pick": {
        const it = quiz.items[quiz.pos];
        quiz.answered = id;
        if (id === it.id) quiz.score++;
        else if (statusOf(it.id) === "memorized") {
          S.names[it.id] = { ...st(it.id), due: today(), interval: 1 };
          save();
        }
        return render();
      }
      case "quiz-next": quiz.pos++; quiz.answered = null; return render();
      case "reveal-book": quiz.answered = true; return render();
      case "book-grade": if (el.dataset.ok === "1") quiz.score++; quiz.pos++; quiz.answered = null; return render();
      case "quiz-again": case "quiz-quit": quiz = null; return render();
      case "export": {
        const blob = new Blob([JSON.stringify(S, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `beautiful-names-progress-${today()}.json`;
        a.click();
        return;
      }
      case "reset-all":
        if (!confirm("This will erase ALL your progress. Continue?")) return;
        S = defaultState();
        save();
        toast("Progress reset");
        return render();
    }
  });

  document.addEventListener("input", (e) => {
    if (e.target.id === "search") {
      browseFilter.q = e.target.value;
      const pos = e.target.selectionStart;
      render();
      const s = $("#search");
      s.focus();
      s.setSelectionRange(pos, pos);
    }
  });

  document.addEventListener("change", (e) => {
    if (e.target.id === "importFile" && e.target.files[0]) {
      e.target.files[0].text().then((txt) => {
        try {
          const data = JSON.parse(txt);
          if (!data.names || !data.settings) throw new Error();
          S = Object.assign(defaultState(), data);
          save();
          toast("Progress imported");
          render();
        } catch {
          alert("That file doesn't look like a progress backup.");
        }
      });
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") return closeModal();
    if (e.target.tagName === "INPUT") return;
    const view = location.hash.slice(1);
    if (session && (view === "learn" || view === "review/session")) {
      if (e.key === " " && !session.revealed) { e.preventDefault(); $('[data-act="reveal"]')?.click(); }
      else if (session.revealed) {
        const map = session.type === "review" ? { 1: "again", 2: "hard", 3: "good", 4: "easy" } : null;
        if (map && map[e.key]) $(`[data-act="grade"][data-g="${map[e.key]}"]`)?.click();
        if (!map && e.key === "1") $('[data-act="learn-no"]')?.click();
        if (!map && e.key === "2") $('[data-act="learn-yes"]')?.click();
      }
    } else if (quiz && view === "quiz" && quiz.mode !== "book") {
      if (quiz.answered === null && /^[1-4]$/.test(e.key)) document.querySelectorAll('[data-act="quiz-pick"]')[e.key - 1]?.click();
      else if (quiz.answered !== null && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); $('[data-act="quiz-next"]')?.click(); }
    }
  });

  window.addEventListener("hashchange", () => {
    const v = location.hash.slice(1);
    if (session && v !== "learn" && v !== "review/session") session = null;
    render();
    window.scrollTo(0, 0);
  });

  render();
})();
