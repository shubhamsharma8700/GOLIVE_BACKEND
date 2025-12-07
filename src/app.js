import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import eventRoutes from "./routes/eventRoutes.js";
import accessRoutes from "./routes/accessRoutes.js";
import playbackRoutes from "./routes/playbackRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import analyticsRoutes from "./routes/analyticsRoutes.js";

const app = express();
// app.use(cors());
app.use(bodyParser.json());
app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
  })
);



// Routes
app.use("/api/admin", adminRoutes);
app.use("/api/event", eventRoutes);
app.use("/api/access", accessRoutes);
app.use("/api/playback", playbackRoutes);
app.use("/api/analytics", analyticsRoutes);

export default app;
