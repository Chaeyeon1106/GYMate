import {
  collection,
  addDoc,
  updateDoc,
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
import { loadGroupMembers } from "./auth.js";
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

let selectedVisibility = "group";
let selectedFile = null;
let photoPositioner = null;
let photoCleared = false;
let editingId = null;
let editingPhotoURL = "";
let editingPhotoPosition = "50% 50%";
let groupLogs = new Map();
let myLogs = new Map();
let taggedLogs = new Map();
let selectedTaggedMembers = []; // [{uid, displayName, color}]
let unsubFeed = [];

let currentWeekStart = startOfWeek(new Date());
let selectedWorkoutDate = todayStr(); // 항상 특정 날짜를 선택한 상태로 유지
let workoutsByDate = {}; // { 'YYYY-MM-DD': Map(uid -> {name, color}) }

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

export function initWorkouts() {
  $("workout-today-date-label").textContent = formatDateLabel(todayStr());
  $("quick-photo-btn").addEventListener("click", () => openWorkoutModal());

  photoPositioner = createPhotoPositioner($("workout-photo-preview-wrap"), $("workout-photo-preview"));

  $("workout-photo").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    selectedFile = file;
    photoCleared = false;
    $("workout-photo-preview").src = URL.createObjectURL(file);
    photoPositioner.reset();
    $("workout-photo-preview-wrap").classList.remove("hidden");
  });

  $("workout-photo-clear").addEventListener("click", () => {
    selectedFile = null;
    photoCleared = true;
    $("workout-photo").value = "";
    $("workout-photo-preview-wrap").classList.add("hidden");
  });

  $("workout-feed").addEventListener("click", (e) => {
    const deleteBtn = e.target.closest(".delete-btn");
    if (deleteBtn) onDeleteWorkout(deleteBtn.dataset.id);
    const editBtn = e.target.closest(".edit-btn");
    if (editBtn) {
      const log = getAllItems().find((l) => l.id === editBtn.dataset.id);
      if (log) openWorkoutModal(log);
    }
  });

  document.querySelectorAll('#modal-workout .vis-btn').forEach((btn) => {
    btn.addEventListener("click", () => setVisibility(btn.dataset.visibility, "#modal-workout"));
  });

  $("workout-form").addEventListener("submit", onSubmitWorkout);

  $("workout-week-prev").addEventListener("click", () => shiftWeek(-1));
  $("workout-week-next").addEventListener("click", () => shiftWeek(1));

  renderWeekGrid();
  subscribeFeed();
}

async function openWorkoutModal(log) {
  $("workout-form").reset();
  photoCleared = false;

  if (log) {
    editingId = log.id;
    editingPhotoURL = log.photoURL || "";
    editingPhotoPosition = log.photoPosition || "50% 50%";
    $("workout-modal-title").textContent = "운동 기록 수정";
    $("workout-date").value = log.date;
    $("workout-duration").value = log.duration;
    $("workout-location").value = log.location;
    $("workout-memo").value = log.memo || "";
    $("workout-feedback").value = log.feedback || "";
    selectedTaggedMembers = [...(log.taggedMembers || [])];
    setVisibility(log.visibility || "group", "#modal-workout");
    if (editingPhotoURL) {
      $("workout-photo-preview").src = editingPhotoURL;
      $("workout-photo-preview-wrap").classList.remove("hidden");
      photoPositioner.setPosition(editingPhotoPosition);
    } else {
      $("workout-photo-preview-wrap").classList.add("hidden");
    }
  } else {
    editingId = null;
    editingPhotoURL = "";
    editingPhotoPosition = "50% 50%";
    $("workout-modal-title").textContent = "운동 기록 추가";
    $("workout-date").value = selectedWorkoutDate || todayStr();
    $("workout-location").value = "바오짐";
    $("workout-photo-preview-wrap").classList.add("hidden");
    selectedTaggedMembers = [];
    setVisibility("group", "#modal-workout");
  }

  selectedFile = null;
  openModal("modal-workout");
  renderTagFriendList();
}

async function renderTagFriendList() {
  const wrap = $("workout-tag-friends");
  const others = state.memberUids.filter((uid) => uid !== state.uid);
  if (!others.length) {
    wrap.innerHTML = `<p class="empty-hint">같이 태그할 그룹원이 아직 없어요. (그룹원 ${state.memberUids.length}명)</p>`;
    return;
  }
  let members;
  try {
    members = await loadGroupMembers(others);
  } catch (err) {
    wrap.innerHTML = `<p class="empty-hint">그룹원 목록을 불러오지 못했어요: ${escapeHtml(err.message)}</p>`;
    return;
  }
  wrap.innerHTML = members
    .map((m) => {
      const initial = escapeHtml((m.displayName || "?").trim().charAt(0));
      const active = selectedTaggedMembers.some((sel) => sel.uid === m.uid);
      return `<button type="button" class="tag-friend-chip ${active ? "active" : ""}" data-uid="${m.uid}" data-name="${escapeHtml(m.displayName)}" data-color="${m.color || ""}">
        <span class="avatar-chip" style="background:${avatarColorFor(m.displayName, m.color)}">${initial}</span>
        ${escapeHtml(m.displayName)}
      </button>`;
    })
    .join("");

  wrap.querySelectorAll(".tag-friend-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      const uid = btn.dataset.uid;
      const idx = selectedTaggedMembers.findIndex((m) => m.uid === uid);
      if (idx >= 0) {
        selectedTaggedMembers.splice(idx, 1);
        btn.classList.remove("active");
      } else {
        selectedTaggedMembers.push({ uid, displayName: btn.dataset.name, color: btn.dataset.color });
        btn.classList.add("active");
      }
    });
  });
}

function setVisibility(vis, scope) {
  selectedVisibility = vis;
  document.querySelectorAll(`${scope} .vis-btn`).forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.visibility === vis);
  });
}

async function onSubmitWorkout(e) {
  e.preventDefault();
  const date = $("workout-date").value;
  const duration = Number($("workout-duration").value);
  const location = $("workout-location").value.trim();
  const memo = $("workout-memo").value.trim();
  const feedback = $("workout-feedback").value.trim();

  if (!date || !duration || !location) return;

  showLoading(true);
  try {
    let photoURL = "";
    let photoPosition = "50% 50%";
    if (selectedFile) {
      const path = `workouts/${state.groupId}/${state.uid}/${Date.now()}_${selectedFile.name}`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, selectedFile);
      photoURL = await getDownloadURL(storageRef);
      photoPosition = photoPositioner.getPosition();
    } else if (!photoCleared && editingId && editingPhotoURL) {
      // 기존 사진을 그대로 두거나 위치만 다시 조정한 경우
      photoURL = editingPhotoURL;
      photoPosition = photoPositioner.getPosition();
    }

    const payload = {
      date,
      duration,
      location,
      memo,
      feedback,
      photoURL,
      photoPosition,
      visibility: selectedVisibility,
      taggedUids: selectedTaggedMembers.map((m) => m.uid),
      taggedMembers: selectedTaggedMembers,
    };

    if (editingId) {
      await updateDoc(doc(db, "groups", state.groupId, "workoutLogs", editingId), payload);
    } else {
      await addDoc(collection(db, "groups", state.groupId, "workoutLogs"), {
        uid: state.uid,
        displayName: state.displayName,
        color: state.color,
        avatarURL: state.photoURL || "",
        ...payload,
        createdAt: serverTimestamp(),
      });
    }

    closeModal("modal-workout");
    showToast(
      editingId
        ? "운동 기록을 수정했어요"
        : selectedTaggedMembers.length
        ? `운동 기록을 저장했어요 💪 (${selectedTaggedMembers.map((m) => m.displayName).join(", ")} 태그됨)`
        : "운동 기록을 저장했어요 💪"
    );
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
  taggedLogs = new Map();

  const base = collection(db, "groups", state.groupId, "workoutLogs");

  // Firestore 규칙상 list 쿼리는 rule과 정확히 대응하는 where() 필터가 있어야
  // 통과되므로(공개 여부를 OR로 검사하는 규칙이라 필터 없는 단일 쿼리로는 불가능),
  // "그룹 공개" 글과 "내 글"을 각각 필터링해 따로 구독한 뒤 합친다.
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

  // 내가 태그된(같이 운동한 친구로 지정된) 기록도 내 활동으로 함께 봐야 하므로
  // 별도 쿼리로 구독해서 합친다.
  const taggedQ = query(base, where("taggedUids", "array-contains", state.uid));
  unsubFeed.push(onSnapshot(taggedQ, (snap) => {
    taggedLogs = new Map();
    snap.forEach((d) => taggedLogs.set(d.id, { id: d.id, ...d.data() }));
    afterDataChange();
  }));
}

// 그룹을 전환했을 때 이전 그룹 구독을 정리하고 새 그룹(state.groupId) 기준으로
// 오늘 날짜부터 다시 보여준다.
export function reloadWorkouts() {
  currentWeekStart = startOfWeek(new Date());
  selectedWorkoutDate = todayStr();
  subscribeFeed();
}

function getAllItems() {
  const merged = new Map([...groupLogs, ...myLogs, ...taggedLogs]);
  return [...merged.values()];
}

function afterDataChange() {
  rebuildWorkoutsByDate();
  renderWeekGrid();
  renderFeed();
}

function rebuildWorkoutsByDate() {
  workoutsByDate = {};
  getAllItems().forEach((log) => {
    if (!workoutsByDate[log.date]) workoutsByDate[log.date] = new Map();
    workoutsByDate[log.date].set(log.uid, { name: log.displayName, color: log.color });
    (log.taggedMembers || []).forEach((m) => {
      workoutsByDate[log.date].set(m.uid, { name: m.displayName, color: m.color });
    });
  });
}

function shiftWeek(delta) {
  currentWeekStart.setDate(currentWeekStart.getDate() + delta * 7);
  renderWeekGrid();
}

function renderWeekGrid() {
  $("workout-week-label").textContent = weekLabel(currentWeekStart);

  const grid = $("workout-week-grid");
  grid.innerHTML = "";

  const today = todayStr();

  for (let i = 0; i < 7; i++) {
    const d = new Date(currentWeekStart);
    d.setDate(d.getDate() + i);
    const dateStr = toDateStr(d);

    const cell = document.createElement("div");
    cell.className = "cal-day";
    if (dateStr === today) cell.classList.add("today");
    if (dateStr === selectedWorkoutDate) cell.classList.add("selected");

    const num = document.createElement("span");
    num.textContent = String(d.getDate());
    cell.appendChild(num);

    const people = workoutsByDate[dateStr];
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
      selectedWorkoutDate = dateStr;
      renderWeekGrid();
      renderFeed();
    });
    grid.appendChild(cell);
  }
}

function renderFeed() {
  const items = getAllItems().filter((log) => log.date === selectedWorkoutDate);
  $("workout-filter-label").textContent = `📅 ${formatDateLabel(selectedWorkoutDate)}`;

  items.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

  const feed = $("workout-feed");
  if (!items.length) {
    feed.innerHTML = `<p class="empty-state">이 날은 기록이 없어요. 첫 운동을 기록해보세요!</p>`;
    return;
  }

  feed.innerHTML = items
    .map((log) => {
      const visLabel = log.visibility === "private" ? "🔒 나만 공개" : "";
      const authorAvatar = log.avatarURL
        ? `<img class="author-avatar" src="${log.avatarURL}" alt="" />`
        : `<span class="author-avatar author-avatar-fallback" style="background:${avatarColorFor(log.displayName, log.color)}">${escapeHtml((log.displayName || "?").trim().charAt(0))}</span>`;
      const mine = log.uid === state.uid;
      const iAmTagged = !mine && (log.taggedUids || []).includes(state.uid);
      const tagPills = (log.taggedMembers || [])
        .map((m) => `<span class="tag ${m.uid === state.uid ? "tag-accent" : ""}">🏷 ${escapeHtml(m.displayName)}</span>`)
        .join("");
      return `<div class="feed-card">
        ${log.photoURL ? `<img src="${log.photoURL}" alt="운동 인증사진" loading="lazy" style="object-position:${log.photoPosition || "50% 50%"}" />` : ""}
        <div class="feed-card-body">
          <div class="feed-card-top">
            <span class="feed-card-author">${authorAvatar}${escapeHtml(log.displayName)}${iAmTagged ? ` <span class="tag tag-accent">나 태그됨</span>` : ""}</span>
            <span class="feed-card-actions">
              ${visLabel ? `<span class="visibility-badge private">${visLabel}</span>` : ""}
              ${mine ? `<button type="button" class="edit-btn" data-id="${log.id}">수정</button>` : ""}
              ${mine ? `<button type="button" class="delete-btn" data-id="${log.id}">삭제</button>` : ""}
            </span>
          </div>
          <div class="feed-card-meta">${escapeHtml(log.date)} · ${log.duration}분 · ${escapeHtml(log.location)}</div>
          ${tagPills ? `<div class="feed-card-tags">${tagPills}</div>` : ""}
          ${log.memo ? `<div class="feed-card-memo">${escapeHtml(log.memo)}</div>` : ""}
          ${log.feedback ? `<div class="feed-card-feedback">🔧 ${escapeHtml(log.feedback)}</div>` : ""}
        </div>
      </div>`;
    })
    .join("");
}

async function onDeleteWorkout(id) {
  if (!confirm("이 운동 기록을 삭제할까요?")) return;
  try {
    await deleteDoc(doc(db, "groups", state.groupId, "workoutLogs", id));
    showToast("삭제했어요");
  } catch (err) {
    showToast(err.message);
  }
}
