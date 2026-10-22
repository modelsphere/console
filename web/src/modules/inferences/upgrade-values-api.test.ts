import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@swiss/lib/api";
import { assertUpgradeRevision, readUpgradeValues } from "./upgrade-values-api";

vi.mock("@swiss/lib/api", () => ({ api: { status: vi.fn(), revisionValues: vi.fn() } }));
const status = vi.mocked(api.status);
const values = vi.mocked(api.revisionValues);
const running = { exists: true, revision: 7 } as Awaited<ReturnType<typeof api.status>>;
const snapshot = { namespace: "models", release: "model", revision: 7, all: "replicaCount: 2\n", supplied: "" };

beforeEach(() => {
  vi.resetAllMocks();
  status.mockResolvedValue(running);
  values.mockResolvedValue(snapshot);
});

describe("current upgrade values snapshot", () => {
  it("reads actual Helm merged values for the current revision and verifies it remained current", async () => {
    expect(await readUpgradeValues("models", "model")).toEqual(snapshot);
    expect(values).toHaveBeenCalledWith("models", "model", 7);
    expect(status).toHaveBeenCalledTimes(2);
  });

  it.each([{ exists: false, revision: 0 }, { exists: true, revision: 0 }, { exists: true, revision: -1 }])("does not invent values when no current revision exists", async (state) => {
    status.mockResolvedValue(state as typeof running);
    await expect(readUpgradeValues("models", "model")).rejects.toMatchObject({ code: "missing" });
    expect(values).not.toHaveBeenCalled();
  });

  it("rejects a revision that changes while its values are read", async () => {
    status.mockResolvedValueOnce(running).mockResolvedValueOnce({ ...running, revision: 8 });
    await expect(readUpgradeValues("models", "model")).rejects.toMatchObject({ code: "changed" });
  });

  it.each([{ namespace: "another" }, { release: "another" }, { revision: 8 }, { all: undefined }])("rejects values for a different or invalid snapshot", async (patch) => {
    values.mockResolvedValue({ ...snapshot, ...patch } as typeof snapshot);
    await expect(readUpgradeValues("models", "model")).rejects.toMatchObject({ code: "unavailable" });
  });

  it("preserves source errors so the UI can show a retry state", async () => {
    values.mockRejectedValue(new Error("values read failed"));
    await expect(readUpgradeValues("models", "model")).rejects.toThrow("values read failed");
  });

  it("refuses composition against an old revision instead of overwriting newer state", async () => {
    status.mockResolvedValue({ ...running, revision: 8 });
    await expect(assertUpgradeRevision("models", "model", 7)).rejects.toMatchObject({ code: "changed" });
  });
});
