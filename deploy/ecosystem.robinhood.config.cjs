// Opt-in only, separate from the working Base agent. Do not run until testnet
// deployment, dedicated agent funding and owner authorizations are verified.
module.exports = { apps: [{
  name: 'ownpay-robinhood-agent', cwd: process.env.OWNPAY_ROBINHOOD_WEB_ROOT || '/opt/ownpay/web', script: 'agent/robinhood-agent.mjs',
  instances: 1, exec_mode: 'fork', autorestart: true, restart_delay: 15000,
  kill_timeout: 10000, max_restarts: 20, min_uptime: '30s',
  env: {
    ROBINHOOD_TESTNET_RPC_URL: process.env.ROBINHOOD_TESTNET_RPC_URL,
    ROBINHOOD_OWNRULES_ADDRESS: process.env.ROBINHOOD_OWNRULES_ADDRESS,
    ROBINHOOD_DEPLOYMENT_BLOCK: process.env.ROBINHOOD_DEPLOYMENT_BLOCK,
    ROBINHOOD_AGENT_PRIVATE_KEY: process.env.ROBINHOOD_AGENT_PRIVATE_KEY,
    ROBINHOOD_AGENT_MODE: process.env.ROBINHOOD_AGENT_MODE || 'observe',
    ROBINHOOD_AGENT_STATE_FILE: process.env.ROBINHOOD_AGENT_STATE_FILE,
    ROBINHOOD_AGENT_HEALTH_FILE: process.env.ROBINHOOD_AGENT_HEALTH_FILE,
    ROBINHOOD_AGENT_ADDRESS: process.env.ROBINHOOD_AGENT_ADDRESS,
    ROBINHOOD_AGENT_INTERVAL_MS: process.env.ROBINHOOD_AGENT_INTERVAL_MS || '60000',
  },
}] };
