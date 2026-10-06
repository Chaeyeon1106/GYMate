import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js";
import { auth } from "./firebase-init.js";
import { state, resetState } from "./state.js";
import {
  signUp,
  logIn,
  logOut,
  loadUserProfile,
  createGroup,
  joinGroupByCode,
  loadGroup,
} from "./auth.js";
import { initCalendar, reloadCalendar } from "./calendar.js";
import { initWorkouts, reloadWorkouts } from "./workouts.js";
import { initMeals, reloadMeals } from "./meals.js";
import { initProfile, renderGroupCard } from "./profile.js";
import { initStats } from "./stats.js";
import { initChat, reloadChat, onChatTabEnter } from "./chat.js";
import {
  $,
  showScreen,
  showToast,
  showLoading,
  closeModal,
  AVATAR_COLORS,
  getTheme,
  applyTheme,
  captureJoinCodeFromURL,
  applyPendingJoinCode,
} from "./utils.js";

captureJoinCodeFromURL();

// ===== 알림 눌러서 들어온 경우: 해당 탭/그룹으로 바로 이동 =====
function captureNotificationTargetFromURL() {
  const params = new URLSearchParams(location.search);
  const tab = params.get("tab");
  const groupId = params.get("group");
  if (!tab && !groupId) return null;
  const url = new URL(location.href);
  url.searchParams.delete("tab");
  url.searchParams.delete("group");
  history.replaceState({}, "", url);
  return { tab, groupId };
}
let pendingNotificationTarget = captureNotificationTargetFromURL();

function goToNotificationTarget(tab, groupId) {
  if (groupId && groupId !== state.groupId && state.groupIds.includes(groupId)) {
    switchGroup(groupId).then(() => {
      if (tab) document.querySelector(`.nav-btn[data-tab="${tab}"]`)?.click();
    });
  } else if (tab) {
    document.querySelector(`.nav-btn[data-tab="${tab}"]`)?.click();
  }
}

// 앱이 이미 켜져있는 상태에서 알림을 누른 경우, 서비스워커가 이 메시지를 보내온다.
navigator.serviceWorker?.addEventListener("message", (event) => {
  if (event.data?.type === "gymate:notification-click") {
    goToNotificationTarget(event.data.tab, event.data.groupId);
  }
});

// 활성(마지막으로 보고 있던) 그룹을 기기에 기억해뒀다가 다음에 로그인할 때 그대로 이어본다.
function activeGroupKey() {
  return `gymate-active-group-${state.uid}`;
}
function rememberActiveGroup(groupId) {
  localStorage.setItem(activeGroupKey(), groupId);
}

let appInitialized = false;
let selectedSignupColor = AVATAR_COLORS[0];

// ===== 채팅 입력창을 하단 탭바 실제 높이 바로 위에 붙인다 =====
function syncNavHeight() {
  const height = $("app").querySelector(".bottom-nav")?.getBoundingClientRect().height;
  if (height) document.documentElement.style.setProperty("--nav-height", `${height}px`);
}
new ResizeObserver(syncNavHeight).observe(document.querySelector(".bottom-nav"));
window.addEventListener("resize", syncNavHeight);

// 채팅 탭 높이 계산(헤더+하단바를 뺀 나머지)에 쓰기 위해 헤더 실제 높이도 재둔다.
function syncHeaderHeight() {
  const height = $("app").querySelector(".app-header")?.getBoundingClientRect().height;
  if (height) document.documentElement.style.setProperty("--header-height", `${height}px`);
}
new ResizeObserver(syncHeaderHeight).observe(document.querySelector(".app-header"));
window.addEventListener("resize", syncHeaderHeight);

// ===== 테마(다크/라이트) =====
document.querySelectorAll("[data-theme-btn]").forEach((btn) => {
  btn.classList.toggle("active", btn.dataset.themeBtn === getTheme());
  btn.addEventListener("click", () => {
    applyTheme(btn.dataset.themeBtn);
    document.querySelectorAll("[data-theme-btn]").forEach((b) => b.classList.toggle("active", b === btn));
  });
});

// ===== 로그인 / 회원가입 폼 전환 =====
$("show-signup").addEventListener("click", (e) => {
  e.preventDefault();
  $("login-form").classList.add("hidden");
  $("signup-form").classList.remove("hidden");
  $("auth-error").classList.add("hidden");
});
$("show-login").addEventListener("click", (e) => {
  e.preventDefault();
  $("signup-form").classList.add("hidden");
  $("login-form").classList.remove("hidden");
  $("auth-error").classList.add("hidden");
});

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  showLoading(true);
  try {
    await logIn($("login-email").value.trim(), $("login-password").value);
  } catch (err) {
    showAuthError(err);
  } finally {
    showLoading(false);
  }
});

document.querySelectorAll("#signup-color-picker .color-swatch").forEach((btn) => {
  btn.addEventListener("click", () => {
    selectedSignupColor = btn.dataset.color;
    document.querySelectorAll("#signup-color-picker .color-swatch").forEach((b) => b.classList.remove("selected"));
    btn.classList.add("selected");
  });
});

$("signup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  showLoading(true);
  try {
    await signUp(
      $("signup-name").value.trim(),
      $("signup-email").value.trim(),
      $("signup-password").value,
      selectedSignupColor
    );
  } catch (err) {
    showAuthError(err);
  } finally {
    showLoading(false);
  }
});

function showAuthError(err) {
  const el = $("auth-error");
  el.textContent = translateFirebaseError(err.message);
  el.classList.remove("hidden");
}

function translateFirebaseError(message) {
  if (message.includes("auth/email-already-in-use")) return "이미 가입된 이메일이에요.";
  if (message.includes("auth/invalid-credential") || message.includes("auth/wrong-password")) return "이메일 또는 비밀번호가 올바르지 않아요.";
  if (message.includes("auth/user-not-found")) return "가입되지 않은 이메일이에요.";
  if (message.includes("auth/weak-password")) return "비밀번호는 6자 이상이어야 해요.";
  if (message.includes("auth/invalid-email")) return "올바른 이메일 형식이 아니에요.";
  return message;
}

// ===== 그룹 만들기 / 참여 =====
document.querySelectorAll(".group-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".group-tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const target = btn.dataset.groupTab;
    $("group-create-form").classList.toggle("hidden", target !== "create");
    $("group-join-form").classList.toggle("hidden", target !== "join");
    $("group-error").classList.add("hidden");
  });
});

$("group-create-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  showLoading(true);
  try {
    const name = $("group-name-input").value.trim();
    const group = await createGroup(name, state.uid);
    state.groupIds = [...new Set([...state.groupIds, group.groupId])];
    rememberActiveGroup(group.groupId);
    await enterApp(group);
  } catch (err) {
    showGroupError(err);
  } finally {
    showLoading(false);
  }
});

$("group-join-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  showLoading(true);
  try {
    const code = $("group-code-input").value.trim();
    const group = await joinGroupByCode(code, state.uid);
    state.groupIds = [...new Set([...state.groupIds, group.groupId])];
    rememberActiveGroup(group.groupId);
    await enterApp(group);
  } catch (err) {
    showGroupError(err);
  } finally {
    showLoading(false);
  }
});

function showGroupError(err) {
  const el = $("group-error");
  el.textContent = err.message;
  el.classList.remove("hidden");
}

$("group-back-btn").addEventListener("click", () => showScreen("app"));
$("group-logout-btn").addEventListener("click", () => logOut());

// ===== 로그아웃 =====
$("logout-btn").addEventListener("click", () => logOut());
$("logout-btn-2").addEventListener("click", () => logOut());

// ===== 탭 전환 =====
document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    $(btn.dataset.tab).classList.add("active");
    // ResizeObserver/resize 이벤트가 뷰포트 변경을 항상 잡아내지 못하는 경우가
    // 있어(예: 방향 전환), 채팅 탭으로 올 때마다 다시 한번 정확히 측정해둔다.
    if (btn.dataset.tab === "tab-chat") {
      syncNavHeight();
      syncHeaderHeight();
      onChatTabEnter();
    }
  });
});

// ===== 모달 닫기 =====
document.querySelectorAll(".modal-close").forEach((btn) => {
  btn.addEventListener("click", () => closeModal(btn.dataset.modal));
});
document.querySelectorAll(".modal").forEach((modal) => {
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.add("hidden");
  });
});

// ===== 운동/식단 모달의 공개범위 토글 공용 처리 =====
// (workouts.js / meals.js 내부에서 각자 바인딩)

// ===== 초대코드 복사 =====
$("copy-code-btn").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(state.joinCode || "");
    showToast("초대코드를 복사했어요");
  } catch {
    showToast("복사에 실패했어요. 직접 선택해서 복사해주세요.");
  }
});

// ===== 앱 진입 (처음 로그인 / 그룹 추가 / 그룹 전환 모두 여기를 거친다) =====
async function enterApp(group) {
  state.groupId = group.groupId;
  state.groupName = group.name;
  state.groupOwnerUid = group.ownerUid;
  state.memberUids = group.memberUids || [];
  state.joinCode = group.joinCode;

  $("user-name").textContent = state.displayName;
  $("invite-code-display").textContent = group.joinCode;

  showScreen("app");
  syncNavHeight();
  syncHeaderHeight();
  showLoading(false);

  if (!appInitialized) {
    appInitialized = true;
    initCalendar();
    initWorkouts();
    initMeals();
    initProfile();
    initStats();
    initChat();
  } else {
    // 이미 앱을 쓰던 중 다른 그룹으로 전환한 경우: 이전 그룹 구독을 정리하고
    // 새 그룹 기준으로 다시 구독/렌더링한다.
    reloadCalendar();
    reloadWorkouts();
    reloadMeals();
    reloadChat();
    renderGroupCard();
  }

  if (pendingNotificationTarget) {
    const target = pendingNotificationTarget;
    pendingNotificationTarget = null;
    goToNotificationTarget(target.tab, target.groupId);
  }
}

// ===== 그룹 전환 (마이 탭의 그룹 스위처에서 발생) =====
async function switchGroup(groupId) {
  if (groupId === state.groupId) return;
  showLoading(true);
  try {
    const group = await loadGroup(groupId);
    if (!group) {
      showToast("그룹 정보를 불러올 수 없어요");
      return;
    }
    rememberActiveGroup(groupId);
    await enterApp(group);
    showToast(`${group.name} 그룹으로 전환했어요`);
  } finally {
    showLoading(false);
  }
}
document.addEventListener("gymate:switch-group", (e) => switchGroup(e.detail.groupId));

// ===== 마지막 그룹까지 탈퇴한 경우: 그룹 만들기/참여 화면으로 되돌린다 =====
document.addEventListener("gymate:no-groups-left", () => {
  localStorage.removeItem(activeGroupKey());
  $("group-back-btn").classList.add("hidden");
  showScreen("group-screen");
});

// ===== 인증 상태 감지 =====
onAuthStateChanged(auth, async (user) => {
  if (user) {
    const profile = await loadUserProfile(user);
    state.uid = user.uid;
    state.displayName = profile.displayName;
    state.color = profile.color || AVATAR_COLORS[0];
    state.photoURL = profile.photoURL || "";
    state.bio = profile.bio || "";
    state.goal = profile.goal || "";
    state.notifyPrefs = profile.notifyPrefs || {};
    state.groupIds = profile.groupIds || [];

    if (!state.groupIds.length) {
      $("group-back-btn").classList.add("hidden");
      showScreen("group-screen");
      applyPendingJoinCode();
      showLoading(false);
      return;
    }

    // 마지막으로 보고 있던 그룹을 기억해뒀다가 우선 시도하고, 없으면 순서대로 시도한다
    // (예: 그 그룹에서 탈퇴/삭제된 경우를 대비).
    const saved = localStorage.getItem(activeGroupKey());
    const candidates =
      saved && state.groupIds.includes(saved)
        ? [saved, ...state.groupIds.filter((id) => id !== saved)]
        : state.groupIds;

    let group = null;
    for (const gid of candidates) {
      group = await loadGroup(gid);
      if (group) break;
    }

    if (!group) {
      $("group-back-btn").classList.add("hidden");
      showScreen("group-screen");
      applyPendingJoinCode();
      showLoading(false);
      return;
    }
    rememberActiveGroup(group.groupId);
    await enterApp(group);
  } else if (appInitialized) {
    // 로그인된 상태로 앱을 쓰던 중 로그아웃하면, 이전 세션의 realtime
    // 구독(캘린더/운동/식단)이 남아있을 수 있어 페이지를 새로고침해 깨끗하게 리셋한다.
    location.reload();
  } else {
    resetState();
    showScreen("auth-screen");
    showLoading(false);
  }
});
