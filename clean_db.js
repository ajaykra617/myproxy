import { pg } from "./src/db/postgres.js";

async function run() {
  try {
    const res = await pg.query("DELETE FROM proxies WHERE provider != 'dataimpulse' OR proxy_type NOT IN ('datacenter', 'residential')");
    console.log(`Deleted ${res.rowCount} proxies.`);
  } catch (err) {
    console.error("Error:", err);
  } finally {
    process.exit(0);
  }
}

run();
