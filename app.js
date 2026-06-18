(function () {
  "use strict";

  const SUPABASE_URL = "https://gvsmwgyzamewmonnnfzj.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_RVYELJSBGrI4sjtN76Z4Ow_gDlzACvi";

  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  let viewedDate = startOfDay(new Date());
  let currentUser = null;
  let renderGeneration = 0;

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

  // ---------- Storage error banner ----------

  function showStorageError(message) {
    const el = document.getElementById("storageError");
    el.textContent = message || "Could not sync your changes — check your internet connection and try again.";
    el.hidden = false;
  }

  function hideStorageError() {
    document.getElementById("storageError").hidden = true;
  }

  function showFileError(message) {
    const el = document.getElementById("fileError");
    el.textContent = message;
    el.hidden = false;
  }

  function hideFileError() {
    document.getElementById("fileError").hidden = true;
  }

  // ---------- Data layer (Supabase) ----------

  async function loadList(key) {
    const { data, error } = await supabase
      .from("todos")
      .select("id, text, done")
      .eq("user_id", currentUser.id)
      .eq("list_key", key)
      .order("created_at", { ascending: true });

    if (error) {
      showStorageError();
      return [];
    }
    hideStorageError();
    return data;
  }

  async function addItem(key, text, listEl) {
    const trimmed = text.trim().slice(0, MAX_TASK_LENGTH);
    if (!trimmed) return;

    const { error } = await supabase
      .from("todos")
      .insert({ user_id: currentUser.id, list_key: key, text: trimmed, done: false });

    if (error) {
      showStorageError();
      return;
    }
    hideStorageError();
    await renderList(listEl, key, renderGeneration);
  }

  async function toggleItem(id, done, listEl, key) {
    const { error } = await supabase
      .from("todos")
      .update({ done })
      .eq("id", id)
      .eq("user_id", currentUser.id);
    if (error) {
      showStorageError();
      return;
    }
    hideStorageError();
    await renderList(listEl, key, renderGeneration);
  }

  async function deleteItem(id, listEl, key) {
    const { error } = await supabase
      .from("todos")
      .delete()
      .eq("id", id)
      .eq("user_id", currentUser.id);
    if (error) {
      showStorageError();
      return;
    }
    hideStorageError();
    await renderList(listEl, key, renderGeneration);
  }

  async function editItemText(id, text, listEl, key) {
    const trimmed = text.trim().slice(0, MAX_TASK_LENGTH);
    if (!trimmed) return false;

    const { error } = await supabase
      .from("todos")
      .update({ text: trimmed })
      .eq("id", id)
      .eq("user_id", currentUser.id);
    if (error) {
      showStorageError();
      return false;
    }
    hideStorageError();
    await renderList(listEl, key, renderGeneration);
    return true;
  }

  // ---------- Export / Import backup ----------

  async function collectAllData() {
    const { data, error } = await supabase
      .from("todos")
      .select("list_key, text, done")
      .eq("user_id", currentUser.id);

    const grouped = { _meta: { exportedAt: new Date().toISOString(), version: 1 } };
    if (error) return grouped;

    data.forEach((row) => {
      if (!grouped[row.list_key]) grouped[row.list_key] = [];
      grouped[row.list_key].push({ text: row.text, done: row.done });
    });
    return grouped;
  }

  async function applyImportedData(data) {
    if (!data || typeof data !== "object") {
      showFileError("That file doesn't look like a valid backup.");
      return;
    }

    const rows = [];
    Object.keys(data).forEach((key) => {
      if (key === "_meta") return;
      if (!/^(daily|weekly|monthly):/.test(key)) return;
      if (!Array.isArray(data[key])) return;
      data[key].forEach((item) => {
        if (item && typeof item.text === "string") {
          rows.push({
            user_id: currentUser.id,
            list_key: key,
            text: item.text.slice(0, MAX_TASK_LENGTH),
            done: !!item.done,
          });
        }
      });
    });

    if (rows.length === 0) {
      showFileError("That file doesn't contain any importable tasks.");
      return;
    }

    const { error } = await supabase.from("todos").insert(rows);
    if (error) {
      showFileError("Could not import — check your internet connection and try again.");
      return;
    }
    hideFileError();
    await render();
  }

  async function exportToFile() {
    const data = await collectAllData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "planner-backup.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function importFromFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        applyImportedData(JSON.parse(reader.result));
      } catch (e) {
        showFileError("That file isn't valid JSON.");
      }
    };
    reader.onerror = () => showFileError("Could not read that file.");
    reader.readAsText(file);
  }

  // ---------- Rendering ----------

  async function renderList(listEl, key, generation) {
    listEl.innerHTML = "";
    const loadingLi = document.createElement("li");
    loadingLi.className = "empty-msg";
    loadingLi.textContent = "Loading…";
    loadingLi.style.borderBottom = "none";
    listEl.appendChild(loadingLi);

    const items = await loadList(key);
    if (generation !== renderGeneration) return; // a newer render has since started; discard this stale result
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
        toggleItem(item.id, checkbox.checked, listEl, key);
      });

      const span = document.createElement("span");
      span.textContent = item.text;
      span.tabIndex = 0;
      span.title = "Click to edit";
      span.setAttribute("role", "button");
      span.setAttribute("aria-label", `Edit "${item.text}"`);

      function startEdit() {
        const input = document.createElement("input");
        input.type = "text";
        input.value = item.text;
        input.maxLength = MAX_TASK_LENGTH;
        input.className = "edit-input";

        let settled = false;

        const finish = async (shouldSave) => {
          if (settled) return;
          settled = true;
          if (shouldSave && input.value.trim() !== item.text) {
            const ok = await editItemText(item.id, input.value, listEl, key);
            if (ok) return; // renderList already rebuilt the list
          }
          // No change, empty input, or save failed: just restore the span.
          input.replaceWith(span);
        };

        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") finish(true);
          if (e.key === "Escape") finish(false);
        });
        input.addEventListener("blur", () => finish(true));

        span.replaceWith(input);
        input.focus();
        input.select();
      }

      span.addEventListener("click", startEdit);
      span.addEventListener("keydown", (e) => {
        if (e.key === "Enter") startEdit();
      });

      const delBtn = document.createElement("button");
      delBtn.className = "delete-btn";
      delBtn.textContent = "×";
      delBtn.title = "Delete";
      delBtn.setAttribute("aria-label", `Delete "${item.text}"`);
      delBtn.addEventListener("click", () => {
        deleteItem(item.id, listEl, key);
      });

      li.appendChild(checkbox);
      li.appendChild(span);
      li.appendChild(delBtn);
      listEl.appendChild(li);
    });
  }

  // ---------- Main render ----------

  async function render() {
    const generation = ++renderGeneration;

    const dayKey = getDayKey(viewedDate);
    const monthKey = getMonthKey(viewedDate);
    const { key: weekKey, weekStart, weekEnd } = getWeekInfo(viewedDate);

    document.getElementById("currentDateLabel").textContent = formatDateLong(viewedDate);
    document.getElementById("datePicker").value = toISODateInput(viewedDate);

    document.getElementById("dailyTitle").textContent = `Daily — ${formatDateShort(viewedDate)}`;
    document.getElementById("weeklyTitle").textContent = `Weekly — ${formatDateShort(weekStart)} to ${formatDateShort(weekEnd)}`;
    document.getElementById("monthlyTitle").textContent = `Monthly — ${formatMonthLabel(viewedDate)}`;

    setupForm("dailyForm", "dailyInput", dayKey, "dailyList");
    setupForm("weeklyForm", "weeklyInput", weekKey, "weeklyList");
    setupForm("monthlyForm", "monthlyInput", monthKey, "monthlyList");

    await Promise.all([
      renderList(document.getElementById("dailyList"), dayKey, generation),
      renderList(document.getElementById("weeklyList"), weekKey, generation),
      renderList(document.getElementById("monthlyList"), monthKey, generation),
    ]);
  }

  function setupForm(formId, inputId, key, listId) {
    const form = document.getElementById(formId);
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

  // ---------- Backup controls ----------

  document.getElementById("exportBtn").addEventListener("click", exportToFile);

  document.getElementById("importBtn").addEventListener("click", () => {
    document.getElementById("importInput").click();
  });

  document.getElementById("importInput").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) importFromFile(file);
    e.target.value = "";
  });

  // ---------- Auth ----------

  function showAuthMessage(text) {
    const el = document.getElementById("authMessage");
    el.textContent = text;
    el.hidden = false;
  }

  function hideAuthMessage() {
    document.getElementById("authMessage").hidden = true;
  }

  function setLoggedInUI(user) {
    document.getElementById("authPanel").hidden = true;
    document.getElementById("panels").hidden = false;
    document.getElementById("backupControls").hidden = false;
    const emailEl = document.getElementById("userEmail");
    emailEl.textContent = user.email;
    emailEl.hidden = false;
    document.getElementById("logoutBtn").hidden = false;
  }

  function setLoggedOutUI() {
    document.getElementById("authPanel").hidden = false;
    document.getElementById("panels").hidden = true;
    document.getElementById("backupControls").hidden = true;
    document.getElementById("userEmail").hidden = true;
    document.getElementById("logoutBtn").hidden = true;
  }

  supabase.auth.onAuthStateChange((_event, session) => {
    currentUser = session ? session.user : null;
    if (currentUser) {
      setLoggedInUI(currentUser);
      render();
    } else {
      setLoggedOutUI();
    }
  });

  document.getElementById("authForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    hideAuthMessage();
    const email = document.getElementById("authEmail").value.trim();
    const password = document.getElementById("authPassword").value;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) showAuthMessage(error.message);
  });

  document.getElementById("signupBtn").addEventListener("click", async () => {
    hideAuthMessage();
    const email = document.getElementById("authEmail").value.trim();
    const password = document.getElementById("authPassword").value;
    if (!email || password.length < 6) {
      showAuthMessage("Enter an email and a password with at least 6 characters.");
      return;
    }
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) {
      showAuthMessage(error.message);
    } else {
      showAuthMessage("Check your email to confirm your account, then log in.");
    }
  });

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await supabase.auth.signOut();
  });
})();
