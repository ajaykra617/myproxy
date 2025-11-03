import express from "express";
import api from "./api/routes/index.js";
import { config } from "./utils/config.js";
import { logger } from "./utils/logger.js";
const app = express();
app.use(express.json());
app.use("/", api);
app.listen(config.port, () => logger.info(`Proxy Manager API running on port ${config.port}`));
