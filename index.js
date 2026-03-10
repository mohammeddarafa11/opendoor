import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import morgan from "morgan";

import connectDB from "./src/config/db.js";
import authRoutes from "./src/routes/authRoutes.js";
import unitRoutes from "./src/routes/unitRoutes.js";
import reservationRoutes from "./src/routes/reservationRoutes.js";
import paymentRoutes from "./src/routes/payments.routes.js";
import waitlistRoutes from "./src/routes/waitlistRoutes.js";
import wishlistRoutes from "./src/routes/wishlistRoutes.js";
import dashboardRoutes from "./src/routes/dashboardRoutes.js";
import adminRoutes from "./src/routes/adminRoutes.js";
import projectRoutes from "./src/routes/projectRoutes.js";
import blockRoutes from "./src/routes/blockRoutes.js";
import { startScheduledTasks } from "./src/scripts/scheduledTasks.js";

// Validate required env vars
const required = ["MONGO_URI", "JWT_SECRET"];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`❌ Missing env var: ${key}`);
    process.exit(1);
  }
}

// Connect DB
await connectDB();

const app = express();

// ─── 1. Security ────────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }),
);

// ─── 2. CORS ────────────────────────────────────────────────────────
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

// ─── 3. Body parsers (MUST be before routes) ────────────────────────
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// ─── 4. Logging ─────────────────────────────────────────────────────
app.use(morgan("dev"));

// ─── 5. Rate limiting (applied globally only — NOT per-path) ────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests, please try again later" },
});
app.use(limiter);

// ─── 6. Mongo sanitize (SAFE — no express-mongo-sanitize) ──────────
function sanitizeObj(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeObj);
  const clean = {};
  for (const [key, val] of Object.entries(obj)) {
    if (key.startsWith("$") || key.includes(".")) continue;
    clean[key] =
      typeof val === "object" && val !== null ? sanitizeObj(val) : val;
  }
  return clean;
}

app.use((req, res, next) => {
  if (req.body && typeof req.body === "object") {
    req.body = sanitizeObj(req.body);
  }
  next();
});

// ─── 7. Debug middleware — find "next is not a function" ─────────────
app.use((req, res, next) => {
  console.log(
    `📥 ${req.method} ${req.originalUrl} — body keys:`,
    Object.keys(req.body || {}),
  );
  next();
});

// ─── 8. Routes ──────────────────────────────────────────────────────
app.use("/api/auth", authRoutes);
app.use("/api/units", unitRoutes);
app.use("/api/reservations", reservationRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/waitlist", waitlistRoutes);
app.use("/api/wishlist", wishlistRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/blocks", blockRoutes);

// ─── 9. Health check ────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ─── 10. 404 ────────────────────────────────────────────────────────
app.use((req, res) => {
  res
    .status(404)
    .json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
});

// ─── 11. Global error handler ───────────────────────────────────────
app.use(function errorHandler(err, req, res, next) {
  console.error("❌ Error:", err.message);
  console.error("Stack:", err.stack);

  if (err.name === "ValidationError") {
    const errors = Object.values(err.errors).map((e) => e.message);
    return res.status(400).json({ message: "Validation Error", errors });
  }

  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || "field";
    return res.status(400).json({ message: `${field} already exists` });
  }

  if (err.name === "CastError") {
    return res.status(400).json({ message: "Invalid ID format" });
  }

  if (err.name === "JsonWebTokenError") {
    return res.status(401).json({ message: "Invalid token" });
  }
  if (err.name === "TokenExpiredError") {
    return res.status(401).json({ message: "Token expired" });
  }

  res.status(err.status || 500).json({
    message: err.message || "Internal server error",
  });
});

// ─── 12. Start ──────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || "development"}`);
  startScheduledTasks();
});

export default app;
