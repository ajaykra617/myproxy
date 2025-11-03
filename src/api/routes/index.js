import { Router } from "express";
import healthRouter from "./health.js";
import proxyRouter from "./proxies.js";
const router = Router();
router.use("/v1", proxyRouter);
router.use("/", healthRouter);
export default router;
