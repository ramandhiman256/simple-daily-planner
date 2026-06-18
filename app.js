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
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveList(key, items) {
    localStorage.setItem(key, JSON.stringify(items));
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

    items.forEach((item, index) => {
      const li = document.createElement("li");
      if (item.done) li.classList.add("done");

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = !!item.done;
      checkbox.addEventListener("change", () => {
        const current = loadList(key);
        current[index].done = checkbox.checked;
        saveList(key, current);
        renderList(listEl, key);
      });

      const span = document.createElement("span");
      span.textContent = item.text;

      const delBtn = document.createElement("button");
      delBtn.className = "delete-btn";
      delBtn.textContent = "×";
      delBtn.title = "Delete";
      delBtn.addEventListener("click", () => {
        const current = loadList(key);
        current.splice(index, 1);
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
    const trimmed = text.trim();
    if (!trimmed) return;
    const items = loadList(key);
    items.push({ text: trimmed, done: false });
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
    render();
  });

  document.getElementById("nextDay").addEventListener("click", () => {
    viewedDate.setDate(viewedDate.getDate() + 1);
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
