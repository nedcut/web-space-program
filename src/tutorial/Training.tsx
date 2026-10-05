import { LESSONS } from './lessons';
import { readCompletions, startLesson } from './runtime';
import { game } from '../game/store';
export function Training() {
  const done = readCompletions();
  return <main className="fullscreen training-screen">
    <div className="label">Flight Director Ama Okafor</div>
    <h1>Training</h1>
    <p>Learn at your own pace. Each lesson starts with its own practice craft and scenario.</p>
    <div className="training-lessons">{LESSONS.map((l, i) => <button className="panel training-lesson" key={l.id} onClick={() => startLesson(l.id)}>
      <span aria-label={done.includes(l.id) ? 'Completed' : 'Not completed'}>{done.includes(l.id) ? '✓' : `${i + 1}.`}</span>
      <div><strong>{l.title}</strong><p>{l.description}</p></div>
    </button>)}</div>
    <button className="btn" onClick={() => game.set({ scene: 'menu' })}>Back to main menu</button>
  </main>;
}
