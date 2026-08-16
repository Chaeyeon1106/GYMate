import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";
import { db } from "./firebase-init.js";
import { state } from "./state.js";
import {
  $,
  toDateStr,
  todayStr,
  formatDateLabel,
  openModal,
  closeModal,
  showToast,
  showLoading,
  escapeHtml,
  avatarColorFor,
} from "./utils.js";

let currentMonth = new Date();
currentMonth.setDate(1);

let selectedDateStr = null;
let scheduleByDate = {}; // { 'YYYY-MM-DD': [ {id, uid, displayName, time, note, resting} ] }
let unsubscribe = null;
let unsubBadges = [];
let restingSelected = false;

// 운동 인증(누가 올렸는지) 캘린더 표시용
let groupWorkouts = new Map(); // id -> {date, uid, displayName, color}
let myWorkouts = new Map();
let taggedWorkouts = new Map();
let workoutsByDate = {}; // { 'YYYY-MM-DD': Map(uid -> {name, color}) }

// 그날 운동 인증을 올린 사람들을 작고 귀여운 아바타로 보여준다 (최대 3명 + 나머지는 숫자로)
function buildAvatarRow(peopleMap) {
  const row = document.createElement("div");
  row.className = "avatar-row";
  const people = [...peopleMap.values()];
  people.slice(0, 3).forEach(({ name, color }) => {
    const avatar = document.createElement("span");
    avatar.className = "avatar-chip";
    avatar.style.background = avatarColorFor(name, color);
    avatar.textContent = (name || "?").trim().charAt(0);
    avatar.title = name;
    row.appendChild(avatar);
  });
  if (people.length > 3) {
    const more = document.createElement("span");
    more.className = "avatar-chip avatar-more";
    more.textContent = `+${people.length - 3}`;
    row.appendChild(more);
  }
  return row;
}

export function initCalendar() {
  $("cal-prev").addEventListener("click", () => shiftMonth(-1));
  $("cal-next").addEventListener("click", () => shiftMonth(1));
  $("day-detail-close").addEventListener("click", () => {
    $("day-detail").classList.add("hidden");
    document.querySelectorAll(".cal-day.selected").forEach((el) => el.classList.remove("selected"));
    selectedDateStr = null;
  });
  $("add-schedule-btn").addEventListener("click", openScheduleModal);
  $("schedule-resting-toggle").addEventListener("click", () => setResting(!restingSelected));
  $("schedule-form").addEventListener("submit", onScheduleSubmit);
  $("schedule-delete-btn").addEventListener("click", onScheduleDelete);
  $("today-date-label").textContent = formatDateLabel(todayStr());
  $("quick-schedule-btn").addEventListener("click", () => {
    selectDate(todayStr());
    openScheduleModal();
  });

  subscribeMonth();
  subscribeWorkoutBadges();
  selectDate(todayStr());
}

// 그룹을 전환했을 때 이전 그룹 구독을 정리하고 새 그룹(state.groupId) 기준으로
// 다시 구독한다.
export function reloadCalendar() {
  currentMonth = new Date();
  currentMonth.setDate(1);
  subscribeMonth();
  subscribeWorkoutBadges();
  selectDate(todayStr());
}

function shiftMonth(delta) {
  currentMonth.setMonth(currentMonth.getMonth() + delta);
  subscribeMonth();
}

function subscribeMonth() {
  if (unsubscribe) unsubscribe();
  renderMonthLabel();
  // 일정 데이터가 아직 없어도(로딩 중, 색인 생성 중 등) 달력 자체는 바로 보여준다.
  scheduleByDate = {};
  renderGrid();

  const monthStart = toDateStr(new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1));
  const monthEnd = toDateStr(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0));

  const q = query(
    collection(db, "groups", state.groupId, "schedule"),
    where("date", ">=", monthStart),
    where("date", "<=", monthEnd),
    orderBy("date"),
    orderBy("time")
  );

  unsubscribe = onSnapshot(q, (snap) => {
    scheduleByDate = {};
    snap.forEach((d) => {
      const data = d.data();
      if (!scheduleByDate[data.date]) scheduleByDate[data.date] = [];
      scheduleByDate[data.date].push({ id: d.id, ...data });
    });
    renderGrid();
    if (selectedDateStr) renderDayDetail(selectedDateStr);
  });
}

function subscribeWorkoutBadges() {
  unsubBadges.forEach((fn) => fn());
  unsubBadges = [];
  groupWorkouts = new Map();
  myWorkouts = new Map();
  taggedWorkouts = new Map();

  const base = collection(db, "groups", state.groupId, "workoutLogs");

  const groupQ = query(base, where("visibility", "==", "group"));
  unsubBadges.push(onSnapshot(groupQ, (snap) => {
    groupWorkouts = new Map();
    snap.forEach((d) => groupWorkouts.set(d.id, d.data()));
    rebuildWorkoutsByDate();
  }));

  const mineQ = query(base, where("uid", "==", state.uid));
  unsubBadges.push(onSnapshot(mineQ, (snap) => {
    myWorkouts = new Map();
    snap.forEach((d) => myWorkouts.set(d.id, d.data()));
    rebuildWorkoutsByDate();
  }));

  // 내가 태그된(같이 운동한 친구로 지정된) 기록도 내 운동 인증으로 함께 표시한다.
  const taggedQ = query(base, where("taggedUids", "array-contains", state.uid));
  unsubBadges.push(onSnapshot(taggedQ, (snap) => {
    taggedWorkouts = new Map();
    snap.forEach((d) => taggedWorkouts.set(d.id, d.data()));
    rebuildWorkoutsByDate();
  }));
}

function rebuildWorkoutsByDate() {
  const merged = new Map([...groupWorkouts, ...myWorkouts, ...taggedWorkouts]);
  workoutsByDate = {};
  merged.forEach((data) => {
    if (!workoutsByDate[data.date]) workoutsByDate[data.date] = new Map();
    workoutsByDate[data.date].set(data.uid, { name: data.displayName, color: data.color });
    (data.taggedMembers || []).forEach((m) => {
      workoutsByDate[data.date].set(m.uid, { name: m.displayName, color: m.color });
    });
  });
  renderGrid();
  if (selectedDateStr) renderDayDetail(selectedDateStr);
}

function renderMonthLabel() {
  $("cal-month-label").textContent = `${currentMonth.getFullYear()}년 ${currentMonth.getMonth() + 1}월`;
}

function renderGrid() {
  const grid = $("calendar-grid");
  grid.innerHTML = "";

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = todayStr();

  for (let i = 0; i < firstWeekday; i++) {
    const empty = document.createElement("div");
    empty.className = "cal-day empty";
    grid.appendChild(empty);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = toDateStr(new Date(year, month, day));
    const cell = document.createElement("div");
    cell.className = "cal-day";
    if (dateStr === today) cell.classList.add("today");
    if (dateStr === selectedDateStr) cell.classList.add("selected");

    const num = document.createElement("span");
    num.textContent = String(day);
    cell.appendChild(num);

    if (scheduleByDate[dateStr]?.length) {
      const dotRow = document.createElement("div");
      dotRow.className = "dot-row";
      const count = Math.min(scheduleByDate[dateStr].length, 4);
      for (let i = 0; i < count; i++) {
        const dot = document.createElement("span");
        dot.className = "dot";
        dotRow.appendChild(dot);
      }
      cell.appendChild(dotRow);
    }

    const workoutPeople = workoutsByDate[dateStr];
    if (workoutPeople?.size) {
      cell.appendChild(buildAvatarRow(workoutPeople));
    }

    cell.addEventListener("click", () => selectDate(dateStr));
    grid.appendChild(cell);
  }
}

function selectDate(dateStr) {
  selectedDateStr = dateStr;
  document.querySelectorAll(".cal-day").forEach((el) => el.classList.remove("selected"));
  renderGrid();
  renderDayDetail(dateStr);
  $("day-detail").classList.remove("hidden");
}

function renderDayDetail(dateStr) {
  $("day-detail-date").textContent = formatDateLabel(dateStr);
  const list = $("day-schedule-list");
  const entries = scheduleByDate[dateStr] || [];

  if (!entries.length) {
    list.innerHTML = `<p class="empty-hint">아직 등록된 방문 일정이 없어요.</p>`;
  } else {
    list.innerHTML = entries
      .map((e) => {
        const mine = e.uid === state.uid;
        const badge = e.resting
          ? `<span class="time-badge resting">😴 쉬어요</span>`
          : `<span class="time-badge">${escapeHtml(e.time)}</span>`;
        return `<div class="schedule-item ${mine ? "mine" : ""}" data-id="${e.id}" data-mine="${mine}">
          ${badge}
          <div>
            <div class="who">${escapeHtml(e.displayName)}${mine ? " (나)" : ""}</div>
            ${e.note ? `<div class="note">${escapeHtml(e.note)}</div>` : ""}
          </div>
        </div>`;
      })
      .join("");

    list.querySelectorAll(".schedule-item.mine").forEach((el) => {
      el.addEventListener("click", () => openScheduleModal(el.dataset.id));
    });
  }

  const preview = $("day-logs-preview");
  const workoutPeople = workoutsByDate[dateStr];
  if (workoutPeople?.size) {
    const pills = [...workoutPeople.values()]
      .map(({ name, color }) => {
        const initial = escapeHtml((name || "?").trim().charAt(0));
        return `<span class="person-pill">
          <span class="avatar-chip" style="background:${avatarColorFor(name, color)}">${initial}</span>
          ${escapeHtml(name)}
        </span>`;
      })
      .join("");
    preview.innerHTML = `<p class="day-logs-title">💪 이 날 운동 인증</p><div class="person-pill-row">${pills}</div>`;
  } else {
    preview.innerHTML = "";
  }
}

function setResting(resting) {
  restingSelected = resting;
  $("schedule-resting-toggle").classList.toggle("active", resting);
  $("schedule-time").classList.toggle("hidden", resting);
  $("schedule-time").required = !resting;
}

function openScheduleModal(editId) {
  if (!selectedDateStr) {
    showToast("먼저 날짜를 선택해주세요");
    return;
  }
  const form = $("schedule-form");
  form.reset();
  $("schedule-date-label").textContent = formatDateLabel(selectedDateStr);

  const mine = (scheduleByDate[selectedDateStr] || []).find((e) => e.uid === state.uid);
  if (mine) {
    $("schedule-time").value = mine.time || "";
    $("schedule-note").value = mine.note || "";
    $("schedule-delete-btn").classList.remove("hidden");
    setResting(!!mine.resting);
  } else {
    // 빈 칸으로 두면 iOS에서 어색하게 커 보여서, 현재 시간을 기본값으로 채워둔다
    const now = new Date();
    $("schedule-time").value = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    $("schedule-delete-btn").classList.add("hidden");
    setResting(false);
  }

  openModal("modal-schedule");
}

async function onScheduleSubmit(e) {
  e.preventDefault();
  const time = restingSelected ? "" : $("schedule-time").value;
  const note = $("schedule-note").value.trim();
  if (!restingSelected && !time) return;

  showLoading(true);
  try {
    const docId = `${state.uid}_${selectedDateStr}`;
    await setDoc(doc(db, "groups", state.groupId, "schedule", docId), {
      uid: state.uid,
      displayName: state.displayName,
      date: selectedDateStr,
      time,
      note,
      resting: restingSelected,
    });
    closeModal("modal-schedule");
    showToast(restingSelected ? "쉬는 날로 등록했어요 😴" : "일정을 저장했어요");
  } catch (err) {
    showToast(err.message);
  } finally {
    showLoading(false);
  }
}

async function onScheduleDelete() {
  showLoading(true);
  try {
    const docId = `${state.uid}_${selectedDateStr}`;
    await deleteDoc(doc(db, "groups", state.groupId, "schedule", docId));
    closeModal("modal-schedule");
    showToast("일정을 삭제했어요");
  } catch (err) {
    showToast(err.message);
  } finally {
    showLoading(false);
  }
}
