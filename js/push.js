import {
  getMessaging,
  getToken,
  deleteToken,
  onMessage,
  isSupported,
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-messaging.js";
import { doc, updateDoc, arrayUnion, arrayRemove } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";
import { app, db } from "./firebase-init.js";
import { state } from "./state.js";
import { showToast } from "./utils.js";

// Firebase 콘솔 > 프로젝트 설정 > 클라우드 메시징 > 웹 구성 > 웹 푸시 인증서 키 쌍에서 발급받은 값.
const VAPID_KEY = "BOWNGgjuuTXCGv12r4fS0vSFvCmae51K04kNNnRjQJpFb19AWsRuZ9FkspZrStUiaxJCMzaucPV5bx5rmIl2H8A";

function pushEnabledKey() {
  return `gymate-push-enabled-${state.uid}`;
}

// Notification.permission은 한번 허용하면 브라우저 차원에서 계속 "granted"로
// 남기 때문에, "이 기기에서 지금 알림을 받도록 켜뒀는지"는 별도로 기기에
// 기억해둔다 (알림 끄기를 누르면 이 값도 지운다).
export function isPushEnabledLocally() {
  return localStorage.getItem(pushEnabledKey()) === "1";
}

export async function isPushSupported() {
  if (!("Notification" in window) || !("serviceWorker" in navigator)) return false;
  try {
    return await isSupported();
  } catch {
    return false;
  }
}

export function getNotificationPermission() {
  return "Notification" in window ? Notification.permission : "unsupported";
}

export async function enablePush() {
  if (!VAPID_KEY) {
    throw new Error("아직 알림 설정이 끝나지 않았어요 (VAPID 키 미설정).");
  }
  if (!(await isPushSupported())) {
    throw new Error("이 기기/브라우저에서는 알림을 지원하지 않아요. 홈 화면에 추가한 아이콘으로, iOS는 16.4 이상에서 열어주세요.");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("알림 권한이 허용되지 않았어요.");
  }

  const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
  const messaging = getMessaging(app);
  const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
  if (!token) {
    throw new Error("알림 토큰을 받아오지 못했어요.");
  }

  await updateDoc(doc(db, "users", state.uid), { fcmTokens: arrayUnion(token) });
  localStorage.setItem(pushEnabledKey(), "1");

  onMessage(messaging, (payload) => {
    showToast(`🔔 ${payload.data?.title || "새 알림"}`);
  });

  return token;
}

// 이 기기로 오는 알림만 끈다 (브라우저 알림 권한 자체는 기기 설정에서만 바꿀 수 있어
// 건드리지 않고, 대신 이 기기의 토큰을 지워서 더 이상 알림이 오지 않게 한다).
export async function disablePush() {
  localStorage.removeItem(pushEnabledKey());

  const registration = await navigator.serviceWorker.getRegistration("/firebase-messaging-sw.js");
  if (!registration) return;

  try {
    const messaging = getMessaging(app);
    const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
    if (token) {
      await updateDoc(doc(db, "users", state.uid), { fcmTokens: arrayRemove(token) });
      await deleteToken(messaging);
    }
  } catch {
    // 토큰을 못 가져와도 로컬에서는 이미 꺼진 상태이므로 조용히 넘어간다.
  }
}
