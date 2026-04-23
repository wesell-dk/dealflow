import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import type { AuthedRequest } from "../middlewares/auth";
import { db, brandsTable } from "@workspace/db";
import { inArray, or, like } from "drizzle-orm";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

const ALLOWED_UPLOAD_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/svg+xml",
  "image/webp",
]);
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

function requireAuthenticated(req: Request, res: Response): boolean {
  const scope = (req as AuthedRequest).scope;
  if (!scope) {
    res.status(401).json({ error: "not authenticated" });
    return false;
  }
  return true;
}

function requireAdminScope(req: Request, res: Response): boolean {
  const scope = (req as AuthedRequest).scope;
  if (!scope) {
    res.status(401).json({ error: "not authenticated" });
    return false;
  }
  if (!scope.tenantWide) {
    res.status(403).json({ error: "admin rights required" });
    return false;
  }
  return true;
}

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned URL for file upload.
 * The client sends JSON metadata (name, size, contentType) — NOT the file.
 * Then uploads the file directly to the returned presigned URL.
 */
router.post("/storage/uploads/request-url", async (req: Request, res: Response) => {
  if (!requireAdminScope(req, res)) return;
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  try {
    const { name, size, contentType } = parsed.data;
    if (!ALLOWED_UPLOAD_MIME.has(contentType)) {
      res.status(400).json({ error: "contentType not allowed (png/jpeg/svg/webp only)" });
      return;
    }
    if (typeof size !== "number" || size <= 0 || size > MAX_UPLOAD_BYTES) {
      res.status(400).json({ error: `size must be 1..${MAX_UPLOAD_BYTES} bytes` });
      return;
    }

    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

    res.json(
      RequestUploadUrlResponse.parse({
        uploadURL,
        objectPath,
        metadata: { name, size, contentType },
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Error generating upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS.
 * These are unconditionally public — no authentication or ACL checks.
 * IMPORTANT: Always provide this endpoint when object storage is set up.
 */
router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const response = await objectStorageService.downloadObject(file);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    req.log.error({ err: error }, "Error serving public object");
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

/**
 * GET /storage/objects/*
 *
 * Serve object entities from PRIVATE_OBJECT_DIR.
 * These are served from a separate path from /public-objects and can optionally
 * be protected with authentication or ACL checks based on the use case.
 */
router.get("/storage/objects/*path", async (req: Request, res: Response) => {
  if (!requireAuthenticated(req, res)) return;
  const scope = (req as AuthedRequest).scope!;
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;

    const suffix = `/storage/objects/${wildcardPath}`;
    const rows = await db
      .select({ id: brandsTable.id })
      .from(brandsTable)
      .where(
        or(
          like(brandsTable.logoUrl, `%${suffix}`),
          like(brandsTable.logoUrl, `%/objects/${wildcardPath}`),
        ),
      );
    if (rows.length === 0) {
      res.status(404).json({ error: "object not found" });
      return;
    }
    const allowed = scope.tenantWide || rows.some((r) => scope.brandIds.includes(r.id));
    if (!allowed) {
      res.status(403).json({ error: "forbidden" });
      return;
    }

    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
    const response = await objectStorageService.downloadObject(objectFile);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      req.log.warn({ err: error }, "Object not found");
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;
