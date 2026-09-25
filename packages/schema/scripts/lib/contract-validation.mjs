import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import apiErrorResponseJsonSchema from "../../json-schema/api-error-response.schema.json" with { type: "json" };
import browsersResponseJsonSchema from "../../json-schema/browsers-response.schema.json" with { type: "json" };
import featureResponseJsonSchema from "../../json-schema/feature-response.schema.json" with { type: "json" };
import indexResponseJsonSchema from "../../json-schema/index-response.schema.json" with { type: "json" };
import metaResponseJsonSchema from "../../json-schema/meta-response.schema.json" with { type: "json" };
import {
  apiErrorResponseSchema,
  browsersResponseSchema,
  featureResponseSchema,
  indexResponseSchema,
  metaResponseSchema,
} from "../../src/schemas.ts";

export const contractKinds = [
  "feature-response",
  "browsers-response",
  "index-response",
  "meta-response",
  "api-error-response",
];

const definitions = {
  "feature-response": [featureResponseSchema, featureResponseJsonSchema],
  "browsers-response": [browsersResponseSchema, browsersResponseJsonSchema],
  "index-response": [indexResponseSchema, indexResponseJsonSchema],
  "meta-response": [metaResponseSchema, metaResponseJsonSchema],
  "api-error-response": [apiErrorResponseSchema, apiErrorResponseJsonSchema],
};

const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);

const validators = Object.fromEntries(
  Object.entries(definitions).map(([kind, [, jsonSchema]]) => [kind, ajv.compile(jsonSchema)]),
);

const renderPath = (path) => (path.length === 0 ? "/" : `/${path.map(String).join("/")}`);

export const isContractKind = (value) => contractKinds.includes(value);

export const validateContract = (kind, value) => {
  if (!isContractKind(kind)) {
    throw new TypeError(`Unknown contract kind: ${kind}`);
  }

  const [zodSchema] = definitions[kind];
  const zodResult = zodSchema.safeParse(value);
  const validateJsonSchema = validators[kind];
  const jsonSchemaValid = validateJsonSchema(value);

  return {
    valid: zodResult.success && jsonSchemaValid,
    zod: zodResult.success
      ? { valid: true, errors: [] }
      : {
          valid: false,
          errors: zodResult.error.issues.map((issue) => ({
            path: renderPath(issue.path),
            message: issue.message,
          })),
        },
    jsonSchema: {
      valid: jsonSchemaValid,
      errors: (validateJsonSchema.errors ?? []).map((error) => ({
        path: error.instancePath || "/",
        message: error.message ?? "JSON Schema validation failed.",
      })),
    },
  };
};
