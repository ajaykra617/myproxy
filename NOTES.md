# 🗒️ Project Notes — MyProxy

**Purpose:**  
A scalable Proxy Manager service designed for internal use and customer distribution.  
Built with **Node.js + Express**, **PostgreSQL**, and **Redis**, running under **Docker** inside **WSL2**.

---

## ⚙️ Current Stack Overview

| Component | Description |
|------------|-------------|
| **Node.js (App)** | REST API handling proxy allocation, release, and health endpoints |
| **PostgreSQL** | Stores proxy data, usage logs, and health stats |
| **Redis** | Used for caching, sessions, and job queues (future use) |
| **Docker Compose** | Manages all services and container networking |
| **WSL2 (Ubuntu)** | Linux environment for development on Windows |
| **GitHub Repo** | Version control and CI/CD integration |

---

## 🚀 How to Run

```bash
docker compose up --build
Check if the API is live:

bash
Copy code
curl http://localhost:3000/health
Expected output:

json
Copy code
{"status":"ok","uptime":12.34,"ts":"2025-11-03T10:36:04.216Z"}
🧩 Current Routes
Endpoint	Method	Description
/health	GET	Check server uptime and API availability
/v1/proxies/random	GET	Return one random healthy proxy from the database

🐘 Database (PostgreSQL)
Database Name: myproxy

Tables:

proxies → stores proxy IPs, credentials, type (http/socks5), provider, etc.

proxy_usage → records usage, success/fail, latency, timestamps

Initialized automatically via:

sql/init.sql (schema creation)

sql/seed.sql (initial data)

Access DB manually:

bash
Copy code
docker exec -it myproxy-db-1 psql -U postgres myproxy
⚡ Redis (Cache / Queue)
Used for:

Caching proxy data for fast access

Tracking usage or sticky sessions

Background task queues (planned for health checks)

🧠 Development Commands
Task	Command
Start all services	docker compose up --build
View live logs	docker compose logs -f app
Stop containers	docker compose down
Restart Node.js only	docker compose restart app
Check running containers	docker ps
Open Postgres shell	docker exec -it myproxy-db-1 psql -U postgres myproxy

🧰 Folder Structure
bash
Copy code
myproxy/
 ├─ src/
 │   ├─ api/              # Express routes (proxies, health)
 │   ├─ db/               # Database connection files
 │   ├─ utils/            # Configs, logger, helper functions
 │   └─ server.js         # App entry point
 ├─ sql/                  # init.sql & seed.sql (DB setup)
 ├─ docker-compose.yml    # Multi-service setup
 ├─ package.json          # Node.js metadata & dependencies
 ├─ .env.example          # Example environment config
 └─ NOTES.md              # This file
🧭 Docker Service Overview
Service	Image	Role
app	node:20-alpine	Runs the Proxy Manager API
db	postgres:16	Stores proxy and usage data
redis	redis:7	Caching and future job processing

📦 Version Control Notes
bash
Copy code
git add .
git commit -m "update notes and docs"
git push
🧩 Todo / Roadmap
 Add nodemon for hot-reload during development

 Add /v1/proxies/release endpoint (report success/failure)

 Implement proxy rotation strategy (round-robin / least-used / sticky)

 Build health-check worker (periodic proxy status validation)

 Add proxy scoring system based on success rate

 Create admin dashboard for internal management

 Add monitoring & metrics endpoint (/v1/metrics)

 Integrate API key system for customers

 Implement rate limiting & usage tracking via Redis

 Set up GitHub Actions for CI/CD

🧠 Knowledge Notes
WSL2 runs a full Linux kernel → Docker Desktop uses this for containers.

Docker Compose links all services internally via DNS (db, redis, app).

Postgres auto-initializes schema and seeds via mounted .sql files.

Node.js connects to Postgres & Redis using internal hostnames.

API is exposed on localhost:3000 on your Windows host.

🧩 Tip: Keep updating this file as the project evolves — treat it like your internal documentation.
Add commands, fixes, or architecture changes as you go.

Author: Ajay Malik
Project: MyProxy
Created: November 2025
