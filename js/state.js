// 로그인한 사용자와 그룹에 대한 전역 상태 (모듈 간 공유)
// groupId/groupName/... 는 지금 보고 있는(활성) 그룹 기준이고,
// groupIds는 내가 속한 전체 그룹 목록(전환용)이다.
export const state = {
  uid: null,
  displayName: null,
  color: null,
  photoURL: "",
  bio: "",
  goal: "",
  notifyPrefs: {},
  groupIds: [],
  groupId: null,
  groupName: null,
  groupOwnerUid: null,
  joinCode: null,
  memberUids: [],
  reactionEmojis: [], // 지금 그룹의 리액션 이모지 목록 (기본 👍🔥💪, 그룹장이 변경)
};

export function resetState() {
  state.uid = null;
  state.displayName = null;
  state.color = null;
  state.photoURL = "";
  state.bio = "";
  state.goal = "";
  state.notifyPrefs = {};
  state.groupIds = [];
  state.groupId = null;
  state.groupName = null;
  state.groupOwnerUid = null;
  state.joinCode = null;
  state.memberUids = [];
  state.reactionEmojis = [];
}
