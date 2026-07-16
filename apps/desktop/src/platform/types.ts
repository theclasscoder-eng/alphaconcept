/**
 * Platform-abstraction interface for OS input injection. Windows is implemented
 * first (nut-js). macOS/Linux can add implementations behind this same
 * interface later without touching the session logic.
 */
import type { KeyCode, MouseButton } from '@rdp/protocol';

export interface InputInjector {
  /** True if a real OS injector is loaded; false for the no-op fallback. */
  readonly available: boolean;
  /** Human-readable backend name for diagnostics. */
  readonly backend: string;

  moveTo(x: number, y: number): Promise<void>;
  buttonDown(button: MouseButton): Promise<void>;
  buttonUp(button: MouseButton): Promise<void>;
  click(button: MouseButton): Promise<void>;
  doubleClick(button: MouseButton): Promise<void>;
  scroll(dx: number, dy: number): Promise<void>;
  keyDown(code: KeyCode): Promise<void>;
  keyUp(code: KeyCode): Promise<void>;
  typeText(text: string): Promise<void>;
  shortcut(modifiers: Array<'ctrl' | 'alt' | 'shift' | 'meta'>, code: KeyCode): Promise<void>;
}
