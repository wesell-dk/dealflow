import { Router, type IRouter } from "express";
import healthRouter from "./health";
import dealflowRouter from "./dealflow";
import storageRouter from "./storage";

const router: IRouter = Router();

router.use(healthRouter);
router.use(storageRouter);
router.use(dealflowRouter);

export default router;
