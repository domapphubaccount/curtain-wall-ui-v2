import "express-async-errors";
import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { projectsRouter } from "./routes/projects.js";
import { authRouter } from "./routes/auth.js";
import { usersRouter } from "./routes/users.js";

const app = express();
const port = Number(process.env.PORT) || 4000;
const allowedOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:5173").split(",").map((o) => o.trim());

app.disable("x-powered-by");
app.use(helmet());
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: "5mb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));
app.use("/api/auth", authRouter);
app.use("/api/users", usersRouter);
app.use("/api/projects", projectsRouter);

app.use((_req, res) => res.status(404).json({ error: "Route not found" }));
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(port, () => {
  console.log(`SprintForge API listening on http://localhost:${port}`);
});
