import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { game } from '../game/store';
import { EditorView } from './scene/EditorView';
import { EditorSession } from './session';
import { STOCK_CRAFTS } from './stockCrafts';
import { LoadDialog } from './ui/LoadDialog';
import { Palette } from './ui/Palette';
import { StagingPanel } from './ui/StagingPanel';
import { TopBar } from './ui/TopBar';
import './ui/editor.css';

declare global {
  interface Window {
    /** Dev/test hook: drive the editor from scripts (screenshots, probes). */
    __editor?: { session: EditorSession; view: EditorView | null; loadStock(id: string): void };
  }
}

/** Vehicle Assembly Building scene. */
export default function EditorScene() {
  const [session] = useState(() => new EditorSession(game.get().craft));
  const view = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [showLoad, setShowLoad] = useState(false);

  useEffect(() => {
    const v = new EditorView(host.current!, session);
    viewRef.current = v;
    const loadStock = (id: string) => {
      const s = STOCK_CRAFTS.find((x) => x.id === id || x.id === `stock-${id}`);
      if (s) session.load(s.build(), false);
    };
    window.__editor = { session, view: v, loadStock };
    const q = new URLSearchParams(location.search).get('stock');
    if (q && !game.get().craft) loadStock(q);
    return () => {
      v.dispose();
      viewRef.current = null;
      if (window.__editor?.session === session) delete window.__editor;
    };
  }, [session]);

  const held = view.held;
  return (
    <div className="fullscreen vab-root">
      <div ref={host} className="fullscreen vab-canvas" />
      <div className="fullscreen vab-vignette" />
      <TopBar
        session={session}
        view={view}
        onLoad={() => setShowLoad(true)}
        onNew={() => {
          if (view.craft.parts.length && !window.confirm('Start a new craft? Unsaved changes will be lost.')) return;
          session.newCraft();
        }}
      />
      <Palette session={session} view={view} />
      <StagingPanel session={session} view={view} />
      <div className="vab-toasts">
        {view.toasts.map((t) => (
          <div key={t.id} className={`vab-toast panel ${t.tone}`}>{t.text}</div>
        ))}
      </div>
      <div className="vab-hints panel">
        {held ? (
          <>
            <Hint k="W S · A D · Q E">rotate</Hint>
            <Hint k="Shift">fine</Hint>
            <Hint k="Space">reset</Hint>
            <Hint k="X">{view.symmetryMode === 'mirror' ? (view.symmetry > 1 ? 'mirror on' : 'mirror off') : `symmetry ×${view.symmetry}`}</Hint>
            <Hint k="R">radial / mirror</Hint>
            <Hint k="Alt">no surface</Hint>
            <Hint k="Esc">cancel</Hint>
            <Hint k="Del">discard</Hint>
          </>
        ) : (
          <>
            <Hint k="Click">pick up part</Hint>
            <Hint k="Drag / RMB">orbit</Hint>
            <Hint k="Wheel">zoom</Hint>
            <Hint k="MMB / Shift+Wheel">pan</Hint>
            <Hint k="Del">delete hovered</Hint>
            <Hint k="F">frame</Hint>
          </>
        )}
      </div>
      {!view.craft.parts.length && !held && (
        <div className="vab-welcome panel">
          <div className="label">Vehicle Assembly</div>
          <div className="vab-welcome-title">Start with a command pod or probe core</div>
          <div className="vab-welcome-text">Pick a part from the list on the left — the first part becomes the root of your vehicle. Or open a stock design.</div>
          <button className="btn small" onClick={() => setShowLoad(true)}>Browse stock vehicles</button>
        </div>
      )}
      {showLoad && <LoadDialog session={session} onClose={() => setShowLoad(false)} />}
    </div>
  );
}

function Hint({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <span className="vab-hint">
      <kbd>{k}</kbd>
      {children}
    </span>
  );
}
