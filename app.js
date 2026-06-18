(function () {
  "use strict";

  let viewedDate = startOfDay(new Date());

  // ---------- Date helpers ----------

  function startOfDay(d) {
    const copy = new Date(d);
    copy.setHours(0, 0, 0, 0);
    return copy;
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  const MAX_TASK_LENGTH = 200;

  function genId() {
    return (crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function getDayKey(date) {
    return `daily:${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function getMonthKey(date) {
    return `monthly:${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
  }

  // Monday-start ISO week. Returns { key, weekStart, weekEnd }
  function getWeekInfo(date) {
    const d = startOfDay(date);
    const dayNum = (d.getDay() + 6) % 7; // 0 = Monday ... 6 = Sunday
    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() - dayNum);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);

    // ISO week number, based on the Thursday of this week
    const thursday = new Date(weekStart);
    thursday.setDate(weekStart.getDate() + 3);

    const tmp = new Date(thursday);
    tmp.setHours(0, 0, 0, 0);
    tmp.setDate(tmp.getDate() + 3 - ((tmp.getDay() + 6) % 7));
    const firstThursday = new Date(tmp.getFullYear(), 0, 4);
    firstThursday.setDate(firstThursday.getDate() - ((firstThursday.getDay() + 6) % 7) + 3);
    const isoWeekNum = 1 + Math.round((tmp - firstThursday) / (7 * 86400000));

    return {
      key: `weekly:${tmp.getFullYear()}-W${pad2(isoWeekNum)}`,
      weekStart,
      weekEnd,
    };
  }

  function formatDateLong(date) {
    return date.toLocaleDateString(undefined, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  function formatDateShort(date) {
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function formatMonthLabel(date) {
    return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }

  function toISODateInput(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  // ---------- Storage ----------

  function loadList(key) {
    let raw;
    try {
      raw = localStorage.getItem(key);
    } catch (e) {
      return [];
    }
    if (!raw) return [];

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return [];
    }
    if (!Array.isArray(parsed)) return [];

    let migrated = false;
    const normalized = parsed
      .filter((item) => item && typeof item === "object" && typeof item.text === "string")
      .map((item) => {
        if (typeof item.id !== "string") migrated = true;
        return {
          id: typeof item.id === "string" ? item.id : genId(),
          text: item.text.slice(0, MAX_TASK_LENGTH),
          done: !!item.done,
        };
      });

    // Persist newly-assigned ids immediately so they stay stable across reads.
    if (migrated) {
      try {
        localStorage.setItem(key, JSON.stringify(normalized));
      } catch (e) {
        // Non-fatal: ids will just be re-assigned next read.
      }
    }

    return normalized;
  }

  function saveList(key, items) {
    try {
      localStorage.setItem(key, JSON.stringify(items));
      hideStorageError();
      return true;
    } catch (e) {
      showStorageError();
      return false;
    }
  }

  function showStorageError() {
    const el = document.getElementById("storageError");
    el.textContent = "Could not save your changes — your browser's storage may be full, disabled, or blocked (e.g. private browsing mode).";
    el.hidden = false;
  }

  function hideStorageError() {
    const el = document.getElementById("storageError");
    el.hidden = true;
  }

  // ---------- Rendering ----------

  function renderList(listEl, key) {
    const items = loadList(key);
    listEl.innerHTML = "";

    if (items.length === 0) {
      const li = document.createElement("li");
      li.className = "empty-msg";
      li.textContent = "Nothing here yet.";
      li.style.borderBottom = "none";
      listEl.appendChild(li);
      return;
    }

    items.forEach((item) => {
      const li = document.createElement("li");
      if (item.done) li.classList.add("done");

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = !!item.done;
      checkbox.setAttribute("aria-label", `Mark "${item.text}" as ${item.done ? "not done" : "done"}`);
      checkbox.addEventListener("change", () => {
        const current = loadList(key);
        const target = current.find((i) => i.id === item.id);
        if (target) target.done = checkbox.checked;
        saveList(key, current);
        renderList(listEl, key);
      });

      const span = document.createElement("span");
      span.textContent = item.text;

      const delBtn = document.createElement("button");
      delBtn.className = "delete-btn";
      delBtn.textContent = "×";
      delBtn.title = "Delete";
      delBtn.setAttribute("aria-label", `Delete "${item.text}"`);
      delBtn.addEventListener("click", () => {
        const current = loadList(key).filter((i) => i.id !== item.id);
        saveList(key, current);
        renderList(listEl, key);
      });

      li.appendChild(checkbox);
      li.appendChild(span);
      li.appendChild(delBtn);
      listEl.appendChild(li);
    });
  }

  function addItem(key, text, listEl) {
    const trimmed = text.trim().slice(0, MAX_TASK_LENGTH);
    if (!trimmed) return;
    const items = loadList(key);
    items.push({ id: genId(), text: trimmed, done: false });
    saveList(key, items);
    renderList(listEl, key);
  }

  // ---------- Main render ----------

  function render() {
    const dayKey = getDayKey(viewedDate);
    const monthKey = getMonthKey(viewedDate);
    const { key: weekKey, weekStart, weekEnd } = getWeekInfo(viewedDate);

    document.getElementById("currentDateLabel").textContent = formatDateLong(viewedDate);
    document.getElementById("datePicker").value = toISODateInput(viewedDate);

    document.getElementById("dailyTitle").textContent = `Daily — ${formatDateShort(viewedDate)}`;
    document.getElementById("weeklyTitle").textContent = `Weekly — ${formatDateShort(weekStart)} to ${formatDateShort(weekEnd)}`;
    document.getElementById("monthlyTitle").textContent = `Monthly — ${formatMonthLabel(viewedDate)}`;

    renderList(document.getElementById("dailyList"), dayKey);
    renderList(document.getElementById("weeklyList"), weekKey);
    renderList(document.getElementById("monthlyList"), monthKey);

    setupForm("dailyForm", "dailyInput", dayKey, "dailyList");
    setupForm("weeklyForm", "weeklyInput", weekKey, "weeklyList");
    setupForm("monthlyForm", "monthlyInput", monthKey, "monthlyList");
  }

  function setupForm(formId, inputId, key, listId) {
    const form = document.getElementById(formId);
    const input = document.getElementById(inputId);
    const listEl = document.getElementById(listId);

    // Replace form to clear old listeners (since key changes on navigation)
    const newForm = form.cloneNode(true);
    form.parentNode.replaceChild(newForm, form);
    const newInput = newForm.querySelector("input");

    newForm.addEventListener("submit", (e) => {
      e.preventDefault();
      addItem(key, newInput.value, listEl);
      newInput.value = "";
      newInput.focus();
    });
  }

  // ---------- Navigation ----------

  document.getElementById("prevDay").addEventListener("click", () => {
    viewedDate.setDate(viewedDate.getDate() - 1);
    viewedDate = startOfDay(viewedDate);
    render();
  });

  document.getElementById("nextDay").addEventListener("click", () => {
    viewedDate.setDate(viewedDate.getDate() + 1);
    viewedDate = startOfDay(viewedDate);
    render();
  });

  document.getElementById("todayBtn").addEventListener("click", () => {
    viewedDate = startOfDay(new Date());
    render();
  });

  document.getElementById("datePicker").addEventListener("change", (e) => {
    if (!e.target.value) return;
    const [y, m, d] = e.target.value.split("-").map(Number);
    viewedDate = startOfDay(new Date(y, m - 1, d));
    render();
  });

  render();
})();
