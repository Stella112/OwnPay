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
        NEXT_PUBLIC_PRIVY_APP_ID: process.env.NEXT_PUBLIC_PRIVY_APP_ID,
      },
    },
  ],
};
