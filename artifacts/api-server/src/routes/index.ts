import { Router, type IRouter } from "express";
import healthRouter from "./health";
import dealflowRouter from "./dealflow";
import storageRouter from "./storage";
import emailChannelsRouter from "./emailChannels";

const router: IRouter = Router();

router.use(healthRouter);
router.use(storageRouter);
// emailChannels MUST be mounted before dealflow because the legacy route
// catches some prefixes; right now there's no overlap, but ordering matches
// the convention used for storage.
router.use(emailChannelsRouter);
router.use(dealflowRouter);

export default router;
