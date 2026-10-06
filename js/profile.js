import {
  ref,
  uploadBytes,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-storage.js";
import { storage } from "./firebase-init.js";
import { state } from "./state.js";
import { saveProfile, saveGoal, saveNotifyPref, saveGroupReactionEmojis, renameGroup, leaveGroup, deleteGroup, loadGroupMembers, loadUserGroups } from "./auth.js";
import { $, showScreen, showToast, showLoading, escapeHtml, avatarColorFor, applyPendingJoinCode } from "./utils.js";
import { rerenderWorkoutFeed } from "./workouts.js";
import { enablePush, disablePush, getNotificationPermission, isPushEnabledLocally } from "./push.js";

let selectedAvatarFile = null;

export function initProfile() {
  $("profile-name-input").value = state.displayName || "";
  $("profile-bio-input").value = state.bio || "";
  renderAvatarPreview(state.photoURL);

  $("profile-photo-input").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    selectedAvatarFile = file;
    renderAvatarPreview(URL.createObjectURL(file));
  });

  $("profile-save-btn").addEventListener("click", onSaveProfile);

  $("goal-input").value = state.goal || "";
  $("goal-save-btn").addEventListener("click", onSaveGoal);

  $("group-name-edit-btn").addEventListener("click", () => {
    $("group-rename-input").value = state.groupName || "";
    $("group-name-edit-row").classList.remove("hidden");
  });
  $("group-name-save-btn").addEventListener("click", onSaveGroupName);
  $("group-reaction-add-btn").addEventListener("click", onAddGroupReaction);
  $("group-reaction-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") onAddGroupReaction();
  });
  $("group-reaction-list").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-remove-emoji]");
    if (btn) onRemoveGroupReaction(btn.dataset.removeEmoji);
  });

  $("add-group-btn").addEventListener("click", () => {
    $("group-back-btn").classList.remove("hidden");
    showScreen("group-screen");
    applyPendingJoinCode();
  });

  $("leave-group-btn").addEventListener("click", onLeaveGroup);
  $("delete-group-btn").addEventListener("click", onDeleteGroup);
  $("share-invite-btn").addEventListener("click", onShareInvite);

  $("enable-push-btn").addEventListener("click", onEnablePush);
  $("disable-push-btn").addEventListener("click", onDisablePush);
  refreshPushStatus();

  document.querySelectorAll("[data-notify-pref]").forEach((box) => {
    const type = box.dataset.notifyPref;
    box.checked = state.notifyPrefs[type] === true;
    box.addEventListener("change", () => onToggleNotifyPref(box, type));
  });

  renderGroupCard();
}

async function onLeaveGroup() {
  if (!confirm(`"${state.groupName || "그룹"}"에서 탈퇴할까요? 그룹원 목록에서 빠지고, 내가 올린 기록도 더 이상 이 그룹에서 보이지 않아요.`)) return;

  showLoading(true);
  try {
    const leftGroupId = state.groupId;
    await leaveGroup(leftGroupId, state.uid);
    state.groupIds = state.groupIds.filter((id) => id !== leftGroupId);
    showToast("그룹에서 탈퇴했어요");

    if (state.groupIds.length) {
      document.dispatchEvent(new CustomEvent("gymate:switch-group", { detail: { groupId: state.groupIds[0] } }));
    } else {
      document.dispatchEvent(new CustomEvent("gymate:no-groups-left"));
    }
  } catch (err) {
    showToast(err.message);
  } finally {
    showLoading(false);
  }
}

async function onDeleteGroup() {
  if (
    !confirm(
      `"${state.groupName || "그룹"}"을 완전히 삭제할까요? 그룹원 전체가 이 그룹에서 빠지고, 되돌릴 수 없어요.`
    )
  )
    return;

  showLoading(true);
  try {
    const deletedGroupId = state.groupId;
    await deleteGroup(deletedGroupId, state.uid);
    state.groupIds = state.groupIds.filter((id) => id !== deletedGroupId);
    showToast("그룹을 삭제했어요");

    if (state.groupIds.length) {
      document.dispatchEvent(new CustomEvent("gymate:switch-group", { detail: { groupId: state.groupIds[0] } }));
    } else {
      document.dispatchEvent(new CustomEvent("gymate:no-groups-left"));
    }
  } catch (err) {
    showToast(err.message);
  } finally {
    showLoading(false);
  }
}

async function onShareInvite() {
  const url = `https://gymate-6872e.web.app/?join=${state.joinCode}`;
  const shareData = {
    title: "GYMate 그룹 초대",
    text: `"${state.groupName}" 그룹에 초대해요! GYMate 앱에서 같이 운동해요 💪`,
    url,
  };

  if (navigator.share) {
    try {
      await navigator.share(shareData);
    } catch (err) {
      if (err.name !== "AbortError") showToast("공유에 실패했어요");
    }
    return;
  }

  try {
    await navigator.clipboard.writeText(url);
    showToast("초대 링크를 복사했어요. 친구에게 붙여넣어 보내주세요");
  } catch {
    showToast("공유를 지원하지 않는 환경이에요. 초대코드로 알려주세요.");
  }
}

function refreshPushStatus() {
  const permission = getNotificationPermission();
  const label = $("push-status-label");
  const enableBtn = $("enable-push-btn");
  const disableBtn = $("disable-push-btn");

  if (permission === "denied") {
    label.textContent = "알림이 차단돼 있어요. 기기 설정에서 허용해주세요.";
    enableBtn.classList.add("hidden");
    disableBtn.classList.add("hidden");
  } else if (permission === "granted" && isPushEnabledLocally()) {
    label.textContent = "알림이 켜져 있어요 🔔";
    enableBtn.classList.add("hidden");
    disableBtn.classList.remove("hidden");
  } else {
    label.textContent = "채팅 메시지 · 태그 · 방문시간 알림을 받아보세요";
    enableBtn.classList.remove("hidden");
    disableBtn.classList.add("hidden");
  }
}

async function onEnablePush() {
  showLoading(true);
  try {
    await enablePush();
    showToast("알림을 켰어요 🔔");
    refreshPushStatus();
  } catch (err) {
    showToast(err.message);
  } finally {
    showLoading(false);
  }
}

async function onDisablePush() {
  showLoading(true);
  try {
    await disablePush();
    showToast("알림을 껐어요 🔕");
    refreshPushStatus();
  } catch (err) {
    showToast(err.message);
  } finally {
    showLoading(false);
  }
}

async function onToggleNotifyPref(box, type) {
  const enabled = box.checked;
  try {
    await saveNotifyPref(state.uid, type, enabled);
    state.notifyPrefs = { ...state.notifyPrefs, [type]: enabled };
  } catch (err) {
    box.checked = !enabled;
    showToast("알림 설정을 저장하지 못했어요. 다시 시도해주세요.");
  }
}

function renderAvatarPreview(url) {
  const img = $("profile-avatar-img");
  const fallback = $("profile-avatar-fallback");
  if (url) {
    img.src = url;
    img.classList.remove("hidden");
    fallback.classList.add("hidden");
  } else {
    img.classList.add("hidden");
    fallback.classList.remove("hidden");
  }
}

async function onSaveProfile() {
  const displayName = $("profile-name-input").value.trim();
  const bio = $("profile-bio-input").value.trim();
  if (!displayName) {
    showToast("닉네임을 입력해주세요");
    return;
  }

  showLoading(true);
  try {
    let photoURL = state.photoURL || "";
    if (selectedAvatarFile) {
      const path = `avatars/${state.uid}/${Date.now()}_${selectedAvatarFile.name}`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, selectedAvatarFile);
      photoURL = await getDownloadURL(storageRef);
      selectedAvatarFile = null;
    }

    await saveProfile(state.uid, { displayName, bio, photoURL });

    state.displayName = displayName;
    state.bio = bio;
    state.photoURL = photoURL;
    $("user-name").textContent = displayName;
    renderGroupCard();

    showToast("프로필을 저장했어요");
  } catch (err) {
    showToast(err.message);
  } finally {
    showLoading(false);
  }
}

async function onSaveGoal() {
  const goal = $("goal-input").value.trim();
  showLoading(true);
  try {
    await saveGoal(state.uid, goal);
    state.goal = goal;
    renderGroupCard();
    showToast("목표를 저장했어요 🎯");
  } catch (err) {
    showToast(err.message);
  } finally {
    showLoading(false);
  }
}

async function renderGroupSwitcher() {
  const groups = await loadUserGroups(state.groupIds);
  $("group-switcher-list").innerHTML = groups
    .map((g) => {
      const active = g.groupId === state.groupId;
      return `<button type="button" class="group-switch-chip ${active ? "active" : ""}" data-group-id="${g.groupId}">
        ${escapeHtml(g.name)}
      </button>`;
    })
    .join("");

  $("group-switcher-list").querySelectorAll(".group-switch-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.groupId === state.groupId) return;
      document.dispatchEvent(new CustomEvent("gymate:switch-group", { detail: { groupId: btn.dataset.groupId } }));
    });
  });
}

export async function renderGroupCard() {
  renderGroupSwitcher();
  $("group-name-display").textContent = state.groupName || "그룹";
  $("group-name-edit-btn").classList.toggle("hidden", state.uid !== state.groupOwnerUid);
  $("delete-group-btn").classList.toggle("hidden", state.uid !== state.groupOwnerUid);
  $("member-count").textContent = state.memberUids.length;
  renderGroupReactions();

  const members = await loadGroupMembers(state.memberUids);
  $("member-list").innerHTML = members
    .map((m) => {
      const avatar = m.photoURL
        ? `<img class="author-avatar" src="${m.photoURL}" alt="" />`
        : `<span class="author-avatar author-avatar-fallback" style="background:${avatarColorFor(m.displayName, m.color)}">${escapeHtml((m.displayName || "?").trim().charAt(0))}</span>`;
      const ownerTag = m.uid === state.groupOwnerUid ? `<span class="owner-badge">그룹장</span>` : "";
      return `<div class="member-item">
        ${avatar}
        <div>
          <div class="member-name">${escapeHtml(m.displayName)}${ownerTag}</div>
          ${m.bio ? `<div class="member-bio">${escapeHtml(m.bio)}</div>` : ""}
          ${m.goal ? `<div class="member-goal">🎯 ${escapeHtml(m.goal)}</div>` : ""}
        </div>
      </div>`;
    })
    .join("");
}

const MAX_GROUP_REACTIONS = 6;

function renderGroupReactions() {
  const isOwner = state.uid === state.groupOwnerUid;
  const emojis = state.reactionEmojis || [];
  $("group-reaction-add-row").classList.toggle("hidden", !isOwner || emojis.length >= MAX_GROUP_REACTIONS);
  $("group-reactions-hint").textContent = isOwner
    ? `이 그룹 운동인증에 쓸 리액션이에요. ✕로 빼고, 최대 ${MAX_GROUP_REACTIONS}개까지 원하는 이모지로 바꿀 수 있어요`
    : "그룹장이 정한 이 그룹 운동인증 리액션이에요";
  $("group-reaction-list").innerHTML = emojis
    .map(
      (e) => `<span class="location-chip group-reaction-chip">${escapeHtml(e)}${
        isOwner && emojis.length > 1 ? ` <button type="button" class="chip-remove" data-remove-emoji="${escapeHtml(e)}" aria-label="${escapeHtml(e)} 삭제">✕</button>` : ""
      }</span>`
    )
    .join("");
}

// 입력값에서 첫 번째 글자(이모지 1개)만 꺼낸다. 이모지가 아니면 null.
function firstEmoji(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const first = typeof Intl !== "undefined" && Intl.Segmenter
    ? new Intl.Segmenter("ko", { granularity: "grapheme" }).segment(trimmed)[Symbol.iterator]().next().value.segment
    : Array.from(trimmed)[0];
  return /\p{Extended_Pictographic}/u.test(first) ? first : null;
}

async function saveGroupReactions(next, message) {
  showLoading(true);
  try {
    await saveGroupReactionEmojis(state.groupId, next);
    state.reactionEmojis = next;
    renderGroupReactions();
    rerenderWorkoutFeed();
    showToast(message);
  } catch (err) {
    showToast("저장하지 못했어요. 그룹장만 바꿀 수 있어요.");
  } finally {
    showLoading(false);
  }
}

async function onAddGroupReaction() {
  const emoji = firstEmoji($("group-reaction-input").value);
  if (!emoji) {
    showToast("이모지 1개를 입력해주세요");
    return;
  }
  const current = state.reactionEmojis || [];
  if (current.includes(emoji)) {
    showToast("이미 있는 리액션이에요");
    return;
  }
  if (current.length >= MAX_GROUP_REACTIONS) {
    showToast(`최대 ${MAX_GROUP_REACTIONS}개까지 추가할 수 있어요`);
    return;
  }
  $("group-reaction-input").value = "";
  await saveGroupReactions([...current, emoji], `${emoji} 리액션을 추가했어요`);
}

async function onRemoveGroupReaction(emoji) {
  if ((state.reactionEmojis || []).length <= 1) {
    showToast("리액션은 최소 1개는 있어야 해요");
    return;
  }
  await saveGroupReactions(
    (state.reactionEmojis || []).filter((e) => e !== emoji),
    `${emoji} 리액션을 뺐어요`
  );
}

async function onSaveGroupName() {
  const name = $("group-rename-input").value.trim();
  if (!name) {
    showToast("그룹 이름을 입력해주세요");
    return;
  }

  showLoading(true);
  try {
    await renameGroup(state.groupId, name);
    state.groupName = name;
    $("group-name-display").textContent = name;
    $("group-name-edit-row").classList.add("hidden");
    showToast("그룹 이름을 저장했어요");
  } catch (err) {
    showToast(err.message);
  } finally {
    showLoading(false);
  }
}
