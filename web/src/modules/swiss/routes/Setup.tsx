import { useNavigate } from "@swiss/lib/host";
import { useQuery } from "@tanstack/react-query";
import { api } from "@swiss/lib/api";
import { HoverHint } from "@swiss/components/ui/hint";
import { ErrorState, Loading } from "@swiss/components/States";
import { ProfileEditor } from "@swiss/components/ProfileEditor";

// Setup is the first run: swissd owns the site profile, the chart writes none,
// so a fresh install has nothing to compose against until this is filled in.
//
// Pre-filled from the server's own default rather than from a blank page: the
// answer to "what goes in here" is most of the work, and the default is a
// working profile with the reasoning beside each field.
//
// Only a site with nothing stored gets here -- the gate sends every other one to
// the site profile page -- so there is no stored document to start from.
export function Setup() {
  const navigate = useNavigate();
  const template = useQuery({ queryKey: ["profileTemplate"], queryFn: api.profileTemplate });

  // Not logged in is the gate's business; this page is always rendered inside
  // it. Navigating from a render body here would be a second answer to one
  // question.
  if (template.isPending) return <Loading what="the setup" />;
  if (template.error) return <ErrorState what="the setup" error={template.error} />;

  // The server's own default failing to parse is a bug in swissd, not something
  // this page can seed around.
  if (!template.data.profile) {
    return <ErrorState what="the setup" error={new Error("the default profile does not parse")} />;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-8">
      <div>
        <h1 className="text-xl font-semibold">Set up this cluster</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The site profile is the cluster-shaped layer: what the public catalog cannot know
          and a deploy form should not have to retype — where charts come from, where weights
          sit on disk, which entrypoint publishes a route. swissd writes it to a ConfigMap in
          this cluster and composes every deploy against it.
        </p>
      </div>

      <div className="space-y-3">
        <h2>
          <HoverHint text="Pre-filled with a working default. Everything here can be changed later on the Site profile page.">
            <span className="text-base font-semibold">Site profile</span>
          </HoverHint>
        </h2>
        <ProfileEditor
          profile={template.data.profile}
          yaml={template.data.yaml ?? ""}
          submitLabel="Save and start"
          onSaved={() => navigate("/", { replace: true })}
        />
      </div>
    </div>
  );
}
