import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import type { ErrorObject, ValidateFunction } from "ajv";

import type { GisSchema } from "#/lib/gis-schemas";

// Properties the converters themselves attach (grouping/legend metadata),
// never part of a target schema — never worth flagging as "unrecognized" or
// offering up as a rename candidate.
export const INTERNAL_PROPERTY_KEYS = new Set(["layer", "source", "block"]);

// The bundled schemas carry custom keys (`synch_alias`, `ui_type`, `layout`,
// `relations`, ...) alongside standard JSON Schema ones, so strict mode
// (which rejects unknown keywords) has to stay off.
const ajv = new Ajv2020({ allErrors: true, strict: false, verbose: true });
addFormats(ajv);

const validatorCache = new WeakMap<GisSchema, ValidateFunction>();

function getValidator(schema: GisSchema): ValidateFunction {
  let validate = validatorCache.get(schema);
  if (!validate) {
    validate = ajv.compile(schema);
    validatorCache.set(schema, validate);
  }
  return validate;
}

export type ValidationIssueKind =
  | "required"
  | "type"
  | "enum"
  | "format"
  | "conditional"
  | "unrecognized"
  | "other";

export interface ValidationIssue {
  kind: ValidationIssueKind;
  propertyKey: string;
  message: string;
  severity: "error" | "warning";
}

export interface FeatureValidationResult {
  featureIndex: number;
  issues: ValidationIssue[];
}

export interface SchemaValidationSummary {
  totalFeatures: number;
  validFeatures: number;
  featuresWithErrors: number;
  featuresWithWarnings: number;
}

function classifyKind(error: ErrorObject): ValidationIssueKind {
  if (
    error.schemaPath.includes("/dependentSchemas/") ||
    error.schemaPath.includes("/dependentRequired/")
  ) {
    return "conditional";
  }
  switch (error.keyword) {
    case "required":
      return "required";
    case "enum":
    case "const":
      return "enum";
    case "type":
      return "type";
    case "format":
      return "format";
    default:
      return "other";
  }
}

function propertyKeyOf(error: ErrorObject): string {
  if (typeof error.params.missingProperty === "string") return error.params.missingProperty;
  const path = error.instancePath.replace(/^\//, "");
  return path || "(feature)";
}

function describeError(error: ErrorObject, propertyKey: string, schema: GisSchema): string {
  const title = schema.properties[propertyKey]?.title;
  const label = title ? `${title} (${propertyKey})` : propertyKey;
  switch (error.keyword) {
    case "required":
      return `"${label}" is required.`;
    case "enum":
      return `"${label}" must be one of: ${(error.params.allowedValues as unknown[]).map(String).join(", ")}. Got ${JSON.stringify(error.data)}.`;
    case "type":
      return `"${label}" should be of type ${error.params.type as string}. Got ${JSON.stringify(error.data)}.`;
    case "format":
      return `"${label}" doesn't match the expected format "${error.params.format as string}".`;
    default:
      return `"${label}" ${error.message ?? "is invalid"}.`;
  }
}

export function validateFeatureCollection(
  featureCollection: GeoJSON.FeatureCollection,
  schema: GisSchema,
): FeatureValidationResult[] {
  const validate = getValidator(schema);
  const results: FeatureValidationResult[] = [];

  featureCollection.features.forEach((feature, featureIndex) => {
    const properties = feature.properties ?? {};
    const issues: ValidationIssue[] = [];

    if (!validate(properties)) {
      for (const error of validate.errors ?? []) {
        const propertyKey = propertyKeyOf(error);
        issues.push({
          kind: classifyKind(error),
          propertyKey,
          message: describeError(error, propertyKey, schema),
          severity: "error",
        });
      }
    }

    for (const key of Object.keys(properties)) {
      if (INTERNAL_PROPERTY_KEYS.has(key) || key in schema.properties) continue;
      issues.push({
        kind: "unrecognized",
        propertyKey: key,
        message: `"${key}" isn't a property in this schema.`,
        severity: "warning",
      });
    }

    if (issues.length > 0) results.push({ featureIndex, issues });
  });

  return results;
}

export function summarizeValidation(
  totalFeatures: number,
  results: FeatureValidationResult[],
): SchemaValidationSummary {
  let featuresWithErrors = 0;
  let featuresWithWarnings = 0;
  for (const result of results) {
    if (result.issues.some((issue) => issue.severity === "error")) featuresWithErrors++;
    else featuresWithWarnings++;
  }
  return {
    totalFeatures,
    featuresWithErrors,
    featuresWithWarnings,
    validFeatures: totalFeatures - featuresWithErrors - featuresWithWarnings,
  };
}
