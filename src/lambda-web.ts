import { createApp } from './server.js';

// Lambda Web Adapter forwards Function URL calls to this plain HTTP server
createApp().listen(Number(process.env.PORT ?? 8080), process.env.HG_HOST ?? '0.0.0.0');
