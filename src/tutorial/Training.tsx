import { Button } from '../ui/components';
import { LESSONS } from './lessons';
import { readCompletions, startLesson } from './runtime';
import { game } from '../game/store';
import { useEscape } from '../ui/nav/escape';
import { arrowNav } from '../ui/nav/arrowNav';
export function Training() {
  const done = readCompletions();
  useEscape(() => game.set({ scene: 'menu' }), true, 'screen');
  return <main className="fullscreen training-screen">
    <div className="label">Flight Director Ama Okafor</div>
    <h1>Training</h1>
    <p>Learn at your own pace. Each lesson starts with its own practice craft and scenario.</p>
    <div className="training-lessons" onKeyDown={e => arrowNav(e)}>{LESSONS.map((l, i) => <Button className="panel training-lesson" key={l.id} onClick={() => startLesson(l.id)}>
      <span aria-label={done.includes(l.id) ? 'Completed' : 'Not completed'}>{done.includes(l.id) ? '✓' : `${i + 1}.`}</span>
      <div><strong>{l.title}</strong><p>{l.description}</p></div>
    </Button>)}</div>
    <Button className="btn" onClick={() => game.set({ scene: 'menu' })}>Back to main menu <span className="kbd">Esc</span></Button>
  </main>;
}
