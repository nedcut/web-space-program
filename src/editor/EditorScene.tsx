import { tutorialContext, getTutorial } from '../tutorial/runtime';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { game } from '../game/store';
import { EditorView, IS_MAC } from './scene/EditorView';
import { EditorSession } from './session';
import { STOCK_CRAFTS } from './stockCrafts';
import { CraftImportDialog } from './ui/CraftImportDialog';
import { LoadDialog } from './ui/LoadDialog';
import { Palette } from './ui/Palette';
import { StagingPanel } from './ui/StagingPanel';
import { TopBar } from './ui/TopBar';
import { ActionGroupsPanel } from './ui/ActionGroupsPanel';
import { EditorInspector, HoverTooltip } from './ui/PartInspector';
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
  const getView = useCallback(() => viewRef.current, []);
  const [importSource, setImportSource] = useState<{ initial?: string; file?: File } | null>(() => { const code = new URLSearchParams(location.hash.slice(1)).get('craft'); return code ? { initial: code } : null; });

  useEffect(() => {
    const v = new EditorView(host.current!, session);
    viewRef.current = v;
    tutorialContext.editor = session;
    const loadStock = (id: string) => {
      const s = STOCK_CRAFTS.find((x) => x.id === id || x.id === `stock-${id}`);
      if (s) session.load(s.build(), false);
    };
    window.__editor = { session, view: v, loadStock };
    const q = new URLSearchParams(location.search).get('stock');
    if (q && !game.get().craft && !getTutorial()) loadStock(q);
    return () => {
      v.dispose();
      if (tutorialContext.editor === session) delete tutorialContext.editor;
      viewRef.current = null;
      if (window.__editor?.session === session) delete window.__editor;
    };
  }, [session]);

  const held = view.held;
  return (
    <div className="fullscreen vab-root" onDragOver={e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }} onDrop={e => { e.preventDefault(); if (e.dataTransfer.files[0]) setImportSource({ file: e.dataTransfer.files[0] }); }}>
      <div ref={host} className="fullscreen vab-canvas" />
      <div className="fullscreen vab-vignette" />
      <TopBar
        session={session}
        view={view}
        onLoad={() => setShowLoad(true)}
        onImport={() => setImportSource({})}
        onNew={() => {
          if (view.craft.parts.length && !window.confirm('Start a new craft? Unsaved changes will be lost.')) return;
          session.newCraft();
        }}
      />
      {view.mode === 'actions' ? <ActionGroupsPanel session={session} view={view} /> : <Palette session={session} view={view} />}
      <StagingPanel session={session} view={view} />
      <EditorInspector session={session} view={view} getView={getView} />
      <HoverTooltip view={view} getView={getView} />
      <div className="vab-toasts">
        {view.toasts.map((t) => (
          <div key={t.id} className={`vab-toast panel ${t.tone} ${t.action ? 'actionable' : ''}`}>
            {t.text}
            {t.action && <button type="button" className="btn small" onClick={() => { t.action!.run(); session.dismissToast(t.id); }}>{t.action.label}</button>}
          </div>
        ))}
      </div>
      <div className="vab-hints panel">
        {view.mode === 'actions' ? (
          <>
            <Hint k="Click">choose part actions</Hint>
            <Hint k="Drag / RMB">orbit</Hint>
            <Hint k="Esc">close panel</Hint>
          </>
        ) : held ? (
          <>
            <Hint k="W S · A D · Q E">rotate</Hint>
            <Hint k="Shift">fine</Hint>
            <Hint k="Space">reset</Hint>
            <Hint k="X">{view.symmetryMode === 'mirror' ? (view.symmetry > 1 ? 'mirror on' : 'mirror off') : `symmetry ×${view.symmetry}`}</Hint>
            <Hint k="R">radial / mirror</Hint>
            <Hint k={ALT}>no surface</Hint>
            <Hint k="Esc">cancel</Hint>
            <Hint k={DEL}>discard</Hint>
          </>
        ) : view.tool === 'offset' || view.tool === 'rotate' ? (
          <>
            <Hint k="Click">{view.gizmoUid === null ? 'choose a part' : 'choose another part'}</Hint>
            <Hint k="Drag">{view.tool === 'offset' ? 'arrows or part: move' : 'rings: turn'}</Hint>
            <Hint k="W S · A D · Q E">{view.tool === 'offset' ? 'nudge' : 'turn 15°'}</Hint>
            <Hint k="Shift">fine</Hint>
            <Hint k={ALT}>this part only</Hint>
            <Hint k="C">snap {view.angleSnap ? 'on' : 'off'}</Hint>
            <Hint k="1">place tool</Hint>
          </>
        ) : view.tool === 'reroot' ? (
          <>
            <Hint k="Click">make root part</Hint>
            <Hint k="Drag">orbit</Hint>
            <Hint k="1">place tool</Hint>
          </>
        ) : (
          <>
            <Hint k="Click">pick up</Hint>
            <Hint k={`${ALT}+Click`}>copy</Hint>
            <Hint k={IS_MAC ? 'Ctrl+Click' : 'Right-click'}>details</Hint>
            <Hint k="Drag">orbit</Hint>
            <Hint k={IS_MAC ? 'Scroll / Pinch' : 'Wheel'}>zoom</Hint>
            <Hint k="Shift+Drag">pan</Hint>
            <Hint k="2 · 3 · 4">offset · rotate · root</Hint>
            <Hint k={DEL}>delete hovered</Hint>
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
      {importSource && <CraftImportDialog session={session} {...importSource} onClose={() => { setImportSource(null); if (location.hash.startsWith('#craft=')) history.replaceState(null, '', location.pathname + location.search); }} />}
      {showLoad && <LoadDialog session={session} onClose={() => setShowLoad(false)} />}
    </div>
  );
}

const ALT = IS_MAC ? '⌥' : 'Alt';
const DEL = IS_MAC ? '⌫' : 'Del';

function Hint({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <span className="vab-hint">
      <kbd>{k}</kbd>
      {children}
    </span>
  );
}
