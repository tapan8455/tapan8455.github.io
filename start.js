// Universal entrypoint: launches Electron on desktop or server.js in cloud / headless / web environments
const { spawn } = require('child_process');

const isHeadlessOrCloud = 
  Boolean(process.env.PORT) || 
  process.env.NODE_ENV === 'production' || 
  Boolean(process.env.RENDER) || 
  Boolean(process.env.RAILWAY_STATIC_URL) || 
  Boolean(process.env.FLY_APP_NAME) || 
  (!process.env.DISPLAY && process.platform === 'linux');

if (isHeadlessOrCloud) {
  require('./server.js');
} else {
  try {
    const electron = require('electron');
    const child = spawn(electron, ['.'], { stdio: 'inherit' });
    child.on('exit', (code) => process.exit(code || 0));
  } catch (_) {
    console.log('Electron runtime not found; starting web server fallback...');
    require('./server.js');
  }
}
