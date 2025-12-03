import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import eventRoutes from "./routes/eventRoutes.js";
import accessRoutes from "./routes/accessRoutes.js";
import playbackRoutes from "./routes/playbackRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";

const app = express();
app.use(cors());
app.use(bodyParser.json());



// Routes
app.use("/api/admin", adminRoutes);
app.use("/api/admin/event", eventRoutes);
app.use("/api/access", accessRoutes);
app.use("/api/playback", playbackRoutes);

export default app;
