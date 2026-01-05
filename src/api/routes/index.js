import { Router } from "express";
import healthRouter from "./health.js";
import proxyRouter from "./proxies.js";
const router = Router();
router.use("/", healthRouter);     // → /health
router.use("/v1", proxyRouter);    // → /v1/proxy, /v1/proxies/random, /v1/proxy/report
export default router;
