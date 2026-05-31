# Install PostgreSQL on a Proxmox LXC (Ubuntu 26.04)

This guide shows how to make a new PostgreSQL database for the Ali Store
backend. The database runs inside a **Proxmox LXC container** with
**Ubuntu 26.04 LTS**.

The goal at the end: the Medusa backend can connect using a
`DATABASE_URL`, and `npm run dev` boots past the database step.

> **Why we need this:** Right now `backend/.env` has an empty
> `DATABASE_URL`. Medusa cannot start without a Postgres database, so the
> dev server gets stuck retrying the connection. This guide fixes that for
> the **production** server on Proxmox. (For local dev you can use a
> Supabase free database instead — see the last section.)

---

## What you need before you start

- A working Proxmox VE server (you can open its web panel).
- Permission to create a container (root or an admin user).
- An Ubuntu 26.04 LXC template downloaded in Proxmox.
- About 20 minutes.

**Words used in this guide:**

- **LXC container** — a small, fast Linux machine inside Proxmox. It is
  lighter than a full virtual machine (VM).
- **PostgreSQL (Postgres)** — the database program Medusa uses.
- **Medusa needs Postgres version 15 or higher.** Ubuntu 26.04 ships a
  newer version, so this is fine.

---

## Step 1 — Download the Ubuntu template (one time)

1. In the Proxmox web panel, click your storage named **`local`**.
2. Open the **CT Templates** tab.
3. Click **Templates**.
4. Find **ubuntu-26.04-standard** in the list.
5. Click **Download** and wait until it finishes.

---

## Step 2 — Create the LXC container

1. Click **Create CT** (top right of the Proxmox panel).
2. Fill in the **General** tab:
   - **Hostname:** `alistore-db`
   - **Password:** set a strong root password (write it down safely).
   - Leave **Unprivileged container** checked (this is safer).
3. **Template** tab: choose the `ubuntu-26.04-standard` template.
4. **Disks** tab: set disk size to **20 GB** (enough for a small store).
5. **CPU** tab: set **2 cores**.
6. **Memory** tab: set **2048 MB** RAM and **512 MB** swap.
7. **Network** tab:
   - **IPv4:** choose **Static**.
   - Set an address like `172.16.18.10/24` (use a free IP on your network).
   - Set the **Gateway** to your router, e.g. `172.16.18.1`.
   - Write down this IP. You will need it later.
8. **DNS** tab: leave the default.
9. Click **Finish**. Proxmox builds the container.

> **Tip:** A static IP is important. The backend connects to the database
> by IP, so the IP must not change.

---

## Step 3 — Start and open the container

1. Select the new `alistore-db` container in the left list.
2. Click **Start**.
3. Click **Console** to open a black terminal window.
4. Log in:
   - **login:** `root`
   - **password:** the root password from Step 2.

You are now inside Ubuntu.

---

## Step 4 — Update Ubuntu

Run these two commands. They get the latest security fixes.

```bash
apt update
apt upgrade -y
```

---

## Step 5 — Install PostgreSQL

Install the database and its extra tools:

```bash
apt install -y postgresql postgresql-contrib
```

Check it is running:

```bash
systemctl status postgresql
```

You should see the word **active (running)** in green. Press `q` to exit.

Check the version is 15 or higher:

```bash
psql --version
```

---

## Step 6 — Create the database and user for Medusa

PostgreSQL makes a special system user called `postgres`. We use it to
create our own database and login.

1. Switch to the `postgres` user and open the database shell:

   ```bash
   sudo -u postgres psql
   ```

   Your prompt changes to `postgres=#`. You are now inside Postgres.
2. Create a login (a "role") for Medusa. **Change the password** to a
   strong one of your own:

   ```sql
   CREATE ROLE "db-admin" WITH LOGIN PASSWORD 'DbNew!2025';
   ```

   > **Important:** The name `db-admin` has a hyphen (`-`). In SQL you
   > **must** keep the double quotes around `"db-admin"` every time, or
   > Postgres reads the `-` as a minus sign and gives an error.
3. Create the database. Its name is `medusa` (this matches `DB_NAME` in
   `backend/.env`):

   ```sql
   CREATE DATABASE medusa OWNER "db-admin";
   ```
4. Give the Medusa user full rights on its database:

   ```sql
   GRANT ALL PRIVILEGES ON DATABASE medusa TO "db-admin";
   ```
5. Leave the database shell:

   ```sql
   \q
   ```

> **Password rule:** Use at least 16 characters with letters, numbers, and
> symbols. Never reuse a password. Keep it secret.

---

## Step 7 — Allow the backend to connect

By default Postgres only accepts connections from inside its own machine.
The Medusa backend runs on a different machine, so we must open it — but
only to the backend, not to the whole internet.

First, find your config folder. The number is the Postgres version (for
example `17`):

```bash
ls /etc/postgresql/
```

Use that number in the next commands. The examples below use **17** —
replace it with your number.

### 7a. Let Postgres listen on the network

Open the main config file:

```bash
nano /etc/postgresql/17/main/postgresql.conf
```

Find the line with `listen_addresses`. Change it to:

```
listen_addresses = '*'
```

Save and exit: press `Ctrl+O`, then `Enter`, then `Ctrl+X`.

### 7b. Allow only the backend machine

Open the access rules file:

```bash
nano /etc/postgresql/17/main/pg_hba.conf
```

Go to the bottom and add **one** line. Replace `172.16.18.20` with the IP
of the machine that runs the Medusa backend:

```
host    medusa    db-admin    172.16.18.20/32    scram-sha-256
```

- `medusa db-admin` means: only the `medusa` database, only the `db-admin`
  user.
- `172.16.18.20/32` means: only that one backend IP.
- `scram-sha-256` means: a password is required and sent securely.

Save and exit (`Ctrl+O`, `Enter`, `Ctrl+X`).

### 7c. Restart Postgres to apply changes

```bash
systemctl restart postgresql
```

> **Security note:** Do **not** allow `0.0.0.0/0`. That would open the
> database to everyone. Only allow the exact backend IP. The database must
> never face the public internet.

---

## Step 8 — Test the connection

From the **backend machine** (not the database container), test the login.
If `psql` is not installed there, you can also test from any machine on the
same network that has the Postgres client.

```bash
psql "postgres://db-admin:DbNew!2025@172.16.18.10:5432/medusa"
```

- `172.16.18.10` is the database container IP from Step 2.
- If you see the `medusa=>` prompt, the connection works. Type `\q` to
  exit.
- If it fails, check: right IP, right password, and the `pg_hba.conf` line
  has the correct backend IP.

---

## Step 9 — Set DATABASE_URL in the backend

Open `backend/.env` and set the line (it is currently empty):

```
DATABASE_URL=postgres://db-admin:DbNew!2025@172.16.18.10:5432/medusa
```

Use your real password and your real database IP.

> **Never commit this file.** `backend/.env` holds secrets and must stay
> out of git. Only `.env.example` (with empty values) belongs in the repo.

Now run the migrations and start the server:

```bash
cd backend
npx medusa db:migrate    # create the Medusa tables (dev only)
npm run dev              # start the server
```

If everything is correct, the server boots fully and the admin panel opens
at `http://localhost:9000/app`.

---

## Step 10 — Install Redis (event bus, cache, workflows)

Medusa uses **Redis** for three things: its event bus, its cache, and its
workflow engine. Without Redis, Medusa falls back to slower in-memory
versions that are **not safe for production** (events and background jobs
are lost on restart, and they cannot be shared across processes).

We install Redis on the **same `alistore-db` container** as PostgreSQL.
Run everything below **inside the database container's console** (the same
black terminal you used for Postgres), logged in as `root`.

### 10a. Install Redis

```bash
apt install -y redis-server
```

Check the version (Medusa works with Redis 6+):

```bash
redis-server --version
```

### 10b. Harden the Redis config

Open the config file:

```bash
nano /etc/redis/redis.conf
```

Change these settings. Use **search** in `nano` (`Ctrl+W`) to find each
line, then edit it. Lines may start with a `#` (commented out) — remove the
`#` to activate them.

1. **(Testing) Listen on all interfaces** so you can connect from any
   machine while developing. Find the `bind` line and set:

   ```
   bind 0.0.0.0
   ```

   > ⚠️ **Testing only.** Before go-live, lock this down to localhost + the
   > container's LAN IP: `bind 127.0.0.1 172.16.18.10`.

2. **(Testing) Allow authenticated remote connections.** Because we bind to
   all interfaces for testing, turn protected mode off — the password below
   still protects Redis:

   ```
   protected-mode no
   ```

   > ⚠️ **Testing only.** Set `protected-mode yes` again before go-live.

3. **Require a password.** For testing we reuse the same password as the
   database. It must match the `REDIS_URL` value in `backend/.env`:

   ```
   requirepass DbNew!2025
   ```

   > ⚠️ **Testing only.** Use a unique, strong Redis password before
   > go-live, and update `REDIS_URL` in `backend/.env` to match.

4. **Persist data to disk** so events and workflow state survive a restart.
   Turn on the append-only file:

   ```
   appendonly yes
   ```

5. **Cap memory and protect important keys.** A small store is fine with
   256 MB. Use `noeviction` so Redis never silently drops event/workflow
   data when full (it returns an error instead, which is the safe choice):

   ```
   maxmemory 256mb
   maxmemory-policy noeviction
   ```

Save and exit: `Ctrl+O`, `Enter`, `Ctrl+X`.

> **Why a password is essential:** because Redis now listens on the LAN
> (`172.16.18.10`), any machine on the network could otherwise read or wipe
> it. `requirepass` + a private-only `bind` keeps it locked down.

### 10c. Restart Redis and enable it on boot

```bash
systemctl restart redis-server
systemctl enable redis-server
systemctl status redis-server
```

You should see **active (running)** in green. Press `q` to exit.

### 10d. Firewall

**(Testing)** Allow Redis (`6379`) from anywhere so you can connect from any
machine while developing:

```bash
ufw allow 6379/tcp
```

> ⚠️ **Testing only.** Before go-live, replace this with a rule scoped to the
> backend IP only, exactly like the Postgres rule:
>
> ```bash
> ufw delete allow 6379/tcp
> ufw allow from 172.16.18.20 to any port 6379 proto tcp
> ```

### 10e. Test Redis

On the container itself:

```bash
redis-cli -a 'DbNew!2025' ping
```

You should see `PONG`. (Ignore the warning about using `-a` on the command
line; it is only a reminder that the password is visible in your shell
history on this admin box.)

### 10f. Turn it on in the backend

The backend is already wired for Redis in `medusa-config.ts` — it activates
automatically as soon as `REDIS_URL` is set. In `backend/.env`, **uncomment**
the `REDIS_URL` line (remove the leading `#`):

```
REDIS_URL=redis://:DbNew!2025@172.16.18.10:6379
```

Then restart the backend (`npm run dev`). On boot you should **no longer**
see `redisUrl not found. A fake redis instance will be used.` — instead the
Redis-backed event bus, cache, and workflow engine load.

> **Never commit `backend/.env`.** For testing this guide uses the shared
> `DbNew!2025` password; before go-live, give Redis its own strong password,
> keep it only in `backend/.env`, and rotate it.

---

## Quick reference

| Item           | Value (example)                                         |
| -------------- | ------------------------------------------------------- |
| Container name | `alistore-db`                                         |
| Database IP    | `172.16.18.10`                                        |
| Backend IP     | `172.16.18.20`                                        |
| Database name  | `medusa`                                              |
| Database user  | `db-admin`                                            |
| Postgres port  | `5432`                                                |
| DATABASE_URL   | `postgres://db-admin:DbNew!2025@172.16.18.10:5432/medusa` |
| Redis port     | `6379`                                                |
| Redis password | `DbNew!2025` (testing — change before go-live)        |
| REDIS_URL      | `redis://:DbNew!2025@172.16.18.10:6379`               |

---

## Backups (do this before going live)

A simple daily backup. Run inside the database container:

```bash
sudo -u postgres pg_dump medusa > /root/medusa-backup-$(date +%F).sql
```

Later you can set this as a daily cron job. Keep backups on a different
machine too. **Never run a production migration without a fresh backup
first.**

---

## Local development option (no Proxmox)

For local development you do not need this Proxmox setup. The project plan
uses a **Supabase free Postgres** database for dev. In that case:

1. Create a free project at supabase.com.
2. Copy its connection string (the "Connection Pooling" URI).
3. Put it in `backend/.env` as `DATABASE_URL=...`.

Then `npm run dev` will boot. The Proxmox guide above is for the
**production** server in Cambodia.
