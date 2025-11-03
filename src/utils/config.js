import dotenv from "dotenv";
dotenv.config();
export const config = {
  port: process.env.PORT || 3000,
  redisUrl: process.env.REDIS_URL || "redis://redis:6379",
  postgresUrl: process.env.POSTGRES_URL || "postgres://postgres:postgres@db:5432/myproxy"
};
