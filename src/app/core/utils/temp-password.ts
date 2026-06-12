// Friendly, easy-to-read starter passwords for invited co-parents. The goal is something a parent can
// say out loud or text to the other parent without confusing characters, while still clearing Firebase's
// 6-character minimum. A later password-reset flow will let the invited parent replace this.

const ADJECTIVES = [
  'Brave',
  'Bright',
  'Calm',
  'Clever',
  'Cozy',
  'Eager',
  'Gentle',
  'Happy',
  'Jolly',
  'Kind',
  'Lucky',
  'Merry',
  'Nimble',
  'Proud',
  'Sunny',
  'Swift',
  'Warm',
  'Wise',
];

const NOUNS = [
  'Acorn',
  'Badger',
  'Cabin',
  'Comet',
  'Falcon',
  'Garden',
  'Harbor',
  'Lantern',
  'Maple',
  'Meadow',
  'Otter',
  'Pebble',
  'River',
  'Robin',
  'Summit',
  'Willow',
];

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

export function generateTempPassword(): string {
  // Two digits keep it short to read while still padding the total length well past Firebase's minimum.
  const suffix = Math.floor(Math.random() * 90 + 10);

  return `${pick(ADJECTIVES)}-${pick(NOUNS)}-${suffix}`;
}
