/**
 * Structured Output Layer
 *
 * Anthropic erzwingt strukturierte Outputs über tool_use. Wir konvertieren
 * unsere zod-Schemas in JSON-Schema-Subset, das Anthropic akzeptiert, und
 * validieren die zurückgelieferte tool-input gegen dasselbe zod-Schema.
 *
 * Bewusst NICHT die volle JSON-Schema-Mächtigkeit — wir whitelisten exakt
 * die zod-Konstruktoren, die wir in Prompts einsetzen.
 */

import { z } from 'zod';

interface JsonSchemaObject {
  type: string;
  properties?: Record<string, JsonSchemaObject>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchemaObject;
  enum?: unknown[];
  description?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
}

class UnsupportedZodTypeError extends Error {
  constructor(typeName: string) {
    super(
      `zodToToolSchema: unsupported zod type "${typeName}". ` +
        `Erweitere structuredOutput.ts oder vereinfache das Schema.`,
    );
    this.name = 'UnsupportedZodTypeError';
  }
}

function convert(schema: z.ZodTypeAny): JsonSchemaObject {
  const def = schema._def as { typeName?: string; description?: string };
  const description = def.description;

  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    const properties: Record<string, JsonSchemaObject> = {};
    const required: string[] = [];
    for (const [k, v] of Object.entries(shape)) {
      const isOptional = v instanceof z.ZodOptional;
      const inner = isOptional ? (v as z.ZodOptional<z.ZodTypeAny>).unwrap() : v;
      properties[k] = convert(inner);
      if (!isOptional) required.push(k);
    }
    return {
      type: 'object',
      properties,
      required,
      additionalProperties: false,
      ...(description ? { description } : {}),
    };
  }

  if (schema instanceof z.ZodArray) {
    return {
      type: 'array',
      items: convert((schema as z.ZodArray<z.ZodTypeAny>).element),
      ...(description ? { description } : {}),
    };
  }

  if (schema instanceof z.ZodString) {
    const checks = (schema._def as { checks?: Array<{ kind: string; value?: number }> }).checks ?? [];
    const out: JsonSchemaObject = { type: 'string', ...(description ? { description } : {}) };
    for (const c of checks) {
      if (c.kind === 'min' && typeof c.value === 'number') out.minLength = c.value;
      if (c.kind === 'max' && typeof c.value === 'number') out.maxLength = c.value;
    }
    return out;
  }

  if (schema instanceof z.ZodNumber) {
    const checks = (schema._def as { checks?: Array<{ kind: string; value?: number }> }).checks ?? [];
    const out: JsonSchemaObject = { type: 'number', ...(description ? { description } : {}) };
    for (const c of checks) {
      if (c.kind === 'min' && typeof c.value === 'number') out.minimum = c.value;
      if (c.kind === 'max' && typeof c.value === 'number') out.maximum = c.value;
    }
    return out;
  }

  if (schema instanceof z.ZodBoolean) {
    return { type: 'boolean', ...(description ? { description } : {}) };
  }

  if (schema instanceof z.ZodEnum) {
    return {
      type: 'string',
      enum: [...((schema as z.ZodEnum<[string, ...string[]]>).options)],
      ...(description ? { description } : {}),
    };
  }

  if (schema instanceof z.ZodLiteral) {
    const v = (schema as z.ZodLiteral<unknown>).value;
    const t =
      typeof v === 'string' ? 'string' :
      typeof v === 'number' ? 'number' :
      typeof v === 'boolean' ? 'boolean' : 'string';
    return { type: t, enum: [v], ...(description ? { description } : {}) };
  }

  throw new UnsupportedZodTypeError(def.typeName ?? schema.constructor.name);
}

/**
 * Wandelt ein zod-Schema in ein JSON-Schema-Objekt für Anthropic tool input_schema.
 * Anthropic verlangt type:object an der Wurzel.
 */
export function zodToToolSchema(schema: z.ZodTypeAny): JsonSchemaObject {
  const out = convert(schema);
  if (out.type !== 'object') {
    throw new Error('zodToToolSchema: root schema must be a z.object()');
  }
  return out;
}

/**
 * Validiert die tool-input von Anthropic gegen das ursprüngliche zod-Schema.
 * Wirft bei Schema-Verletzungen mit klarer Fehlermeldung.
 */
export function validateStructured<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const err = new Error(
      `AI returned tool input that does not match expected schema: ${result.error.message}`,
    );
    (err as Error & { cause?: unknown }).cause = result.error;
    err.name = 'StructuredOutputValidationError';
    throw err;
  }
  return result.data;
}
