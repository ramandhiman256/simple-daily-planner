(function () {
  "use strict";

  const SUPABASE_URL = "https://gvsmwgyzamewmonnnfzj.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_RVYELJSBGrI4sjtN76Z4Ow_gDlzACvi";

  if (typeof window.supabase === "undefined") {
    const authPanel = document.getElementById("authPanel");
    authPanel.hidden = false;
    const msg = document.createElement("p");
    msg.className = "auth-message";
    msg.style.color = "#e0566f";
    msg.textContent =
      "Could not load a required script. This page may be blocked by an ad blocker, content blocker, or firewall on this network/browser — please try a different network or disabling any blockers, then reload.";
    authPanel.querySelector(".auth-card").appendChild(msg);
    return;
  }

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

  const CATEGORIES = ["work", "household", "misc"];

  function isCurrentPeriod(key) {
    const prefix = key.split(":")[0];
    const now = new Date();
    if (prefix === "daily") return key === getDayKey(now);
    if (prefix === "weekly") return key === getWeekInfo(now).key;
    if (prefix === "monthly") return key === getMonthKey(now);
    return false;
  }

  async function loadList(key) {
    const baseSelect = "id, text, done, category, priority, created_at, list_key";

    if (!isCurrentPeriod(key)) {
      const { data, error } = await supabase
        .from("todos")
        .select(baseSelect)
        .eq("user_id", currentUser.id)
        .eq("list_key", key)
        .order("created_at", { ascending: true });

      if (error) {
        showStorageError();
        return [];
      }
      hideStorageError();
      return data.map((row) => ({ ...row, carried: false }));
    }

    const prefix = key.split(":")[0];
    const [ownResult, carryResult] = await Promise.all([
      supabase
        .from("todos")
        .select(baseSelect)
        .eq("user_id", currentUser.id)
        .eq("list_key", key),
      supabase
        .from("todos")
        .select(baseSelect)
        .eq("user_id", currentUser.id)
        .like("list_key", `${prefix}:%`)
        .lt("list_key", key)
        .eq("done", false),
    ]);

    if (ownResult.error || carryResult.error) {
      showStorageError();
      return [];
    }
    hideStorageError();

    const merged = [
      ...ownResult.data.map((row) => ({ ...row, carried: false })),
      ...carryResult.data.map((row) => ({ ...row, carried: true })),
    ];
    merged.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    return merged;
  }

  function formatCarryBadge(item) {
    const prefix = item.list_key.split(":")[0];
    if (prefix === "daily") {
      const [, dateStr] = item.list_key.split(":");
      const [y, m, d] = dateStr.split("-").map(Number);
      const orig = new Date(y, m - 1, d);
      const days = Math.round((startOfDay(new Date()) - orig) / 86400000);
      return `Carried forward · ${days} day${days === 1 ? "" : "s"} late`;
    }
    return "Carried forward";
  }

  async function addItem(key, text, category) {
    const trimmed = text.trim().slice(0, MAX_TASK_LENGTH);
    if (!trimmed) return;

    const { error } = await supabase
      .from("todos")
      .insert({ user_id: currentUser.id, list_key: key, text: trimmed, done: false, category: category || null });

    if (error) {
      showStorageError();
      return;
    }
    hideStorageError();
    await refreshList(key);
  }

  async function toggleItem(id, done, key) {
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
    await refreshList(key);
  }

  async function togglePriority(id, priority, key) {
    const { error } = await supabase
      .from("todos")
      .update({ priority })
      .eq("id", id)
      .eq("user_id", currentUser.id);
    if (error) {
      showStorageError();
      return;
    }
    hideStorageError();
    await refreshList(key);
  }

  async function deleteItem(id, key) {
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
    await refreshList(key);
  }

  async function editItemText(id, text, key) {
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
    await refreshList(key);
    return true;
  }

  // ---------- Export / Import backup ----------

  async function collectAllData() {
    const { data, error } = await supabase
      .from("todos")
      .select("list_key, text, done, category, priority")
      .eq("user_id", currentUser.id);

    const grouped = { _meta: { exportedAt: new Date().toISOString(), version: 1 } };
    if (error) return grouped;

    data.forEach((row) => {
      if (!grouped[row.list_key]) grouped[row.list_key] = [];
      grouped[row.list_key].push({ text: row.text, done: row.done, category: row.category, priority: row.priority });
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
            category: CATEGORIES.includes(item.category) ? item.category : null,
            priority: !!item.priority,
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

  function showLoadingPlaceholder(listEl) {
    listEl.innerHTML = "";
    const loadingLi = document.createElement("li");
    loadingLi.className = "empty-msg";
    loadingLi.textContent = "Loading…";
    loadingLi.style.borderBottom = "none";
    listEl.appendChild(loadingLi);
  }

  function buildItemRow(item, key) {
    const li = document.createElement("li");
    if (item.done) li.classList.add("done");
    if (item.priority) li.classList.add("priority");
    if (item.carried) li.classList.add("carried");

    const starBtn = document.createElement("button");
    starBtn.className = "star-btn" + (item.priority ? " active" : "");
    starBtn.textContent = item.priority ? "★" : "☆";
    const starLabel = item.priority ? `Remove high priority from "${item.text}"` : `Mark "${item.text}" as high priority`;
    starBtn.title = starLabel;
    starBtn.setAttribute("aria-label", starLabel);
    starBtn.addEventListener("click", () => {
      togglePriority(item.id, !item.priority, key);
    });

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = !!item.done;
    checkbox.setAttribute("aria-label", `Mark "${item.text}" as ${item.done ? "not done" : "done"}`);
    checkbox.addEventListener("change", () => {
      toggleItem(item.id, checkbox.checked, key);
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
          const ok = await editItemText(item.id, input.value, key);
          if (ok) return; // refreshList already rebuilt the list
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

    const textWrap = document.createElement("div");
    textWrap.className = "task-text-wrap";
    textWrap.appendChild(span);
    if (item.carried) {
      const badge = document.createElement("span");
      badge.className = "carry-badge";
      badge.textContent = formatCarryBadge(item);
      textWrap.appendChild(badge);
    }

    const delBtn = document.createElement("button");
    delBtn.className = "delete-btn";
    delBtn.textContent = "×";
    delBtn.title = "Delete";
    delBtn.setAttribute("aria-label", `Delete "${item.text}"`);
    delBtn.addEventListener("click", () => {
      deleteItem(item.id, key);
    });

    li.appendChild(starBtn);
    li.appendChild(checkbox);
    li.appendChild(textWrap);
    li.appendChild(delBtn);
    return li;
  }

  function populateListItems(listEl, items, key) {
    listEl.innerHTML = "";
    if (items.length === 0) {
      const li = document.createElement("li");
      li.className = "empty-msg";
      li.textContent = "Nothing here yet.";
      li.style.borderBottom = "none";
      listEl.appendChild(li);
      return;
    }
    items.forEach((item) => listEl.appendChild(buildItemRow(item, key)));
  }

  async function renderList(listEl, key, generation) {
    showLoadingPlaceholder(listEl);
    const items = await loadList(key);
    if (generation !== renderGeneration) return; // a newer render has since started; discard this stale result
    populateListItems(listEl, items, key);
  }

  function dailyListElements() {
    return {
      work: document.getElementById("dailyListWork"),
      household: document.getElementById("dailyListHousehold"),
      misc: document.getElementById("dailyListMisc"),
    };
  }

  async function renderDailyLists(key, generation) {
    const listEls = dailyListElements();
    Object.values(listEls).forEach(showLoadingPlaceholder);

    const items = await loadList(key);
    if (generation !== renderGeneration) return;

    const grouped = { work: [], household: [], misc: [] };
    items.forEach((item) => {
      const cat = CATEGORIES.includes(item.category) ? item.category : "misc";
      grouped[cat].push(item);
    });

    CATEGORIES.forEach((cat) => populateListItems(listEls[cat], grouped[cat], key));
  }

  async function refreshList(key) {
    if (key.startsWith("daily:")) {
      await renderDailyLists(key, renderGeneration);
    } else {
      const listEl = key.startsWith("weekly:")
        ? document.getElementById("weeklyList")
        : document.getElementById("monthlyList");
      await renderList(listEl, key, renderGeneration);
    }
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

    setupForm("dailyForm", "dailyInput", dayKey, true);
    setupForm("weeklyForm", "weeklyInput", weekKey, false);
    setupForm("monthlyForm", "monthlyInput", monthKey, false);

    await Promise.all([
      renderDailyLists(dayKey, generation),
      renderList(document.getElementById("weeklyList"), weekKey, generation),
      renderList(document.getElementById("monthlyList"), monthKey, generation),
    ]);
  }

  function setupForm(formId, inputId, key, hasCategory) {
    const form = document.getElementById(formId);

    // Replace form to clear old listeners (since key changes on navigation)
    const newForm = form.cloneNode(true);
    form.parentNode.replaceChild(newForm, form);
    const newInput = newForm.querySelector("input");
    const categorySelect = hasCategory ? newForm.querySelector("select") : null;

    newForm.addEventListener("submit", (e) => {
      e.preventDefault();
      addItem(key, newInput.value, categorySelect ? categorySelect.value : null);
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

  function friendlyErrorMessage(error) {
    if (error && typeof error.message === "string" && error.message.trim() && error.message.trim() !== "{}") {
      return error.message;
    }
    return "Something went wrong on our end. Please try again in a moment.";
  }

  function hideAuthMessage() {
    document.getElementById("authMessage").hidden = true;
  }

  function closeAccountMenu() {
    document.getElementById("accountDropdown").classList.remove("open");
    document.getElementById("accountMenuBtn").setAttribute("aria-expanded", "false");
  }

  function setLoggedInUI(user) {
    document.getElementById("authPanel").hidden = true;
    document.getElementById("topbar").hidden = false;
    document.getElementById("panels").hidden = false;
    document.getElementById("backupControls").hidden = false;
    document.getElementById("disclaimerFooter").hidden = false;
    const emailEl = document.getElementById("userEmail");
    emailEl.textContent = user.email;
    emailEl.hidden = false;
    document.getElementById("logoutBtn").hidden = false;
    document.getElementById("accountMenuBtn").hidden = false;
  }

  function setLoggedOutUI() {
    document.getElementById("authPanel").hidden = false;
    document.getElementById("topbar").hidden = true;
    document.getElementById("panels").hidden = true;
    document.getElementById("backupControls").hidden = true;
    document.getElementById("disclaimerFooter").hidden = true;
    document.getElementById("userEmail").hidden = true;
    document.getElementById("logoutBtn").hidden = true;
    document.getElementById("accountMenuBtn").hidden = true;
    closeAccountMenu();
  }

  document.getElementById("accountMenuBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    const dropdown = document.getElementById("accountDropdown");
    const isOpen = dropdown.classList.toggle("open");
    document.getElementById("accountMenuBtn").setAttribute("aria-expanded", String(isOpen));
  });

  document.addEventListener("click", (e) => {
    const menu = document.getElementById("accountMenu");
    if (!menu.contains(e.target)) closeAccountMenu();
  });

  supabase.auth.onAuthStateChange((_event, session) => {
    currentUser = session ? session.user : null;
    if (currentUser) {
      setLoggedInUI(currentUser);
      render();
    } else {
      setLoggedOutUI();
    }
  });

  function withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise((resolve) =>
        setTimeout(
          () => resolve({ error: { message: "This is taking too long — check your internet connection (or try a different network/browser) and try again." } }),
          ms
        )
      ),
    ]);
  }

  function setAuthButtonsBusy(busy) {
    const loginBtn = document.getElementById("loginBtn");
    const signupBtn = document.getElementById("signupBtn");
    loginBtn.disabled = busy;
    signupBtn.disabled = busy;
    loginBtn.textContent = busy ? "Logging in…" : "Log in";
    signupBtn.textContent = busy ? "Signing up…" : "Sign up";
  }

  document.getElementById("authForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    hideAuthMessage();
    const email = document.getElementById("authEmail").value.trim();
    const password = document.getElementById("authPassword").value;
    setAuthButtonsBusy(true);
    const { error } = await withTimeout(supabase.auth.signInWithPassword({ email, password }), 15000);
    setAuthButtonsBusy(false);
    if (error) showAuthMessage(friendlyErrorMessage(error));
  });

  document.getElementById("signupBtn").addEventListener("click", async () => {
    hideAuthMessage();
    const email = document.getElementById("authEmail").value.trim();
    const password = document.getElementById("authPassword").value;
    if (!email || password.length < 6) {
      showAuthMessage("Enter an email and a password with at least 6 characters.");
      return;
    }
    setAuthButtonsBusy(true);
    const { data, error } = await withTimeout(supabase.auth.signUp({ email, password }), 15000);
    setAuthButtonsBusy(false);
    if (error) {
      showAuthMessage(friendlyErrorMessage(error));
    } else if (!data.session) {
      // Email confirmation is required and no session was returned yet.
      showAuthMessage("Check your email to confirm your account, then log in.");
    }
    // If data.session exists, email confirmation is off and the user is
    // already signed in — onAuthStateChange will switch to the planner UI.
  });

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await supabase.auth.signOut();
  });
})();
