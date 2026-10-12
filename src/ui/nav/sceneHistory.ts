import { game, type Scene } from '../../game/store';

/**
 * The scene shown before the current one, so a screen can tell how the player arrived (e.g. the
 * Flight Log offers "Continue to Space Center" after a flight). Updated on scene changes only.
 */
let current: Scene = game.get().scene;
let previous: Scene | null = null;
game.subscribe(() => {
  const scene = game.get().scene;
  if (scene !== current) { previous = current; current = scene; }
});
export const previousScene = () => previous;
