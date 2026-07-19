const maxPostDisplayIdInt4 = 2_147_483_647;

export function parsePostDisplayIdFilter(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) {
    return null;
  }
  const displayId = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(displayId) || displayId < 1 || displayId > maxPostDisplayIdInt4) {
    return null;
  }
  return displayId;
}
