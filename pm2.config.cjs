module.exports = {
  apps: [
    {
      name: "app-montadores-api",
      script: "dist/server/index.js",
      instances: 1,
      exec_mode: "fork",
      watch: false,
      node_args: "--experimental-vm-modules",
      env: {
        NODE_ENV: "development",
        PORT: 3333,
      },
      env_production: {
        NODE_ENV: "production",
        PORT: 3333,
      },
      error_file: "logs/pm2-error.log",
      out_file: "logs/pm2-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      max_restarts: 10,
      restart_delay: 5000,
      kill_timeout: 5000,
      min_uptime: 10000,
    },
  ],
};
