const listPreferencePrefix = "campux.list-preferences.";

export function readListPreferences<T>(key: string, fallback: T, validate?: (value: unknown) => value is T): T {
  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(`${listPreferencePrefix}${key}`);
    if (!raw) {
      return fallback;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (validate && !validate(parsed)) {
      return fallback;
    }
    return (validate ? parsed : parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

export function writeListPreferences<T>(key: string, value: T) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(`${listPreferencePrefix}${key}`, JSON.stringify(value));
  } catch {
    // Ignore storage failures; the current page state still works.
  }
}

