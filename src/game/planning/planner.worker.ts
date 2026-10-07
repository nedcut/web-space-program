import { loadEarthData } from '../earthLoader';
import { createPlannerHandler } from './handler';
import type { PlannerMessage } from './protocol';

const handle = createPlannerHandler(event => self.postMessage(event));
self.onmessage = (event: MessageEvent<PlannerMessage>) => { void loadEarthData().then(() => handle(event.data)).catch(error => self.postMessage({ type: 'error', id: event.data.id, name: 'Error', message: String(error) })); };
