import { Router, type IRouter } from "express";
import healthRouter from "./health";
import dealflowRouter from "./dealflow";

const router: IRouter = Router();

router.use(healthRouter);
router.use(dealflowRouter);

export default router;
