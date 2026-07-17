// Vercel serverless entry — wraps the Express app as a single function.
import { createApp } from '../server/src/app.js';

export default createApp();
