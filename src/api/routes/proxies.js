import { Router } from "express";
import { pg } from "../../db/postgres.js";
const router = Router();
router.get("/proxies/random", async (req,res)=>{
  const { rows } = await pg.query("SELECT * FROM proxies WHERE healthy=true ORDER BY RANDOM() LIMIT 1");
  if(!rows.length) return res.status(404).send({error:"No proxies"});
  const p = rows[0];
  const proxy = p.username ? `${p.protocol}://${p.username}:${p.password}@${p.ip}:${p.port}` : `${p.protocol}://${p.ip}:${p.port}`;
  res.send({ proxy, id:p.id });
});
export default router;
