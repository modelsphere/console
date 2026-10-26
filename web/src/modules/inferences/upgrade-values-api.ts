import { api, type RevisionValues } from "@swiss/lib/api";
import { UpgradeValuesError } from "./upgrade-values";

export async function assertUpgradeRevision(namespace: string, release: string, revision: number) {
  const current = await api.status(namespace, release);
  if (!current.exists || current.revision !== revision) throw new UpgradeValuesError("changed");
}

export async function readUpgradeValues(namespace: string, release: string): Promise<RevisionValues> {
  const current = await api.status(namespace, release);
  if (!current.exists || !Number.isInteger(current.revision) || current.revision <= 0) throw new UpgradeValuesError("missing");
  const values = await api.revisionValues(namespace, release, current.revision);
  if (values.namespace !== namespace || values.release !== release || values.revision !== current.revision || typeof values.all !== "string") throw new UpgradeValuesError("unavailable");
  await assertUpgradeRevision(namespace, release, current.revision);
  return values;
}
