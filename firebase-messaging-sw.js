// 앱이 꺼져있거나 백그라운드일 때 푸시 알림을 받아 표시하는 서비스워커.
// 서비스워커는 ES 모듈 import를 못 쓰므로 firebase-config.js를 그대로 가져올 수 없어
// (그 값들은 클라이언트에 노출돼도 안전한 값이라) 여기 직접 옮겨 적었다.
importScripts("https://www.gstatic.com/firebasejs/10.12.3/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.3/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyCpEHH71QhrSKeE8TpAqzVPsxN8Pje95Gc",
  authDomain: "gymate-6872e.firebaseapp.com",
  projectId: "gymate-6872e",
  storageBucket: "gymate-6872e.firebasestorage.app",
  messagingSenderId: "502076130731",
  appId: "1:502076130731:web:094c9102ca4466f8e9beee",
});

const messaging = firebase.messaging();

// 알림 종류에 따라 눌렀을 때 이동할 탭을 정해둔다.
const TAB_BY_TYPE = { chat: "tab-chat", tag: "tab-workouts", schedule: "tab-calendar" };

// data-only 메시지로만 보내서(서버 쪽 notification 필드 제거) 여기서만 알림을
// 띄운다 — notification 필드를 같이 보내면 브라우저가 자동으로 한 번 더
// 띄워서 알림이 중복으로 오는 문제가 있었다.
messaging.onBackgroundMessage((payload) => {
  const title = payload.data?.title || "GYMate";
  const body = payload.data?.body || "";
  self.registration.showNotification(title, {
    body,
    icon: "/images/icon-192.png",
    badge: "/images/icon-192.png",
    data: payload.data || {},
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const tab = TAB_BY_TYPE[data.type];
  const params = new URLSearchParams();
  if (tab) params.set("tab", tab);
  if (data.groupId) params.set("group", data.groupId);
  const targetPath = params.toString() ? `/?${params.toString()}` : "/";
  const targetUrl = new URL(targetPath, self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ("focus" in client) {
          client.postMessage({ type: "gymate:notification-click", tab, groupId: data.groupId });
          return client.focus();
        }
      }
      return clients.openWindow(targetUrl);
    })
  );
});
