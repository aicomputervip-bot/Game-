const cityDefaults = [
  { zone: "America/New_York", city: "New York" },
  { zone: "Europe/London", city: "London" },
  { zone: "Asia/Tokyo", city: "Tokyo" },
  { zone: "Australia/Sydney", city: "Sydney" },
];
const supportedTimeZones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : cityDefaults.map((city) => city.zone);
const regionNames = new Intl.DisplayNames([navigator.language || "en"], { type: "region" });
const englishRegionNames = new Intl.DisplayNames(["en"], { type: "region" });
const timezoneCountries = new Map();
const countryAliases = {
  US: ["usa", "america", "united states of america"],
  GB: ["uk", "britain", "great britain", "england"],
  KR: ["south korea"],
  KP: ["north korea"],
  AE: ["uae"],
  RU: ["russia"],
  CZ: ["czech republic"],
  MM: ["burma"],
};

const safeRead = (key, fallback) => {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
};
const safeWrite = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Storage may be unavailable in private browsing. */ }
};

let cities = safeRead("daymark-cities", cityDefaults);
let alarms = safeRead("daymark-alarms", []);
let use24Hour = safeRead("daymark-24-hour", false);
let reminderActive = false;
let reminderEndsAt = 0;
let reminderPausedRemaining = 0;
let reminderDuration = Number(document.querySelector("#reminder-interval").value) * 60;
let alarmAudioContext;
let alarmSoundInterval;
let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let selectedCalendarDate = new Date();
let calendarEvents = safeRead("daymark-calendar-events", []);
let scheduledReminders = safeRead("daymark-scheduled-reminders", []);

const localTime = document.querySelector("#local-time");
const localZone = document.querySelector("#local-zone");
const analogClock = document.querySelector("#analog-clock");
const clockContext = analogClock.getContext("2d");
const worldList = document.querySelector("#world-list");
const alarmList = document.querySelector("#alarm-list");
const formatToggle = document.querySelector("#format-toggle");
const reminderToggle = document.querySelector("#reminder-toggle");
const reminderButtonLabel = document.querySelector("#reminder-button-label");
const reminderCountdown = document.querySelector("#reminder-countdown");
const reminderDialog = document.querySelector("#reminder-dialog");
const alarmToast = document.querySelector("#alarm-toast");
const toolTabs = Array.from(document.querySelectorAll(".tool-tab"));
const calendarGrid = document.querySelector("#calendar-grid");
const calendarEventList = document.querySelector("#calendar-events");
const citySearchInput = document.querySelector("#city-search");
const citySearchResults = document.querySelector("#city-search-results");
const scheduledReminderList = document.querySelector("#scheduled-reminders");
const scheduledReminderToast = document.querySelector("#scheduled-reminder-toast");

function normalizeSearch(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

async function loadTimezoneCountries() {
  try {
    const response = await fetch("https://raw.githubusercontent.com/eggert/tz/main/zone1970.tab");
    if (!response.ok) return;
    const rows = (await response.text()).split("\n");
    rows.forEach((row) => {
      if (!row || row.startsWith("#")) return;
      const [codes, , zone] = row.split("\t");
      if (!codes || !zone) return;
      const countryCodes = codes.split(",");
      const names = countryCodes.flatMap((code) => [regionNames.of(code), englishRegionNames.of(code)]).filter(Boolean);
      const aliases = countryCodes.flatMap((code) => countryAliases[code] || []);
      timezoneCountries.set(zone, { codes: countryCodes, names: [...new Set(names)], aliases });
    });
    if (citySearchInput.value.trim()) renderCitySearchResults(citySearchInput.value);
  } catch {
    document.querySelector("#city-search-hint").textContent = "City search is available; country matches need an internet connection.";
  }
}

function cityForZone(zone) {
  const knownCity = cityDefaults.find((city) => city.zone === zone);
  return knownCity?.city || zone.split("/").at(-1).replaceAll("_", " ");
}

function searchWorldTimeZones(query) {
  const normalizedQuery = normalizeSearch(query);
  if (!normalizedQuery) return [];
  const terms = normalizedQuery.split(/\s+/);
  return supportedTimeZones.map((zone) => {
    const city = cityForZone(zone);
    const countryData = timezoneCountries.get(zone) || { codes: [], names: [], aliases: [] };
    const searchable = normalizeSearch([city, zone.replaceAll("/", " ").replaceAll("_", " "), ...countryData.names, ...countryData.aliases, ...countryData.codes].join(" "));
    if (!terms.every((term) => searchable.includes(term))) return null;
    const exactMatch = normalizeSearch(city) === normalizedQuery || countryData.names.some((name) => normalizeSearch(name) === normalizedQuery);
    return { zone, city, country: countryData.names[0] || "", rank: exactMatch ? 0 : 1 };
  }).filter(Boolean).sort((first, second) => first.rank - second.rank || first.city.localeCompare(second.city)).slice(0, 14);
}

function addWorldCity(city) {
  if (cities.some((entry) => (typeof entry === "string" ? entry : entry.zone) === city.zone)) {
    document.querySelector("#city-search-hint").textContent = `${city.city} is already in your world clock.`;
    return;
  }
  cities.push({ zone: city.zone, city: city.city, country: city.country });
  safeWrite("daymark-cities", cities);
  updateWorldClocks();
  citySearchInput.value = "";
  citySearchResults.replaceChildren();
  citySearchResults.hidden = true;
  citySearchInput.setAttribute("aria-expanded", "false");
  document.querySelector("#city-search-hint").textContent = `${city.city} added to your world clock.`;
}

function renderCitySearchResults(query) {
  citySearchResults.replaceChildren();
  const matches = searchWorldTimeZones(query);
  if (!normalizeSearch(query)) {
    citySearchResults.hidden = true;
    citySearchInput.setAttribute("aria-expanded", "false");
    return matches;
  }
  if (matches.length === 0) {
    const empty = document.createElement("p");
    empty.className = "city-search-empty";
    empty.textContent = "No matching cities or countries.";
    citySearchResults.append(empty);
  } else {
    matches.forEach((city) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "city-search-option";
      option.setAttribute("role", "option");
      const alreadyAdded = cities.some((entry) => (typeof entry === "string" ? entry : entry.zone) === city.zone);
      option.setAttribute("aria-disabled", String(alreadyAdded));
      const details = document.createElement("span");
      details.className = "city-search-option-name";
      const name = document.createElement("strong");
      name.textContent = city.city;
      const country = document.createElement("small");
      country.textContent = city.country || city.zone.replaceAll("_", " ");
      details.append(name, country);
      const zone = document.createElement("span");
      zone.className = "city-search-option-zone";
      zone.textContent = alreadyAdded ? "ADDED" : "ADD +";
      option.append(details, zone);
      option.addEventListener("click", () => addWorldCity(city));
      citySearchResults.append(option);
    });
  }
  citySearchResults.hidden = false;
  citySearchInput.setAttribute("aria-expanded", "true");
  document.querySelector("#city-search-hint").textContent = matches.length ? `${matches.length} matching places shown.` : "Try another spelling or a different country name.";
  return matches;
}

function activateTool(tab) {
  toolTabs.forEach((toolTab) => {
    const selected = toolTab === tab;
    toolTab.setAttribute("aria-selected", String(selected));
    toolTab.tabIndex = selected ? 0 : -1;
    toolTab.classList.toggle("active", selected);
    document.querySelector(`#${toolTab.dataset.view}`).hidden = !selected;
  });
  if (tab.dataset.view === "calendar-view") renderCalendar();
}

toolTabs.forEach((tab, index) => {
  tab.addEventListener("click", () => activateTool(tab));
  tab.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const nextTab = toolTabs[(index + direction + toolTabs.length) % toolTabs.length];
    activateTool(nextTab);
    nextTab.focus();
  });
});

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function renderCalendar() {
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  document.querySelector("#calendar-month-label").textContent = new Intl.DateTimeFormat(navigator.language, { month: "long", year: "numeric" }).format(calendarMonth);
  document.querySelector("#selected-date-title").textContent = new Intl.DateTimeFormat(navigator.language, { weekday: "long", month: "long", day: "numeric" }).format(selectedCalendarDate);

  const monthStartOffset = (new Date(year, month, 1).getDay() + 6) % 7;
  const monthDays = new Date(year, month + 1, 0).getDate();
  const cellCount = Math.ceil((monthStartOffset + monthDays) / 7) * 7;
  const today = dateKey(new Date());
  const selected = dateKey(selectedCalendarDate);
  calendarGrid.replaceChildren();

  for (let index = 0; index < cellCount; index += 1) {
    const date = new Date(year, month, index - monthStartOffset + 1);
    const key = dateKey(date);
    const dayButton = document.createElement("button");
    dayButton.type = "button";
    dayButton.className = "calendar-day";
    dayButton.classList.toggle("is-outside", date.getMonth() !== month);
    dayButton.classList.toggle("is-today", key === today);
    dayButton.classList.toggle("is-selected", key === selected);
    dayButton.setAttribute("aria-pressed", String(key === selected));
    dayButton.setAttribute("aria-label", new Intl.DateTimeFormat(navigator.language, { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(date));
    const number = document.createElement("span");
    number.className = "calendar-number";
    number.textContent = String(date.getDate());
    dayButton.append(number);
    if (calendarEvents.some((item) => item.date === key)) {
      const marker = document.createElement("span");
      marker.className = "calendar-dot";
      marker.setAttribute("aria-hidden", "true");
      dayButton.append(marker);
    }
    dayButton.addEventListener("click", () => {
      selectedCalendarDate = date;
      if (date.getMonth() !== calendarMonth.getMonth()) calendarMonth = new Date(date.getFullYear(), date.getMonth(), 1);
      renderCalendar();
    });
    calendarGrid.append(dayButton);
  }

  const dayEvents = calendarEvents.filter((item) => item.date === selected);
  calendarEventList.replaceChildren();
  if (dayEvents.length === 0) {
    const empty = document.createElement("p");
    empty.className = "event-empty";
    empty.textContent = "A clear day. Add a note when you need one.";
    calendarEventList.append(empty);
  }
  dayEvents.forEach((item) => {
    const row = document.createElement("div");
    row.className = "event-row";
    const title = document.createElement("span");
    title.className = "event-title";
    title.textContent = item.title;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "event-remove";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove ${item.title}`);
    remove.addEventListener("click", () => {
      calendarEvents = calendarEvents.filter((savedEvent) => savedEvent.id !== item.id);
      safeWrite("daymark-calendar-events", calendarEvents);
      renderCalendar();
    });
    row.append(title, remove);
    calendarEventList.append(row);
  });
}

function renderScheduledReminders() {
  scheduledReminderList.replaceChildren();
  if (scheduledReminders.length === 0) {
    const empty = document.createElement("p");
    empty.className = "scheduled-reminder-empty";
    empty.textContent = "No one-time reminders yet.";
    scheduledReminderList.append(empty);
    return;
  }
  scheduledReminders.sort((first, second) => new Date(first.at) - new Date(second.at));
  scheduledReminders.forEach((reminder) => {
    const row = document.createElement("div");
    row.className = `scheduled-reminder-row${reminder.fired ? " is-done" : ""}`;
    const details = document.createElement("div");
    details.className = "scheduled-reminder-details";
    const title = document.createElement("strong");
    title.textContent = reminder.label || "Reminder";
    const date = document.createElement("time");
    date.dateTime = reminder.at;
    date.textContent = new Intl.DateTimeFormat(navigator.language, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(reminder.at));
    const status = document.createElement("span");
    status.className = "scheduled-reminder-status";
    status.textContent = reminder.fired ? "DONE" : "UP NEXT";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "scheduled-reminder-remove";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove reminder ${reminder.label || "Reminder"}`);
    remove.addEventListener("click", () => {
      scheduledReminders = scheduledReminders.filter((item) => item.id !== reminder.id);
      safeWrite("daymark-scheduled-reminders", scheduledReminders);
      renderScheduledReminders();
    });
    details.append(title, date);
    row.append(details, status, remove);
    scheduledReminderList.append(row);
  });
}

function updateScheduledReminderMinimum() {
  const dateTimeInput = document.querySelector("#scheduled-reminder-time");
  const localNow = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  dateTimeInput.min = localNow;
}

function checkScheduledReminders(now) {
  const dueReminders = scheduledReminders.filter((reminder) => !reminder.fired && new Date(reminder.at).getTime() <= now.getTime());
  if (dueReminders.length === 0) return;
  dueReminders.forEach((reminder) => { reminder.fired = true; });
  safeWrite("daymark-scheduled-reminders", scheduledReminders);
  renderScheduledReminders();
  document.querySelector("#scheduled-reminder-toast-label").textContent = dueReminders.map((item) => item.label || "Reminder").join(" · ");
  scheduledReminderToast.hidden = false;
  playTone(true);
}

document.querySelector("#calendar-prev").addEventListener("click", () => {
  calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1);
  selectedCalendarDate = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
  renderCalendar();
});
document.querySelector("#calendar-next").addEventListener("click", () => {
  calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1);
  selectedCalendarDate = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
  renderCalendar();
});
document.querySelector("#calendar-event-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = document.querySelector("#calendar-event-input");
  const title = input.value.trim();
  if (!title) return;
  calendarEvents.push({ id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`, date: dateKey(selectedCalendarDate), title });
  safeWrite("daymark-calendar-events", calendarEvents);
  event.currentTarget.reset();
  renderCalendar();
});

function localDateParts(date) {
  return {
    hour: date.getHours(),
    minute: date.getMinutes(),
    second: date.getSeconds(),
  };
}

function drawAnalogClock(date, parts) {
  const size = 240;
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(analogClock.clientWidth * ratio));
  const height = Math.max(1, Math.round(analogClock.clientHeight * ratio));
  if (analogClock.width !== width || analogClock.height !== height) {
    analogClock.width = width;
    analogClock.height = height;
  }
  clockContext.setTransform(width / size, 0, 0, height / size, 0, 0);
  clockContext.clearRect(0, 0, size, size);

  const center = size / 2;
  const faceRadius = 111;
    const colors = { ink: "#203b49", green: "#328cac", muted: "#a9c2cb", coral: "#df806a", paper: "#f4f9fa", gold: "#e9c76d" };

  clockContext.beginPath();
  clockContext.arc(center, center, faceRadius, 0, Math.PI * 2);
  clockContext.fillStyle = colors.paper;
  clockContext.fill();
  clockContext.lineWidth = 2;
  clockContext.strokeStyle = colors.green;
  clockContext.stroke();

  clockContext.beginPath();
  clockContext.arc(center, center, 103, 0, Math.PI * 2);
  clockContext.lineWidth = 1;
    clockContext.strokeStyle = "#dcebf0";
  clockContext.stroke();

  for (let mark = 0; mark < 60; mark += 1) {
    const angle = (mark * Math.PI) / 30 - Math.PI / 2;
    const isHour = mark % 5 === 0;
    const outer = faceRadius - 8;
    const inner = isHour ? faceRadius - 21 : faceRadius - 14;
    clockContext.beginPath();
    clockContext.moveTo(center + Math.cos(angle) * inner, center + Math.sin(angle) * inner);
    clockContext.lineTo(center + Math.cos(angle) * outer, center + Math.sin(angle) * outer);
    clockContext.lineWidth = isHour ? 2.5 : 1;
    clockContext.lineCap = "round";
    clockContext.strokeStyle = isHour ? colors.green : colors.muted;
    clockContext.stroke();
  }

  clockContext.textAlign = "center";
  clockContext.textBaseline = "middle";
  for (let number = 1; number <= 12; number += 1) {
    const angle = (number * Math.PI) / 6 - Math.PI / 2;
    const radius = 77;
    clockContext.font = number % 3 === 0 ? '500 17px "DM Mono", monospace' : '500 14px "DM Mono", monospace';
    clockContext.fillStyle = number % 3 === 0 ? colors.ink : colors.green;
    clockContext.fillText(String(number), center + Math.cos(angle) * radius, center + Math.sin(angle) * radius);
  }

  clockContext.beginPath();
  clockContext.arc(center, center, 59, 0, Math.PI * 2);
  clockContext.lineWidth = 1;
    clockContext.strokeStyle = "#d8eaf0";
  clockContext.stroke();

  const hand = (angle, length, color, width) => {
    clockContext.beginPath();
    clockContext.moveTo(center - Math.cos(angle) * 9, center - Math.sin(angle) * 9);
    clockContext.lineTo(center + Math.cos(angle) * length, center + Math.sin(angle) * length);
    clockContext.lineWidth = width;
    clockContext.lineCap = "round";
    clockContext.strokeStyle = color;
    clockContext.stroke();
  };
  const hourAngle = ((parts.hour % 12 + parts.minute / 60) * Math.PI) / 6 - Math.PI / 2;
  const minuteAngle = ((parts.minute + parts.second / 60) * Math.PI) / 30 - Math.PI / 2;
  const secondAngle = (parts.second * Math.PI) / 30 - Math.PI / 2;
  hand(hourAngle, 43, colors.ink, 6);
  hand(minuteAngle, 66, colors.green, 4);
  hand(secondAngle, 87, colors.coral, 1.5);

  clockContext.beginPath();
  clockContext.arc(center, center, 7, 0, Math.PI * 2);
  clockContext.fillStyle = colors.ink;
  clockContext.fill();
  clockContext.beginPath();
  clockContext.arc(center, center, 3, 0, Math.PI * 2);
  clockContext.fillStyle = colors.gold;
  clockContext.fill();
  const accessibleTime = new Intl.DateTimeFormat(navigator.language, { hour: "numeric", minute: "2-digit", timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }).format(date);
  analogClock.setAttribute("aria-label", `Analog clock showing ${accessibleTime}`);
}

function updateClock() {
  const now = new Date();
  const parts = localDateParts(now);
  const formattedTime = new Intl.DateTimeFormat(navigator.language, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: !use24Hour }).formatToParts(now);
  localTime.replaceChildren(...formattedTime.map((part) => {
    if (part.type !== "second") return document.createTextNode(part.value);
    const seconds = document.createElement("span");
    seconds.textContent = part.value;
    return seconds;
  }));
  localZone.textContent = Intl.DateTimeFormat().resolvedOptions().timeZone.replaceAll("_", " ").toUpperCase();
  drawAnalogClock(now, parts);
  updateWorldClocks(now);
  checkAlarms(now);
  checkScheduledReminders(now);
}

function getCityLabel(zone) {
  const explicit = cityDefaults.find((city) => city.zone === zone);
  if (explicit) return explicit.city;
  return zone.split("/").at(-1).replaceAll("_", " ");
}

function updateWorldClocks(now = new Date()) {
  const locations = cities.map((entry) => typeof entry === "string" ? { zone: entry, city: getCityLabel(entry) } : entry);
  const rows = Array.from(worldList.children);
  const needsRender = rows.length !== locations.length || locations.some((city, index) => rows[index]?.dataset.zone !== city.zone);
  if (needsRender) {
    worldList.replaceChildren();
    locations.forEach((city, index) => {
      const row = document.createElement("div");
      row.className = "world-row";
      row.dataset.zone = city.zone;
      const cityDetails = document.createElement("div");
      cityDetails.className = "world-city";
      const cityName = document.createElement("span");
      cityName.className = "city-name";
      cityName.textContent = city.city || getCityLabel(city.zone);
      const zoneName = document.createElement("span");
      zoneName.className = "city-zone";
      zoneName.textContent = city.country || city.zone.replaceAll("_", " ");
      const time = document.createElement("time");
      time.className = "city-time";
      const day = document.createElement("span");
      day.className = "city-day";
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "remove-city";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `Remove ${city.city || getCityLabel(city.zone)}`);
      remove.addEventListener("click", () => {
        cities.splice(index, 1);
        safeWrite("daymark-cities", cities);
        updateWorldClocks();
      });
      cityDetails.append(cityName, zoneName);
      row.append(cityDetails, time, day, remove);
      worldList.append(row);
    });
  }

  locations.forEach((city, index) => {
    const time = worldList.children[index].querySelector(".city-time");
    time.dateTime = new Intl.DateTimeFormat("en-GB", { timeZone: city.zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
    time.textContent = new Intl.DateTimeFormat(navigator.language, { timeZone: city.zone, hour: "2-digit", minute: "2-digit", hour12: !use24Hour }).format(now);
    worldList.children[index].querySelector(".city-day").textContent = new Intl.DateTimeFormat(navigator.language, { timeZone: city.zone, weekday: "short" }).format(now).toUpperCase();
  });
}

function renderAlarms() {
  alarmList.replaceChildren();
  if (alarms.length === 0) {
    const empty = document.createElement("p");
    empty.className = "alarm-empty";
    empty.textContent = "No alarms set. Add one above.";
    alarmList.append(empty);
    return;
  }
  alarms.sort((first, second) => first.time.localeCompare(second.time));
  alarms.forEach((alarm) => {
    const row = document.createElement("div");
    row.className = "alarm-row";
    const info = document.createElement("div");
    info.className = "alarm-info";
    const time = document.createElement("time");
    time.className = "alarm-time";
    time.textContent = new Intl.DateTimeFormat(navigator.language, { hour: "numeric", minute: "2-digit", hour12: !use24Hour, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }).format(new Date(`2000-01-01T${alarm.time}:00`));
    const label = document.createElement("span");
    label.className = "alarm-name";
    label.textContent = alarm.label || "Alarm";
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = alarm.enabled;
    toggle.setAttribute("aria-label", `${alarm.enabled ? "Turn off" : "Turn on"} ${alarm.label || "alarm"}`);
    toggle.addEventListener("change", () => {
      alarm.enabled = toggle.checked;
      alarm.firedDate = "";
      safeWrite("daymark-alarms", alarms);
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-alarm";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Delete ${alarm.label || "alarm"}`);
    remove.addEventListener("click", () => {
      alarms = alarms.filter((savedAlarm) => savedAlarm.id !== alarm.id);
      safeWrite("daymark-alarms", alarms);
      renderAlarms();
    });
    info.append(time, label);
    row.append(info, toggle, remove);
    alarmList.append(row);
  });
}

function unlockAudio() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!alarmAudioContext || alarmAudioContext.state === "closed") alarmAudioContext = new AudioContextClass();
    if (alarmAudioContext.state === "suspended") alarmAudioContext.resume().catch(() => {});
    return alarmAudioContext;
  } catch {
    return null;
  }
}

function playTone(repeating = false) {
  const context = alarmAudioContext;
  if (!context || context.state !== "running") return false;
  try {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = repeating ? 660 : 520;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.45);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
    oscillator.start();
    oscillator.stop(context.currentTime + 0.46);
    return true;
  } catch {
    return false;
  }
}

function playAlarmBell() {
  const context = alarmAudioContext;
  if (!context || context.state !== "running") return false;
  const strike = (startAt, fundamental) => {
    const partials = [
      { ratio: 1, volume: 0.075, decay: 1.15 },
      { ratio: 2.01, volume: 0.024, decay: 0.82 },
      { ratio: 3.97, volume: 0.007, decay: 0.56 },
    ];
    partials.forEach((partial) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = fundamental * partial.ratio;
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(partial.volume, startAt + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + partial.decay);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
      oscillator.start(startAt);
      oscillator.stop(startAt + partial.decay + 0.02);
    });
  };

  const now = context.currentTime;
  strike(now, 659.25);
  strike(now + 0.2, 783.99);
  return true;
}

function checkAlarms(now) {
  const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const today = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  alarms.forEach((alarm) => {
    if (alarm.enabled && alarm.time === currentTime && alarm.firedDate !== today) {
      alarm.firedDate = today;
      safeWrite("daymark-alarms", alarms);
      triggerAlarm(alarm);
    }
  });
}

function triggerAlarm(alarm) {
  document.querySelector("#alarm-toast-label").textContent = `${alarm.label || "Alarm"} · ${alarm.time}`;
  alarmToast.hidden = false;
  if (alarmSoundInterval) window.clearInterval(alarmSoundInterval);
  playAlarmBell();
  alarmSoundInterval = window.setInterval(() => {
    if (alarmToast.hidden) {
      window.clearInterval(alarmSoundInterval);
      alarmSoundInterval = null;
      return;
    }
    playAlarmBell();
  }, 1800);
  const dismiss = () => {
    alarmToast.hidden = true;
    if (alarmSoundInterval) window.clearInterval(alarmSoundInterval);
    alarmSoundInterval = null;
  };
  document.querySelector("#alarm-dismiss").onclick = dismiss;
}

function setReminderButton() {
  reminderButtonLabel.textContent = reminderActive ? "Pause reminder" : "Start reminder";
  reminderToggle.querySelector(".button-symbol").textContent = reminderActive ? "Ⅱ" : "▶";
  reminderCountdown.textContent = reminderActive ? "READY" : "PAUSED";
  reminderToggle.setAttribute("aria-pressed", String(reminderActive));
}

function showReminder() {
  reminderActive = false;
  reminderPausedRemaining = reminderDuration;
  setReminderButton();
  reminderDialog.showModal();
  playTone(true);
}

function tickReminder() {
  if (!reminderActive) return;
  const remaining = Math.max(0, Math.ceil((reminderEndsAt - Date.now()) / 1000));
  if (remaining === 0) {
    showReminder();
    return;
  }
  const minutes = Math.floor(remaining / 60);
  const seconds = String(remaining % 60).padStart(2, "0");
  reminderCountdown.textContent = `${String(minutes).padStart(2, "0")}:${seconds}`;
}

document.querySelector("#city-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const matches = renderCitySearchResults(citySearchInput.value);
  if (matches.length) addWorldCity(matches[0]);
});

citySearchInput.addEventListener("input", () => renderCitySearchResults(citySearchInput.value));
citySearchInput.addEventListener("focus", () => {
  if (citySearchInput.value.trim()) renderCitySearchResults(citySearchInput.value);
});
citySearchInput.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    citySearchResults.hidden = true;
    citySearchInput.setAttribute("aria-expanded", "false");
  }
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".city-search-control")) {
    citySearchResults.hidden = true;
    citySearchInput.setAttribute("aria-expanded", "false");
  }
});

document.querySelector("#alarm-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const time = document.querySelector("#alarm-time").value;
  if (!time) return;
  unlockAudio();
  alarms.push({ id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`, time, label: document.querySelector("#alarm-label").value.trim(), enabled: true, firedDate: "" });
  safeWrite("daymark-alarms", alarms);
  renderAlarms();
  event.currentTarget.reset();
});

document.querySelector("#scheduled-reminder-form").addEventListener("submit", (event) => {
  event.preventDefault();
  unlockAudio();
  const dateTimeInput = document.querySelector("#scheduled-reminder-time");
  const selectedTime = new Date(dateTimeInput.value);
  if (Number.isNaN(selectedTime.getTime()) || selectedTime.getTime() <= Date.now()) {
    dateTimeInput.setCustomValidity("Choose a future date and time.");
    dateTimeInput.reportValidity();
    return;
  }
  dateTimeInput.setCustomValidity("");
  scheduledReminders.push({
    id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
    at: dateTimeInput.value,
    label: document.querySelector("#scheduled-reminder-label").value.trim() || "Reminder",
    fired: false,
  });
  safeWrite("daymark-scheduled-reminders", scheduledReminders);
  event.currentTarget.reset();
  updateScheduledReminderMinimum();
  renderScheduledReminders();
});
document.querySelector("#scheduled-reminder-dismiss").addEventListener("click", () => { scheduledReminderToast.hidden = true; });

formatToggle.addEventListener("click", () => {
  use24Hour = !use24Hour;
  formatToggle.setAttribute("aria-pressed", String(use24Hour));
  formatToggle.setAttribute("aria-label", `Switch to ${use24Hour ? "12" : "24"}-hour time`);
  safeWrite("daymark-24-hour", use24Hour);
  updateClock();
  renderAlarms();
});

reminderToggle.addEventListener("click", () => {
  unlockAudio();
  if (reminderActive) {
    reminderPausedRemaining = Math.max(1, Math.ceil((reminderEndsAt - Date.now()) / 1000));
    reminderActive = false;
  } else {
    reminderActive = true;
    reminderEndsAt = Date.now() + (reminderPausedRemaining || reminderDuration) * 1000;
    reminderPausedRemaining = 0;
  }
  setReminderButton();
  tickReminder();
});

document.querySelector("#reminder-interval").addEventListener("change", (event) => {
  reminderDuration = Number(event.target.value) * 60;
  reminderPausedRemaining = reminderDuration;
  if (reminderActive) reminderEndsAt = Date.now() + reminderDuration * 1000;
  tickReminder();
});

function closeReminder() {
  if (reminderDialog.open) reminderDialog.close();
}
document.querySelector("#dialog-close").addEventListener("click", closeReminder);
document.querySelector("#dialog-done").addEventListener("click", closeReminder);
document.querySelector("#dialog-snooze").addEventListener("click", () => {
  closeReminder();
  reminderActive = true;
  reminderPausedRemaining = 0;
  reminderEndsAt = Date.now() + 5 * 60 * 1000;
  setReminderButton();
});

document.addEventListener("pointerdown", unlockAudio, { once: true });
document.addEventListener("keydown", unlockAudio, { once: true });

formatToggle.setAttribute("aria-pressed", String(use24Hour));
formatToggle.setAttribute("aria-label", `Switch to ${use24Hour ? "12" : "24"}-hour time`);
renderAlarms();
updateClock();
setReminderButton();
renderScheduledReminders();
updateScheduledReminderMinimum();
loadTimezoneCountries();
window.setInterval(updateClock, 1000);
window.setInterval(tickReminder, 250);