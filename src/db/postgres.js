import pkg from "pg";
import { config } from "../utils/config.js";
import { logger } from "../utils/logger.js";
const { Pool } = pkg;
export const pg = new Pool({ connectionString: config.postgresUrl });
pg.connect().then(()=>logger.info("Connected to Postgres")).catch(e=>logger.error("Postgres error:",e));
