import { bindingText, getBindings, subscribeBindings } from '../input/bindings';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { advanceTutorial, endTutorial, getTutorial, startLesson, tickTutorial, useTutorial } from './runtime';
import { useGame } from '../game/store';
import './tutorial.css';
export function TutorialPanel() {
  const run = useTutorial();
  const scene = useGame(s => s.scene);
  const [collapsedEpoch, setCollapsedEpoch] = useState<number | null>(null);
  const collapsed = collapsedEpoch === run?.epoch;
  const bindings = useSyncExternalStore(subscribeBindings, getBindings);
  const step = run?.lesson.steps[run.index];
  useEffect(() => {
    if (!run) return;
    let frame = 0;
    let highlighted: Element | null = null;
    const tick = () => {
      tickTutorial();
      const current = getTutorial();
      const selector = !current?.finished ? current?.lesson.steps[current.index].highlight : undefined;
      const target = selector ? document.querySelector(selector) : null;
      if (target !== highlighted) { highlighted?.classList.remove('tutorial-pulse'); target?.classList.add('tutorial-pulse'); highlighted = target; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); highlighted?.classList.remove('tutorial-pulse'); };
    // The frame loop reads the live tutorial store; restarting on each step would clear its highlight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.epoch]);
  if (!run || !step) return null;
  return <aside className={`panel tutorial-panel ${scene === 'editor' ? 'editor' : 'flight'}${collapsed ? ' collapsed' : ''}`} aria-label="Training instructions" onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') e.stopPropagation(); }}>
    <div className="tutorial-heading">
      <div className="label">Training · {run.lesson.title}</div>
      <button className="btn small" aria-expanded={!collapsed} aria-controls="tutorial-instructions" onClick={() => setCollapsedEpoch(collapsed ? null : run.epoch)}>{collapsed ? 'Show instructions' : 'Collapse'}</button>
    </div>
    <div className="tutorial-progress">Step {run.index + 1} of {run.lesson.steps.length}</div>
    <div id="tutorial-instructions" hidden={collapsed}>
      <div className="tutorial-mentor">Flight Director Ama Okafor</div>
      <p aria-live="polite">{run.finished ? (run.skipped ? 'Practice finished. Repeat without skipping to earn your completion checkmark.' : 'Lesson complete. Nicely flown! Your completion checkmark is saved when browser storage is available.') : bindingText(step.text, bindings)}</p>
      {!run.finished && <div className="tutorial-status">{run.ready ? '✓ Goal reached — continue when ready.' : 'Try the action above to unlock Next.'}</div>}
      <div className="tutorial-actions">
        {!run.finished && <><button className="btn small primary" disabled={!run.ready} onClick={e => { advanceTutorial(); e.currentTarget.blur(); }}>Next</button><button className="btn small" onClick={e => { advanceTutorial(true); e.currentTarget.blur(); }}>Skip step</button></>}
        <button className="btn small" onClick={() => startLesson(run.lesson.id)}>Restart</button>
        <button className="btn small" onClick={endTutorial}>Lessons</button>
      </div>
    </div>
    {collapsed && <div className="tutorial-status" aria-live="polite">{run.finished ? 'Lesson complete' : run.ready ? 'Goal reached · Show instructions to continue' : 'Practice active · Show instructions for your next action'}</div>}
  </aside>;
}
