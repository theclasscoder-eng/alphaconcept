/**
 * Maps browser `KeyboardEvent.code` values to the protocol's `KeyCode` names.
 * Returns null for keys we do not forward.
 */
import type { KeyCode } from '@rdp/protocol';

const STATIC: Record<string, KeyCode> = {
  Space: 'Space',
  Enter: 'Enter',
  Tab: 'Tab',
  Escape: 'Escape',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ControlLeft: 'LeftControl',
  ControlRight: 'RightControl',
  ShiftLeft: 'LeftShift',
  ShiftRight: 'RightShift',
  AltLeft: 'LeftAlt',
  AltRight: 'RightAlt',
  MetaLeft: 'LeftSuper',
  MetaRight: 'RightSuper',
  CapsLock: 'CapsLock',
  Minus: 'Minus',
  Equal: 'Equal',
  BracketLeft: 'LeftBracket',
  BracketRight: 'RightBracket',
  Backslash: 'Backslash',
  Semicolon: 'Semicolon',
  Quote: 'Quote',
  Comma: 'Comma',
  Period: 'Period',
  Slash: 'Slash',
  Backquote: 'Grave',
  NumpadAdd: 'Add',
  NumpadSubtract: 'Subtract',
  NumpadMultiply: 'Multiply',
  NumpadDivide: 'Divide',
  NumpadDecimal: 'Decimal',
  NumpadEnter: 'NumPadEnter',
  PrintScreen: 'PrintScreen',
  ScrollLock: 'ScrollLock',
  Pause: 'Pause',
  NumLock: 'NumLock',
  ContextMenu: 'Menu',
};

export function browserCodeToKeyCode(code: string): KeyCode | null {
  if (STATIC[code]) return STATIC[code]!;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3) as KeyCode;
  if (/^Digit[0-9]$/.test(code)) return `Num${code.slice(5)}` as KeyCode;
  if (/^Numpad[0-9]$/.test(code)) return `NumPad${code.slice(6)}` as KeyCode;
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code as KeyCode;
  return null;
}

export interface CommonShortcut {
  label: string;
  modifiers: Array<'ctrl' | 'alt' | 'shift' | 'meta'>;
  code: KeyCode;
  note?: string;
}

export const COMMON_SHORTCUTS: CommonShortcut[] = [
  { label: 'Alt + Tab', modifiers: ['alt'], code: 'Tab' },
  { label: 'Copy (Ctrl+C)', modifiers: ['ctrl'], code: 'C' },
  { label: 'Paste (Ctrl+V)', modifiers: ['ctrl'], code: 'V' },
  { label: 'Show desktop (Win+D)', modifiers: ['meta'], code: 'D' },
  { label: 'Lock (Win+L)', modifiers: ['meta'], code: 'L' },
  { label: 'Close window (Alt+F4)', modifiers: ['alt'], code: 'F4' },
  { label: 'Task view (Win+Tab)', modifiers: ['meta'], code: 'Tab' },
];
