import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore, getControllerSession } from '../store.js';
import type { KeyCode, MouseButton } from '@rdp/protocol';
import { computeContentRect, viewerPixelToNormalized } from '@rdp/protocol/browser';
import { browserCodeToKeyCode, COMMON_SHORTCUTS } from '../keycodes.js';

const BUTTONS: Record<number, MouseButton> = { 0: 'left', 1: 'middle', 2: 'right' };

/** Controller viewer: renders the host's screen and forwards validated input. */
export function Viewer(): JSX.Element | null {
  const session = useStore((s) => s.session);
  const remoteStream = useStore((s) => s.remoteStream);
  const endSession = useStore((s) => s.endSession);

  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [oneToOne, setOneToOne] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [clipboardOn, setClipboardOn] = useState(false);
  const [videoReady, setVideoReady] = useState(false);

  /**
   * Whether we are forwarding input to the host. Toggle with Ctrl+Alt+Shift+R so
   * the controller can take their own mouse/keyboard back at any moment without
   * ending the session. Mirrored into a ref so the global key handler can read
   * it without being re-subscribed on every toggle.
   */
  const [inputEnabled, setInputEnabled] = useState(true);
  const inputEnabledRef = useRef(true);
  /** Keys currently held down on the HOST, so we can release them cleanly. */
  const pressedKeys = useRef<Set<KeyCode>>(new Set());

  const active = session.role === 'controller' && session.phase !== 'idle' && session.phase !== 'ended';

  /**
   * Send key-up for everything we've pressed on the host. Without this, releasing
   * control (or Alt+Tabbing away) would leave Ctrl/Alt/Shift stuck down on the
   * host — the classic remote-desktop "sticky modifier" bug.
   */
  const releaseAllKeys = useCallback(() => {
    const cs = getControllerSession();
    for (const code of pressedKeys.current) {
      cs?.sendControl({ type: 'input.key', action: 'up', code });
    }
    pressedKeys.current.clear();
  }, []);

  const setControl = useCallback(
    (on: boolean) => {
      inputEnabledRef.current = on;
      setInputEnabled(on);
      if (!on) releaseAllKeys();
    },
    [releaseAllKeys],
  );

  useEffect(() => {
    setVideoReady(false);
    if (videoRef.current && remoteStream) {
      videoRef.current.srcObject = remoteStream;
      void videoRef.current.play().catch(() => undefined);
    }
  }, [remoteStream]);

  // Keyboard capture while the viewer is open.
  useEffect(() => {
    if (!active) return;

    const onKeyDown = (e: KeyboardEvent) => {
      // Release/resume control. Handled locally and NEVER forwarded, so the
      // controller can always get their keyboard back.
      if (e.ctrlKey && e.altKey && e.shiftKey && e.code === 'KeyR') {
        e.preventDefault();
        e.stopPropagation();
        setControl(!inputEnabledRef.current);
        return;
      }
      // Control released: let the key go to this computer instead.
      if (!inputEnabledRef.current) return;
      const code = browserCodeToKeyCode(e.code);
      if (!code) return;
      e.preventDefault();
      pressedKeys.current.add(code);
      getControllerSession()?.sendControl({ type: 'input.key', action: 'down', code });
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (!inputEnabledRef.current) return;
      const code = browserCodeToKeyCode(e.code);
      if (!code) return;
      e.preventDefault();
      pressedKeys.current.delete(code);
      getControllerSession()?.sendControl({ type: 'input.key', action: 'up', code });
    };

    // Losing focus (Alt+Tab, clicking away) must not strand keys on the host.
    const onBlur = () => releaseAllKeys();

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onBlur);
      releaseAllKeys();
    };
  }, [active, setControl, releaseAllKeys]);

  if (!active) return null;

  /**
   * Map a pointer position to normalized [0,1] coords of the HOST's screen.
   *
   * The <video> element fills the stage and letterboxes internally (object-fit:
   * contain), so the element's box is NOT the frame's box. We compute the real
   * content rect from the stream's intrinsic size and map against that.
   *
   * Returns null when there is no frame yet (videoWidth === 0) or the pointer is
   * over a letterbox bar — in both cases we must not fabricate a coordinate.
   */
  const norm = (e: React.MouseEvent): { nx: number; ny: number } | null => {
    const v = videoRef.current;
    if (!v || !v.videoWidth || !v.videoHeight) return null;
    const r = v.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    const content = computeContentRect(
      { width: r.width, height: r.height },
      { width: v.videoWidth, height: v.videoHeight },
    );
    const p = viewerPixelToNormalized({ x: e.clientX - r.left, y: e.clientY - r.top }, content);
    if (!p.inBounds) return null;
    return { nx: p.nx, ny: p.ny };
  };

  const cs = () => getControllerSession();

  const onMove = (e: React.MouseEvent) => {
    if (!inputEnabled) return;
    const p = norm(e);
    if (p) cs()?.sendControl({ type: 'input.mouse.move', p });
  };
  const onButton = (e: React.MouseEvent, action: 'down' | 'up') => {
    if (!inputEnabled) return;
    e.preventDefault();
    const p = norm(e) ?? undefined;
    const button = BUTTONS[e.button] ?? 'left';
    cs()?.sendControl({ type: 'input.mouse.button', button, action, p });
  };
  const onDouble = (e: React.MouseEvent) => {
    if (!inputEnabled) return;
    const p = norm(e);
    if (p) cs()?.sendControl({ type: 'input.mouse.double', button: 'left', p });
  };
  const onWheel = (e: React.WheelEvent) => {
    if (!inputEnabled) return;
    const p = norm(e) ?? undefined;
    cs()?.sendControl({
      type: 'input.mouse.scroll',
      dx: e.deltaX / 40,
      dy: e.deltaY / 40,
      p,
    });
  };

  const toggleFullscreen = async () => {
    if (!document.fullscreenElement) {
      await stageRef.current?.parentElement?.requestFullscreen().catch(() => undefined);
      setFullscreen(true);
    } else {
      await document.exitFullscreen().catch(() => undefined);
      setFullscreen(false);
    }
  };

  const sendClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) cs()?.sendControl({ type: 'control.clipboard', text: text.slice(0, 256 * 1024) });
    } catch {
      /* clipboard read denied */
    }
  };

  const q = session.quality;
  const status =
    session.phase === 'active' ? 'Connected' : session.phase === 'connecting' ? 'Connecting…' : 'Requesting…';

  return (
    <div className="viewer">
      <div className={`viewer-toolbar${collapsed ? ' collapsed' : ''}`}>
        <span className={`dot ${inputEnabled ? 'on' : 'busy'}`} />
        <strong>{session.peer?.name ?? 'Host'}</strong>
        <span className="pill">{status}</span>
        {/* Always visible, even when collapsed: you must never lose the way out. */}
        <button
          className={inputEnabled ? 'ghost' : 'primary'}
          onClick={() => setControl(!inputEnabled)}
          title="Toggle sending mouse/keyboard to the host (Ctrl+Alt+Shift+R)"
        >
          {inputEnabled ? 'Control: on' : 'Control: off — viewing'}
        </button>
        {!collapsed && (
          <>
            <span className="pill">
              {q?.rttMs != null ? `${q.rttMs} ms` : '— ms'} ·{' '}
              {q?.kbps != null ? `${q.kbps} kbps` : '— kbps'} · {q?.state ?? ''}
            </span>
            <span className="spacer" />
            <button className="ghost" onClick={() => setOneToOne((v) => !v)}>
              {oneToOne ? 'Fit to window' : '1:1'}
            </button>
            <button className="ghost" onClick={toggleFullscreen}>
              {fullscreen ? 'Exit full screen' : 'Full screen'}
            </button>
            <button
              className="ghost"
              onClick={() => {
                setClipboardOn((v) => !v);
                if (!clipboardOn) void sendClipboard();
              }}
              title="Send local clipboard text to the host (opt-in, text only)"
            >
              {clipboardOn ? 'Clipboard: on' : 'Send clipboard'}
            </button>
            <ShortcutMenu />
            <MonitorMenu />
          </>
        )}
        <button className="ghost" onClick={() => setCollapsed((v) => !v)} title="Collapse toolbar">
          {collapsed ? '▸' : '▾'}
        </button>
        <button className="danger" onClick={() => endSession('controller ended')}>
          Disconnect
        </button>
      </div>

      <div
        ref={stageRef}
        className={`viewer-stage${oneToOne ? ' one-to-one' : ''}${inputEnabled ? '' : ' no-control'}`}
        tabIndex={0}
        onMouseMove={onMove}
        onMouseDown={(e) => onButton(e, 'down')}
        onMouseUp={(e) => onButton(e, 'up')}
        onDoubleClick={onDouble}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          onLoadedMetadata={() => setVideoReady(true)}
          style={{ visibility: videoReady ? 'visible' : 'hidden' }}
        />
        {inputEnabled && videoReady && (
          <div className="control-hint">Ctrl+Alt+Shift+R to release control</div>
        )}
        {!inputEnabled && videoReady && (
          <div className="control-released">
            <strong>Control released</strong>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              Your mouse and keyboard are your own again. The screen is still live.
              <br />
              Press <b>Ctrl+Alt+Shift+R</b> (or click “Control: off”) to resume.
            </div>
          </div>
        )}
        {!videoReady && (
          <div className="viewer-waiting">
            <div className="spinner" />
            <div style={{ fontWeight: 600, marginTop: 14 }}>Waiting for the host’s screen…</div>
            <div className="muted" style={{ marginTop: 6, fontSize: 12, maxWidth: 380 }}>
              Connected and input is working. If this persists, the host failed to start screen
              capture — check the host window for a “Capture error” message.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ShortcutMenu(): JSX.Element {
  const [open, setOpen] = useState(false);
  const cs = () => getControllerSession();
  return (
    <div style={{ position: 'relative' }}>
      <button className="ghost" onClick={() => setOpen((v) => !v)}>
        Shortcuts ▾
      </button>
      {open && (
        <div className="menu" style={{ width: 240 }}>
          <div>
            {COMMON_SHORTCUTS.map((s) => (
              <button
                key={s.label}
                className="ghost"
                onClick={() => {
                  cs()?.sendControl({ type: 'input.shortcut', modifiers: s.modifiers, code: s.code });
                  setOpen(false);
                }}
              >
                {s.label}
              </button>
            ))}
            <button className="ghost" disabled title="Ctrl+Alt+Del is a Windows secure sequence and cannot be injected by an application.">
              Ctrl+Alt+Del (unavailable)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MonitorMenu(): JSX.Element {
  const [open, setOpen] = useState(false);
  const cs = () => getControllerSession();
  return (
    <div style={{ position: 'relative' }}>
      <button className="ghost" onClick={() => setOpen((v) => !v)}>
        Monitor ▾
      </button>
      {open && (
        <div
          className="card"
          style={{ position: 'absolute', top: 36, right: 0, zIndex: 10, width: 160, margin: 0 }}
        >
          <div className="stack">
            {[0, 1, 2, 3].map((i) => (
              <button
                key={i}
                className="ghost"
                onClick={() => {
                  cs()?.sendControl({ type: 'control.monitor', index: i });
                  setOpen(false);
                }}
              >
                Host monitor {i + 1}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
