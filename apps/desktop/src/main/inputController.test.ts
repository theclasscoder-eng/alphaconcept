import { describe, it, expect, beforeEach } from 'vitest';
import { InputController } from './inputController.js';
import type { InputInjector } from '../platform/types.js';
import { INPUT_PROTOCOL_VERSION } from '@rdp/protocol';

class MockInjector implements InputInjector {
  available = true;
  backend = 'mock';
  calls: Array<[string, ...unknown[]]> = [];
  async moveTo(x: number, y: number) {
    this.calls.push(['moveTo', x, y]);
  }
  async buttonDown(b: string) {
    this.calls.push(['buttonDown', b]);
  }
  async buttonUp(b: string) {
    this.calls.push(['buttonUp', b]);
  }
  async click(b: string) {
    this.calls.push(['click', b]);
  }
  async doubleClick(b: string) {
    this.calls.push(['doubleClick', b]);
  }
  async scroll(dx: number, dy: number) {
    this.calls.push(['scroll', dx, dy]);
  }
  async keyDown(c: string) {
    this.calls.push(['keyDown', c]);
  }
  async keyUp(c: string) {
    this.calls.push(['keyUp', c]);
  }
  async typeText(t: string) {
    this.calls.push(['typeText', t]);
  }
  async shortcut(m: string[], c: string) {
    this.calls.push(['shortcut', m.join('+'), c]);
  }
}

const base = { v: INPUT_PROTOCOL_VERSION, seq: 0, t: 0 };
const display = { bounds: { x: 0, y: 0, width: 1000, height: 1000 }, scaleFactor: 1 };

describe('InputController', () => {
  let injector: MockInjector;
  let now: number;
  let ctl: InputController;

  beforeEach(() => {
    injector = new MockInjector();
    now = 0;
    ctl = new InputController({ injector, now: () => now });
  });

  it('rejects malformed messages', async () => {
    expect(await ctl.handle({ nope: true })).toBe('rejected');
  });

  it('refuses input before authorization', async () => {
    const r = await ctl.handle({ ...base, type: 'input.mouse.move', p: { nx: 0.5, ny: 0.5 } });
    expect(r).toBe('not-authorized');
    expect(injector.calls).toHaveLength(0);
  });

  it('injects a mouse move mapped to the display after authorization', async () => {
    ctl.authorize(display);
    const r = await ctl.handle({ ...base, type: 'input.mouse.move', p: { nx: 0.5, ny: 0.5 } });
    expect(r).toBe('injected');
    expect(injector.calls[0]).toEqual(['moveTo', 500, 500]);
  });

  it('throttles a flood of mouse moves', async () => {
    ctl.authorize(display);
    let throttled = 0;
    // capacity == DEFAULT_MOUSE_MOVE_RATE (240); the (N+1)th within the same
    // instant is throttled because no time passes to refill.
    for (let i = 0; i < 400; i++) {
      const r = await ctl.handle({ ...base, type: 'input.mouse.move', p: { nx: 0.1, ny: 0.1 } });
      if (r === 'throttled') throttled++;
    }
    expect(throttled).toBeGreaterThan(0);
  });

  it('handles buttons, keys, text, and shortcuts', async () => {
    ctl.authorize(display);
    await ctl.handle({ ...base, type: 'input.mouse.button', button: 'left', action: 'down' });
    await ctl.handle({ ...base, type: 'input.key', action: 'down', code: 'A' });
    await ctl.handle({ ...base, type: 'input.text', text: 'hi' });
    await ctl.handle({ ...base, type: 'input.shortcut', modifiers: ['ctrl'], code: 'C' });
    const names = injector.calls.map((c) => c[0]);
    expect(names).toContain('buttonDown');
    expect(names).toContain('keyDown');
    expect(names).toContain('typeText');
    expect(names).toContain('shortcut');
  });

  it('routes clipboard messages to the callback, not the injector', async () => {
    let clip = '';
    const c = new InputController({ injector, onClipboard: (t) => (clip = t) });
    c.authorize(display);
    const r = await c.handle({ ...base, type: 'control.clipboard', text: 'copied' });
    expect(r).toBe('accepted');
    expect(clip).toBe('copied');
  });

  it('stops injecting after revoke', async () => {
    ctl.authorize(display);
    await ctl.handle({ ...base, type: 'input.mouse.move', p: { nx: 0.5, ny: 0.5 } });
    ctl.revoke();
    const r = await ctl.handle({ ...base, type: 'input.mouse.move', p: { nx: 0.5, ny: 0.5 } });
    expect(r).toBe('not-authorized');
  });
});
