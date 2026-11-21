import { createRequire } from "node:module";

import type { CompatData } from "@mdn/browser-compat-data/types";
import { featureResponseSchema, type FeatureResponse } from "@bcd-embed/schema";
import { describe, expect, it } from "vitest";

import {
  EXAMPLES,
  HomeDataError,
  LIVE_EXAMPLE,
  buildFeatureResponse,
  buildHomePageData,
  dataScriptId,
  findMdnUrl,
  findSubtree,
  toScriptJson,
} from "../src/data/examples.js";
import { HOSTILE_NOTE } from "./hostile-note.js";

const require = createRequire(import.meta.url);
const bcd: CompatData = require("@mdn/browser-compat-data");

describe("the four examples", () => {
  it("are the owner's four keys, in the order of the radio inputs", () => {
    expect(EXAMPLES.map(({ id, label, key }) => [id, label, key])).toEqual([
      ["html", "HTML", "html.elements.video.loading"],
      ["css", "CSS", "css.properties.line-clamp"],
      ["javascript", "JavaScript", "javascript.builtins.Error.isError"],
      ["api", "Web API", "api.Navigator.share"],
    ]);
  });

  it.each(EXAMPLES.map((example) => [example.key]))(
    "builds a feature response for %s that validates against the contract",
    (key) => {
      const payload = buildFeatureResponse(bcd, key);
      expect(featureResponseSchema.safeParse(payload).success).toBe(true);
      expect(payload.query).toBe(key);
      expect(payload.features[0]?.key).toBe(key);
    },
  );

  it("shows a partial implementation in the JavaScript example's Safari or Node.js data", () => {
    const payload = buildFeatureResponse(bcd, "javascript.builtins.Error.isError");
    const partial = ["safari", "nodejs"].flatMap((target) =>
      (payload.features[0]?.support[target]?.branches ?? []).flatMap((branch) =>
        branch.statements.filter((statement) => statement.partialImplementation),
      ),
    );
    expect(partial.length).toBeGreaterThan(0);
  });

  it("fails when BCD has no feature at one of the keys", () => {
    // A shallow copy of the path down to the key, so the installed data stays untouched.
    const properties: Record<string, unknown> = { ...bcd.css.properties };
    delete properties["line-clamp"];
    const withoutLineClamp = { ...bcd, css: { ...bcd.css, properties } } as unknown as CompatData;
    expect(() => buildHomePageData(withoutLineClamp)).toThrow(HomeDataError);
    expect(() => buildHomePageData(withoutLineClamp)).toThrow(/css\.properties\.line-clamp/);
  });

  it("fails for a key that names a namespace or an inherited property, not a feature", () => {
    expect(() => findSubtree(bcd, "css.properties")).toThrow(HomeDataError);
    expect(() => findSubtree(bcd, "javascript.builtins.constructor")).toThrow(HomeDataError);
    expect(() => findSubtree(bcd, "javascript.builtins.Error.toString.call")).toThrow(
      HomeDataError,
    );
  });

  it("links a feature without its own MDN page to its nearest ancestor's page", () => {
    expect(findSubtree(bcd, "html.elements.video.loading").__compat?.mdn_url).toBeUndefined();
    const video = findSubtree(bcd, "html.elements.video").__compat?.mdn_url;
    expect(video).toBeDefined();
    expect(findMdnUrl(bcd, "html.elements.video.loading")).toBe(`${video}#browser_compatibility`);
    const lineClamp = findSubtree(bcd, "css.properties.line-clamp").__compat?.mdn_url;
    expect(findMdnUrl(bcd, "css.properties.line-clamp")).toBe(`${lineClamp}#browser_compatibility`);
  });

  it("reads the BCD version and checks the live table's key", () => {
    const data = buildHomePageData(bcd);
    expect(data.bcdVersion).toBe(bcd.__meta.version);
    expect(data.examples).toHaveLength(4);
    expect(data.live.key).toBe(LIVE_EXAMPLE.key);
    expect(data.live.mdnUrl).toMatch(
      /^https:\/\/developer\.mozilla\.org\/.+#browser_compatibility$/,
    );
  });
});

describe("toScriptJson", () => {
  const withHostileNote = (): FeatureResponse => {
    const payload = structuredClone(buildFeatureResponse(bcd, "css.properties.line-clamp"));
    const statement = payload.features[0]?.support.chrome?.branches[0]?.statements[0];
    if (statement === undefined) throw new Error("The line-clamp payload has no Chrome statement.");
    statement.notes = [HOSTILE_NOTE];
    return payload;
  };

  it("writes every < as the six characters \\u003c, and JSON.parse restores the note", () => {
    const payload = withHostileNote();
    const text = toScriptJson(payload);
    expect(text).not.toContain("<");
    expect(text).toContain("\\u003c/script>\\u003cscript>alert(1)");
    expect(text).toContain("\\u003c!--\\u003cscript>");
    const parsed = JSON.parse(text) as FeatureResponse;
    expect(parsed.features[0]?.support.chrome?.branches[0]?.statements[0]?.notes).toEqual([
      HOSTILE_NOTE,
    ]);
    expect(parsed).toEqual(payload);
  });

  it("escapes the markup that real BCD notes contain", () => {
    const payload = buildFeatureResponse(bcd, "javascript.builtins.Error.isError");
    const json = JSON.stringify(payload);
    expect(json).toContain("<code>");
    const text = toScriptJson(payload);
    expect(text).not.toContain("<");
    expect(JSON.parse(text)).toEqual(payload);
  });
});

describe("dataScriptId", () => {
  it("writes each dot of the key as a dash after bcd-data-", () => {
    expect(dataScriptId("css.properties.line-clamp")).toBe("bcd-data-css-properties-line-clamp");
  });
});
