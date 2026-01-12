import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import cookieParser from "cookie-parser";

import eventRoutes from "./routes/eventRoutes.js";
import playbackRoutes from "./routes/playbackRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import analyticsRoutes from "./routes/analyticsRoutes.js";
import awsRoutes from "./routes/awsRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import PaymentsController from "./controllers/paymentsController.js";
import viewerRoutes from "./routes/viewerRoutes.js";

const app = express();
app.set("trust proxy", true);

/* ======================================================
   CORS (MUST be first)
====================================================== */
const allowedOrigins = [
  "http://localhost:5173",
  "http://13.234.235.130:5173",
  "https://d2wmdj5cojtj0q.cloudfront.net",
];

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow non-browser tools (Postman, curl)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "Accept",
    ],
    exposedHeaders: ["Set-Cookie"],
    optionsSuccessStatus: 204,
  })
);


/* ======================================================
   Stripe Webhook (RAW BODY ONLY)
====================================================== */
app.post(
  "/api/payments/stripe/webhook",
  express.raw({ type: "application/json" }),
  PaymentsController.webhook
);
// Important: reset JSON parser AFTER webhook
app.use((req, res, next) => {
  if (req.originalUrl === "/api/payments/stripe/webhook") {
    next();
  } else {
    express.json()(req, res, next);
  }
});

// AFTER webhook route
//app.use(express.json());

/* ======================================================
   JSON body parser (AFTER webhook)
====================================================== */
//app.use(bodyParser.json());

app.use(cookieParser());

/* ======================================================
   API Routes
====================================================== */
app.use("/api/admin", adminRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/playback", playbackRoutes);
app.use("/api/viewers", viewerRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/payments", paymentRoutes); // ← create-session, verify, admin
app.use("/api/aws", awsRoutes);

export default app;
