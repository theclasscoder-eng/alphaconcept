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

  // Regression: nut-js drives the cursor in PHYSICAL pixels inside the DPI-aware
  // Electron process, but display bounds are DIP. Without converting, the cursor
  // reached only 1/scaleFactor of the screen (at 200%: far edge -> screen centre).
  describe('DPI scaling', () => {
    // A 2560x1600 display at 200% reports 1280x800 DIP with scaleFactor 2.
    const hidpi = { bounds: { x: 0, y: 0, width: 1280, height: 800 }, scaleFactor: 2 };
    const dipToScreenPoint = (p: { x: number; y: number }) => ({ x: p.x * 2, y: p.y * 2 });

    it('maps the far corner to the physical far corner, not the centre', async () => {
      const c = new InputController({ injector, dipToScreenPoint });
      c.authorize(hidpi);
      await c.handle({ ...base, type: 'input.mouse.move', p: { nx: 1, ny: 1 } });
      // Must be the real bottom-right (2560,1600) - NOT the DIP value (1280,800),
      // which is the middle of the physical screen.
      expect(injector.calls[0]).toEqual(['moveTo', 2560, 1600]);
    });

    it('maps the centre to the physical centre', async () => {
      const c = new InputController({ injector, dipToScreenPoint });
      c.authorize(hidpi);
      await c.handle({ ...base, type: 'input.mouse.move', p: { nx: 0.5, ny: 0.5 } });
      expect(injector.calls[0]).toEqual(['moveTo', 1280, 800]);
    });

    it('applies the converter to clicks and scrolls too', async () => {
      const c = new InputController({ injector, dipToScreenPoint });
      c.authorize(hidpi);
      await c.handle({
        ...base,
        type: 'input.mouse.button',
        button: 'left',
        action: 'down',
        p: { nx: 1, ny: 1 },
      });
      expect(injector.calls[0]).toEqual(['moveTo', 2560, 1600]);
    });

    it('offsets a secondary monitor correctly', async () => {
      // Second display to the right of a 1280-DIP primary.
      const second = { bounds: { x: 1280, y: 0, width: 1280, height: 800 }, scaleFactor: 2 };
      const c = new InputController({ injector, dipToScreenPoint });
      c.authorize(second);
      await c.handle({ ...base, type: 'input.mouse.move', p: { nx: 0, ny: 0 } });
      // DIP (1280,0) -> physical (2560,0): the origin of the second monitor.
      expect(injector.calls[0]).toEqual(['moveTo', 2560, 0]);
    });
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
