const API_BASE = "";

(function () {
  const STORAGE_KEY = "switchboardPersonId";
  const POLL_MS = 2000;
  const LINE_NAMES = ["Study", "Food", "Sport", "Chat", "Help", "Random"];

  function h(tag, props, ...kids) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === "class") node.className = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else if (v === true) node.setAttribute(k, "");
      else if (v !== false && v != null) node.setAttribute(k, v);
    }
    for (const kid of kids) {
      if (kid == null) continue;
      node.append(kid.nodeType ? kid : document.createTextNode(kid));
    }
    return node;
  }

  async function api(path, options) {
    const res = await fetch(API_BASE + path, options);
    if (!res.ok) {
      const err = new Error("HTTP " + res.status);
      err.status = res.status;
      try { err.detail = (await res.json()).detail; } catch (e) { /* no JSON body */ }
      throw err;
    }
    return res.json();
  }

  function postJson(path, body) {
    return api(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function loadId() {
    try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
  }
  function saveId(id) {
    try { localStorage.setItem(STORAGE_KEY, id); } catch (e) { /* ignore */ }
  }
  function clearId() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
  }

  // ---------- Sound (Web Audio, no files) ----------

  const MUTE_KEY = "switchboardMuted";
  let muted = false;
  try { muted = localStorage.getItem(MUTE_KEY) === "1"; } catch (e) { /* default: sound on */ }
  let audioCtx = null;

  function getCtx() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { audioCtx = new AC(); } catch (e) { return null; }
    }
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
    return audioCtx;
  }

  function tick(ctx, t, amp, band, thunk) {
    const len = Math.floor(ctx.sampleRate * 0.03);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = band;
    filter.Q.value = 0.9;
    const gain = ctx.createGain();
    gain.gain.value = amp;
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(t);

    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(thunk, t);
    osc.frequency.exponentialRampToValueAtTime(70, t + 0.05);
    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(amp * 0.5, t);
    oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    osc.connect(oscGain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.07);
  }

  // Short mechanical click (press and release), or a softer single click.
  function playClick(soft) {
    if (muted) return;
    const ctx = getCtx();
    if (!ctx) return;
    const t = ctx.currentTime;
    if (soft) {
      tick(ctx, t, 0.375, 1200, 180);
    } else {
      tick(ctx, t, 0.9, 2400, 260);
      tick(ctx, t + 0.07, 0.525, 2000, 200);
    }
  }

  // Classic British double ring: two bursts of a fast two-tone bell trill.
  function playRing() {
    if (muted || !audioCtx || audioCtx.state !== "running") return;
    const ctx = audioCtx;
    const t0 = ctx.currentTime + 0.05;
    const master = ctx.createGain();
    master.gain.value = 0.27;
    master.connect(ctx.destination);
    for (const burst of [0, 0.6]) {
      for (let i = 0; i < 12; i++) {
        const t = t0 + burst + i * 0.033;
        const base = i % 2 ? 1380 : 1500;
        for (const [mult, amp] of [[1, 1], [1.5, 0.6], [2.15, 0.3]]) {
          const osc = ctx.createOscillator();
          osc.type = "sine";
          osc.frequency.value = base * mult;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(amp, t + 0.003);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
          osc.connect(g).connect(master);
          osc.start(t);
          osc.stop(t + 0.06);
        }
      }
    }
  }

  function mountSwitchboardPanel(el) {
    el.classList.add("sb-panel");
    // Unlock audio on the first touch inside the panel so a later ring can play.
    el.addEventListener("pointerdown", () => { if (!muted) getCtx(); });

    let personId = null;
    let timer = null;
    let busy = false;
    let mode = null;
    let ui = {};

    function stopPolling() {
      if (timer) clearInterval(timer);
      timer = null;
      busy = false;
      mode = null;
    }

    // Narrow screens: the panel is a bottom sheet that can be collapsed to its header.
    function setSheet(collapsed, chatting) {
      el.classList.toggle("sb-collapsed", collapsed);
      el.classList.toggle("sb-chatting", chatting);
      const toggle = el.querySelector(".sb-toggle");
      if (toggle) toggle.setAttribute("aria-expanded", String(!collapsed));
    }

    function muteButton() {
      const btn = h("button", {
        type: "button", class: "sb-btn sb-mute" + (muted ? " sb-muted" : ""),
        role: "switch", "aria-checked": String(!muted), "aria-label": "Sound", title: "Sound on/off",
        onclick: () => {
          muted = !muted;
          try { localStorage.setItem(MUTE_KEY, muted ? "1" : "0"); } catch (e) { /* ignore */ }
          btn.classList.toggle("sb-muted", muted);
          btn.setAttribute("aria-checked", String(!muted));
          if (!muted) getCtx();
        },
      }, "♪");
      return btn;
    }

    function header(withLeave) {
      return h("header", { class: "sb-header" },
        h("button", {
          type: "button", class: "sb-toggle",
          "aria-expanded": String(!el.classList.contains("sb-collapsed")),
          onclick: () => setSheet(!el.classList.contains("sb-collapsed"), el.classList.contains("sb-chatting")),
        }, h("span", { class: "sb-brand" }, "SWITCHBOARD"), h("span", { class: "sb-chevron", "aria-hidden": "true" })),
        muteButton(),
        withLeave ? h("button", {
          type: "button", class: "sb-btn sb-leave",
          onclick: () => { playClick(true); leave(); },
        }, "Leave") : null
      );
    }

    // ---------- Form ----------

    function showForm(values, error) {
      stopPolling();
      values = values || { firstName: "", text: "", line: "" };
      let selectedLine = values.line;

      const nameInput = h("input", {
        class: "sb-input", type: "text", maxlength: "20", required: true,
        autocomplete: "given-name", value: values.firstName, id: "sb-name",
      });
      const textInput = h("input", {
        class: "sb-input", type: "text", maxlength: "60", required: true,
        value: values.text, id: "sb-text", placeholder: "e.g. stuck on recursion",
      });
      const errorBox = h("p", { class: "sb-error", role: "alert" }, error || "");

      const lineButtons = [{ label: "Let the operator decide", value: "" }]
        .concat(LINE_NAMES.map((n) => ({ label: n, value: n })))
        .map((opt) => {
          const btn = h("button", {
            type: "button",
            class: "sb-line" + (opt.value === "" ? " sb-line-auto" : ""),
            "aria-pressed": String(opt.value === selectedLine),
            onclick: () => {
              selectedLine = opt.value;
              lineButtons.forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
            },
          }, opt.label);
          return btn;
        });

      const form = h("form", { class: "sb-form", novalidate: true,
        onsubmit: (e) => {
          e.preventDefault();
          const firstName = nameInput.value.trim();
          const text = textInput.value.trim();
          if (!firstName || !text) {
            errorBox.textContent = "Please fill in your name and your status.";
            return;
          }
          join({ firstName, text, line: selectedLine });
        } },
        h("label", { class: "sb-label", for: "sb-name" }, "First name"),
        nameInput,
        h("label", { class: "sb-label", for: "sb-text" }, "Status"),
        textInput,
        h("p", { class: "sb-label" }, "Pick a line"),
        h("div", { class: "sb-lines" }, ...lineButtons),
        errorBox,
        h("button", { type: "submit", class: "sb-btn sb-primary", onclick: () => playClick(false) }, "Go on air")
      );

      el.replaceChildren(header(false), h("main", { class: "sb-main" }, form));
      setSheet(false, false);
    }

    function showJoining() {
      stopPolling();
      el.replaceChildren(
        header(false),
        h("main", { class: "sb-main sb-center" },
          h("div", { class: "sb-dots", "aria-hidden": "true" }, h("span"), h("span"), h("span")),
          h("p", { class: "sb-big", role: "status" }, "The operator is checking the lines…")
        )
      );
      setSheet(false, false);
    }

    async function join(values) {
      showJoining();
      try {
        const body = { firstName: values.firstName, text: values.text };
        if (values.line) body.line = values.line;
        const person = await postJson("/api/join", body);
        personId = person.id;
        saveId(personId);
        startLive();
      } catch (e) {
        showForm(values, e.status === 400 && typeof e.detail === "string"
          ? e.detail
          : "The lines are busy — please try again.");
      }
    }

    // ---------- Live (on air + connected) ----------

    function startLive() {
      stopPolling();
      tick();
      timer = setInterval(tick, POLL_MS);
    }

    async function tick() {
      if (busy) return;
      busy = true;
      const id = personId;
      try {
        const board = await api("/api/board");
        if (id !== personId) return;
        const me = board.people.find((p) => p.id === id);
        if (!me) {
          clearId();
          personId = null;
          showForm();
          return;
        }
        const conn = me.status === "connected" && me.connectionId
          ? board.connections.find((c) => c.id === me.connectionId)
          : null;
        if (conn) {
          const other = board.people.find((p) => conn.personIds.includes(p.id) && p.id !== me.id);
          renderConnected(me, conn, other);
          const msgs = await api("/api/messages?connectionId=" + encodeURIComponent(conn.id));
          if (id !== personId) return;
          renderMessages(msgs, me.id);
        } else {
          renderOnAir(me);
        }
      } catch (e) {
        // keep polling; the next tick may succeed
      } finally {
        busy = false;
      }
    }

    function renderOnAir(me) {
      if (mode === "onair:" + me.line) return;
      mode = "onair:" + me.line;
      el.replaceChildren(
        header(true),
        h("main", { class: "sb-main sb-center" },
          h("div", { class: "sb-lamp", style: "--lamp:" + me.colour, "aria-hidden": "true" }),
          h("p", { class: "sb-big", role: "status" },
            "You're on air on the " + me.line + " line, waiting for a caller…")
        )
      );
      setSheet(true, false);
    }

    function renderConnected(me, conn, other) {
      if (mode === "connected:" + conn.id) return;
      mode = "connected:" + conn.id;
      playRing();

      const log = h("div", { class: "sb-log", role: "log", "aria-live": "polite" });
      const input = h("input", {
        class: "sb-input", type: "text", maxlength: "500", placeholder: "Type a message",
        "aria-label": "Message", autocomplete: "off",
      });
      const chatForm = h("form", { class: "sb-send", onsubmit: async (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        input.value = "";
        try {
          await postJson("/api/messages", { connectionId: conn.id, personId: me.id, text });
          const msgs = await api("/api/messages?connectionId=" + encodeURIComponent(conn.id));
          renderMessages(msgs, me.id);
        } catch (err) {
          input.value = text;
        }
      } }, input, h("button", { type: "submit", class: "sb-btn sb-primary" }, "Send"));

      ui = { log, count: -1 };
      el.replaceChildren(
        header(true),
        h("main", { class: "sb-main sb-chat" },
          h("section", { class: "sb-operator" },
            h("p", { class: "sb-operator-line" }, conn.operatorLine),
            h("p", { class: "sb-caller" },
              h("strong", null, other ? other.firstName : "Someone"),
              other ? " — " + other.text : "")
          ),
          log,
          chatForm
        )
      );
      setSheet(false, true);
    }

    function renderMessages(msgs, myId) {
      if (!ui.log || msgs.length === ui.count) return;
      const log = ui.log;
      const nearBottom = ui.count < 0 || log.scrollHeight - log.scrollTop - log.clientHeight < 60;
      ui.count = msgs.length;
      log.replaceChildren(...msgs.map((m) =>
        h("div", { class: "sb-msg " + (m.personId === myId ? "sb-mine" : "sb-theirs") }, m.text)
      ));
      if (nearBottom) log.scrollTop = log.scrollHeight;
    }

    async function leave() {
      const id = personId;
      stopPolling();
      personId = null;
      clearId();
      ui = {};
      if (id) {
        try { await postJson("/api/leave", { personId: id }); } catch (e) { /* ignore */ }
      }
      showForm();
    }

    // ---------- Start ----------

    const savedId = loadId();
    if (!savedId) {
      showForm();
      return;
    }
    api("/api/board").then((board) => {
      if (board.people.some((p) => p.id === savedId)) {
        personId = savedId;
        startLive();
      } else {
        clearId();
        showForm();
      }
    }).catch(() => showForm());
  }

  window.mountSwitchboardPanel = mountSwitchboardPanel;
})();
