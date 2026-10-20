import { useQuery } from "@tanstack/react-query";
import { api } from "@swiss/lib/api";
import { catalogTokenKey, initState, listSecrets } from "@/modules/inferences/catalog-write-api";
import { markedWritable } from "@/modules/inferences/catalog-write-lib";

// What the pages may do with a catalog: edit it once it is set up, or set it
// up while its repository is empty. Both need the profile's writable mark and
// a token in swissd's Secret.
export function useCatalogWrite(catalog: string) {
  const profile = useQuery({ queryKey: ["profile"], queryFn: api.profile, retry: false });
  const marked = markedWritable(profile.data?.profile, catalog);
  const secrets = useQuery({ queryKey: ["secrets"], queryFn: listSecrets, enabled: marked, retry: false });
  const tokenSet = !!secrets.data?.keys.includes(catalogTokenKey(catalog));
  const init = useQuery({ queryKey: ["catalog-init", catalog], queryFn: () => initState(catalog), enabled: marked && tokenSet, retry: false });
  return {
    marked,
    missingToken: marked && !!secrets.data && !tokenSet,
    editable: marked && tokenSet && init.data?.initialized === true,
    setupable: marked && tokenSet && init.data?.initialized === false,
    initError: marked && tokenSet ? init.error : null,
    // Where the catalog is read: what a set-up catalog says it is served at, to start from.
    url: profile.data?.profile?.catalogs?.find((c) => c.name === catalog)?.url,
  };
}
