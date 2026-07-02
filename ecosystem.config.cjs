// PM2 ecosystem — dev/pre-production mode (Windows)
// Cloudflare Named Tunnel → Vite (5173) → proxy /api → Express (3333)
// Start: pm2 start ecosystem.config.cjs
// Stop:  pm2 stop all
// Logs:  pm2 logs
//
// Usa node diretamente (sem cmd.exe) para evitar janelas visíveis no Windows.
// tsx CLI: node_modules/tsx/dist/cli.mjs
// Vite:   node_modules/vite/bin/vite.js

module.exports = {
  apps: [
    {
      name: "montadores-api",
      script: "node_modules/tsx/dist/cli.mjs",
      args: "src/server/index.ts",
      cwd: __dirname,
      node_args: "--env-file=.env",
      watch: false,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      kill_timeout: 5000,
      windowsHide: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
    {
      name: "montadores-web",
      script: "node_modules/vite/bin/vite.js",
      args: "--host 0.0.0.0 --port 5173",
      cwd: __dirname,
      watch: false,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      windowsHide: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
    {
      name: "montadores-tunnel",
      script: "C:\\Users\\cleit\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Cloudflare.cloudflared_Microsoft.Winget.Source_8wekyb3d8bbwe\\cloudflared.exe",
      args: `--config "C:\\Users\\cleit\\.cloudflared\\config.yml" tunnel run`,
      interpreter: "none",
      cwd: __dirname,
      watch: false,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "15s",
      windowsHide: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};
