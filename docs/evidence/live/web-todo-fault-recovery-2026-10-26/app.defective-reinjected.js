(function () {
  "use strict";

  var STORAGE_KEY = "todo-app.v1";
  var FILTERS = ["all", "active", "done"];
  var idCounter = 0;

  var els = {
    form: document.getElementById("new-todo-form"),
    input: document.getElementById("new-todo"),
    list: document.getElementById("todo-list"),
    filters: document.getElementById("filters"),
    counter: document.getElementById("counter")
  };

  // ---- ids -------------------------------------------------------------

  function newId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    idCounter += 1;
    return Date.now().toString(36) + "-" + idCounter;
  }

  // ---- storage (section 4 of the architecture) --------------------------

  function defaults() {
    return { todos: [], filter: "all" };
  }

  function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  // Turns any parsed payload into a valid state. Structurally invalid payloads
  // become defaults; otherwise invalid items are dropped and bad ids replaced.
  function normalize(parsed) {
    if (!isPlainObject(parsed) || !Array.isArray(parsed.todos)) {
      return defaults();
    }
    var seen = Object.create(null);
    var todos = [];
    parsed.todos.forEach(function (item) {
      if (!isPlainObject(item)) return;
      if (typeof item.text !== "string") return;
      var text = item.text.trim();
      if (text === "") return;
      if (typeof item.done !== "boolean") return;
      var id = typeof item.id === "string" && item.id !== "" ? item.id : null;
      if (id === null || seen[id] === true) {
        id = newId();
        while (seen[id] === true) id = newId();
      }
      seen[id] = true;
      todos.push({ id: id, text: text, done: item.done });
    });
    var filter = FILTERS.indexOf(parsed.filter) !== -1 ? parsed.filter : "all";
    return { todos: todos, filter: filter };
  }

  function serialize(state) {
    return JSON.stringify({ version: 1, todos: state.todos, filter: state.filter });
  }

  function persist(state) {
    try {
      window.localStorage.setItem(STORAGE_KEY, serialize(state));
    } catch (e) {
      // Quota or privacy mode: keep working in memory, no console output.
    }
  }

  function load() {
    var raw;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      return defaults();
    }
    if (raw === null) return defaults();

    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      parsed = undefined;
    }
    var state = normalize(parsed);
    // If anything was repaired, store the normalized state so storage is valid again.
    if (serialize(state) !== raw) persist(state);
    return state;
  }

  // ---- state -----------------------------------------------------------

  var state = load();

  function commit() {
    persist(state);
    render();
  }

  function add(raw) {
    var text = String(raw).trim();
    if (text === "") return;
    state.todos.push({ id: newId(), text: text, done: false });
    els.input.value = "";
    commit();
    els.input.focus();
  }

  function toggle(id) {
    state.todos.forEach(function (t) {
      if (t.id === id) t.done = !t.done;
    });
    commit();
  }

  function remove(id) {
    state.todos = state.todos.filter(function (t) {
      return t.id !== id;
    });
    commit();
  }

  function setFilter(f) {
    if (FILTERS.indexOf(f) === -1) return;
    state.filter = f;
    commit();
  }

  // ---- rendering -------------------------------------------------------

  function visibleTodos() {
    return state.todos.filter(function (t) {
      if (state.filter === "active") return !t.done;
      if (state.filter === "done") return t.done;
      return true;
    });
  }

  function render() {
    while (els.list.firstChild) els.list.removeChild(els.list.firstChild);

    var frag = document.createDocumentFragment();
    visibleTodos().forEach(function (t) {
      var li = document.createElement("li");
      li.className = t.done ? "todo-item done" : "todo-item";
      li.setAttribute("data-id", t.id);

      var checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "toggle";
      checkbox.checked = t.done;
      checkbox.setAttribute("aria-label", "Mark " + t.text + " done");

      var text = document.createElement("span");
      text.className = "todo-text";
      text.textContent = t.text;

      var del = document.createElement("button");
      del.type = "button";
      del.className = "delete";
      del.setAttribute("aria-label", "Delete " + t.text);
      del.textContent = "×";

      // 44x44 hit area: the visible 1.75rem checkbox is centred in a padded label,
      // so clicking anywhere in the label toggles it (native label activation).
      var hit = document.createElement("label");
      hit.className = "toggle-hit";
      hit.appendChild(checkbox);

      li.appendChild(hit);
      li.appendChild(text);
      li.appendChild(del);
      frag.appendChild(li);
    });
    els.list.appendChild(frag);

    var buttons = els.filters.querySelectorAll("[data-filter]");
    Array.prototype.forEach.call(buttons, function (btn) {
      var pressed = btn.getAttribute("data-filter") === state.filter;
      btn.setAttribute("aria-pressed", pressed ? "true" : "false");
    });

    var active = state.todos.filter(function (t) {
      return !t.done;
    }).length;
    els.counter.textContent = active === 1 ? "1 item left" : active + " items left";
  }

  // ---- events (delegated) ----------------------------------------------

  els.form.addEventListener("submit", function (e) {
    e.preventDefault();
    add(els.input.value);
  });

  els.list.addEventListener("change", function (e) {
    var target = e.target;
    if (!target.matches || !target.matches("input.toggle")) return;
    var li = target.closest("li.todo-item");
    if (li) toggle(li.getAttribute("data-id"));
  });

  els.list.addEventListener("click", function (e) {
    var btn = e.target.closest ? e.target.closest("button.delete") : null;
    if (!btn) return;
    var li = btn.closest("li.todo-item");
    if (li) remove(null);
  });

  els.filters.addEventListener("click", function (e) {
    var btn = e.target.closest ? e.target.closest("[data-filter]") : null;
    if (!btn) return;
    setFilter(btn.getAttribute("data-filter"));
  });

  render();
})();
