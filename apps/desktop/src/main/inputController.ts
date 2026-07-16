/**
 * Authoritative host-side input handling. Every control-channel message is
 * re-validated here (defense in depth — the renderer also validates) before any
 * OS input is injected. Mouse-move events are rate-limited; coordinates are
 * translated from normalized [0,1] to the active display.
 *
 * This module has no Electron dependency so it is unit-testable in isolation.
 */
import {
  parseControlMessage,
  normalizedToLogicalPoint,
  normalizedToPhysicalPoint,
  TokenBucket,
  DEFAULT_MOUSE_MOVE_RATE,
  type ControlMessage,
} from '@rdp/protocol';
import type { InputInjector } from '../platform/types.js';
import type { ActiveDisplay } from '../shared-app/types.js';

export type HandleResult = 'injected' | 'accepted' | 'rejected' | 'throttled' | 'not-authorized';

export interface InputControllerOptions {
  injector: InputInjector;
  /** Set true to map to physical pixels (injector operating in device px). */
  usePhysicalPixels?: boolean;
  now?: () => number;
  /** Callback invoked with clipboard text when a clipboard message arrives. */
  onClipboard?: (text: string) => void;
  /** Callback invoked when a monitor-switch is requested. */
  onMonitorSelect?: (index: number) => void;
}

export class InputController {
  private display: ActiveDisplay | null = null;
  private authorized = false;
  private readonly moveBucket: TokenBucket;
  private readonly opts: InputControllerOptions;

  constructor(opts: InputControllerOptions) {
    this.opts = opts;
    this.moveBucket = new TokenBucket({
      capacity: DEFAULT_MOUSE_MOVE_RATE,
      refillPerSecond: DEFAULT_MOUSE_MOVE_RATE,
      now: opts.now,
    });
  }

  /** Enable input handling for an authorized session and set the target display. */
  authorize(display: ActiveDisplay): void {
    this.display = display;
    this.authorized = true;
  }

  setDisplay(display: ActiveDisplay): void {
    this.display = display;
  }

  /** Immediately stop accepting input (disconnect / emergency stop). */
  revoke(): void {
    this.authorized = false;
    this.display = null;
  }

  private point(p: { nx: number; ny: number }): { x: number; y: number } {
    const display = this.display!;
    return this.opts.usePhysicalPixels
      ? normalizedToPhysicalPoint(p, display)
      : normalizedToLogicalPoint(p, display);
  }

  /** Validate and, if authorized, inject a raw control message. */
  async handle(raw: unknown): Promise<HandleResult> {
    const parsed = parseControlMessage(raw);
    if (!parsed.success) return 'rejected';
    const msg: ControlMessage = parsed.data;

    // Non-input control messages are allowed even without display authorization.
    if (msg.type === 'control.hello') return 'accepted';
    if (msg.type === 'control.clipboard') {
      this.opts.onClipboard?.(msg.text);
      return 'accepted';
    }
    if (msg.type === 'control.monitor') {
      this.opts.onMonitorSelect?.(msg.index);
      return 'accepted';
    }

    if (!this.authorized || !this.display) return 'not-authorized';

    const inj = this.opts.injector;
    switch (msg.type) {
      case 'input.mouse.move': {
        if (!this.moveBucket.tryConsume()) return 'throttled';
        const { x, y } = this.point(msg.p);
        await inj.moveTo(x, y);
        return 'injected';
      }
      case 'input.mouse.button': {
        if (msg.p) {
          const { x, y } = this.point(msg.p);
          await inj.moveTo(x, y);
        }
        if (msg.action === 'down') await inj.buttonDown(msg.button);
        else await inj.buttonUp(msg.button);
        return 'injected';
      }
      case 'input.mouse.double': {
        const { x, y } = this.point(msg.p);
        await inj.moveTo(x, y);
        await inj.doubleClick(msg.button);
        return 'injected';
      }
      case 'input.mouse.scroll': {
        if (msg.p) {
          const { x, y } = this.point(msg.p);
          await inj.moveTo(x, y);
        }
        await inj.scroll(msg.dx, msg.dy);
        return 'injected';
      }
      case 'input.key': {
        if (msg.action === 'down') await inj.keyDown(msg.code);
        else await inj.keyUp(msg.code);
        return 'injected';
      }
      case 'input.text': {
        await inj.typeText(msg.text);
        return 'injected';
      }
      case 'input.shortcut': {
        await inj.shortcut(msg.modifiers, msg.code);
        return 'injected';
      }
      default:
        return 'rejected';
    }
  }
}
