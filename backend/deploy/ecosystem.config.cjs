/**
 * PM2 process definitions for the Ali Store backend on the Proxmox LXC.
 * See docs/backend-proxmox-lxc-setup.md (Step 8) and docs/production-deploy.md.
 * Run from /opt/alistore/backend:
 *
 *   pm2 start deploy/ecosystem.config.cjs
 *   pm2 save && pm2 startup      # survive VM reboot
 *
 * One process:
 *   - alistore-backend : the built Medusa server (`medusa start`) from
 *                        .medusa/server, serving the store API + admin (/app)
 *                        on localhost:9000. It reads .medusa/server/.env.
 *
 * Public exposure is handled by **Tailscale**, NOT PM2:
 *   - `tailscale serve`  → admin (/app) private over the tailnet (valid TLS).
 *   - `tailscale funnel` → /store/* public for Vercel at a STABLE
 *                          https://alistore-backend.<tailnet>.ts.net URL.
 * Tailscale persists this config in the tailscaled service across reboots, so
 * there is no tunnel process to babysit here (this replaced the old cloudflared
 * quick tunnel — see docs/backend-proxmox-lxc-setup.md Step 9).
 */

const path = require("path")

// .medusa/server is the production build artifact produced by `medusa build`.
const SERVER_DIR = path.join(__dirname, "..", ".medusa", "server")

module.exports = {
  apps: [
    {
      name: "alistore-backend",
      cwd: SERVER_DIR,
      script: path.join(SERVER_DIR, "node_modules", ".bin", "medusa"),
      args: "start",
      env: { NODE_ENV: "production" },
      autorestart: true,
      max_restarts: 10,
      // Medusa boots Postgres/Redis connections + the admin build; give it room.
      kill_timeout: 10000,
    },
  ],
}
