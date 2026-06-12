const CHILD_USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{2,19})$/;

export function normalizeChildUsername(value: string) {
  const normalized = value.trim().toLowerCase();
  return CHILD_USERNAME_PATTERN.test(normalized) ? normalized : null;
}

export function suggestChildUsername(name: string) {
  const compact = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 16);

  return compact.length >= 3 ? compact : 'questkid';
}

export function buildChildInternalEmailAlias(childId: string) {
  const safeLocalPart = childId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return `child.${safeLocalPart || 'kid'}@children.auth.chorechamp.app`;
}

export function looksLikeEmail(value: string) {
  return value.includes('@');
}

export function childUsernameHelpText() {
  return 'Use 3 to 20 letters, numbers, dots, dashes, or underscores.';
}
