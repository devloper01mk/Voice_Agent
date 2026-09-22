import { Router } from 'express';
import { simulator2LivekitRouter } from './livekit.js';
import { simulator2RuntimeRouter } from './runtime.js';
import { simulator2SessionConfigRouter } from './session-config.js';

export const simulator2Router = Router();

simulator2Router.use('/livekit', simulator2LivekitRouter);
simulator2Router.use('/agents', simulator2RuntimeRouter);
simulator2Router.use('/calls', simulator2SessionConfigRouter);
