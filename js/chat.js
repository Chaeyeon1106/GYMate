import {
  collection,
  addDoc,
  query,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";
import { db } from "./firebase-init.js";
import { state } from "./state.js";
import { $, showToast, escapeHtml, avatarColorFor } from "./utils.js";

let unsubMessages = null;
let latestItems = [];
// 채팅 탭에 막 들어온 직후의 렌더링에서만 "안 읽은 부분부터 보여주기"를
// 적용하고, 그 이후 실시간으로 새 메시지가 올 때는 기존처럼 동작한다.
let pendingEntryScroll = true;

function lastReadKey() {
  return `gymate-chat-lastread-${state.groupId}-${state.uid}`;
}

function getLastRead() {
  return Number(localStorage.getItem(lastReadKey()) || 0);
}

function markRead(items) {
  if (!items.length) return;
  const latest = items[items.length - 1];
  localStorage.setItem(lastReadKey(), String(latest.createdAt?.seconds || 0));
  $("chat-jump-bottom").classList.add("hidden");
}

function isNearBottom(container) {
  return container.scrollHeight - container.scrollTop - container.clientHeight < 80;
}

export function initChat() {
  $("chat-form").addEventListener("submit", onSendMessage);
  $("chat-jump-bottom").addEventListener("click", () => {
    const container = $("chat-messages");
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    markRead(latestItems);
  });
  $("chat-messages").addEventListener("scroll", () => {
    const container = $("chat-messages");
    if (isNearBottom(container)) markRead(latestItems);
  });
  subscribeMessages();
}

// 채팅 탭으로 전환해서 들어올 때마다 호출: 안 읽은 메시지가 있으면 그
// 지점부터 보여주도록 다시 계산해서 렌더링한다.
export function onChatTabEnter() {
  pendingEntryScroll = true;
  if (latestItems.length) renderMessages(latestItems);
}

// 그룹을 전환했을 때 이전 그룹 채팅 구독을 정리하고 새 그룹(state.groupId)
// 채팅으로 다시 구독한다.
export function reloadChat() {
  pendingEntryScroll = true;
  $("chat-jump-bottom").classList.add("hidden");
  subscribeMessages();
}

function subscribeMessages() {
  if (unsubMessages) unsubMessages();
  const q = query(
    collection(db, "groups", state.groupId, "messages"),
    orderBy("createdAt", "desc"),
    limit(200)
  );
  unsubMessages = onSnapshot(q, (snap) => {
    const items = [];
    snap.forEach((d) => items.push({ id: d.id, ...d.data() }));
    items.reverse();
    renderMessages(items);
  });
}

async function onSendMessage(e) {
  e.preventDefault();
  const input = $("chat-input");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  // 버튼 탭으로 인풋 포커스가 빠지면서 모바일 키보드가 내려가는 걸 막기 위해,
  // await 이전(같은 이벤트 처리 틱 안)에 바로 포커스를 되돌려준다.
  input.focus();

  try {
    await addDoc(collection(db, "groups", state.groupId, "messages"), {
      uid: state.uid,
      displayName: state.displayName,
      color: state.color,
      avatarURL: state.photoURL || "",
      text,
      createdAt: serverTimestamp(),
    });
    markRead(latestItems);
  } catch (err) {
    input.value = text;
    showToast(err.message);
  }
}

function renderMessages(items) {
  const container = $("chat-messages");

  if (!items.length) {
    latestItems = items;
    container.innerHTML = `<p class="empty-state">아직 메시지가 없어요. 첫 인사를 남겨보세요!</p>`;
    return;
  }

  const wasNearBottom = isNearBottom(container);
  const lastRead = getLastRead();
  const firstUnreadIdx = items.findIndex((m) => (m.createdAt?.seconds || 0) > lastRead);
  latestItems = items;

  container.innerHTML = items
    .map((m, i) => {
      const mine = m.uid === state.uid;
      const avatar = mine
        ? ""
        : m.avatarURL
        ? `<img class="chat-avatar" src="${m.avatarURL}" alt="" />`
        : `<span class="chat-avatar chat-avatar-fallback" style="background:${avatarColorFor(m.displayName, m.color)}">${escapeHtml((m.displayName || "?").trim().charAt(0))}</span>`;
      const divider = i === firstUnreadIdx && firstUnreadIdx > 0 ? `<div class="chat-unread-divider">여기부터 안 읽음</div>` : "";
      return `${divider}<div class="chat-row ${mine ? "mine" : ""}">
        ${avatar}
        <div class="chat-bubble-wrap">
          ${!mine ? `<div class="chat-sender">${escapeHtml(m.displayName)}</div>` : ""}
          <div class="chat-bubble">${escapeHtml(m.text)}</div>
        </div>
      </div>`;
    })
    .join("");

  if (pendingEntryScroll) {
    pendingEntryScroll = false;
    if (firstUnreadIdx > 0) {
      // scrollIntoView는 상황에 따라 채팅창이 아니라 페이지 전체를 스크롤시켜
      // 위쪽에 빈 공간이 생기는 문제가 있었다. container.scrollTop만 직접
      // 계산해서 옮기면 채팅창 내부 스크롤만 움직여서 안전하다.
      const dividerEl = container.querySelector(".chat-unread-divider");
      if (dividerEl) {
        const containerRect = container.getBoundingClientRect();
        const dividerRect = dividerEl.getBoundingClientRect();
        container.scrollTop += dividerRect.top - containerRect.top;
      }
      $("chat-jump-bottom").classList.remove("hidden");
    } else {
      container.scrollTop = container.scrollHeight;
      markRead(items);
    }
  } else if (wasNearBottom) {
    container.scrollTop = container.scrollHeight;
    markRead(items);
  } else {
    $("chat-jump-bottom").classList.remove("hidden");
  }
}
