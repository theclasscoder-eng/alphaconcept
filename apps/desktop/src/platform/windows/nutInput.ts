/**
 * Windows input injector backed by @nut-tree-fork/nut-js. Loaded lazily; if the
 * native module cannot be initialized the factory throws and the caller falls
 * back to the no-op injector (surfacing the error to the user).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { InputInjector } from '../types.js';
import type { KeyCode, MouseButton } from '@rdp/protocol';
import { buildKeyMap, MODIFIER_TO_KEYNAME } from './keymap.js';

export class NutInputInjector implements InputInjector {
  readonly available = true;
  readonly backend = 'nut-js';

  private constructor(
    private readonly nut: any,
    private readonly keyMap: Map<KeyCode, number>,
  ) {}

  static async create(): Promise<NutInputInjector> {
    const nut = await import('@nut-tree-fork/nut-js');
    // Minimize per-action delays for responsive control.
    nut.mouse.config.autoDelayMs = 0;
    nut.keyboard.config.autoDelayMs = 0;
    const keyMap = buildKeyMap(nut.Key as any);
    return new NutInputInjector(nut, keyMap);
  }

  private button(button: MouseButton): number {
    const { Button } = this.nut;
    switch (button) {
      case 'left':
        return Button.LEFT;
      case 'middle':
        return Button.MIDDLE;
      case 'right':
        return Button.RIGHT;
    }
  }

  async moveTo(x: number, y: number): Promise<void> {
    await this.nut.mouse.setPosition(new this.nut.Point(x, y));
  }

  async buttonDown(button: MouseButton): Promise<void> {
    await this.nut.mouse.pressButton(this.button(button));
  }

  async buttonUp(button: MouseButton): Promise<void> {
    await this.nut.mouse.releaseButton(this.button(button));
  }

  async click(button: MouseButton): Promise<void> {
    await this.nut.mouse.click(this.button(button));
  }

  async doubleClick(button: MouseButton): Promise<void> {
    await this.nut.mouse.doubleClick(this.button(button));
  }

  async scroll(dx: number, dy: number): Promise<void> {
    // nut-js scroll takes a positive number of steps in a direction.
    if (dy > 0) await this.nut.mouse.scrollDown(Math.round(Math.abs(dy)));
    else if (dy < 0) await this.nut.mouse.scrollUp(Math.round(Math.abs(dy)));
    if (dx > 0) await this.nut.mouse.scrollRight(Math.round(Math.abs(dx)));
    else if (dx < 0) await this.nut.mouse.scrollLeft(Math.round(Math.abs(dx)));
  }

  async keyDown(code: KeyCode): Promise<void> {
    const key = this.keyMap.get(code);
    if (key === undefined) return;
    await this.nut.keyboard.pressKey(key);
  }

  async keyUp(code: KeyCode): Promise<void> {
    const key = this.keyMap.get(code);
    if (key === undefined) return;
    await this.nut.keyboard.releaseKey(key);
  }

  async typeText(text: string): Promise<void> {
    await this.nut.keyboard.type(text);
  }

  async shortcut(
    modifiers: Array<'ctrl' | 'alt' | 'shift' | 'meta'>,
    code: KeyCode,
  ): Promise<void> {
    const modKeys = modifiers
      .map((m) => this.nut.Key[MODIFIER_TO_KEYNAME[m]])
      .filter((k: unknown) => typeof k === 'number');
    const key = this.keyMap.get(code);
    if (key === undefined) return;
    for (const m of modKeys) await this.nut.keyboard.pressKey(m);
    await this.nut.keyboard.pressKey(key);
    await this.nut.keyboard.releaseKey(key);
    for (const m of [...modKeys].reverse()) await this.nut.keyboard.releaseKey(m);
  }
}
