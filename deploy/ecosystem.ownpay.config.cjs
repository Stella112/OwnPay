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
      },
    },
  ],
};
