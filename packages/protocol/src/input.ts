/**
 * Remote-control data-channel protocol. These messages travel over the
 * dedicated, encrypted WebRTC data channel (never the signaling server). They
 * are validated on the HOST before any OS input is injected. Invalid version,
 * unknown key codes, out-of-range coordinates, and malformed shapes are all
 * rejected here at the trust boundary.
 */
import { z } from 'zod';
import { INPUT_PROTOCOL_VERSION, MAX_CLIPBOARD_BYTES } from './constants.js';

/** Normalized pointer position; range-checked so bogus coordinates are rejected. */
export const normalizedPointSchema = z.object({
  nx: z.number().min(0).max(1),
  ny: z.number().min(0).max(1),
});
export type WirePoint = z.infer<typeof normalizedPointSchema>;

export const mouseButtonSchema = z.enum(['left', 'middle', 'right']);
export type MouseButton = z.infer<typeof mouseButtonSchema>;

/**
 * Allowlist of injectable key identifiers. Anything not in this list is an
 * "impossible key code" and is rejected. Names map 1:1 to the host injector's
 * key table (see apps/desktop/src/platform/windows/keymap.ts).
 */
export const KEY_CODES = [
  // Letters
  'A','B','C','D','E','F','G','H','I','J','K','L','M',
  'N','O','P','Q','R','S','T','U','V','W','X','Y','Z',
  // Digits (top row)
  'Num0','Num1','Num2','Num3','Num4','Num5','Num6','Num7','Num8','Num9',
  // Function keys
  'F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12',
  'F13','F14','F15','F16','F17','F18','F19','F20','F21','F22','F23','F24',
  // Whitespace / editing
  'Space','Enter','Tab','Escape','Backspace','Delete','Insert',
  // Navigation
  'Home','End','PageUp','PageDown','Up','Down','Left','Right',
  // Modifiers
  'LeftControl','RightControl','LeftShift','RightShift',
  'LeftAlt','RightAlt','LeftSuper','RightSuper','CapsLock',
  // Punctuation
  'Minus','Equal','LeftBracket','RightBracket','Backslash',
  'Semicolon','Quote','Comma','Period','Slash','Grave',
  // Numpad
  'NumPad0','NumPad1','NumPad2','NumPad3','NumPad4','NumPad5',
  'NumPad6','NumPad7','NumPad8','NumPad9',
  'Add','Subtract','Multiply','Divide','Decimal','NumPadEnter',
  // Misc
  'PrintScreen','ScrollLock','Pause','NumLock','Menu',
] as const;
export type KeyCode = (typeof KEY_CODES)[number];
export const keyCodeSchema = z.enum(KEY_CODES);

const cbase = z.object({
  v: z.literal(INPUT_PROTOCOL_VERSION),
  /** Monotonic sequence number per channel (diagnostics / ordering). */
  seq: z.number().int().nonnegative(),
  /** Sender timestamp (ms). */
  t: z.number().int().nonnegative(),
});

function control<TType extends string, T extends z.ZodRawShape>(type: TType, shape: T) {
  return cbase.extend({ type: z.literal(type), ...shape }).strict();
}

// ---- Handshake -------------------------------------------------------------
export const helloMessage = control('control.hello', {
  role: z.enum(['controller', 'host']),
  protocolVersion: z.literal(INPUT_PROTOCOL_VERSION),
});

// ---- Mouse -----------------------------------------------------------------
export const mouseMoveMessage = control('input.mouse.move', {
  p: normalizedPointSchema,
});

export const mouseButtonMessage = control('input.mouse.button', {
  button: mouseButtonSchema,
  action: z.enum(['down', 'up']),
  p: normalizedPointSchema.optional(),
});

export const mouseDoubleMessage = control('input.mouse.double', {
  button: mouseButtonSchema.default('left'),
  p: normalizedPointSchema,
});

export const mouseScrollMessage = control('input.mouse.scroll', {
  /** Wheel deltas; positive dy scrolls down, positive dx scrolls right. */
  dx: z.number().min(-10_000).max(10_000),
  dy: z.number().min(-10_000).max(10_000),
  p: normalizedPointSchema.optional(),
});

// ---- Keyboard --------------------------------------------------------------
export const keyMessage = control('input.key', {
  action: z.enum(['down', 'up']),
  code: keyCodeSchema,
});

/** Direct text entry (typed as a unit). Length-bounded. */
export const textMessage = control('input.text', {
  text: z.string().min(1).max(4096),
});

/** A named chord/shortcut, e.g. modifiers + a key, executed atomically. */
export const shortcutMessage = control('input.shortcut', {
  modifiers: z
    .array(z.enum(['ctrl', 'alt', 'shift', 'meta']))
    .max(4)
    .default([]),
  code: keyCodeSchema,
});

// ---- Clipboard (text-only, opt-in) ----------------------------------------
export const clipboardMessage = control('control.clipboard', {
  text: z.string().max(MAX_CLIPBOARD_BYTES),
});

// ---- Session/quality control over the data channel ------------------------
export const monitorSelectMessage = control('control.monitor', {
  index: z.number().int().min(0).max(64),
});

export const controlMessage = z.discriminatedUnion('type', [
  helloMessage,
  mouseMoveMessage,
  mouseButtonMessage,
  mouseDoubleMessage,
  mouseScrollMessage,
  keyMessage,
  textMessage,
  shortcutMessage,
  clipboardMessage,
  monitorSelectMessage,
]);
export type ControlMessage = z.infer<typeof controlMessage>;

/**
 * Validate a decoded control message. Returns a typed result. The host MUST call
 * this before injecting any input and drop anything that fails.
 */
export function parseControlMessage(raw: unknown): z.SafeParseReturnType<unknown, ControlMessage> {
  return controlMessage.safeParse(raw);
}
