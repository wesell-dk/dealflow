export interface ResponseMeta {
  source: "live" | "version";
  validFrom: string | null;
  validTo: string | null;
  generatedAt: string;
  asOf?: string;
  version?: number;
}

export interface WithMeta<T> {
  data: T;
  meta: ResponseMeta;
}

export function withMeta<T>(
  data: T,
  opts: Partial<Omit<ResponseMeta, "generatedAt">> = {},
): WithMeta<T> {
  return {
    data,
    meta: {
      source: opts.source ?? "live",
      validFrom: opts.validFrom ?? null,
      validTo: opts.validTo ?? null,
      generatedAt: new Date().toISOString(),
      ...(opts.asOf ? { asOf: opts.asOf } : {}),
      ...(opts.version !== undefined ? { version: opts.version } : {}),
    },
  };
}
