// The element publishes plain copies of the contract types (`src/contract.ts`), because
// `@bcd-embed/schema` is private and defines its types with Zod. These checks run in the type
// checker: `pnpm typecheck` fails when a copy and its schema namesake are not the same type. The
// Vitest case only makes the file count as a test.
import type * as Schema from "@bcd-embed/schema";
import { describe, expect, it } from "vitest";

import type * as Contract from "../src/contract.js";

/**
 * Rewrites a type as plain nested object types, member by member, so that two spellings of one
 * shape compare equal: `contract.ts` writes some objects as intersections, and Zod writes its own
 * as mapped types. It distributes over unions, maps arrays to arrays, and keeps `readonly` and `?`
 * on every property, because a homomorphic mapped type copies those modifiers.
 */
type Normalize<T> = T extends object ? { [Key in keyof T]: Normalize<T[Key]> } : T;

/**
 * `true` only when the two types are identical, not merely assignable to each other. Mutual
 * assignability would accept a copy that gained an optional property or lost a `readonly`; this
 * comparison of two generic functions does not, because TypeScript relates them only when their
 * conditional types are identical.
 */
type Equal<A, B> =
  (<T>() => T extends Normalize<A> ? 1 : 2) extends <T>() => T extends Normalize<B> ? 1 : 2
    ? true
    : false;

/** Compiles only when its type argument is `true`. */
const same = <Check extends true>(): Check | undefined => undefined;

describe("the published contract types", () => {
  it("are identical to the types in @bcd-embed/schema", () => {
    const checks = [
      same<Equal<Contract.ContractVersion, Schema.ContractVersion>>(),
      same<Equal<Contract.SupportTargetType, Schema.SupportTargetType>>(),
      same<Equal<Contract.SupportState, Schema.SupportState>>(),
      same<Equal<Contract.SupportFlag, Schema.SupportFlag>>(),
      same<Equal<Contract.SupportStatement, Schema.SupportStatement>>(),
      same<Equal<Contract.SupportBranch, Schema.SupportBranch>>(),
      same<Equal<Contract.SupportSummary, Schema.SupportSummary>>(),
      same<Equal<Contract.SupportTargetSupport, Schema.SupportTargetSupport>>(),
      same<Equal<Contract.SupportTarget, Schema.SupportTarget>>(),
      same<Equal<Contract.FeatureStatus, Schema.FeatureStatus>>(),
      same<Equal<Contract.Feature, Schema.Feature>>(),
      same<Equal<Contract.FeatureResponse, Schema.FeatureResponse>>(),
      // The check can fail. Each line below differs from the schema in one way that mutual
      // assignability would let through.
      // @ts-expect-error An added optional property makes the types differ.
      same<Equal<Contract.SupportTarget & { extra?: string }, Schema.SupportTarget>>(),
      // @ts-expect-error A `readonly` property makes the types differ.
      same<Equal<Readonly<Contract.FeatureStatus>, Schema.FeatureStatus>>(),
      // @ts-expect-error A removed property makes the types differ.
      same<Equal<Omit<Contract.SupportFlag, "valueToSet">, Schema.SupportFlag>>(),
    ];

    expect(checks).toHaveLength(15);
  });
});
