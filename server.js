'use strict';

const { server } = require('./server/network');
const { gracefulShutdown, setupKeypressListener } = require('./server/shutdown');
const { C, PORT } = require('./server/config');

// Terminal keypress listener (S to start, R to restart, Ctrl+C to quit)
setupKeypressListener();

// Graceful shutdown hooks
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Start listening
server.listen(PORT, () => {
  console.log(`AZ Tank Game server running on http://localhost:${PORT}`);
  console.log('Press S to force-start, R to restart, Ctrl+C to quit.');
});
