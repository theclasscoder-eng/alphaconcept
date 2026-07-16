import { useEffect, useRef, useState } from 'react';
import { useStore, getControllerSession } from '../store.js';
import type { MouseButton } from '@rdp/protocol';
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

  const active = session.role === 'controller' && session.phase !== 'idle' && session.phase !== 'ended';

  useEffect(() => {
    if (videoRef.current && remoteStream) {
      videoRef.current.srcObject = remoteStream;
      void videoRef.current.play().catch(() => undefined);
    }
  }, [remoteStream]);

  // Keyboard capture while the viewer is focused.
  useEffect(() => {
    if (!active) return;
    const cs = () => getControllerSession();
    const onKey = (e: KeyboardEvent, action: 'down' | 'up') => {
      const code = browserCodeToKeyCode(e.code);
      if (!code) return;
      e.preventDefault();
      cs()?.sendControl({ type: 'input.key', action, code });
    };
    const down = (e: KeyboardEvent) => onKey(e, 'down');
    const up = (e: KeyboardEvent) => onKey(e, 'up');
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
    };
  }, [active]);

  if (!active) return null;

  const norm = (e: React.MouseEvent): { nx: number; ny: number } | null => {
    const v = videoRef.current;
    if (!v) return null;
    const r = v.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    const nx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const ny = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    return { nx, ny };
  };

  const cs = () => getControllerSession();

  const onMove = (e: React.MouseEvent) => {
    const p = norm(e);
    if (p) cs()?.sendControl({ type: 'input.mouse.move', p });
  };
  const onButton = (e: React.MouseEvent, action: 'down' | 'up') => {
    e.preventDefault();
    const p = norm(e) ?? undefined;
    const button = BUTTONS[e.button] ?? 'left';
    cs()?.sendControl({ type: 'input.mouse.button', button, action, p });
  };
  const onDouble = (e: React.MouseEvent) => {
    const p = norm(e);
    if (p) cs()?.sendControl({ type: 'input.mouse.double', button: 'left', p });
  };
  const onWheel = (e: React.WheelEvent) => {
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
        <span className="dot on" />
        <strong>{session.peer?.name ?? 'Host'}</strong>
        <span className="pill">{status}</span>
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
        className={`viewer-stage${oneToOne ? ' one-to-one' : ''}`}
        tabIndex={0}
        onMouseMove={onMove}
        onMouseDown={(e) => onButton(e, 'down')}
        onMouseUp={(e) => onButton(e, 'up')}
        onDoubleClick={onDouble}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
      >
        <video ref={videoRef} autoPlay playsInline muted />
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
        <div
          className="card"
          style={{ position: 'absolute', top: 36, right: 0, zIndex: 10, width: 240, margin: 0 }}
        >
          <div className="stack">
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
