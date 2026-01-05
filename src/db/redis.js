// src/db/redis.js
import Redis from "ioredis";
import { config } from "../utils/config.js";
import { logger } from "../utils/logger.js";

export const redis = new Redis(config.redisUrl);

redis.on("connect", () => logger.info("Connected to Redis"));
redis.on("error", (e) => logger.error("Redis error:", e));
