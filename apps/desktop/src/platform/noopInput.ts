import type { InputInjector } from './types.js';

/**
 * Fallback injector used when a native backend cannot be loaded (e.g. the
 * native module failed to build on this machine). It performs no OS input and
 * only logs, so the rest of the app remains functional and the failure is
 * surfaced to the user rather than crashing.
 */
export class NoopInputInjector implements InputInjector {
  readonly available = false;
  readonly backend = 'noop';
  async moveTo(): Promise<void> {}
  async buttonDown(): Promise<void> {}
  async buttonUp(): Promise<void> {}
  async click(): Promise<void> {}
  async doubleClick(): Promise<void> {}
  async scroll(): Promise<void> {}
  async keyDown(): Promise<void> {}
  async keyUp(): Promise<void> {}
  async typeText(): Promise<void> {}
  async shortcut(): Promise<void> {}
}
