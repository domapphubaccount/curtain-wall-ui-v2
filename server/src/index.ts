import "dotenv/config";
import express from "express";
import cors from "cors";
import { projectsRouter } from "./routes/projects.js";

const app = express();
const port = Number(process.env.PORT) || 4000;
const allowedOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:5173").split(",").map((o) => o.trim());

app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: "5mb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));
app.use("/api/projects", projectsRouter);

app.listen(port, () => {
  console.log(`SprintForge API listening on http://localhost:${port}`);
});
