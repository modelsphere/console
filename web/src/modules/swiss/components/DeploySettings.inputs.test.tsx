import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DeploySettings, EMPTY } from "./DeploySettings";

describe("dropped catalog inputs", () => {
  it("lists deprecated and broken keys with their old values", () => {
    const html = renderToStaticMarkup(
      <DeploySettings
        form={EMPTY}
        onChange={() => {}}
        droppedInputs={[
          { key: "old.flag", value: "gone", reason: "deprecated" },
          { key: "volumes.[name=nope].path", value: "/old", reason: "broken" },
        ]}
      />,
    );
    expect(html).toContain("No longer an input: old.flag (gone)");
    expect(html).toContain("Does not match this variant: volumes.[name=nope].path (/old)");
  });
});
