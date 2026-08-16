const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { logger } = require("firebase-functions");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();
const db = getFirestore();

// 여러 uid의 fcmTokens를 모아 중복 제거해서 돌려준다.
async function getTokensForUids(uids) {
  if (!uids.length) return [];
  const snaps = await Promise.all(uids.map((uid) => db.collection("users").doc(uid).get()));
  const tokens = [];
  snaps.forEach((snap) => {
    const list = snap.data()?.fcmTokens;
    if (Array.isArray(list)) tokens.push(...list);
  });
  return [...new Set(tokens)];
}

// 알림을 보내고, 더 이상 유효하지 않은(기기에서 삭제된 등) 토큰은 유저 문서에서 정리한다.
// notification 필드를 같이 보내면 FCM/브라우저가 서비스워커의 onBackgroundMessage와
// 별개로 알림을 자동으로 한 번 더 띄워서 알림이 두 번 오는 문제가 있었다.
// data-only로만 보내고 표시는 전적으로 서비스워커(onBackgroundMessage)에서
// 직접 하도록 해서 중복 표시를 없앤다.
async function sendAndCleanup(tokens, notification, data) {
  if (!tokens.length) {
    logger.info("보낼 토큰이 없어요 (알림 켜둔 사람이 없거나 태그 대상이 없음)", { notification });
    return;
  }
  const res = await getMessaging().sendEachForMulticast({
    tokens,
    data: { title: notification.title, body: notification.body, ...data },
    webpush: { fcmOptions: { link: "https://gymate-6872e.web.app" } },
  });

  logger.info(`알림 전송 결과: 성공 ${res.successCount}건 / 실패 ${res.failureCount}건`, {
    notification,
    tokenCount: tokens.length,
    errors: res.responses.filter((r) => !r.success).map((r) => r.error?.code),
  });

  const invalidTokens = [];
  res.responses.forEach((r, i) => {
    if (!r.success && r.error?.code === "messaging/registration-token-not-registered") {
      invalidTokens.push(tokens[i]);
    }
  });
  if (!invalidTokens.length) return;

  const usersSnap = await db.collection("users").where("fcmTokens", "array-contains-any", invalidTokens).get();
  await Promise.all(
    usersSnap.docs.map((docSnap) => {
      const remaining = (docSnap.data().fcmTokens || []).filter((t) => !invalidTokens.includes(t));
      return docSnap.ref.update({ fcmTokens: remaining });
    })
  );
}

// 채팅 메시지가 오면, 보낸 사람을 뺀 나머지 그룹원에게 알림을 보낸다.
exports.onChatMessageCreated = onDocumentCreated(
  "groups/{groupId}/messages/{messageId}",
  async (event) => {
    const msg = event.data?.data();
    if (!msg) return;
    const { groupId } = event.params;

    const groupSnap = await db.collection("groups").doc(groupId).get();
    const group = groupSnap.data();
    if (!group) return;

    const recipientUids = (group.memberUids || []).filter((uid) => uid !== msg.uid);
    const tokens = await getTokensForUids(recipientUids);
    logger.info(`채팅 알림 대상 ${recipientUids.length}명, 토큰 ${tokens.length}개`, { recipientUids });

    await sendAndCleanup(
      tokens,
      { title: `${msg.displayName} · ${group.name}`, body: msg.text || "" },
      { type: "chat", groupId }
    );
  }
);

// 그룹원이 방문 시간을 새로 등록하면, 본인을 뺀 나머지 그룹원에게 알림을 보낸다.
exports.onScheduleCreated = onDocumentCreated(
  "groups/{groupId}/schedule/{scheduleId}",
  async (event) => {
    const entry = event.data?.data();
    if (!entry) return;
    const { groupId } = event.params;

    const groupSnap = await db.collection("groups").doc(groupId).get();
    const group = groupSnap.data();
    if (!group) return;

    const recipientUids = (group.memberUids || []).filter((uid) => uid !== entry.uid);
    const tokens = await getTokensForUids(recipientUids);

    const body = entry.resting
      ? `${entry.date}엔 쉰대요 😴`
      : `${entry.date} ${entry.time}에 운동 간대요 💪`;

    await sendAndCleanup(
      tokens,
      { title: `${entry.displayName} · ${group.name}`, body },
      { type: "schedule", groupId }
    );
  }
);

// 운동 기록이 새로 올라올 때 태그된 친구가 있으면 알림을 보낸다.
exports.onWorkoutLogCreated = onDocumentCreated(
  "groups/{groupId}/workoutLogs/{logId}",
  async (event) => {
    const log = event.data?.data();
    if (!log) return;
    const { groupId, logId } = event.params;

    const taggedUids = (log.taggedUids || []).filter((uid) => uid !== log.uid);
    const tokens = await getTokensForUids(taggedUids);

    await sendAndCleanup(
      tokens,
      { title: "운동 기록에 태그됐어요 🏷", body: `${log.displayName}님이 함께 운동한 친구로 태그했어요` },
      { type: "tag", groupId, logId }
    );
  }
);
