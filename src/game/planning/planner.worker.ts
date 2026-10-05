import { createPlannerHandler } from './handler';
import type { PlannerMessage } from './protocol';

const handle = createPlannerHandler(event => self.postMessage(event));
self.onmessage = (event: MessageEvent<PlannerMessage>) => { void handle(event.data); };
