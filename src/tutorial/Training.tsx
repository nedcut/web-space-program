import { useEffect, useRef } from 'react';
import { Button } from '../ui/components';
import { LESSONS } from './lessons';
import { readCompletions, startLesson } from './runtime';
import { LESSON_MINUTES, recommendedLesson } from './trainingProgress';
import { game } from '../game/store';
import { MenuScreenHeader } from '../ui/nav/MenuScreenHeader';
import { arrowNav, focusFirst } from '../ui/nav/arrowNav';
import './tutorial.css';

export function Training() {
  const done = readCompletions();
  const next = recommendedLesson(LESSONS, done);
  const grid = useRef<HTMLDivElement>(null);
  // Land on the recommended lesson so Enter starts it and arrows move from there.
  useEffect(() => focusFirst(grid.current), []);
  const count = LESSONS.filter(l => done.includes(l.id)).length;
  return <main className="fullscreen training-screen">
    <MenuScreenHeader onBack={() => game.set({ scene: 'menu' })} kicker="Flight Director Ama Okafor" title="Training"
      subtitle="Learn at your own pace. Each lesson starts with its own practice craft and scenario; nothing touches your saved programs."
      aside={<div className="training-progress" aria-label={`${count} of ${LESSONS.length} lessons completed`}>
        <strong>{count} / {LESSONS.length}</strong><span className="label">lessons completed</span>
        <span className="training-bar" aria-hidden="true"><span style={{ width: `${100 * count / LESSONS.length}%` }} /></span>
      </div>} />
    <div className="training-lessons" ref={grid} onKeyDown={e => arrowNav(e)}>{LESSONS.map((l, i) => {
      const complete = done.includes(l.id), recommended = next?.id === l.id;
      return <Button className={`panel training-lesson ${complete ? 'complete' : ''} ${recommended ? 'recommended' : ''}`} key={l.id}
        data-autofocus={recommended || (!next && i === 0) ? true : undefined} onClick={() => startLesson(l.id)}>
        <span className="training-index" aria-label={complete ? 'Completed' : `Lesson ${i + 1}`}>{complete ? '✓' : i + 1}</span>
        <div>
          {recommended && <span className="training-next">Recommended next</span>}
          <strong>{l.title}</strong><p>{l.description}</p>
          <span className="training-meta">≈ {LESSON_MINUTES[l.id] ?? 10} min · {l.steps.length} steps · {l.scene === 'editor' ? 'Integration Hall' : 'In flight'}{complete ? ' · Completed' : ''}</span>
        </div>
      </Button>;
    })}</div>
    <p className="training-hint"><span className="kbd">←↑↓→</span> choose · <span className="kbd">Enter</span> start · <span className="kbd">Esc</span> main menu</p>
  </main>;
}
