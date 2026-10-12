import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ResourceTable } from "./resource-table";

const data = [{ id: "qwen", name: "Qwen3" }];
const columns = [{ key: "name", title: "Model" }];

function render(pagination?: boolean) {
  return renderToStaticMarkup(
    <ResourceTable data={data} columns={columns} rowKey="id" pagination={pagination} showColumnToggle={false} />,
  );
}

describe("resource table previews", () => {
  it("keeps normal resource pages at their default empty size", () => {
    const html = renderToStaticMarkup(
      <ResourceTable data={[]} columns={columns} rowKey="id" showColumnToggle={false} />,
    );
    expect(html).toContain("px-0 py-14");
  });

  it.each([null, new Error("preview-read-failed")])("uses compact spacing for empty or failed previews", (error) => {
    const html = renderToStaticMarkup(
      <ResourceTable
        data={[]}
        columns={columns}
        rowKey="id"
        emptySize="compact"
        error={error}
        showColumnToggle={false}
      />,
    );
    expect(html).toContain("px-0 py-6");
    expect(html).toContain("gap-3 p-0 md:p-0");
    expect(html).not.toContain("py-14");
  });
  it("keeps pagination visible by default", () => {
    expect(render()).toContain('data-slot="pagination"');
  });

  it("does not slice supplied rows when pagination is disabled", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ id: String(i), name: `model-${i}` }));
    const html = renderToStaticMarkup(
      <ResourceTable data={rows} columns={columns} rowKey="id" pagination={false} showColumnToggle={false} />,
    );
    for (const row of rows) expect(html).toContain(row.name);
  });

  it("hides pagination for a bounded dashboard preview without hiding its rows", () => {
    const html = render(false);
    expect(html).toContain("Qwen3");
    expect(html).not.toContain('data-slot="pagination"');
    expect(html).toContain("border-border bg-card");
  });
});
