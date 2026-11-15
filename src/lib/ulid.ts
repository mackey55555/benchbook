const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_LEN = 10;
const RANDOM_LEN = 16;

let lastTime = -1;
let lastRandom: number[] = [];

/**
 * ULID（時刻順に並ぶ26文字のID）。同一ミリ秒内では乱数部を+1して単調増加にする。
 * 端末内でのみ使うIDなので乱数は Math.random で足りる。
 */
export function ulid(now: number = Date.now()): string {
  if (now === lastTime) {
    for (let i = RANDOM_LEN - 1; i >= 0; i--) {
      if (lastRandom[i] < 31) {
        lastRandom[i]++;
        break;
      }
      lastRandom[i] = 0;
    }
  } else {
    lastTime = now;
    lastRandom = Array.from({ length: RANDOM_LEN }, () => Math.floor(Math.random() * 32));
  }
  let time = '';
  let t = now;
  for (let i = 0; i < TIME_LEN; i++) {
    time = ENCODING[t % 32] + time;
    t = Math.floor(t / 32);
  }
  return time + lastRandom.map((n) => ENCODING[n]).join('');
}
