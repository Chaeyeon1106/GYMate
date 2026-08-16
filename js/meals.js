import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  query,
  where,
  onSnapshot,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";
import {
  ref,
  uploadBytes,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-storage.js";
import { db, storage } from "./firebase-init.js";
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
  createPhotoPositioner,
} from "./utils.js";

const MEAL_TYPE_ORDER = ["아침", "점심", "저녁", "간식"];

let selectedVisibility = "group";
let selectedFile = null;
let photoPositioner = null;
let groupLogs = new Map();
let myLogs = new Map();
let unsubFeed = [];

let currentWeekStart = startOfWeek(new Date());
let selectedMealDate = todayStr(); // 항상 특정 날짜를 선택한 상태로 유지
let mealsByDate = {}; // { 'YYYY-MM-DD': Map(uid -> {name, color}) }

function startOfWeek(date) {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
}

function weekLabel(start) {
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const fmt = (d) => `${d.getMonth() + 1}.${d.getDate()}`;
  return `${fmt(start)} - ${fmt(end)}`;
}

export function initMeals() {
  photoPositioner = createPhotoPositioner($("meal-photo-preview-wrap"), $("meal-photo-preview"));

  $("add-meal-btn").addEventListener("click", () => {
    $("meal-form").reset();
    $("meal-date").value = selectedMealDate;
    $("meal-photo-preview-wrap").classList.add("hidden");
    selectedFile = null;
    setVisibility("group");
    openModal("modal-meal");
  });

  $("meal-photo").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    selectedFile = file;
    $("meal-photo-preview").src = URL.createObjectURL(file);
    photoPositioner.reset();
    $("meal-photo-preview-wrap").classList.remove("hidden");
  });

  $("meal-photo-clear").addEventListener("click", () => {
    selectedFile = null;
    $("meal-photo").value = "";
    $("meal-photo-preview-wrap").classList.add("hidden");
  });

  document.querySelectorAll('#modal-meal .vis-btn').forEach((btn) => {
    btn.addEventListener("click", () => setVisibility(btn.dataset.visibility));
  });

  $("meal-form").addEventListener("submit", onSubmitMeal);

  $("meal-feed").addEventListener("click", (e) => {
    const btn = e.target.closest(".delete-btn");
    if (btn) onDeleteMeal(btn.dataset.id);
  });

  $("meal-week-prev").addEventListener("click", () => shiftWeek(-1));
  $("meal-week-next").addEventListener("click", () => shiftWeek(1));

  renderWeekGrid();
  subscribeFeed();
}

function setVisibility(vis) {
  selectedVisibility = vis;
  document.querySelectorAll("#modal-meal .vis-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.visibility === vis);
  });
}

async function onSubmitMeal(e) {
  e.preventDefault();
  const date = $("meal-date").value;
  const time = $("meal-time").value;
  const mealType = $("meal-type").value;
  const calories = $("meal-calories").value ? Number($("meal-calories").value) : null;
  const protein = $("meal-protein").value ? Number($("meal-protein").value) : null;
  const memo = $("meal-memo").value.trim();

  if (!date || !mealType) return;

  showLoading(true);
  try {
    let photoURL = "";
    let photoPosition = "50% 50%";
    if (selectedFile) {
      const path = `meals/${state.groupId}/${state.uid}/${Date.now()}_${selectedFile.name}`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, selectedFile);
      photoURL = await getDownloadURL(storageRef);
      photoPosition = photoPositioner.getPosition();
    }

    await addDoc(collection(db, "groups", state.groupId, "mealLogs"), {
      uid: state.uid,
      displayName: state.displayName,
      color: state.color,
      avatarURL: state.photoURL || "",
      date,
      time,
      mealType,
      calories,
      protein,
      memo,
      photoURL,
      photoPosition,
      visibility: selectedVisibility,
      createdAt: serverTimestamp(),
    });

    closeModal("modal-meal");
    showToast("식단 기록을 저장했어요 🍱");
  } catch (err) {
    showToast(err.message);
  } finally {
    showLoading(false);
  }
}

function subscribeFeed() {
  unsubFeed.forEach((fn) => fn());
  unsubFeed = [];
  groupLogs = new Map();
  myLogs = new Map();

  const base = collection(db, "groups", state.groupId, "mealLogs");

  const groupQ = query(base, where("visibility", "==", "group"));
  unsubFeed.push(onSnapshot(groupQ, (snap) => {
    groupLogs = new Map();
    snap.forEach((d) => groupLogs.set(d.id, { id: d.id, ...d.data() }));
    afterDataChange();
  }));

  const mineQ = query(base, where("uid", "==", state.uid));
  unsubFeed.push(onSnapshot(mineQ, (snap) => {
    myLogs = new Map();
    snap.forEach((d) => myLogs.set(d.id, { id: d.id, ...d.data() }));
    afterDataChange();
  }));
}

// 그룹을 전환했을 때 이전 그룹 구독을 정리하고 새 그룹(state.groupId) 기준으로
// 오늘 날짜부터 다시 보여준다.
export function reloadMeals() {
  currentWeekStart = startOfWeek(new Date());
  selectedMealDate = todayStr();
  subscribeFeed();
}

function getAllItems() {
  const merged = new Map([...groupLogs, ...myLogs]);
  return [...merged.values()];
}

function afterDataChange() {
  rebuildMealsByDate();
  renderWeekGrid();
  renderFeed();
}

function rebuildMealsByDate() {
  mealsByDate = {};
  getAllItems().forEach((log) => {
    if (!mealsByDate[log.date]) mealsByDate[log.date] = new Map();
    mealsByDate[log.date].set(log.uid, { name: log.displayName, color: log.color });
  });
}

function shiftWeek(delta) {
  currentWeekStart.setDate(currentWeekStart.getDate() + delta * 7);
  renderWeekGrid();
}

function renderWeekGrid() {
  $("meal-week-label").textContent = weekLabel(currentWeekStart);

  const grid = $("meal-week-grid");
  grid.innerHTML = "";

  const today = todayStr();

  for (let i = 0; i < 7; i++) {
    const d = new Date(currentWeekStart);
    d.setDate(d.getDate() + i);
    const dateStr = toDateStr(d);

    const cell = document.createElement("div");
    cell.className = "cal-day";
    if (dateStr === today) cell.classList.add("today");
    if (dateStr === selectedMealDate) cell.classList.add("selected");

    const num = document.createElement("span");
    num.textContent = String(d.getDate());
    cell.appendChild(num);

    const people = mealsByDate[dateStr];
    if (people?.size) {
      const row = document.createElement("div");
      row.className = "avatar-row";
      [...people.values()].slice(0, 3).forEach(({ name, color }) => {
        const chip = document.createElement("span");
        chip.className = "avatar-chip";
        chip.style.background = avatarColorFor(name, color);
        chip.textContent = (name || "?").trim().charAt(0);
        chip.title = name;
        row.appendChild(chip);
      });
      if (people.size > 3) {
        const more = document.createElement("span");
        more.className = "avatar-chip avatar-more";
        more.textContent = `+${people.size - 3}`;
        row.appendChild(more);
      }
      cell.appendChild(row);
    }

    cell.addEventListener("click", () => {
      selectedMealDate = dateStr;
      renderWeekGrid();
      renderFeed();
    });
    grid.appendChild(cell);
  }
}

function mealCard(log) {
  const visLabel = log.visibility === "private" ? "🔒 나만" : "👥 그룹";
  const visClass = log.visibility === "private" ? "private" : "";
  const macros = [
    log.calories != null ? `${log.calories}kcal` : null,
    log.protein != null ? `단백질 ${log.protein}g` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const mine = log.uid === state.uid;
  return `<div class="feed-card">
    ${log.photoURL ? `<img src="${log.photoURL}" alt="식단 사진" loading="lazy" style="object-position:${log.photoPosition || "50% 50%"}" />` : ""}
    <div class="feed-card-body">
      <div class="feed-card-top">
        <span class="meal-type-pill">${escapeHtml(log.mealType)}${log.time ? ` · ${escapeHtml(log.time)}` : ""}</span>
        <span class="feed-card-actions">
          <span class="visibility-badge ${visClass}">${visLabel}</span>
          ${mine ? `<button type="button" class="delete-btn" data-id="${log.id}">삭제</button>` : ""}
        </span>
      </div>
      ${log.memo ? `<div class="feed-card-memo">${escapeHtml(log.memo)}</div>` : ""}
      ${macros ? `<div class="feed-card-meta">${escapeHtml(macros)}</div>` : ""}
    </div>
  </div>`;
}

function renderFeed() {
  const items = getAllItems().filter((log) => log.date === selectedMealDate);
  $("meal-filter-label").textContent = `📅 ${formatDateLabel(selectedMealDate)}`;

  const feed = $("meal-feed");
  if (!items.length) {
    feed.innerHTML = `<p class="empty-state">이 날은 기록이 없어요. 오늘 먹은 걸 기록해보세요!</p>`;
    return;
  }

  // 사람별로 묶고, 그 안에서는 아침 → 점심 → 저녁 → 간식 순으로 정렬해
  // 여러 명이 한꺼번에 올려도 한눈에 구분되게 한다.
  const byPerson = new Map();
  items.forEach((log) => {
    if (!byPerson.has(log.uid)) byPerson.set(log.uid, []);
    byPerson.get(log.uid).push(log);
  });

  const people = [...byPerson.entries()].sort((a, b) =>
    (a[1][0].displayName || "").localeCompare(b[1][0].displayName || "", "ko")
  );

  feed.innerHTML = people
    .map(([uid, logs]) => {
      logs.sort((a, b) => {
        const ai = MEAL_TYPE_ORDER.indexOf(a.mealType);
        const bi = MEAL_TYPE_ORDER.indexOf(b.mealType);
        if (ai !== bi) return ai - bi;
        return (a.time || "").localeCompare(b.time || "");
      });
      const first = logs[0];
      const color = avatarColorFor(first.displayName, first.color);
      const authorAvatar = first.avatarURL
        ? `<img class="author-avatar" src="${first.avatarURL}" alt="" />`
        : `<span class="author-avatar author-avatar-fallback" style="background:${color}">${escapeHtml((first.displayName || "?").trim().charAt(0))}</span>`;

      return `<div class="person-section" style="border-left-color:${color}">
        <div class="person-section-header">
          ${authorAvatar}
          <span class="person-section-name">${escapeHtml(first.displayName)}</span>
        </div>
        <div class="person-meals">
          ${logs.map(mealCard).join("")}
        </div>
      </div>`;
    })
    .join("");
}

async function onDeleteMeal(id) {
  if (!confirm("이 식단 기록을 삭제할까요?")) return;
  try {
    await deleteDoc(doc(db, "groups", state.groupId, "mealLogs", id));
    showToast("삭제했어요");
  } catch (err) {
    showToast(err.message);
  }
}
