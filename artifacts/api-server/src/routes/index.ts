import { Router, type IRouter } from "express";
import healthRouter from "./health";
import mrzRouter from "./mrz";

const router: IRouter = Router();

router.use(healthRouter);
router.use(mrzRouter);

export default router;
