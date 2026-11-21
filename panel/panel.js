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
    if (!res.ok) throw new Error("HTTP " + res.status);
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

  function mountSwitchboardPanel(el) {
    el.classList.add("sb-panel");

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

    function header(withLeave) {
      return h("header", { class: "sb-header" },
        h("span", { class: "sb-brand" }, "SWITCHBOARD"),
        withLeave ? h("button", { type: "button", class: "sb-btn sb-leave", onclick: leave }, "Leave") : null
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
        h("button", { type: "submit", class: "sb-btn sb-primary" }, "Go on air")
      );

      el.replaceChildren(header(false), h("main", { class: "sb-main" }, form));
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
        showForm(values, "The lines are busy — please try again.");
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
    }

    function renderConnected(me, conn, other) {
      if (mode === "connected:" + conn.id) return;
      mode = "connected:" + conn.id;

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
