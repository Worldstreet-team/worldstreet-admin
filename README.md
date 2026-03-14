# Express Admin Service

## Features
- JWT-based authentication (superadmin role)
- MongoDB with Mongoose
- Input validation with Joi
- Security middleware (Helmet, CORS, Rate limiting)
- Modular folder structure
- Seed script for initial superadmin creation

## Getting Started

1. Copy `.env.example` to `.env` and fill in your values:
   ```bash
   cp .env.example .env
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Seed the initial superadmin user:
   ```bash
   npm run seed
   ```
   You can customize the admin credentials via `SEED_USERNAME` and `SEED_PASSWORD` env vars.

4. Start the server:
   ```bash
   npm start
   ```

## Environment Variables

| Variable        | Description                          | Default            |
|----------------|--------------------------------------|--------------------|
| `NODE_ENV`     | Environment mode                     | `development`      |
| `PORT`         | Server port                          | `3000`             |
| `MONGO_URI`    | MongoDB connection string            | —                  |
| `JWT_SECRET`   | Secret key for JWT signing           | —                  |
| `CORS_ORIGIN`  | Allowed CORS origin                  | `http://localhost:3000` |
| `SEED_USERNAME`| Username for seed script             | `superadmin`       |
| `SEED_PASSWORD`| Password for seed script             | `changeme123`      |

## API Endpoints

| Method | Route                | Auth     | Description           |
|--------|----------------------|----------|-----------------------|
| POST   | `/api/admin/login`   | Public   | Login as superadmin   |
| GET    | `/api/admin/dashboard` | JWT    | Protected dashboard   |

## Deployment on Render
1. Push this repo to GitHub.
2. Create a new Web Service on Render.
3. Add environment variables (`MONGO_URI`, `JWT_SECRET`, `CORS_ORIGIN`, `NODE_ENV`).
4. Build Command: `npm install`
5. Start Command: `node src/app.js`
6. Render automatically sets `PORT`, ensure config uses `process.env.PORT`.
