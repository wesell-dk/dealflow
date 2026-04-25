import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import type { AuthedRequest } from "../middlewares/auth";
import {
  db,
  brandsTable,
  attachmentLibraryTable,
  quoteAttachmentsTable,
  quoteVersionsTable,
  quotesTable,
  dealsTable,
  companiesTable,
  uploadedObjectsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

// Logos / inline images: small + image-only.
const ALLOWED_LOGO_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/svg+xml",
  "image/webp",
]);
const MAX_LOGO_BYTES = 5 * 1024 * 1024;

// Quote attachments / library docs: docs + spreadsheets + images, up to 25 MB.
const ALLOWED_DOCUMENT_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/svg+xml",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/markdown",
  "text/csv",
  "text/plain",
]);
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

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
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  const kind = (parsed.data as { kind?: "logo" | "document" }).kind ?? "logo";
  if (kind === "logo") {
    if (!requireAdminScope(req, res)) return;
  } else {
    if (!requireAuthenticated(req, res)) return;
  }

  try {
    const { name, size, contentType } = parsed.data;
    const allowed = kind === "logo" ? ALLOWED_LOGO_MIME : ALLOWED_DOCUMENT_MIME;
    const maxBytes = kind === "logo" ? MAX_LOGO_BYTES : MAX_DOCUMENT_BYTES;
    if (!allowed.has(contentType)) {
      res.status(400).json({
        error:
          kind === "logo"
            ? "contentType not allowed (png/jpeg/svg/webp only)"
            : "contentType not allowed for document upload",
      });
      return;
    }
    if (typeof size !== "number" || size <= 0 || size > maxBytes) {
      res.status(400).json({ error: `size must be 1..${maxBytes} bytes` });
      return;
    }

    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

    const scope = (req as AuthedRequest).scope!;
    await db
      .insert(uploadedObjectsTable)
      .values({
        objectPath,
        tenantId: scope.tenantId,
        userId: scope.user?.id ?? null,
        kind,
        contentType,
        size,
      })
      .onConflictDoNothing();

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

    const brandRows = await db
      .select({ id: brandsTable.id, tenantId: companiesTable.tenantId })
      .from(brandsTable)
      .innerJoin(companiesTable, eq(companiesTable.id, brandsTable.companyId))
      .where(eq(brandsTable.logoUrl, objectPath));

    const libRows = await db
      .select({
        id: attachmentLibraryTable.id,
        tenantId: attachmentLibraryTable.tenantId,
        companyId: attachmentLibraryTable.companyId,
        brandId: attachmentLibraryTable.brandId,
      })
      .from(attachmentLibraryTable)
      .where(eq(attachmentLibraryTable.objectPath, objectPath));

    const qattRows = await db
      .select({
        id: quoteAttachmentsTable.id,
        dealId: dealsTable.id,
        tenantId: companiesTable.tenantId,
        companyId: companiesTable.id,
        brandId: dealsTable.brandId,
      })
      .from(quoteAttachmentsTable)
      .innerJoin(quoteVersionsTable, eq(quoteVersionsTable.id, quoteAttachmentsTable.quoteVersionId))
      .innerJoin(quotesTable, eq(quotesTable.id, quoteVersionsTable.quoteId))
      .innerJoin(dealsTable, eq(dealsTable.id, quotesTable.dealId))
      .innerJoin(companiesTable, eq(companiesTable.id, dealsTable.companyId))
      .where(eq(quoteAttachmentsTable.objectPath, objectPath));

    if (brandRows.length === 0 && libRows.length === 0 && qattRows.length === 0) {
      res.status(404).json({ error: "object not found" });
      return;
    }

    const brandAllowed = brandRows.some(
      (r) => r.tenantId === scope.tenantId && (scope.tenantWide || scope.brandIds.includes(r.id)),
    );
    const libAllowed = libRows.some((r) =>
      r.tenantId === scope.tenantId && (
        scope.tenantWide ||
        (!r.companyId && !r.brandId) ||
        (r.companyId && scope.companyIds.includes(r.companyId)) ||
        (r.brandId && scope.brandIds.includes(r.brandId))
      ),
    );
    const qattAllowed = qattRows.some((r) =>
      r.tenantId === scope.tenantId && (
        scope.tenantWide ||
        scope.companyIds.includes(r.companyId) ||
        (r.brandId && scope.brandIds.includes(r.brandId))
      ),
    );

    if (!brandAllowed && !libAllowed && !qattAllowed) {
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
