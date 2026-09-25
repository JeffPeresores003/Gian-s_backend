# Gian's Cafe — Backend API Service

Node.js / Express REST API with MySQL, tailored for Hostinger MySQL and Render deployment.

## Architecture & Security Highlights

1. **Stored Procedures Only**: All database reads, writes, updates, toggles, and deletions run via MySQL Stored Procedures (`sp_*`). No inline/raw SQL queries exist in application code.
2. **Password Hashing**: Admin credentials use `bcrypt` with salt rounds = 12. Never stored in plaintext.
3. **HTTP-only Cookies & JWT**: Secure session authentication via signed HTTP-only cookies (`adminToken`) with `SameSite=strict` and expiration controls.
4. **Server-Side Authorization**: Every protected route (`/api/admin/*`) strictly verifies `user = admin` before invoking any Stored Procedure.
5. **Generic Error Masking**: Centralized error middleware ensures detailed stack traces and system internals are logged server-side only via Winston, while clients receive safe, generic messages.
6. **Strict CORS Allowlist**: Restricted exclusively to configured origins (`localhost` for dev, production domain on Render).
7. **Zero Console.log**: Production-ready structured Winston logging writing to file and stream transports.
8. **Dependency Audit**: Verified 0 vulnerabilities via `npm audit`.

---

## Getting Started

### 1. Configure Environment Variables
Copy `.env.example` to `.env` and fill in your Hostinger MySQL credentials:
```bash
cp .env.example .env
```

### 2. Run Database Setup (via MySQLyog or CLI)
1. Open MySQLyog and connect to your Hostinger MySQL instance.
2. Execute `database/schema.sql` to create tables and all required stored procedures.
3. (Optional) Execute `database/seed_data.sql` to populate sample menu items.

### 3. Generate Admin Password Hash & Seed Admin
Run the CLI helper to hash your admin password:
```bash
node scripts/seedAdmin.js admin YourSecurePasswordHere
```
This prints the SQL insert statement to run in MySQLyog or inserts it directly if your `.env` is configured.

### 4. Run Development Server
```bash
npm run dev
```

---

## Deployment to Render

1. Create a new **Web Service** on [Render](https://render.com).
2. Connect the `Gian-s_backend` repository.
3. Configure settings:
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
4. Set Environment Variables on Render:
   - `NODE_ENV`: `production`
   - `PORT`: `10000` (or leave default Render port)
   - `DB_HOST`: Your Hostinger MySQL host
   - `DB_USER`: Your Hostinger MySQL user
   - `DB_PASSWORD`: Your Hostinger MySQL password
   - `DB_NAME`: Your Hostinger MySQL database name
   - `DB_PORT`: `3306`
   - `JWT_SECRET`: A strong random 64-character string
   - `ALLOWED_ORIGINS`: `https://your-frontend-domain.onrender.com`
   - `COOKIE_SECURE`: `true`
