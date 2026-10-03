import type { CatalogInfo } from "@swiss/lib/api";

// The catalogs a release may move to, by swissd's checkMove: the same HF repo.
// A plan without hf takes it from its own catalog by name or location, never
// the default -- which may be another catalog with the same model name.
export function movableCatalogs(
  catalogs: CatalogInfo[],
  source: { catalog?: string; catalogName?: string; hf?: string },
  own: string | undefined,
  hfIn: (catalog: string | undefined) => string | undefined,
): { hf?: string; movable: string[] } {
  const ownByIdentity = source.catalogName ?? catalogs.find((c) => c.source === source.catalog)?.name;
  const hf = source.hf || hfIn(ownByIdentity);
  if (!hf) return { movable: [] };
  return { hf, movable: catalogs.map((c) => c.name).filter((n) => n !== own && hfIn(n) === hf) };
}
