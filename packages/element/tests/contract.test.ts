// The element publishes plain copies of the contract types (`src/contract.ts`), because
// `@bcd-embed/schema` is private and defines its types with Zod. These checks run in the type
// checker: `pnpm typecheck` fails when a copy and its schema namesake stop being assignable to
// each other in both directions. The Vitest case only makes the file count as a test.
import type * as Schema from "@bcd-embed/schema";
import { describe, expect, it } from "vitest";

import type * as Contract from "../src/contract.js";

/** `true` when each type is assignable to the other, `false` otherwise. */
type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/** Compiles only when its type argument is `true`. */
const same = <Check extends true>(): Check | undefined => undefined;

describe("the published contract types", () => {
  it("match @bcd-embed/schema in both directions", () => {
    const checks = [
      same<MutuallyAssignable<Contract.ContractVersion, Schema.ContractVersion>>(),
      same<MutuallyAssignable<Contract.SupportTargetType, Schema.SupportTargetType>>(),
      same<MutuallyAssignable<Contract.SupportState, Schema.SupportState>>(),
      same<MutuallyAssignable<Contract.SupportFlag, Schema.SupportFlag>>(),
      same<MutuallyAssignable<Contract.SupportStatement, Schema.SupportStatement>>(),
      same<MutuallyAssignable<Contract.SupportBranch, Schema.SupportBranch>>(),
      same<MutuallyAssignable<Contract.SupportSummary, Schema.SupportSummary>>(),
      same<MutuallyAssignable<Contract.SupportTargetSupport, Schema.SupportTargetSupport>>(),
      same<MutuallyAssignable<Contract.SupportTarget, Schema.SupportTarget>>(),
      same<MutuallyAssignable<Contract.FeatureStatus, Schema.FeatureStatus>>(),
      same<MutuallyAssignable<Contract.Feature, Schema.Feature>>(),
      same<MutuallyAssignable<Contract.FeatureResponse, Schema.FeatureResponse>>(),
      // The check can fail: a summary that lost its `hasNotes` field is no longer the schema's.
      // @ts-expect-error The two types differ, so the check rejects them.
      same<MutuallyAssignable<Omit<Contract.SupportSummary, "hasNotes">, Schema.SupportSummary>>(),
    ];

    expect(checks).toHaveLength(13);
  });
});
