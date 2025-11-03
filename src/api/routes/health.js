import { Router } from "express";
const router = Router();
router.get("/health",(req,res)=>res.send({status:"ok",uptime:process.uptime(),ts:new Date()}));
export default router;
