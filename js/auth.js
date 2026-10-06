import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  collection,
  query,
  where,
  documentId,
  limit,
  getDocs,
  arrayUnion,
  arrayRemove,
  deleteField,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";
import { auth, db } from "./firebase-init.js";
import { generateJoinCode, AVATAR_COLORS } from "./utils.js";

export async function signUp(name, email, password, color) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName: name });
  await setDoc(doc(db, "users", cred.user.uid), {
    displayName: name,
    color: color || AVATAR_COLORS[0],
    photoURL: "",
    bio: "",
    goal: "",
    groupIds: [],
    createdAt: serverTimestamp(),
  });
  return cred.user;
}

export async function logIn(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export function logOut() {
  return signOut(auth);
}

// users/{uid} 문서를 읽어온다.
// signUp()에서 이 문서를 쓰는 것과 onAuthStateChanged가 이 함수를 호출하는 것이
// 거의 동시에 일어날 수 있어(회원가입 직후), 문서가 아직 안 보일 수 있다.
// 짧게 재시도해서 signUp()의 쓰기가 반영될 시간을 준 뒤, 그래도 없으면
// (예외적인 경우) 기본값으로 생성한다.
export async function loadUserProfile(user) {
  const ref = doc(db, "users", user.uid);

  for (let i = 0; i < 5; i++) {
    const snap = await getDoc(ref);
    if (snap.exists()) return migrateGroupIds(ref, snap.data());
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  const fallback = {
    displayName: user.displayName || "회원",
    color: AVATAR_COLORS[0],
    photoURL: "",
    bio: "",
    goal: "",
    groupIds: [],
    createdAt: serverTimestamp(),
  };
  await setDoc(ref, fallback);
  return fallback;
}

// 예전에는 groupId(단일 그룹) 하나만 저장했는데, 이제 groupIds(배열)로
// 여러 그룹에 속할 수 있게 바뀌었다. 옛 데이터를 만나면 자동으로 옮겨준다.
async function migrateGroupIds(ref, data) {
  if (data.groupIds) return data;
  const groupIds = data.groupId ? [data.groupId] : [];
  await updateDoc(ref, { groupIds, groupId: deleteField() });
  return { ...data, groupIds, groupId: undefined };
}

// 새 그룹 생성 후 groupId를 반환
export async function createGroup(name, uid) {
  let joinCode = generateJoinCode();
  // 코드 중복 방지를 위해 최대 5회 재시도
  for (let i = 0; i < 5; i++) {
    const q = query(collection(db, "groups"), where("joinCode", "==", joinCode), limit(1));
    const existing = await getDocs(q);
    if (existing.empty) break;
    joinCode = generateJoinCode();
  }

  const groupRef = await addDoc(collection(db, "groups"), {
    name,
    joinCode,
    ownerUid: uid,
    memberUids: [uid],
    createdAt: serverTimestamp(),
  });

  await updateDoc(doc(db, "users", uid), { groupIds: arrayUnion(groupRef.id) });
  return { groupId: groupRef.id, name, joinCode, ownerUid: uid, memberUids: [uid] };
}

// 초대코드로 그룹 참여 후 그룹 정보를 반환
export async function joinGroupByCode(code, uid) {
  const q = query(
    collection(db, "groups"),
    where("joinCode", "==", code.toUpperCase()),
    limit(1)
  );
  const snap = await getDocs(q);
  if (snap.empty) {
    throw new Error("존재하지 않는 초대코드예요. 다시 확인해주세요.");
  }
  const groupDoc = snap.docs[0];
  await updateDoc(doc(db, "groups", groupDoc.id), {
    memberUids: arrayUnion(uid),
  });
  await updateDoc(doc(db, "users", uid), { groupIds: arrayUnion(groupDoc.id) });
  const data = groupDoc.data();
  return {
    groupId: groupDoc.id,
    name: data.name,
    joinCode: data.joinCode,
    ownerUid: data.ownerUid,
    memberUids: [...(data.memberUids || []), uid],
  };
}

// 그룹 탈퇴: 마지막 한 명이면 그룹 문서를 통째로 삭제하고, 남은 사람이 있으면
// memberUids에서 본인만 빼고(그룹장이었다면 남은 사람 중 한 명에게 그룹장을 넘긴다).
export async function leaveGroup(groupId, uid) {
  const groupRef = doc(db, "groups", groupId);
  const snap = await getDoc(groupRef);
  if (!snap.exists()) return;
  const group = snap.data();
  const remaining = (group.memberUids || []).filter((m) => m !== uid);

  if (!remaining.length) {
    await deleteDoc(groupRef);
  } else {
    const ownerUid = group.ownerUid === uid ? remaining[0] : group.ownerUid;
    await updateDoc(groupRef, { memberUids: remaining, ownerUid });
  }

  await updateDoc(doc(db, "users", uid), { groupIds: arrayRemove(groupId) });
}

// 그룹장이 잘못 만든 그룹을 통째로 삭제한다. 다른 그룹원들의 groupIds에
// 남아있는 참조는 지워지지 않지만(다른 사람 문서라 쓸 권한이 없음),
// loadGroup()이 null을 반환하면 그 그룹은 자동으로 건너뛰도록 이미
// main.js에서 처리하고 있어 문제되지 않는다.
export async function deleteGroup(groupId, uid) {
  await deleteDoc(doc(db, "groups", groupId));
  await updateDoc(doc(db, "users", uid), { groupIds: arrayRemove(groupId) });
}

export async function loadGroup(groupId) {
  const snap = await getDoc(doc(db, "groups", groupId));
  if (!snap.exists()) return null;
  return { groupId: snap.id, ...snap.data() };
}

// 내가 속한 여러 그룹의 이름/정보를 한 번에 불러온다 (그룹 전환 스위처용).
export async function loadUserGroups(groupIds) {
  if (!groupIds?.length) return [];
  const q = query(collection(db, "groups"), where(documentId(), "in", groupIds.slice(0, 30)));
  const snap = await getDocs(q);
  const byId = new Map();
  snap.forEach((d) => byId.set(d.id, d.data()));
  return groupIds
    .filter((id) => byId.has(id))
    .map((id) => ({ groupId: id, ...byId.get(id) }));
}

export async function saveGoal(uid, goal) {
  await updateDoc(doc(db, "users", uid), { goal });
}

// 알림 종류별 수신 여부. 체크하지 않은(없는) 항목은 서버에서 알림을 보내지 않는다.
export async function saveNotifyPref(uid, type, enabled) {
  await updateDoc(doc(db, "users", uid), { [`notifyPrefs.${type}`]: enabled });
}

export async function saveProfile(uid, { displayName, bio, photoURL }) {
  await updateDoc(doc(db, "users", uid), { displayName, bio, photoURL });
}

// 그룹 리액션 이모지 전체 목록 (그룹장만 수정 — 기존 규칙의 "그룹장, 멤버 변화 없음" 업데이트로 허용됨)
export async function saveGroupReactionEmojis(groupId, emojis) {
  await updateDoc(doc(db, "groups", groupId), { reactions: emojis });
}

export async function renameGroup(groupId, name) {
  await updateDoc(doc(db, "groups", groupId), { name });
}

// 그룹원들의 프로필(이름/사진/색/한줄소개)을 한 번에 불러온다.
// Firestore 'in' 쿼리는 최대 30개까지만 지원하므로 그 이상은 앞 30명만 조회한다.
export async function loadGroupMembers(memberUids) {
  if (!memberUids?.length) return [];
  const q = query(collection(db, "users"), where(documentId(), "in", memberUids.slice(0, 30)));
  const snap = await getDocs(q);
  const byUid = new Map();
  snap.forEach((d) => byUid.set(d.id, d.data()));
  return memberUids.map((uid) => ({ uid, ...(byUid.get(uid) || { displayName: "알 수 없음" }) }));
}
