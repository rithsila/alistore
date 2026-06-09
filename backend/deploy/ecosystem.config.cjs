/**
 * PM2 process definitions for the Ali Store UAT backend on the Proxmox VM.
 * See docs/uat-deploy.md (Phase 4). Run from /opt/alistore/backend:
 *
 *   pm2 start deploy/ecosystem.config.cjs
 *   pm2 logs alistore-tunnel     # read the trycloudflare URL (quick tunnel)
 *   pm2 save && pm2 startup      # survive VM reboot
 *
 * Two processes:
 *   - alistore-backend : the built Medusa server (`medusa start`) from
 *                        .medusa/server, serving the store API + admin (/app)
 *                        on localhost:9000. It reads .medusa/server/.env.
 *   - alistore-tunnel  : cloudflared quick tunnel exposing :9000 publicly.
 *                        Swap for a named tunnel once you own a Cloudflare
 *                        domain (then this entry can be removed / replaced —
 *                        see docs/uat-deploy.md Phase 3).
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
    {
      name: "alistore-tunnel",
      script: "cloudflared",
      // `interpreter: none` → run the binary directly, not via node.
      interpreter: "none",
      args: "tunnel --url http://localhost:9000",
      autorestart: true,
      // A restart mints a NEW quick-tunnel URL — update Vercel MEDUSA_BACKEND_URL
      // and the backend CORS when that happens (docs/uat-deploy.md, Operating notes).
      max_restarts: 10,
    },
  ],
}
