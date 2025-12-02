import bodyParser from "body-parser";
import cors from "cors";
import express from "express";
import accessRoutes from "./routes/accessRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import eventRoutes from "./routes/eventRoutes.js";
import playbackRoutes from "./routes/playbackRoutes.js";

const app = express();
app.use(cors());
app.use(bodyParser.json());



// Routes
app.use("/api/admin", authRoutes);
app.use("/api/admin/event", eventRoutes);
app.use("/api/access", accessRoutes);
app.use("/api/playback", playbackRoutes);

export default app;
