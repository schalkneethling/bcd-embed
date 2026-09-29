import { createHash } from "node:crypto";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import type { CompatData, Identifier } from "@mdn/browser-compat-data/types";
import publicSchema from "./upstream/public.schema.json" with { type: "json" };

export const BCD_VERSION = "8.1.3" as const;
export const BCD_SCHEMA_SHA256 =
  "0a94f39473d919fd6caa54ef4055879a4442810ffded72081707130fef7b81b7" as const;

export class BcdInputError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BcdInputError";
  }
}

// JSON parse/stringify preserves every semantic field; whitespace is deliberately irrelevant.
const digest = createHash("sha256").update(JSON.stringify(publicSchema)).digest("hex");
if (digest !== BCD_SCHEMA_SHA256) {
  throw new BcdInputError(
    "Pinned BCD public schema fingerprint changed; review compatibility before generation.",
  );
}

// Upstream dependencies require fields declared on the enclosing object. Ajv's
// strictRequired schema lint cannot see that scope; the required data rule still runs.
const ajv = new Ajv({ strict: true, strictRequired: false, allErrors: false });
// Match upstream scripts/lib/ajv.js: fast URI format accepts specification
// anchors such as ① that are present in published BCD data.
addFormats(ajv, { mode: "fast" });
// Upstream's type-generator annotation has no validation semantics.
ajv.addKeyword({ keyword: "tsType", schemaType: "string", valid: true });
ajv.addSchema(publicSchema, "bcd-public");
const validateAggregate = ajv.compile<CompatData>({ $ref: "bcd-public" });
const validateIdentifier = ajv.compile<Identifier>({ $ref: "bcd-public#/definitions/identifier" });

/** Validate the full input against the pinned public BCD schema and exact version. */
export function validateBcdInput(value: unknown): asserts value is CompatData {
  if (!validateAggregate(value)) {
    throw new BcdInputError(
      `BCD input failed published schema validation: ${ajv.errorsText(validateAggregate.errors)}`,
    );
  }
  if (value.__meta.version !== BCD_VERSION) {
    throw new BcdInputError(
      `Expected pinned BCD ${BCD_VERSION}; received ${value.__meta.version}.`,
    );
  }
}

/** Validate a raw feature subtree against the upstream identifier schema. */
export function validateRawArtifact(value: unknown): asserts value is Identifier {
  if (!validateIdentifier(value)) {
    throw new BcdInputError(
      `Raw BCD artifact failed published identifier schema: ${ajv.errorsText(validateIdentifier.errors)}`,
    );
  }
  if (!Object.hasOwn(value, "__compat")) {
    throw new BcdInputError("Raw artifact root must be independently addressable.");
  }
}
