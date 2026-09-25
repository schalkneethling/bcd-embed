import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { ZodType } from "zod";

import apiErrorResponseJsonSchema from "../../../packages/schema/json-schema/api-error-response.schema.json" with { type: "json" };
import browsersResponseJsonSchema from "../../../packages/schema/json-schema/browsers-response.schema.json" with { type: "json" };
import featureResponseJsonSchema from "../../../packages/schema/json-schema/feature-response.schema.json" with { type: "json" };
import indexResponseJsonSchema from "../../../packages/schema/json-schema/index-response.schema.json" with { type: "json" };
import metaResponseJsonSchema from "../../../packages/schema/json-schema/meta-response.schema.json" with { type: "json" };
import {
  apiErrorResponseSchema,
  browsersResponseSchema,
  featureResponseSchema,
  indexResponseSchema,
  metaResponseSchema,
} from "../../../packages/schema/src/schemas.js";

export const contractKinds = [
  "feature-response",
  "browsers-response",
  "index-response",
  "meta-response",
  "api-error-response",
] as const;

export type ContractKind = (typeof contractKinds)[number];

type ValidationError = { path: string; message: string };
type ValidationOutcome = { valid: boolean; errors: ValidationError[] };
export type ContractValidationResult = {
  valid: boolean;
  zod: ValidationOutcome;
  jsonSchema: ValidationOutcome;
};

const schemas: Record<ContractKind, ZodType> = {
  "feature-response": featureResponseSchema,
  "browsers-response": browsersResponseSchema,
  "index-response": indexResponseSchema,
  "meta-response": metaResponseSchema,
  "api-error-response": apiErrorResponseSchema,
};

const jsonSchemas = {
  "feature-response": featureResponseJsonSchema,
  "browsers-response": browsersResponseJsonSchema,
  "index-response": indexResponseJsonSchema,
  "meta-response": metaResponseJsonSchema,
  "api-error-response": apiErrorResponseJsonSchema,
};

const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);

const validators = Object.fromEntries(
  contractKinds.map((kind) => [kind, ajv.compile(jsonSchemas[kind])]),
) as Record<ContractKind, ValidateFunction>;

const zodPath = (path: PropertyKey[]) =>
  path.length === 0 ? "/" : `/${path.map(String).join("/")}`;
const ajvError = (error: ErrorObject): ValidationError => ({
  path: error.instancePath || "/",
  message: error.message ?? "JSON Schema validation failed.",
});

export const isContractKind = (value: string): value is ContractKind =>
  contractKinds.includes(value as ContractKind);

export const validateContract = (kind: ContractKind, value: unknown): ContractValidationResult => {
  const zodResult = schemas[kind].safeParse(value);
  const jsonSchemaValid = validators[kind](value);

  const zod: ValidationOutcome = zodResult.success
    ? { valid: true, errors: [] }
    : {
        valid: false,
        errors: zodResult.error.issues.map((issue) => ({
          path: zodPath(issue.path),
          message: issue.message,
        })),
      };
  const jsonSchema: ValidationOutcome = {
    valid: jsonSchemaValid,
    errors: (validators[kind].errors ?? []).map(ajvError),
  };

  return { valid: zod.valid && jsonSchema.valid, zod, jsonSchema };
};
