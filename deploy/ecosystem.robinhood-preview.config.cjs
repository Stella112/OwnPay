// Isolated, loopback-only smoke process. Never alters the live Base process.
const existing = require('./ecosystem.ownpay.config.cjs');
const web = existing.apps.find(app => app.name === 'ownpay-web');
module.exports = { apps: [{ ...web, name: 'ownpay-robinhood-preview',
  cwd: '/opt/ownpay/releases/robinhood-20261003/web',
  script: '.next-robinhood-20261003/standalone/server.js',
  env: { ...web.env, PORT: '3104', HOSTNAME: '127.0.0.1' },
}] };
