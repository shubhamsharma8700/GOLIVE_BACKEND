import dotenv from "dotenv";
import express from "express";
import authRoutes from "./routes/authRoutes.js";

dotenv.config();
const app = express();

app.use(express.json());

// Routes
app.use("/auth", authRoutes);

app.get("/", (req, res) => {
  res.send("API running...");
});

export default app;
