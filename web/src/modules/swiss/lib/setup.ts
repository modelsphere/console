import type { Session } from "@swiss/lib/api";

// setupRedirect is where the gate sends a logged-in page, or null to render it.
//
// Setup is the first run and nothing else. It writes over whatever is stored,
// so a site that has a profile never lands there, typed URL included: it goes
// to the site profile page, where that profile is edited. So does a profile
// that does not parse, or could not be read -- that page opens on the stored
// document, or says why it could not.
export function setupRedirect(s: Session, pathname: string): string | null {
  // A swissd older than setUp only says initialized, and sent every profile it
  // could not use to setup.
  const setUp = s.setUp ?? s.initialized;
  const onSetup = pathname.endsWith("/setup");
  if (!setUp) return onSetup ? null : "/setup";
  if (onSetup || (!s.initialized && !pathname.endsWith("/site-profile"))) return "/site-profile";
  return null;
}
