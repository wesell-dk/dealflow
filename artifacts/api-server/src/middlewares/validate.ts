import type { Request, Response, NextFunction, RequestHandler } from "express";
import type { ZodSchema, ZodIssue } from "zod";

export interface ValidateOptions {
  body?: ZodSchema;
  params?: ZodSchema;
  query?: ZodSchema;
}

export interface ValidationErrorIssue {
  path: string;
  message: string;
}

export interface ValidationErrorBody {
  error: "validation";
  issues: ValidationErrorIssue[];
}

function toIssues(where: string, zIssues: readonly ZodIssue[]): ValidationErrorIssue[] {
  return zIssues.map((i) => ({
    path: `${where}${i.path.length ? "." + i.path.join(".") : ""}`,
    message: i.message,
  }));
}

function runChecks(req: Request, opts: ValidateOptions): ValidationErrorIssue[] {
  const issues: ValidationErrorIssue[] = [];
  if (opts.params) {
    const r = opts.params.safeParse(req.params);
    if (!r.success) issues.push(...toIssues("params", r.error.issues));
    else req.params = r.data as typeof req.params;
  }
  if (opts.query) {
    const r = opts.query.safeParse(req.query);
    if (!r.success) issues.push(...toIssues("query", r.error.issues));
    else {
      try {
        Object.defineProperty(req, "query", { value: r.data, writable: true, configurable: true });
      } catch {
        // req.query is getter-only in Express 5; leave original query intact.
      }
    }
  }
  if (opts.body) {
    const r = opts.body.safeParse(req.body);
    if (!r.success) issues.push(...toIssues("body", r.error.issues));
    else req.body = r.data;
  }
  return issues;
}

/**
 * Express middleware factory validating req.params, req.query and req.body
 * against Zod schemas. On failure responds 422 with a structured issues array.
 */
export function validate(opts: ValidateOptions): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const issues = runChecks(req, opts);
    if (issues.length > 0) {
      const payload: ValidationErrorBody = { error: "validation", issues };
      res.status(422).json(payload);
      return;
    }
    next();
  };
}

/**
 * In-handler validation. Runs Zod checks; on failure responds 422 and returns
 * `false`. On success returns `true` — the caller proceeds. Use when inserting
 * a middleware would disrupt Express 5 path-template type inference.
 */
export function validateInline(req: Request, res: Response, opts: ValidateOptions): boolean {
  const issues = runChecks(req, opts);
  if (issues.length > 0) {
    const payload: ValidationErrorBody = { error: "validation", issues };
    res.status(422).json(payload);
    return false;
  }
  return true;
}
