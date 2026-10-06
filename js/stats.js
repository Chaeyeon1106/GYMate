// 마이 탭 "내 운동 통계" 카드: 월별 운동한 날/시간, 날짜별 히트맵, 장소·부위별 횟수.
// 데이터는 workouts.js가 이미 구독 중인 내 기록 + 내가 태그된 기록을 넘겨받아 쓴다.
import { $, toDateStr, todayStr, escapeHtml } from "./utils.js";

let statsMonth = new Date();
statsMonth.setDate(1);
let allLogs = [];

export function initStats() {
  $("stats-prev").addEventListener("click", () => shiftStatsMonth(-1));
  $("stats-next").addEventListener("click", () => shiftStatsMonth(1));
  renderStats();
}

export function setStatsLogs(logs) {
  allLogs = logs;
  renderStats();
}

function shiftStatsMonth(delta) {
  statsMonth.setMonth(statsMonth.getMonth() + delta);
  renderStats();
}

// 같은 날 내가 직접 올린 기록이 있으면, 친구가 나를 태그한 기록은 중복 집계하지 않는다
// (같이 운동한 한 번의 운동이 두 번 세어지는 것을 막기 위해).
function logsForMonth(prefix) {
  const monthLogs = allLogs.filter((log) => log.date?.startsWith(prefix));
  const myDates = new Set(monthLogs.filter((log) => log.isMine).map((log) => log.date));
  return monthLogs.filter((log) => log.isMine || !myDates.has(log.date));
}

function formatMinutes(min) {
  if (min < 60) return `${min}분`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}시간 ${m}분` : `${h}시간`;
}

function heatLevel(min) {
  if (!min) return 0;
  if (min <= 30) return 1;
  if (min <= 60) return 2;
  if (min <= 90) return 3;
  return 4;
}

function renderStats() {
  const label = $("stats-month-label");
  if (!label) return;
  const year = statsMonth.getFullYear();
  const month = statsMonth.getMonth();
  const prefix = `${year}-${String(month + 1).padStart(2, "0")}-`;
  label.textContent = `${year}년 ${month + 1}월`;

  const logs = logsForMonth(prefix);
  const minutesByDate = {};
  const placesByDate = {};
  logs.forEach((log) => {
    minutesByDate[log.date] = (minutesByDate[log.date] || 0) + (Number(log.duration) || 0);
    if (!placesByDate[log.date]) placesByDate[log.date] = new Set();
    if (log.location) placesByDate[log.date].add(log.location);
  });

  const total = logs.reduce((sum, log) => sum + (Number(log.duration) || 0), 0);
  $("stats-days").textContent = `${Object.keys(minutesByDate).length}일`;
  $("stats-total").textContent = formatMinutes(total);
  $("stats-avg").textContent = logs.length ? formatMinutes(Math.round(total / logs.length)) : "-";

  renderHeatmap(year, month, minutesByDate, placesByDate);
  renderBars($("stats-locations"), countBy(logs, (log) => (log.location ? [log.location] : [])), "이 달에는 기록이 없어요");
  renderBars(
    $("stats-parts"),
    countBy(logs, (log) => log.parts || []),
    "운동 기록에서 운동 부위를 선택하면 여기에 모여요"
  );
}

function renderHeatmap(year, month, minutesByDate, placesByDate) {
  const grid = $("stats-heatmap");
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = todayStr();
  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(`<span class="heat-day empty"></span>`);
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = toDateStr(new Date(year, month, day));
    const min = minutesByDate[dateStr] || 0;
    const places = [...(placesByDate[dateStr] || [])].join(", ");
    const tip = min ? `${month + 1}월 ${day}일 · ${formatMinutes(min)}${places ? ` · ${places}` : ""}` : `${month + 1}월 ${day}일 · 기록 없음`;
    cells.push(
      `<span class="heat-day heat-cell heat-${heatLevel(min)} ${dateStr === today ? "today" : ""}" title="${escapeHtml(tip)}" aria-label="${escapeHtml(tip)}">${day}</span>`
    );
  }
  grid.innerHTML = cells.join("");
}

function countBy(logs, keysOf) {
  const counts = new Map();
  logs.forEach((log) => keysOf(log).forEach((k) => counts.set(k, (counts.get(k) || 0) + 1)));
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

// 한 가지 색의 가로 막대 목록 (값은 막대 옆 글자로 항상 보여줘서 색에만 의존하지 않는다)
function renderBars(el, entries, emptyText) {
  if (!entries.length) {
    el.innerHTML = `<p class="empty-hint">${emptyText}</p>`;
    return;
  }
  const top = entries.slice(0, 5);
  const rest = entries.slice(5).reduce((sum, [, n]) => sum + n, 0);
  if (rest) top.push(["기타", rest]);
  const max = Math.max(...top.map(([, n]) => n));
  el.innerHTML = top
    .map(
      ([name, n]) => `<div class="stat-bar-row">
        <span class="stat-bar-label">${escapeHtml(name)}</span>
        <span class="stat-bar-track"><span class="stat-bar-fill" style="width:${Math.max(4, (n / max) * 100)}%"></span></span>
        <span class="stat-bar-value">${n}회</span>
      </div>`
    )
    .join("");
}
