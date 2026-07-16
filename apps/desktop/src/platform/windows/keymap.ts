/**
 * Maps the protocol's validated `KeyCode` names to nut-js `Key` enum values.
 * Most names match 1:1; the overrides table covers the differences. Passing the
 * nut-js `Key` object in avoids a static import so this stays testable and the
 * native module can be loaded lazily.
 */
import type { KeyCode } from '@rdp/protocol';
import { KEY_CODES } from '@rdp/protocol';

// nut-js Key names that differ from our KeyCode names.
const OVERRIDES: Partial<Record<KeyCode, string>> = {
  PrintScreen: 'Print',
  NumPadEnter: 'Enter',
};

type KeyEnum = Record<string, number>;

export function buildKeyMap(Key: KeyEnum): Map<KeyCode, number> {
  const map = new Map<KeyCode, number>();
  for (const code of KEY_CODES) {
    const nutName = OVERRIDES[code] ?? code;
    const value = Key[nutName];
    if (typeof value === 'number') {
      map.set(code, value);
    }
  }
  return map;
}

export const MODIFIER_TO_KEYNAME: Record<'ctrl' | 'alt' | 'shift' | 'meta', string> = {
  ctrl: 'LeftControl',
  alt: 'LeftAlt',
  shift: 'LeftShift',
  meta: 'LeftSuper',
};
