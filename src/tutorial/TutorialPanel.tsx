import { useEffect } from 'react';
import { advanceTutorial, endTutorial, getTutorial, startLesson, tickTutorial, useTutorial } from './runtime';
import './tutorial.css';
export function TutorialPanel() {
  const run = useTutorial();
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
  }, [run?.epoch]);
  if (!run || !step) return null;
  return <aside className="panel tutorial-panel" aria-label="Training instructions" onKeyDown={e => e.stopPropagation()} onKeyUp={e => e.stopPropagation()}>
    <div className="label">Flight Director Ama Okafor · {run.lesson.title}</div>
    <div className="tutorial-progress">Step {run.index + 1} of {run.lesson.steps.length}</div>
    <p aria-live="polite">{run.finished ? (run.skipped ? 'Practice finished. Repeat without skipping to earn your completion checkmark.' : 'Lesson complete. Nicely flown! Your completion checkmark is saved when browser storage is available.') : step.text}</p>
    {!run.finished && <div className="tutorial-status">{run.ready ? '✓ Goal reached — continue when ready.' : 'Try the action above to unlock Next.'}</div>}
    <div className="tutorial-actions">
      {!run.finished && <><button className="btn small primary" disabled={!run.ready} onClick={() => advanceTutorial()}>Next</button><button className="btn small" onClick={() => advanceTutorial(true)}>Skip step</button></>}
      <button className="btn small" onClick={() => startLesson(run.lesson.id)}>Restart</button>
      <button className="btn small" onClick={endTutorial}>Lessons</button>
    </div>
  </aside>;
}
