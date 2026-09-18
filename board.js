// Traditional square 윷놀이 board: 20 perimeter spaces (corners at 0/5/10/15).
// Shortcuts through the center are drawn for looks but are not a movement mechanic in this version.
const SIZE = 320, MARGIN = 40;
const CORNERS = [[SIZE - MARGIN, SIZE - MARGIN], [MARGIN, SIZE - MARGIN], [MARGIN, MARGIN], [SIZE - MARGIN, MARGIN]];
export const NODES = Array.from({ length: 20 }, (_, i) => {
  const seg = Math.floor(i / 5), t = i % 5;
  const [sx, sy] = CORNERS[seg], [ex, ey] = CORNERS[(seg + 1) % 4];
  return { x: sx + (ex - sx) * t / 5, y: sy + (ey - sy) * t / 5 };
});
export const BOARD_LENGTH = 20;
export const CENTER = { x: SIZE / 2, y: SIZE / 2 };
// Purely decorative: the two diagonal shortcut paths (corner-mid-mid-center) drawn on a real 윷판,
// shown for looks only. Movement in this version always follows the 20-space perimeter (NODES).
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
function diagonal(cornerA, cornerB) {
  return [cornerA, lerp(cornerA, CENTER, 1 / 3), lerp(cornerA, CENTER, 2 / 3), CENTER, lerp(CENTER, cornerB, 1 / 3), lerp(CENTER, cornerB, 2 / 3), cornerB];
}
export const DIAGONALS = [diagonal(NODES[0], NODES[10]), diagonal(NODES[5], NODES[15])];

export const ZODIAC = [
  { name: '쥐', emoji: '🐭' }, { name: '소', emoji: '🐂' }, { name: '호랑이', emoji: '🐯' }, { name: '토끼', emoji: '🐰' },
  { name: '용', emoji: '🐲' }, { name: '뱀', emoji: '🐍' }, { name: '말', emoji: '🐴' }, { name: '양', emoji: '🐐' },
  { name: '원숭이', emoji: '🐵' }, { name: '닭', emoji: '🐓' }, { name: '개', emoji: '🐶' }, { name: '돼지', emoji: '🐷' },
];

export const EVENT_TYPES = {
  forward1: { label: '한 칸 전진', delta: 1 },
  forward2: { label: '두 칸 전진', delta: 2 },
  back1: { label: '한 칸 후퇴', delta: -1 },
  back2: { label: '두 칸 후퇴', delta: -2 },
  extraTurn: { label: '한 번 더 던지기', extraTurn: true },
  skipTurn: { label: '다음 차례 쉬기', skipTurn: true },
  toStart: { label: '처음으로', toStart: true },
};

const STEP_MAP = { 도: 1, 개: 2, 걸: 3, 윷: 4, 모: 5, 낙: 0 };
export function stepsFor(name) { return STEP_MAP[name] ?? 0; }

export function createBoardState(pieceCount) {
  return { waiting: Array.from({ length: pieceCount }, (_, i) => i), stacks: [], finished: [] };
}
function totalPieces(state) { return state.waiting.length + state.stacks.reduce((n, s) => n + s.ids.length, 0) + state.finished.length; }

export function moveOptions(state) {
  const options = state.waiting.map(id => ({ kind: 'waiting', id }));
  state.stacks.forEach((stack, index) => options.push({ kind: 'stack', index }));
  return options;
}

// Auto-fills empty spaces (skipping corners and any node the organizer already assigned) with a random mix of the
// event types above, loosely modeled after common board-game "move back / lose a turn / go again" tiles.
export function autoGenerateEvents(existing = {}) {
  const events = { ...existing };
  const pool = Object.keys(EVENT_TYPES);
  const candidates = [];
  for (let i = 1; i < BOARD_LENGTH; i++) if (i % 5 !== 0 && !(i in events)) candidates.push(i);
  for (let i = candidates.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[candidates[i], candidates[j]] = [candidates[j], candidates[i]]; }
  const count = Math.min(6, candidates.length);
  for (let i = 0; i < count; i++) events[candidates[i]] = pool[Math.floor(Math.random() * pool.length)];
  return events;
}

export function applyMove(teams, teamIndex, option, steps, events = {}) {
  const state = teams[teamIndex].board;
  let ids, progress;
  if (option.kind === 'waiting') {
    ids = [option.id];
    state.waiting = state.waiting.filter(id => id !== option.id);
    progress = steps;
  } else {
    const [stack] = state.stacks.splice(option.index, 1);
    ids = stack.ids;
    progress = stack.progress + steps;
  }
  const info = { ids, captured: false, finished: false, event: null, bonusTurn: steps >= 4, skipNext: false, progress, teamDone: false };

  function settle(atProgress, movingIds) {
    if (atProgress >= BOARD_LENGTH) { state.finished.push(...movingIds); return null; }
    teams.forEach((other, oi) => {
      if (oi === teamIndex) return;
      const hit = other.board.stacks.findIndex(s => s.progress === atProgress);
      if (hit !== -1) {
        const [captured] = other.board.stacks.splice(hit, 1);
        other.board.waiting.push(...captured.ids);
        info.captured = true; info.bonusTurn = true;
      }
    });
    const mine = state.stacks.findIndex(s => s.progress === atProgress);
    if (mine !== -1) { state.stacks[mine].ids.push(...movingIds); return state.stacks[mine]; }
    const created = { ids: movingIds, progress: atProgress };
    state.stacks.push(created);
    return created;
  }

  let landed = settle(progress, ids);
  info.finished = !landed;

  if (landed) {
    const key = events[progress];
    const ev = key && EVENT_TYPES[key];
    if (ev) {
      info.event = { key, label: ev.label };
      if (ev.extraTurn) info.bonusTurn = true;
      if (ev.skipTurn) info.skipNext = true;
      if (ev.toStart || ev.delta) {
        const movedIds = landed.ids.slice();
        state.stacks = state.stacks.filter(s => s !== landed);
        if (ev.toStart) {
          state.waiting.push(...movedIds);
          info.progress = 0;
        } else {
          const nextProgress = Math.max(1, progress + ev.delta);
          const landed2 = settle(nextProgress, movedIds);
          if (!landed2) info.finished = true;
          info.progress = landed2 ? landed2.progress : BOARD_LENGTH;
        }
      }
    }
  }
  info.teamDone = totalPieces(state) === state.finished.length;
  return info;
}
