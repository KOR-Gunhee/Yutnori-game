import { MotionTracker, DEFAULT_SETTINGS, thresholds, resolveThrow } from './motion.js?v=board-1';
import { NODES, DIAGONALS, ZODIAC, EVENT_TYPES, createBoardState, moveOptions, applyMove, stepsFor, autoGenerateEvents } from './board.js?v=board-2';
const TEAM_COLORS = ['#c96a4d', '#3c6e91', '#7a5ba5', '#4f8f5b', '#b98a2e', '#a34d78', '#4f7a7a', '#9a5d3c'];
const $ = id => document.getElementById(id);
const tracker = new MotionTracker();
let page = 'home', mode = 'samson', calibration = null, editing = 'mo', phase = '', round = 1, stream, landmarker, loading = false;
let settings = { ...DEFAULT_SETTINGS };
let returnSeconds = 10;
try { const saved = Number(localStorage.getItem('yut-return-seconds')); if (Number.isInteger(saved) && saved >= 1 && saved <= 30) returnSeconds = saved; } catch {}
try { const saved = JSON.parse(localStorage.getItem('yut-body-settings-v1')); if (saved && Number.isFinite(saved.fall) && Number.isFinite(saved.mo) && saved.fall >= 1 && saved.mo <= 1000 && saved.mo > saved.fall) settings = saved; } catch {}
let teams = [], teamTurn = 0, bonusTurn = false, boardVisible = false, selectedMove = null;
try { const saved = JSON.parse(localStorage.getItem('yut-teams-v1')); if (Array.isArray(saved)) teams = saved.filter(t => t && typeof t.name === 'string' && Number.isFinite(t.score)).slice(0, 8).map(t => ({ name: t.name, score: t.score, skipNext: false })); } catch {}
let pieceCount = 4;
try { const saved = Number(localStorage.getItem('yut-piece-count')); if (Number.isInteger(saved) && saved >= 1 && saved <= 6) pieceCount = saved; } catch {}
let boardEvents = {};
try { const saved = JSON.parse(localStorage.getItem('yut-board-events-v1')); if (saved && typeof saved === 'object') boardEvents = saved; } catch {}
let generation = 0, lastFrame = -1, lastDetection = 0, lastSeen = 0, resultTimer, returnTimer, currentResult;
const video = $('video'), canvas = $('overlay'), ctx = canvas.getContext('2d');
const sticks = [...document.querySelectorAll('.stick')];
function updateSettings() {
  const levels = thresholds(settings);
  $('settingsSummary').textContent = `낙 기준 ${settings.fall} / 모 기준 ${settings.mo}`;
  $('bands').textContent = ['도', '개', '걸', '윷', '모'].map((name, i) => `${name} ${levels[i].toFixed(1)} 이상`).join(' · ');
  const points = Array.from({ length: 41 }, (_, i) => `${30 + i * 13.5},${125 - Math.expm1(2 * i / 40) / Math.expm1(2) * 100}`).join(' ');
  $('curve').innerHTML = `<path d="M30 15 V125 H575" fill="none" stroke="#c2ceba"/><polyline points="${points}" fill="none" stroke="#52704a" stroke-width="3"/>` + levels.map((value, i) => `<circle cx="${30 + i * 135}" cy="${125 - (value - settings.fall) / (settings.mo - settings.fall) * 100}" r="5" fill="#52704a"/><text x="${30 + i * 135}" y="148" text-anchor="middle" fill="#52634d" font-size="12">${['도','개','걸','윷','모'][i]}</text>`).join('');
}
function persistTeams() { try { localStorage.setItem('yut-teams-v1', JSON.stringify(teams)); } catch {} }
function teamLabel() { return teams.length ? `${teams[teamTurn % teams.length].name} · ` : ''; }
function renderTeamList() {
  const box = $('teamList'); box.innerHTML = '';
  if (!teams.length) { const note = document.createElement('p'); note.className = 'empty-note'; note.textContent = '아직 등록된 팀이 없어요. 팀을 추가하면 게임 중 차례를 넘길 수 있어요.'; box.appendChild(note); return; }
  teams.forEach((team, i) => {
    const row = document.createElement('div'); row.className = 'team-row';
    const name = document.createElement('b'); name.textContent = team.name;
    const score = document.createElement('span'); score.textContent = `${team.score}점`;
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '삭제';
    remove.onclick = () => removeTeam(i);
    row.append(name, score, remove);
    box.appendChild(row);
  });
}
function renderScoreDialog() {
  const box = $('scoreList'); box.innerHTML = '';
  if (!teams.length) { const note = document.createElement('p'); note.className = 'empty-note'; note.textContent = '등록된 팀이 없어요. 처음화면에서 팀을 추가해주세요.'; box.appendChild(note); return; }
  teams.forEach((team, i) => {
    const row = document.createElement('div'); row.className = 'score-row';
    const name = document.createElement('b'); name.textContent = team.name;
    const minus = document.createElement('button'); minus.type = 'button'; minus.textContent = '−1'; minus.onclick = () => adjustScore(i, -1);
    const input = document.createElement('input'); input.type = 'number'; input.step = '1'; input.value = team.score;
    input.oninput = () => setScore(i, Number(input.value));
    const plus = document.createElement('button'); plus.type = 'button'; plus.textContent = '+1'; plus.onclick = () => adjustScore(i, 1);
    row.append(name, minus, input, plus);
    box.appendChild(row);
  });
}
function updateRoundLabel() { if (page !== 'home') $('round').textContent = calibration ? '감도 측정' : `${teamLabel()}${mode === 'classic' ? '전통모드' : '삼손모드'} · ${round}번째 던지기`; }
function refreshTeamUI() { renderTeamList(); renderScoreDialog(); updateRoundLabel(); }
function addTeam(name) {
  if (teams.length >= 8) { $('teamMessage').textContent = '팀은 최대 8개까지 등록할 수 있어요.'; return; }
  teams.push({ name, score: 0, skipNext: false }); persistTeams(); $('teamMessage').textContent = ''; refreshTeamUI();
}
function removeTeam(i) {
  teams.splice(i, 1); if (teamTurn >= teams.length) teamTurn = 0;
  persistTeams(); refreshTeamUI();
}
function adjustScore(i, delta) { setScore(i, teams[i].score + delta); renderScoreDialog(); }
function setScore(i, value) {
  if (!Number.isFinite(value)) return;
  // Avoid rebuilding the score dialog here: doing so on every keystroke would drop input focus mid-type.
  teams[i].score = value; persistTeams(); renderTeamList(); updateRoundLabel();
}
function rotateTeam() {
  if (teams.length < 2) return;
  teamTurn = (teamTurn + 1) % teams.length;
  if (teams[teamTurn].skipNext) { teams[teamTurn].skipNext = false; teamTurn = (teamTurn + 1) % teams.length; }
}
function passTurn() {
  if (teams.length < 2) return;
  rotateTeam(); bonusTurn = false;
  if (page === 'result') round++;
  setPage('capture');
}
function persistEvents() { try { localStorage.setItem('yut-board-events-v1', JSON.stringify(boardEvents)); } catch {} }
function renderEventGrid() {
  const box = $('eventGrid'); box.innerHTML = '';
  for (let i = 1; i < 20; i++) {
    if (i % 5 === 0) continue;
    const row = document.createElement('div'); row.className = 'event-row';
    const label = document.createElement('span'); label.textContent = `${i}번 칸`;
    const select = document.createElement('select');
    const none = document.createElement('option'); none.value = ''; none.textContent = '없음'; select.appendChild(none);
    Object.entries(EVENT_TYPES).forEach(([key, ev]) => { const opt = document.createElement('option'); opt.value = key; opt.textContent = ev.label; select.appendChild(opt); });
    select.value = boardEvents[i] || '';
    select.onchange = () => { if (select.value) boardEvents[i] = select.value; else delete boardEvents[i]; persistEvents(); renderBoard(); };
    row.append(label, select);
    box.appendChild(row);
  }
}
function renderToggleButtons() {
  const relevant = teams.length > 0 && !calibration && (page === 'capture' || page === 'result');
  const label = boardVisible ? '말판 숨기기 ↓' : '말판 보기 ↑';
  for (const btn of [$('toggleBoard'), $('toggleBoardResult')]) { btn.hidden = !relevant; btn.textContent = label; }
}
function renderBoard() {
  renderToggleButtons();
  const show = teams.length > 0 && !calibration && boardVisible && (page === 'capture' || page === 'result');
  $('boardPanel').hidden = !show;
  if (!show) return;
  $('boardTurn').textContent = `${teams[teamTurn % teams.length].name} 차례`;
  const parts = [];
  DIAGONALS.forEach(path => {
    parts.push(`<polyline points="${path.map(p => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="#dfe6d2" stroke-width="2"/>`);
    path.slice(1, -1).forEach(p => parts.push(`<circle cx="${p.x}" cy="${p.y}" r="5" fill="#eef1e6" stroke="#c7d0ba" stroke-width="1.5"/>`));
  });
  parts.push(`<polygon points="${NODES.filter((_, i) => i % 5 === 0).map(p => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="#cbd5bb" stroke-width="2"/>`);
  NODES.forEach((pos, i) => {
    const corner = i % 5 === 0;
    const hasEvent = Boolean(boardEvents[i]);
    const fill = hasEvent ? '#e7c46b' : corner ? '#52704a' : '#d7ddcb';
    parts.push(`<circle cx="${pos.x}" cy="${pos.y}" r="${corner ? 10 : 6}" fill="${fill}" stroke="#fff" stroke-width="${corner ? 2.5 : 1.5}"/>`);
  });
  teams.forEach((team, ti) => {
    const color = TEAM_COLORS[ti % TEAM_COLORS.length];
    team.board?.stacks.forEach(stack => {
      const pos = NODES[stack.progress];
      const n = stack.ids.length;
      stack.ids.forEach((pid, k) => {
        const dx = (k - (n - 1) / 2) * 14;
        parts.push(`<circle cx="${pos.x + dx}" cy="${pos.y}" r="9" fill="${color}"/><text x="${pos.x + dx}" y="${pos.y + 4}" font-size="11" text-anchor="middle">${ZODIAC[pid % 12].emoji}</text>`);
      });
    });
  });
  $('boardSvg').innerHTML = parts.join('');
  renderRoster();
}
function renderRoster() {
  const box = $('boardRoster'); box.innerHTML = '';
  teams.forEach((team, ti) => {
    const row = document.createElement('div'); row.className = 'roster-row';
    const name = document.createElement('b'); name.textContent = team.name; name.style.color = TEAM_COLORS[ti % TEAM_COLORS.length];
    row.appendChild(name);
    if (team.board) {
      team.board.waiting.forEach(id => { const s = document.createElement('span'); s.className = 'roster-piece waiting'; s.textContent = ZODIAC[id % 12].emoji; row.appendChild(s); });
      team.board.finished.forEach(id => { const s = document.createElement('span'); s.className = 'roster-piece done'; s.textContent = ZODIAC[id % 12].emoji; row.appendChild(s); });
    }
    box.appendChild(row);
  });
}
function sameOption(a, b) { return Boolean(a && b) && a.kind === b.kind && (a.kind === 'waiting' ? a.id === b.id : a.index === b.index); }
function presentMoveOptions() {
  clearInterval(returnTimer);
  $('countdown').textContent = '이동할 말을 고르고 완료를 눌러주세요.';
  const team = teams[teamTurn % teams.length];
  const options = moveOptions(team.board);
  selectedMove = options[0] || null;
  boardVisible = true;
  $('next').hidden = true;
  renderMoveOptions(options, team);
  renderBoard();
}
function renderMoveOptions(options, team) {
  const box = $('moveOptions'); box.innerHTML = '';
  options.forEach(opt => {
    const btn = document.createElement('button'); btn.type = 'button';
    btn.className = sameOption(opt, selectedMove) ? 'primary selected' : 'primary';
    const id = opt.kind === 'waiting' ? opt.id : team.board.stacks[opt.index].ids[0];
    const count = opt.kind === 'stack' ? team.board.stacks[opt.index].ids.length : 1;
    btn.textContent = opt.kind === 'waiting' ? `${ZODIAC[opt.id % 12].emoji} 새 말 출발` : `${ZODIAC[id % 12].emoji} 말 이동${count > 1 ? ` (${count}개)` : ''}`;
    btn.onclick = () => { selectedMove = opt; renderMoveOptions(options, team); };
    box.appendChild(btn);
  });
  const confirm = document.createElement('button'); confirm.type = 'button'; confirm.className = 'primary confirm-move';
  confirm.textContent = '완료'; confirm.disabled = !selectedMove;
  confirm.onclick = () => chooseMove(selectedMove);
  box.appendChild(confirm);
}
function chooseMove(option) {
  if (!option) return;
  const steps = stepsFor(currentResult.name);
  const info = applyMove(teams, teamTurn % teams.length, option, steps, boardEvents);
  bonusTurn = info.bonusTurn; selectedMove = null;
  if (info.skipNext) teams[teamTurn % teams.length].skipNext = true;
  $('moveOptions').innerHTML = ''; $('next').hidden = false;
  const messages = [];
  if (info.captured) messages.push('상대 말을 잡았어요!');
  if (info.event) messages.push(`이벤트: ${info.event.label}`);
  if (info.finished) messages.push('말이 도착했어요!');
  if (bonusTurn && !info.teamDone) messages.push('보너스! 한 번 더 던지세요.');
  if (info.teamDone) messages.push(`${teams[teamTurn % teams.length].name} 완주!`);
  $('boardMessage').textContent = messages.join(' ');
  renderBoard();
  if (info.teamDone) { $('countdown').textContent = `${teams[teamTurn % teams.length].name}이(가) 모든 말을 완주시켰어요!`; return; }
  startReturnCountdown();
}
function startReturnCountdown() {
  let remaining = returnSeconds; $('countdown').textContent = `${remaining}초 후 모션 인식 화면으로 돌아갑니다.`;
  returnTimer = setInterval(() => { remaining--; $('countdown').textContent = `${remaining}초 후 모션 인식 화면으로 돌아갑니다.`; if (remaining <= 0) nextRound(); }, 1000);
}
function openSettings(key, measured) {
  editing = key; $('settingsTitle').textContent = key === 'mo' ? '모 감도 입력' : '낙 감도 입력';
  $('thresholdInput').value = measured ?? settings[key]; $('settingsError').textContent = '';
  $('settingsDialog').showModal();
}
function home() {
  generation++; stopCamera(); calibration = null; tracker.reset(); error(); teamTurn = 0; bonusTurn = false;
  $('placeholder').hidden = false; $('cameraState').textContent = '카메라 대기 중';
  setPage('home'); updateSettings(); renderTeamList();
}
function begin(selectedMode) {
  mode = selectedMode; calibration = null; round = 1; teamTurn = 0; bonusTurn = false;
  teams.forEach(t => { t.board = createBoardState(pieceCount); t.skipNext = false; });
  setPage('capture');
}
function clearTimers() { clearTimeout(resultTimer); clearInterval(returnTimer); }
function error(message = '') { $('error').textContent = message; $('error').hidden = !message; }
function power(value) { $('powerBar').style.width = `${value}%`; $('powerValue').textContent = `${Math.round(value)}%`; }
function setPage(next) {
  clearTimers(); page = next;
  for (const id of ['home', 'capture', 'result', 'ended']) $(id).hidden = id !== next;
  document.querySelector('nav').hidden = next === 'home' || next === 'ended';
  $('homeButton').hidden = next === 'home';
  $('step1').classList.toggle('active', next === 'capture');
  $('step2').classList.toggle('active', next === 'result');
  $('retry').hidden = next !== 'capture'; $('next').hidden = next !== 'capture' && next !== 'result' || Boolean(calibration); $('quit').hidden = next === 'ended' || next === 'home';
  $('scoreboard').hidden = !teams.length || next === 'home' || next === 'ended' || Boolean(calibration);
  $('passTurn').hidden = teams.length < 2 || !(next === 'capture' || next === 'result') || Boolean(calibration);
  if (next === 'home') $('round').textContent = '모드 선택';
  if (next === 'capture') {
    const classic = mode === 'classic';
    document.querySelector('.power').hidden = classic;
    $('classicNotice').hidden = !classic;
    tracker.reset(); power(0); $('next').textContent = mode === 'classic' ? '윷 던지기 →' : '체험 던지기 →';
    $('round').textContent = calibration ? '감도 측정' : `${teamLabel()}${mode === 'classic' ? '전통모드' : '삼손모드'} · ${round}번째 던지기`;
    document.querySelector('#capture h1').textContent = calibration ? `${calibration === 'mo' ? '모가 나올 만큼 강하게' : '낙의 경계가 될 만큼 약하게'} 던져주세요.` : '달을 향해, 힘껏 던져요.';
    document.querySelector('#capture .heading > p:last-child').textContent = calibration ? '몸통을 위로 들어 올리며 손을 올려주세요. 측정 후 값을 확인하고 저장할 수 있어요.' : classic ? '동작은 시작 신호일 뿐, 결과는 세기와 관계없이 무작위로 결정됩니다.' : '살짝 앉았다가 몸을 위로 들어 올리며 팔도 함께 올려보세요.';
    const instructions = document.querySelectorAll('.instruction p');
    instructions[0].textContent = classic ? '얼굴부터 허리, 두 손까지 보여주세요.' : '어깨·골반·손이 움직이는 동안 화면에 보여야 해요.';
    instructions[1].textContent = '손을 허리 아래에 두고 잠깐 멈춰 준비해요.';
    instructions[2].textContent = classic ? '한쪽 팔만 올려도 시작돼요. 세기는 결과에 반영되지 않아요.' : '살짝 앉았다가 몸을 위로 튕기며 손을 어깨 위로 올려요.';
    $('hint').textContent = classic ? '카메라 동작 또는 윷 던지기 버튼으로 시작하세요.' : '카메라 앞에서 손을 내리고 몸통을 잠깐 멈춰주세요.';
    $('moveOptions').innerHTML = ''; $('boardMessage').textContent = ''; selectedMove = null;
  }
  renderBoard();
}
function stopCamera() { stream?.getTracks().forEach(t => t.stop()); stream = null; video.srcObject = null; ctx.clearRect(0, 0, canvas.width, canvas.height); }
async function startCamera() {
  if (loading) return;
  const ticket = ++generation;
  loading = true; $('start').disabled = true; $('retry').disabled = true; error();
  $('cameraState').textContent = '카메라 연결 중';
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('localhost 또는 HTTPS 주소에서 실행해주세요.');
    if (!stream?.active) {
      stopCamera();
      const acquired = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false });
      if (ticket !== generation) { acquired.getTracks().forEach(t => t.stop()); return; }
      stream = acquired; video.srcObject = stream;
    }
    await video.play();
    if (ticket !== generation) return;
    $('placeholder').hidden = true; $('cameraState').textContent = '모션 인식 모델 준비 중';
    if (!landmarker) {
      const { FilesetResolver, PoseLandmarker } = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/vision_bundle.mjs');
      const files = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm');
      const options = { baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task', delegate: 'GPU' }, runningMode: 'VIDEO', numPoses: 1 };
      try { landmarker = await PoseLandmarker.createFromOptions(files, options); }
      catch { options.baseOptions.delegate = 'CPU'; landmarker = await PoseLandmarker.createFromOptions(files, options); }
    }
    if (ticket !== generation) return;
    tracker.reset(); lastFrame = -1; lastSeen = performance.now();
    $('cameraState').textContent = '카메라 연결됨';
    stream.getVideoTracks()[0].addEventListener('ended', () => {
      if (ticket !== generation || page === 'ended') return;
      stopCamera(); $('placeholder').hidden = false; $('cameraState').textContent = '카메라 연결 끊김'; error('카메라 연결이 끊겼습니다. 카메라 재시도 또는 체험 던지기를 눌러주세요.');
    });
  } catch (e) {
    if (ticket !== generation) return;
    const cameraActive = Boolean(stream?.active);
    if (!cameraActive) stopCamera();
    $('placeholder').hidden = cameraActive;
    $('cameraState').textContent = cameraActive ? '카메라 연결됨 · 모션 인식 준비 실패' : '연결을 확인해주세요';
    const messages = { NotAllowedError: '카메라 권한이 필요합니다. 주소창에서 카메라를 허용한 뒤 재시도해주세요.', NotFoundError: '연결된 카메라가 없습니다. 카메라를 연결하거나 체험 던지기를 이용해주세요.', NotReadableError: '카메라를 사용할 수 없습니다. 다른 카메라 앱을 닫고 재시도해주세요.' };
    error(cameraActive ? `카메라는 연결되어 있지만 모션 인식 모델을 불러오지 못했습니다. 카메라 재시도를 눌러주세요. (${e.message})` : (messages[e.name] || `카메라를 시작하지 못했습니다. (${e.message})`));
  } finally { loading = false; $('start').disabled = false; $('retry').disabled = false; }
}
function draw(points) {
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  ctx.strokeStyle = '#d8f5ab'; ctx.fillStyle = '#efffdb'; ctx.lineWidth = 4;
  for (const [a, b] of [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24]]) {
    if (points[a].visibility < .6 || points[b].visibility < .6) continue;
    ctx.beginPath(); ctx.moveTo(points[a].x * canvas.width, points[a].y * canvas.height); ctx.lineTo(points[b].x * canvas.width, points[b].y * canvas.height); ctx.stroke();
  }
  for (const i of [11,12,13,14,15,16]) { if (points[i].visibility < .6) continue; ctx.beginPath(); ctx.arc(points[i].x * canvas.width, points[i].y * canvas.height, 6, 0, Math.PI * 2); ctx.fill(); }
}
function frame(now) {
  requestAnimationFrame(frame);
  if (page !== 'capture' || loading || !stream || !landmarker || video.readyState < 2 || video.currentTime === lastFrame || now - lastDetection < 65) return;
  lastFrame = video.currentTime; lastDetection = now;
  try {
    const pose = landmarker.detectForVideo(video, now).landmarks[0];
    if (!pose) {
      tracker.reset(); power(0); ctx.clearRect(0, 0, canvas.width, canvas.height);
      $('hint').textContent = now - lastSeen > 10000 ? '인식이 어렵다면 조명을 밝히거나 체험 던지기로 진행하세요.' : '상체와 손이 보이도록 카메라 앞에 서주세요.';
      return;
    }
    lastSeen = now; draw(pose);
    const motion = tracker.update(pose, now, settings, mode); power(mode === 'classic' ? 0 : motion.power);
    $('hint').textContent = motion.hint || (motion.ready ? (mode === 'classic' ? '준비 완료! 손을 올리면 무작위로 던져요.' : '준비 완료! 몸을 위로 들어 올리며 손도 함께 올려주세요.') : '손을 허리 아래로 내리고 잠깐 멈춰주세요.');
    if (motion.result) {
      if (calibration) { const key = calibration, value = Math.max(1, Math.round(motion.result.raw * 10) / 10); home(); openSettings(key, value); }
      else showThrow(resolveThrow(mode, motion.result));
    }
  } catch (e) { stopCamera(); $('placeholder').hidden = false; $('cameraState').textContent = '인식 일시 중단'; error('모션 인식에 문제가 발생했습니다. 카메라 재시도 또는 체험 던지기로 계속할 수 있습니다.'); }
}
function showThrow(result) {
  error(); currentResult = result; setPage('result'); phase = 'rolling';
  $('resultTitle').textContent = '달빛 아래, 윷이 구르는 중…'; $('resultDetail').textContent = result.demo ? '체험 던지기 · 카메라 측정 없이 진행합니다.' : result.traditional ? '전통모드 · 던지는 세기와 관계없는 무작위 결과' : `삼손모드 · 측정 세기 ${result.raw.toFixed(1)} / 모 기준 ${settings.mo}`;
  $('resultBadge').hidden = true; $('countdown').textContent = '윷이 멈추면 결과가 나타납니다.'; $('next').textContent = '애니메이션 스킵 →';
  const flats = { 도: 1, 개: 2, 걸: 3, 윷: 4, 모: 0, 낙: 0 }[result.name];
  $('sticks').classList.remove('rolling');
  sticks.forEach((stick, i) => { stick.classList.toggle('flat', i < flats); stick.style.setProperty('--angle', `${[-18, 9, -7, 20][i]}deg`); stick.style.setProperty('--delay', `${i * .08}s`); });
  void $('sticks').offsetWidth; $('sticks').classList.add('rolling');
  resultTimer = setTimeout(reveal, 1900);
}
function reveal() {
  if (page !== 'result' || phase !== 'rolling') return;
  clearTimeout(resultTimer); phase = 'revealed'; $('sticks').classList.remove('rolling');
  $('resultTitle').textContent = currentResult.name === '낙' ? '아쉬워요, 낙!' : `${currentResult.name}! 멋지게 던졌어요.`;
  $('resultDetail').textContent = currentResult.reason; $('resultBadge').textContent = currentResult.name; $('resultBadge').hidden = false;
  $('next').textContent = '다음 던지기 →';
  const canMove = teams.length > 0 && !currentResult.demo && currentResult.name !== '낙';
  if (canMove) presentMoveOptions(); else { $('moveOptions').innerHTML = ''; startReturnCountdown(); }
}
function nextRound() {
  round++;
  if (!bonusTurn) rotateTeam();
  bonusTurn = false;
  setPage('capture');
}
$('start').onclick = startCamera; $('retry').onclick = startCamera;
$('next').onclick = () => {
  if (page === 'capture' && mode === 'classic') { showThrow(resolveThrow(mode)); return; }
  if (page === 'capture') { const name = ['도','개','걸','윷','모'][Math.floor(Math.random() * 5)]; showThrow({ name, score: 0, demo: true, reason: '체험 결과입니다. 다음에는 카메라로 직접 던져보세요.' }); }
  else if (phase === 'rolling') reveal(); else nextRound();
};
$('quit').onclick = () => { generation++; stopCamera(); setPage('ended'); error(); $('placeholder').hidden = false; $('cameraState').textContent = '카메라 대기 중'; };
$('restart').onclick = home;
$('homeButton').onclick = home;
$('classic').onclick = () => begin('classic');
$('samson').onclick = () => begin('samson');
$('setMo').onclick = () => openSettings('mo');
$('setFall').onclick = () => openSettings('fall');
$('closeSettings').onclick = () => $('settingsDialog').close();
$('settingsForm').onsubmit = event => {
  event.preventDefault(); const value = Number($('thresholdInput').value); const candidate = { ...settings, [editing]: value };
  if (!Number.isFinite(value) || value < 1 || value > 1000 || candidate.mo <= candidate.fall) { $('settingsError').textContent = '1~1000 사이 숫자를 입력하세요. 모 기준은 낙 기준보다 커야 합니다.'; return; }
  settings = candidate; persistSettings(); $('settingsDialog').close();
};
function persistSettings() {
  try { localStorage.setItem('yut-body-settings-v1', JSON.stringify(settings)); $('savedMessage').textContent = '이 브라우저에 몸통 감도를 저장했어요.'; } catch { $('savedMessage').textContent = '현재 게임에 적용했어요. 브라우저 저장은 사용할 수 없습니다.'; }
  updateSettings();
}
$('resetSettings').onclick = () => { settings = { ...DEFAULT_SETTINGS }; persistSettings(); };
$('teamForm').onsubmit = event => {
  event.preventDefault();
  const name = $('teamName').value.trim();
  if (!name) return;
  $('teamName').value = '';
  addTeam(name);
};
$('scoreboard').onclick = () => { renderScoreDialog(); $('scoreDialog').showModal(); };
$('closeScore').onclick = () => $('scoreDialog').close();
$('passTurn').onclick = passTurn;
$('pieceCount').value = pieceCount;
$('pieceForm').onsubmit = event => {
  event.preventDefault();
  const value = Number($('pieceCount').value);
  if (!Number.isInteger(value) || value < 1 || value > 6) { $('pieceMessage').textContent = '1~6 사이의 정수를 입력해주세요.'; return; }
  pieceCount = value;
  try { localStorage.setItem('yut-piece-count', String(value)); $('pieceMessage').textContent = `말 ${value}개로 저장했어요. 다음 게임부터 적용됩니다.`; }
  catch { $('pieceMessage').textContent = `현재 게임에 ${value}개를 적용했어요. 브라우저 저장은 사용할 수 없습니다.`; }
};
$('autoEvents').onclick = () => { boardEvents = autoGenerateEvents(boardEvents); persistEvents(); renderEventGrid(); renderBoard(); };
$('resetEvents').onclick = () => { boardEvents = {}; persistEvents(); renderEventGrid(); renderBoard(); };
$('toggleBoard').onclick = $('toggleBoardResult').onclick = () => { boardVisible = !boardVisible; renderBoard(); };
$('measure').onclick = () => { $('settingsDialog').close(); calibration = editing; mode = 'samson'; setPage('capture'); startCamera(); };
document.addEventListener('visibilitychange', () => tracker.reset());
window.addEventListener('pagehide', () => { generation++; stopCamera(); landmarker?.close(); });
$('returnSeconds').value = returnSeconds;
$('timingForm').onsubmit = event => {
  event.preventDefault();
  const value = Number($('returnSeconds').value);
  if (!Number.isInteger(value) || value < 1 || value > 30) { $('timingMessage').textContent = '1~30 사이의 정수 초를 입력해주세요.'; return; }
  returnSeconds = value;
  try { localStorage.setItem('yut-return-seconds', String(value)); $('timingMessage').textContent = `결과 표시 후 ${value}초 뒤 돌아가도록 저장했어요.`; }
  catch { $('timingMessage').textContent = `현재 게임에 ${value}초를 적용했어요. 브라우저 저장은 사용할 수 없습니다.`; }
};
updateSettings(); renderTeamList(); renderEventGrid(); setPage('home'); requestAnimationFrame(frame);
