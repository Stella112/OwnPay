// PM2 process definition for the shared Qevor VPS.
// OwnPay gets its own process name and listens only on loopback port 3102.
module.exports = {
  apps: [
    {
      name: "ownpay-web",
      cwd: "/opt/ownpay/web",
      script: ".next/standalone/server.js",
      env: {
        NODE_ENV: "production",
        HOSTNAME: "127.0.0.1",
        PORT: process.env.OWNPAY_PORT || "3102",
        NEXT_TELEMETRY_DISABLED: "1",
        OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL,
        OLLAMA_MODEL: process.env.OLLAMA_MODEL,
        OLLAMA_API_KEY: process.env.OLLAMA_API_KEY,
        DATABASE_URL: process.env.DATABASE_URL,
        PRIVY_VERIFICATION_KEY: process.env.PRIVY_VERIFICATION_KEY,
        NEXT_PUBLIC_PRIVY_APP_ID: process.env.NEXT_PUBLIC_PRIVY_APP_ID,
        NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID: process.env.NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID || process.env.PRIVY_KEY_QUORUM_ID,
      },
    },
    {
      name: "ownpay-agent",
      cwd: "/opt/ownpay/web",
      script: "agent/ownership-agent.mjs",
      autorestart: true,
      restart_delay: 5000,
      env: {
        NODE_ENV: "production",
        AGENT_RPC_URL: process.env.AGENT_RPC_URL,
        AGENT_CHAIN_ID: process.env.AGENT_CHAIN_ID,
        AGENT_USDC_ADDRESS: process.env.AGENT_USDC_ADDRESS,
        AGENT_START_BLOCK: process.env.AGENT_START_BLOCK,
        AGENT_BLOCK_CHUNK: process.env.AGENT_BLOCK_CHUNK || "10",
        AGENT_POLL_INTERVAL_MS: process.env.AGENT_POLL_INTERVAL_MS,
        OWNPAY_AGENT_MODE: process.env.OWNPAY_AGENT_MODE || "observe",
        OWNPAY_B20_ROUTE_ENABLED: process.env.OWNPAY_B20_ROUTE_ENABLED,
        OWNPAY_B20_VENUE: process.env.OWNPAY_B20_VENUE,
        OWNPAY_B20_ROUTER_ADDRESS: process.env.OWNPAY_B20_ROUTER_ADDRESS,
        PRIVY_APP_ID: process.env.PRIVY_APP_ID || process.env.NEXT_PUBLIC_PRIVY_APP_ID,
        PRIVY_APP_SECRET: process.env.PRIVY_APP_SECRET,
        PRIVY_AUTHORIZATION_PRIVATE_KEY: process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY,
        PRIVY_KEY_QUORUM_ID: process.env.PRIVY_KEY_QUORUM_ID,
        DATABASE_URL: process.env.DATABASE_URL,
      },
    },
  ],
};
