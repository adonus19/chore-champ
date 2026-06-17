// Friendly, easy-to-read temporary passwords a parent can read aloud or text to a child without
// confusing characters, while still clearing Firebase's 6-character minimum. Kept in sync with the
// client-side generator in src/app/core/utils/temp-password.ts so the experience matches everywhere.

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
  const suffix = Math.floor(Math.random() * 90 + 10);

  return `${pick(ADJECTIVES)}-${pick(NOUNS)}-${suffix}`;
}
