export const DEFAULT_SETTINGS = { fall: 35, mo: 220 };
export function thresholds({ fall, mo } = DEFAULT_SETTINGS) {
  return Array.from({ length: 5 }, (_, i) => fall + (mo - fall) * Math.expm1(2 * i / 4) / Math.expm1(2));
}
// Body displacement and speed are expressed in baseline torso lengths.
// Small body movements cannot score highly even with a brief speed spike.
export function strength(rise, speed) { return Math.max(0, rise * 180 + speed * 65) * Math.min(1, Math.max(0, rise) / .25); }
export function randomThrow(random = Math.random) {
  const flats = Array.from({ length: 4 }, () => random() < .5).filter(Boolean).length;
  if (random() < .1) return { name: '낙', score: 0, traditional: true, reason: '윷이 판 밖으로 떨어졌어요. 다음 던지기에 도전해보세요!' };
  return { name: ['모', '도', '개', '걸', '윷'][flats], score: 0, traditional: true, reason: '네 개의 윷을 무작위로 던진 결과입니다.' };
}
export function resolveThrow(mode, motionResult, random = Math.random) {
  return mode === 'classic' ? randomThrow(random) : motionResult;
}
export function classifyThrow(rise, speed, settings = DEFAULT_SETTINGS) {
  const raw = strength(rise, speed);
  const score = Math.min(100, Math.round(raw / settings.mo * 100));
  const limits = thresholds(settings);
  if (raw < settings.fall) return { name: '낙', score, raw, reason: '던지는 세기가 낙 기준보다 낮아요.' };
  if (rise < .08 || speed < .18) return { name: '낙', score, raw, reason: '팔만 올리지 말고 몸통을 함께 위로 들어 올려주세요.' };
  const level = limits.filter(limit => raw >= limit).length - 1;
  return { name: ['도', '개', '걸', '윷', '모'][level], score, raw, reason: `측정 세기 ${raw.toFixed(1)} · 모 기준 ${settings.mo}` };
}

class ArmGestureTracker {
  constructor() { this.reset(); }
  reset() { this.arms = [{}, {}]; }
  update(points, now, settings = DEFAULT_SETTINGS) {
    for (let side = 0; side < 2; side++) {
      const wrist = points[15 + side], shoulder = points[11 + side], hip = points[23 + side];
      let a = this.arms[side];
      if (!wrist || !shoulder || !hip || [wrist, shoulder, hip].some(p => (p.visibility ?? 1) < .6)) { this.arms[side] = {}; continue; }
      const scale = Math.max(.12, Math.abs(hip.y - shoulder.y));
      const y = (wrist.y - shoulder.y) / scale;
      if (a.time && now - a.time > 250) a = this.arms[side] = {};
      const dt = a.time ? (now - a.time) / 1000 : 0;
      const instant = dt > .01 ? (a.y - y) / dt : 0;
      const speed = a.speed === undefined ? instant : a.speed * .55 + instant * .45;
      a.speed = speed;
      if (!a.armed) {
        if (y > .8) {
          a.readyAt ??= now;
          if (now - a.readyAt > 350) { a.armed = true; a.base = y; a.peak = 0; a.rise = 0; }
        } else a.readyAt = null;
      } else {
        if (!a.started) a.base = Math.max(a.base, y);
        if (a.base - y > .12 && speed > .2) a.started ??= now;
        if (a.started) {
          a.peak = Math.max(a.peak, Math.min(speed, 25));
          a.rise = Math.max(a.rise, a.base - y);
          if ((a.rise > .25 && speed < -.25) || now - a.started > 1500 || y < -.65) {
            // Traditional mode only needs a gesture trigger, never a strength result.
            const result = { triggered: true };
            this.reset();
            return { result, power: 0, ready: true };
          }
        }
      }
      a.y = y; a.time = now;
    }
    return { power: 0, ready: this.arms.some(a => a.armed) };
  }
}

class BodyTracker {
  constructor() { this.reset(); }
  reset() { this.state = null; this.readyAt = null; this.previous = null; this.positions = []; }
  update(points, now, settings) {
    const visible = i => points[i] && (points[i].visibility ?? 1) >= .65 && points[i].y > .02 && points[i].y < .98;
    if (![11, 12, 23, 24].every(visible)) {
      this.reset(); return { power: 0, ready: false, hint: '양쪽 어깨와 골반이 모두 화면에 보이도록 서주세요.' };
    }
    this.positions.push({ shoulder: (points[11].y + points[12].y) / 2, hip: (points[23].y + points[24].y) / 2 });
    if (this.positions.length > 3) this.positions.shift();
    const median = key => this.positions.map(p => p[key]).sort((a, b) => a - b)[Math.floor(this.positions.length / 2)];
    const shoulder = median('shoulder');
    const hip = median('hip');
    const scale = hip - shoulder;
    const centerX = (points[11].x + points[12].x + points[23].x + points[24].x) / 4;
    const arms = [15, 16].filter(visible).map(i => ({ i, y: (points[i].y - shoulder) / Math.max(.12, scale) }));
    if (scale < .12 || !arms.length || (this.previous && now - this.previous.time > 250)) {
      this.reset(); return { power: 0, ready: false, hint: '몸통과 손이 잘 보이도록 카메라 위치를 확인해주세요.' };
    }
    if (!this.state) {
      const low = arms.filter(a => a.y > .8);
      const steady = !this.previous || Math.abs(hip - this.previous.hip) / scale < .06;
      if (low.length && steady) {
        this.readyAt ??= now;
        if (now - this.readyAt >= 350) {
          this.state = { shoulder, hip, scale, centerX, arms: low, history: [], rise: 0, peak: 0, armRise: 0, armUp: false };
        }
      } else this.readyAt = null;
      this.previous = { time: now, hip };
      return { ready: Boolean(this.state), power: 0 };
    }
    const s = this.state;
    if (Math.abs(scale / s.scale - 1) > .3 || Math.abs(centerX - s.centerX) / s.scale > .7) {
      this.reset(); return { ready: false, power: 0, hint: '앞뒤로 이동하지 말고 같은 자리에서 위로 움직여주세요.' };
    }
    // Both shoulders AND hips must rise: shrugging or lifting arms is insufficient.
    const displacement = Math.min(s.shoulder - shoulder, s.hip - hip) / s.scale;
    s.history.push({ time: now, displacement });
    while (s.history.length > 1 && now - s.history[0].time > 240) s.history.shift();
    const first = s.history[0], elapsed = (now - first.time) / 1000;
    const speed = elapsed >= .1 && s.history.length >= 3 ? (displacement - first.displacement) / elapsed : 0;
    for (const arm of s.arms) {
      const current = arms.find(a => a.i === arm.i);
      if (current) {
        s.armRise = Math.max(s.armRise, arm.y - current.y);
        if (current.y < .2 && arm.y - current.y > .65) s.armUp = true;
      }
    }
    if (!s.started && (displacement > .035 || s.armRise > .15)) s.started = now;
    // Follow a preparatory dip while arms remain down, then lock the baseline.
    if (!s.started && displacement < 0 && s.armRise < .15) { s.shoulder = shoulder; s.hip = hip; s.history = []; }
    s.rise = Math.max(s.rise, displacement);
    s.peak = Math.max(s.peak, Math.min(6, speed));
    this.previous = { time: now, hip };
    if (s.started && (now - s.started >= 1500 || (now - s.started >= 350 && s.armUp && speed < .1))) {
      let result = classifyThrow(s.rise, s.peak, settings);
      if (!s.armUp) result = { ...result, name: '낙', reason: '몸을 들어 올리면서 손도 어깨 위로 올려주세요.' };
      result.bodyRise = s.rise; result.bodySpeed = s.peak;
      this.reset(); return { result, ready: true, power: result.score };
    }
    return { ready: true, power: Math.min(100, strength(s.rise, s.peak) / settings.mo * 100) };
  }
}

export class MotionTracker {
  constructor() { this.arm = new ArmGestureTracker(); this.body = new BodyTracker(); }
  reset() { this.arm.reset(); this.body.reset(); }
  update(points, now, settings = DEFAULT_SETTINGS, mode = 'samson') {
    return mode === 'classic' ? this.arm.update(points, now, settings) : this.body.update(points, now, settings);
  }
}

