import { MotionTracker, DEFAULT_SETTINGS, thresholds, resolveThrow } from './motion.js?v=body-2';
const $ = id => document.getElementById(id);
const tracker = new MotionTracker();
let page = 'home', mode = 'samson', calibration = null, editing = 'mo', phase = '', round = 1, stream, landmarker, loading = false;
let settings = { ...DEFAULT_SETTINGS };
let returnSeconds = 10;
try { const saved = Number(localStorage.getItem('yut-return-seconds')); if (Number.isInteger(saved) && saved >= 1 && saved <= 30) returnSeconds = saved; } catch {}
try { const saved = JSON.parse(localStorage.getItem('yut-body-settings-v1')); if (saved && Number.isFinite(saved.fall) && Number.isFinite(saved.mo) && saved.fall >= 1 && saved.mo <= 1000 && saved.mo > saved.fall) settings = saved; } catch {}
let teams = [], teamTurn = 0;
try { const saved = JSON.parse(localStorage.getItem('yut-teams-v1')); if (Array.isArray(saved)) teams = saved.filter(t => t && typeof t.name === 'string' && Number.isFinite(t.score)).slice(0, 8); } catch {}
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
  teams.push({ name, score: 0 }); persistTeams(); $('teamMessage').textContent = ''; refreshTeamUI();
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
function passTurn() {
  if (teams.length < 2) return;
  teamTurn = (teamTurn + 1) % teams.length;
  if (page === 'result') round++;
  setPage('capture');
}
function openSettings(key, measured) {
  editing = key; $('settingsTitle').textContent = key === 'mo' ? '모 감도 입력' : '낙 감도 입력';
  $('thresholdInput').value = measured ?? settings[key]; $('settingsError').textContent = '';
  $('settingsDialog').showModal();
}
function home() {
  generation++; stopCamera(); calibration = null; tracker.reset(); error(); teamTurn = 0;
  $('placeholder').hidden = false; $('cameraState').textContent = '카메라 대기 중';
  setPage('home'); updateSettings(); renderTeamList();
}
function begin(selectedMode) {
  mode = selectedMode; calibration = null; round = 1; setPage('capture');
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
  }
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
  let remaining = returnSeconds; $('countdown').textContent = `${remaining}초 후 모션 인식 화면으로 돌아갑니다.`;
  returnTimer = setInterval(() => { remaining--; $('countdown').textContent = `${remaining}초 후 모션 인식 화면으로 돌아갑니다.`; if (remaining <= 0) nextRound(); }, 1000);
}
function nextRound() { round++; setPage('capture'); }
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
updateSettings(); renderTeamList(); setPage('home'); requestAnimationFrame(frame);
