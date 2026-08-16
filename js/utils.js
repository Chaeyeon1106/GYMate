export const $ = (id) => document.getElementById(id);

export function showScreen(id) {
  document.querySelectorAll(".screen").forEach((el) => el.classList.add("hidden"));
  $(id).classList.remove("hidden");
}

let toastTimer = null;
export function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 2200);
}

export function showLoading(isLoading) {
  $("loading-overlay").classList.toggle("hidden", !isLoading);
}

export function openModal(id) {
  $(id).classList.remove("hidden");
}

export function closeModal(id) {
  $(id).classList.add("hidden");
}

// Date -> 'YYYY-MM-DD' (로컬 타임존 기준)
export function toDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function todayStr() {
  return toDateStr(new Date());
}

export function formatDateLabel(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
  return `${m}월 ${d}일 (${weekdays[date.getDay()]})`;
}

// 카톡 등으로 공유한 초대 링크(?join=CODE)로 들어온 경우, 코드를 기억해뒀다가
// 로그인 후 그룹 화면이 뜰 때 자동으로 채워준다.
export function captureJoinCodeFromURL() {
  const params = new URLSearchParams(location.search);
  const code = params.get("join");
  if (!code) return;
  sessionStorage.setItem("gymate-pending-join", code.toUpperCase());
  const url = new URL(location.href);
  url.searchParams.delete("join");
  history.replaceState({}, "", url);
}

export function applyPendingJoinCode() {
  const code = sessionStorage.getItem("gymate-pending-join");
  if (!code) return;
  sessionStorage.removeItem("gymate-pending-join");
  document.querySelector('.group-tab[data-group-tab="join"]')?.click();
  const input = $("group-code-input");
  if (input) input.value = code;
}

export function generateJoinCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// 아바타 색상: 회원가입 때 고른 색이 있으면 그걸 쓰고, 없으면(예: 예전 계정) 이름으로 자동 배정
export const AVATAR_COLORS = ["#ff5e3a", "#b6ff3b", "#3ac6ff", "#ff9f3a", "#c47bff", "#3affc4"];

export function avatarColorFor(name, color) {
  if (color) return color;
  let sum = 0;
  for (const ch of name || "?") sum += ch.charCodeAt(0);
  return AVATAR_COLORS[sum % AVATAR_COLORS.length];
}

// 밝은/어두운 테마 전환. index.html의 인라인 스크립트가 로드 시점에 먼저
// 저장된 값을 적용해두므로(깜빡임 방지), 여기서는 사용자가 바꿀 때만 갱신한다.
export function getTheme() {
  return localStorage.getItem("gymate-theme") || "dark";
}

export function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("gymate-theme", theme);
}

// 사진 위치(크롭) 조정: 프레임은 4:3 고정, 드래그로 object-position만 옮긴다
// (원본 사진은 그대로 두고 "보여줄 위치"만 저장하는 방식).
export function createPhotoPositioner(wrapEl, imgEl) {
  let pos = { x: 50, y: 50 };
  let dragging = false;
  let startX, startY, startPos;
  let overflowX = 0;
  let overflowY = 0;

  function computeOverflow() {
    const rect = wrapEl.getBoundingClientRect();
    const iw = imgEl.naturalWidth;
    const ih = imgEl.naturalHeight;
    if (!iw || !ih || !rect.width || !rect.height) {
      overflowX = 0;
      overflowY = 0;
      return;
    }
    const scale = Math.max(rect.width / iw, rect.height / ih);
    overflowX = Math.max(0, iw * scale - rect.width);
    overflowY = Math.max(0, ih * scale - rect.height);
  }

  function clamp(v) {
    return Math.max(0, Math.min(100, v));
  }

  function apply() {
    wrapEl.style.setProperty("--pos", `${pos.x}% ${pos.y}%`);
  }

  imgEl.addEventListener("load", computeOverflow);

  wrapEl.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".photo-clear-btn")) return;
    dragging = true;
    computeOverflow();
    wrapEl.classList.add("dragging");
    startX = e.clientX;
    startY = e.clientY;
    startPos = { ...pos };
    wrapEl.setPointerCapture(e.pointerId);
  });
  wrapEl.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    pos.x = overflowX > 0 ? clamp(startPos.x - (dx / overflowX) * 100) : 50;
    pos.y = overflowY > 0 ? clamp(startPos.y - (dy / overflowY) * 100) : 50;
    apply();
  });
  const endDrag = () => {
    dragging = false;
    wrapEl.classList.remove("dragging");
  };
  wrapEl.addEventListener("pointerup", endDrag);
  wrapEl.addEventListener("pointercancel", endDrag);

  return {
    reset() {
      pos = { x: 50, y: 50 };
      apply();
    },
    setPosition(positionStr) {
      const [x, y] = (positionStr || "50% 50%").split(" ").map((v) => parseFloat(v) || 50);
      pos = { x, y };
      apply();
    },
    getPosition() {
      return `${Math.round(pos.x)}% ${Math.round(pos.y)}%`;
    },
  };
}
