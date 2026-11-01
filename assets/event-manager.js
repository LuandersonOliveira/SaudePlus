/* global HTMLElement */
(() => {
  "use strict";

  const defaultColors = [
    { name: "Blue", value: "blue", color: "#2563eb" },
    { name: "Green", value: "green", color: "#16a34a" },
    { name: "Purple", value: "purple", color: "#9333ea" },
    { name: "Orange", value: "orange", color: "#ea580c" },
    { name: "Pink", value: "pink", color: "#db2777" },
    { name: "Red", value: "red", color: "#dc2626" },
  ];

  function uid() { return Math.random().toString(36).slice(2, 11); }
  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function toDate(v) { return v instanceof Date ? new Date(v) : new Date(v); }
  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }
  function formatTime(d) {
    return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  }
  function toLocalInput(d) {
    if (!d) return "";
    const x = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return x.toISOString().slice(0, 16);
  }

  function EventManager(container, options) {
    if (!(container instanceof HTMLElement)) throw new Error("EventManager container must be an HTMLElement");
    options = options || {};
    const colors = Array.isArray(options.colors) && options.colors.length ? options.colors : defaultColors;
    const categories = Array.isArray(options.categories) && options.categories.length ? options.categories : ["Meeting", "Task", "Reminder", "Personal"];
    const availableTags = Array.isArray(options.availableTags) ? options.availableTags : ["Important", "Urgent", "Work", "Personal", "Team", "Client"];
    const state = {
      events: Array.isArray(options.events) ? options.events.map((e) => ({
        id: e.id || uid(),
        title: e.title || "",
        description: e.description || "",
        startTime: toDate(e.startTime),
        endTime: toDate(e.endTime),
        color: e.color || colors[0].value,
        category: e.category || categories[0],
        attendees: Array.isArray(e.attendees) ? e.attendees.slice() : [],
        tags: Array.isArray(e.tags) ? e.tags.slice() : [],
      })) : [],
      currentDate: new Date(),
      view: ["month", "week", "day", "list"].includes(options.defaultView) ? options.defaultView : "month",
      filters: { query: "", colors: [], tags: [], categories: [] },
      selectedEvent: null,
      isCreating: false,
      isDialogOpen: false,
      newEvent: { title: "", description: "", color: colors[0].value, category: categories[0], tags: [] },
    };

    this.container = container;
    this.options = Object.assign({ colors, categories, availableTags, onEventCreate: options.onEventCreate, onEventUpdate: options.onEventUpdate, onEventDelete: options.onEventDelete }, options);
    this.colors = colors;
    this.categories = categories;
    this.availableTags = availableTags;
    this.state = state;
    this.instanceId = "em-" + uid();

    this.colorValue = (value) => {
      const found = this.colors.find((c) => c.value === value);
      return found ? found.color : "#64748b";
    };

    this.filteredEvents = () => {
      const f = state.filters;
      const query = f.query.trim().toLowerCase();
      return state.events.filter((event) => {
        if (query) {
          const matches = event.title.toLowerCase().includes(query)
            || (event.description || "").toLowerCase().includes(query)
            || (event.category || "").toLowerCase().includes(query)
            || (event.tags || []).some((tag) => tag.toLowerCase().includes(query));
          if (!matches) return false;
        }
        if (f.colors.length && !f.colors.includes(event.color)) return false;
        if (f.tags.length && !(event.tags || []).some((tag) => f.tags.includes(tag))) return false;
        if (f.categories.length && event.category && !f.categories.includes(event.category)) return false;
        return true;
      });
    };

    this.mount = function () {
      container.classList.add("event-manager");
      container.innerHTML = `
        <header class="event-manager-header">
          <h2 class="event-manager-title" data-em-title></h2>
          <div class="event-manager-toolbar">
            <div class="event-manager-nav">
              <button type="button" class="btn btn-outline btn-sm" data-em-prev>&#8249;</button>
              <button type="button" class="btn btn-outline btn-sm" data-em-today>Today</button>
              <button type="button" class="btn btn-outline btn-sm" data-em-next>&#8250;</button>
            </div>
            <div class="event-manager-view-group" role="tablist" aria-label="Calendar views">
              <button type="button" data-em-view="month">Month</button>
              <button type="button" data-em-view="week">Week</button>
              <button type="button" data-em-view="day">Day</button>
              <button type="button" data-em-view="list">List</button>
            </div>
            <button type="button" class="btn btn-primary btn-sm" data-em-create>New Event</button>
          </div>
          <div class="event-manager-filters">
            <input type="search" class="input" data-em-search placeholder="Search events..." />
            <div class="event-manager-filter-group" data-em-colors></div>
            <div class="event-manager-filter-group" data-em-tags></div>
            <div class="event-manager-filter-group" data-em-categories></div>
            <button type="button" class="btn btn-outline btn-sm" data-em-clear>Clear</button>
          </div>
        </header>
        <main data-em-content></main>
        <div class="event-manager-modal-backdrop" data-em-backdrop>
          <div class="event-manager-modal" role="dialog" aria-modal="true" aria-label="Event form" data-em-modal></div>
        </div>
      `;

      this.cache = {
        title: container.querySelector("[data-em-title]"),
        prev: container.querySelector("[data-em-prev]"),
        next: container.querySelector("[data-em-next]"),
        today: container.querySelector("[data-em-today]"),
        search: container.querySelector("[data-em-search]"),
        colors: container.querySelector("[data-em-colors]"),
        tags: container.querySelector("[data-em-tags]"),
        categories: container.querySelector("[data-em-categories]"),
        clear: container.querySelector("[data-em-clear]"),
        content: container.querySelector("[data-em-content]"),
        backdrop: container.querySelector("[data-em-backdrop]"),
        modal: container.querySelector("[data-em-modal]"),
      };

      this.cache.prev.addEventListener("click", () => this.navigate(-1));
      this.cache.next.addEventListener("click", () => this.navigate(1));
      this.cache.today.addEventListener("click", () => { state.currentDate = new Date(); this.render(); });
      container.querySelectorAll("[data-em-view]").forEach((btn) => {
        btn.addEventListener("click", () => {
          state.view = btn.getAttribute("data-em-view");
          this.render();
        });
      });
      this.cache.search.addEventListener("input", (e) => {
        state.filters.query = e.target.value || "";
        this.renderEvents();
      });
      this.cache.clear.addEventListener("click", () => this.clearFilters());
      this.cache.backdrop.addEventListener("click", (e) => {
        if (e.target === this.cache.backdrop) this.closeDialog();
      });
      this.renderFilters();
      container.querySelector("[data-em-create]").addEventListener("click", () => {
        state.isCreating = true; state.isDialogOpen = true;
        state.newEvent = { title: "", description: "", color: this.colors[0].value, category: this.categories[0], tags: [] };
        this.openDialog();
      });
      this.render();
    };

    this.renderFilters = function () {
      const c = this.cache.colors;
      const t = this.cache.tags;
      const cat = this.cache.categories;
      c.innerHTML = this.colors.map((color) => `<label><input type="checkbox" data-filter-color="${esc(color.value)}" /> <span style="display:inline-block;width:.7rem;height:.7rem;border-radius:999px;background:${color.color}"></span> ${esc(color.name)}</label>`).join("");
      t.innerHTML = `<span class="event-manager-chip-filter">Tags:</span>` + this.availableTags.map((tag) => `<label><input type="checkbox" data-filter-tag="${esc(tag)}" /> ${esc(tag)}</label>`).join("");
      cat.innerHTML = `<span class="event-manager-chip-filter">Categories:</span>` + this.categories.map((category) => `<label><input type="checkbox" data-filter-category="${esc(category)}" /> ${esc(category)}</label>`).join("");

      c.querySelectorAll("input").forEach((input) => input.addEventListener("change", () => {
        const v = input.getAttribute("data-filter-color");
        if (input.checked) state.filters.colors.push(v); else state.filters.colors = state.filters.colors.filter((x) => x !== v);
        this.renderEvents();
      }));
      t.querySelectorAll("input").forEach((input) => input.addEventListener("change", () => {
        const v = input.getAttribute("data-filter-tag");
        if (input.checked) state.filters.tags.push(v); else state.filters.tags = state.filters.tags.filter((x) => x !== v);
        this.renderEvents();
      }));
      cat.querySelectorAll("input").forEach((input) => input.addEventListener("change", () => {
        const v = input.getAttribute("data-filter-category");
        if (input.checked) state.filters.categories.push(v); else state.filters.categories = state.filters.categories.filter((x) => x !== v);
        this.renderEvents();
      }));
      this.syncFilterInputs();
    };

    this.syncFilterInputs = function () {
      this.cache.colors.querySelectorAll("input").forEach((input) => {
        input.checked = state.filters.colors.includes(input.getAttribute("data-filter-color"));
      });
      this.cache.tags.querySelectorAll("input").forEach((input) => {
        input.checked = state.filters.tags.includes(input.getAttribute("data-filter-tag"));
      });
      this.cache.categories.querySelectorAll("input").forEach((input) => {
        input.checked = state.filters.categories.includes(input.getAttribute("data-filter-category"));
      });
    };

    this.clearFilters = function () {
      state.filters = { query: "", colors: [], tags: [], categories: [] };
      if (this.cache.search) this.cache.search.value = "";
      this.syncFilterInputs();
      this.renderEvents();
    };

    this.navigate = function (direction) {
      const d = new Date(state.currentDate);
      if (state.view === "month") d.setMonth(d.getMonth() + direction);
      else if (state.view === "week") d.setDate(d.getDate() + direction * 7);
      else if (state.view === "day") d.setDate(d.getDate() + direction);
      state.currentDate = d;
      this.render();
    };

    this.titleText = function () {
      const d = state.currentDate;
      if (state.view === "month") return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
      if (state.view === "week") return `Week of ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
      if (state.view === "day") return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
      return "All Events";
    };

    this.render = function () {
      if (!this.cache) this.mount();
      this.cache.title.textContent = this.titleText();
      this.cache.search.value = state.filters.query;
      this.syncFilterInputs();
      this.container.querySelectorAll("[data-em-view]").forEach((btn) => {
        btn.classList.toggle("active", btn.getAttribute("data-em-view") === state.view);
      });
      this.renderEvents();
      if (state.isDialogOpen) this.openDialog(); else if (this.cache.backdrop.classList.contains("show")) this.closeDialog();
    };

    this.renderEvents = function () {
      const events = this.filteredEvents();
      const content = this.cache.content;
      if (state.view === "month") content.innerHTML = this.monthView(events);
      else if (state.view === "week") content.innerHTML = this.weekView(events);
      else if (state.view === "day") content.innerHTML = this.dayView(events);
      else content.innerHTML = this.listView(events);

      content.querySelectorAll("[data-event-id]").forEach((el) => {
        const id = el.getAttribute("data-event-id");
        el.addEventListener("click", () => {
          const event = state.events.find((e) => e.id === id);
          if (!event) return;
          state.selectedEvent = JSON.parse(JSON.stringify(event, (k, v) => v instanceof Date ? v.toISOString() : v));
          state.selectedEvent.startTime = toDate(state.selectedEvent.startTime);
          state.selectedEvent.endTime = toDate(state.selectedEvent.endTime);
          state.isCreating = false;
          state.isDialogOpen = true;
          this.openDialog();
        });
      });
    };

    this.monthView = function (events) {
      const first = new Date(state.currentDate.getFullYear(), state.currentDate.getMonth(), 1);
      const start = new Date(first);
      start.setDate(start.getDate() - start.getDay());
      let html = `<div class="event-manager-panel"><div class="event-manager-daynames">${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((name) => `<div>${name}</div>`).join("")}</div><div class="event-manager-month-grid">`;
      for (let i = 0; i < 42; i++) {
        const day = new Date(start);
        day.setDate(start.getDate() + i);
        const inMonth = day.getMonth() === state.currentDate.getMonth();
        const isToday = sameDay(day, new Date());
        const dayEvents = events.filter((e) => sameDay(new Date(e.startTime), day));
        html += `<div class="event-manager-day${inMonth ? "" : " muted"}${isToday ? " today" : ""}">
          <div class="em-day-number">${day.getDate()}</div>
          ${dayEvents.map((e) => `<button type="button" class="em-event-chip" data-event-id="${esc(e.id)}" style="background:${esc(this.colorValue(e.color))}">${esc(e.title)}</button>`).join("")}
        </div>`;
      }
      html += "</div></div>";
      return html;
    };

    this.weekView = function (events) {
      const start = new Date(state.currentDate);
      start.setDate(start.getDate() - start.getDay());
      const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
      const hours = Array.from({ length: 24 }, (_, i) => i);
      let html = `<div class="event-manager-panel event-manager-week-grid">
        <div class="event-manager-week-head" style="grid-column:1/-1;grid-template-columns:4rem repeat(7,1fr)">
          <div>Time</div>${days.map((d) => `<div>${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</div>`).join("")}
        </div>`;
      hours.forEach((hour) => {
        html += `<div class="event-manager-week-cell"><span class="em-time">${String(hour).padStart(2, "0")}:00</span></div>`;
        days.forEach((day) => {
          const hourEvents = events.filter((e) => {
            const d = new Date(e.startTime);
            return sameDay(d, day) && d.getHours() === hour;
          });
          html += `<div class="event-manager-week-cell">${hourEvents.map((e) => `<button type="button" class="em-event-chip" data-event-id="${esc(e.id)}" style="background:${esc(this.colorValue(e.color))}">${esc(e.title)}</button>`).join("")}</div>`;
        });
      });
      html += "</div>";
      return html;
    };

    this.dayView = function (events) {
      const day = state.currentDate;
      const hours = Array.from({ length: 24 }, (_, i) => i);
      let html = `<div class="event-manager-panel event-manager-day-list">`;
      hours.forEach((hour) => {
        const hourEvents = events.filter((e) => {
          const d = new Date(e.startTime);
          return sameDay(d, day) && d.getHours() === hour;
        });
        html += `<div class="em-hour-row"><div class="em-hour-label">${String(hour).padStart(2, "0")}:00</div><div class="em-hour-events">${hourEvents.map((e) => `<button type="button" class="em-event-chip" data-event-id="${esc(e.id)}" style="background:${esc(this.colorValue(e.color))}">${esc(e.title)} · ${formatTime(new Date(e.startTime))}</button>`).join("")}</div></div>`;
      });
      html += "</div>";
      return html;
    };

    this.listView = function (events) {
      const sorted = events.slice().sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
      const groups = {};
      sorted.forEach((event) => {
        const key = new Date(event.startTime).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
        groups[key] = groups[key] || [];
        groups[key].push(event);
      });
      if (!sorted.length) return `<div class="event-manager-panel event-manager-empty">No events found</div>`;
      let html = `<div class="event-manager-panel em-list-group">`;
      Object.keys(groups).forEach((key) => {
        html += `<h3 style="margin:0 0 .5rem;font-size:.9rem;color:var(--muted-foreground,#6b7280)">${esc(key)}</h3>`;
        groups[key].forEach((e) => {
          html += `<div class="em-list-item" data-event-id="${esc(e.id)}">
            <div style="font-weight:600">${esc(e.title)}</div>
            ${e.description ? `<p style="margin:.25rem 0;font-size:.9rem;color:var(--muted-foreground,#6b7280)">${esc(e.description)}</p>` : ""}
            <div style="display:flex;gap:.5rem;align-items:center;font-size:.8rem;color:var(--muted-foreground,#6b7280)">
              <span>${formatTime(new Date(e.startTime))} - ${formatTime(new Date(e.endTime))}</span>
              ${e.category ? `<span>${esc(e.category)}</span>` : ""}
              ${(e.tags || []).map((tag) => `<span>${esc(tag)}</span>`).join(" ")}
            </div>
          </div>`;
        });
      });
      html += "</div>";
      return html;
    };

    this.openDialog = function () {
      const modal = this.cache.modal;
      const backdrop = this.cache.backdrop;
      const editing = state.selectedEvent && !state.isCreating;
      const data = state.isCreating ? state.newEvent : state.selectedEvent;
      const form = data || {};
      modal.innerHTML = `
        <h2>${state.isCreating ? "Create Event" : "Event Details"}</h2>
        <div class="event-manager-field"><label for="${this.instanceId}-title">Title</label><input id="${this.instanceId}-title" data-em-title value="${esc(form.title || "")}" placeholder="Event title" /></div>
        <div class="event-manager-field"><label for="${this.instanceId}-description">Description</label><textarea id="${this.instanceId}-description" data-em-description rows="3">${esc(form.description || "")}</textarea></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem">
          <div class="event-manager-field"><label for="${this.instanceId}-start">Start</label><input type="datetime-local" id="${this.instanceId}-start" data-em-start value="${toLocalInput(form.startTime)}" /></div>
          <div class="event-manager-field"><label for="${this.instanceId}-end">End</label><input type="datetime-local" id="${this.instanceId}-end" data-em-end value="${toLocalInput(form.endTime)}" /></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem">
          <div class="event-manager-field"><label>Category</label><select data-em-category>${this.categories.map((c) => `<option value="${esc(c)}"${c === (form.category || this.categories[0]) ? " selected" : ""}>${esc(c)}</option>`).join("")}</select></div>
          <div class="event-manager-field"><label>Color</label><select data-em-color>${this.colors.map((c) => `<option value="${esc(c.value)}"${c.value === (form.color || this.colors[0].value) ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
        </div>
        <div class="event-manager-field"><label>Tags</label><div>${this.availableTags.map((tag) => {
          const checked = (form.tags || []).includes(tag) ? " checked" : "";
          return `<label style="display:inline-flex;align-items:center;gap:.25rem;margin-right:.5rem"><input type="checkbox" data-em-tag="${esc(tag)}"${checked} /> ${esc(tag)}</label>`;
        }).join("")}</div></div>
        <div class="event-manager-modal-actions">
          ${editing ? `<button type="button" class="btn btn-outline btn-sm" data-em-delete>Delete</button>` : ""}
          <button type="button" class="btn btn-outline btn-sm" data-em-cancel>Cancel</button>
          <button type="button" class="btn btn-primary btn-sm" data-em-save>${state.isCreating ? "Create" : "Save"}</button>
        </div>
      `;
      backdrop.classList.add("show");
      const readForm = () => {
        const title = modal.querySelector("[data-em-title]").value;
        const description = modal.querySelector("[data-em-description]").value;
        const start = modal.querySelector("[data-em-start]").value;
        const end = modal.querySelector("[data-em-end]").value;
        const category = modal.querySelector("[data-em-category]").value;
        const color = modal.querySelector("[data-em-color]").value;
        const tags = Array.from(modal.querySelectorAll("[data-em-tag]")).filter((i) => i.checked).map((i) => i.getAttribute("data-em-tag"));
        return { title, description, startTime: new Date(start), endTime: new Date(end), category, color, tags };
      };
      modal.querySelector("[data-em-cancel]").addEventListener("click", () => this.closeDialog());
      modal.querySelector("[data-em-save]").addEventListener("click", () => {
        const values = readForm();
        if (!values.title || !values.start || !values.end || Number.isNaN(values.startTime.getTime()) || Number.isNaN(values.endTime.getTime())) return;
        if (state.isCreating) {
          const event = { id: uid(), title: values.title, description: values.description, startTime: values.startTime, endTime: values.endTime, color: values.color, category: values.category, tags: values.tags };
          state.events.push(event);
          if (typeof this.options.onEventCreate === "function") this.options.onEventCreate(event);
          this.closeDialog();
        } else if (state.selectedEvent) {
          const updated = Object.assign({}, state.selectedEvent, values);
          state.events = state.events.map((e) => (e.id === state.selectedEvent.id ? updated : e));
          state.selectedEvent = updated;
          if (typeof this.options.onEventUpdate === "function") this.options.onEventUpdate(updated.id, updated);
          this.closeDialog();
        }
        state.isDialogOpen = false;
        this.render();
      });
      if (editing) {
        modal.querySelector("[data-em-delete]").addEventListener("click", () => {
          const id = state.selectedEvent.id;
          state.events = state.events.filter((e) => e.id !== id);
          state.selectedEvent = null;
          state.isDialogOpen = false;
          if (typeof this.options.onEventDelete === "function") this.options.onEventDelete(id);
          this.closeDialog();
          this.render();
        });
      }
      const first = modal.querySelector("input,select,textarea,button");
      if (first) try { first.focus(); } catch (e) {}
    };

    this.closeDialog = function () {
      state.isDialogOpen = false;
      state.selectedEvent = null;
      this.cache.backdrop.classList.remove("show");
    };

    if (this.options.className) container.classList.add(...String(this.options.className).split(/\s+/).filter(Boolean));
    this.mount();
  }

  window.EventManager = EventManager;
  window.initEventManager = function (container, options) {
    const instance = new EventManager(container, options);
    return instance;
  };
})();
