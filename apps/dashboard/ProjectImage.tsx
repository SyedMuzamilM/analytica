import { useRef, useState } from "react";
import { Button } from "@cloudflare/kumo/components/button";
import { Upload } from "lucide-react";
import type { Site } from "../../packages/contracts";
import { friendlyError } from "./api";
import { ProjectIcon } from "./ProjectsView";

export function ProjectImage({
  site,
  canEdit,
  demo,
  onChanged,
  notify,
}: {
  site: Site;
  canEdit: boolean;
  demo: boolean;
  onChanged: (site: Site) => void;
  notify: (message: string) => void;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  async function upload(image: File) {
    if (demo) {
      notify("Create an account to customize your project.");
      return;
    }
    if (image.size > 49152) {
      notify("Choose a PNG, JPEG or WebP image smaller than 48 KB.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(
        `/api/workspaces/${site.workspaceId}/sites/${site.id}/logo`,
        {
          method: "PUT",
          headers: { "Content-Type": image.type },
          body: image,
          credentials: "same-origin",
        },
      );
      if (!response.ok) {
        const body: unknown = await response.json();
        throw new Error(
          typeof body === "object" &&
            body !== null &&
            "error" in body &&
            typeof body.error === "string"
            ? body.error
            : "The upload failed. Try again.",
        );
      }
      onChanged(await response.json());
      notify("Project logo updated.");
    } catch (error) {
      notify(friendlyError(error));
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  }
  return (
    <section className="panel settings-panel project-logo-panel">
      <div>
        <ProjectIcon site={site} />
        <span>
          <h2>Project identity</h2>
          <p>A recognizable image for {site.name}.</p>
        </span>
      </div>
      <p>
        PNG, JPEG or WebP, up to 48 KB. Images are private to workspace members.
      </p>
      {canEdit && (
        <>
          <input
            ref={file}
            className="sr-only"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            aria-label="Project logo"
            onChange={(e) => {
              const image = e.target.files?.[0];
              if (image) void upload(image);
            }}
          />
          <Button
            variant="secondary"
            loading={busy}
            onClick={() => file.current?.click()}
          >
            <Upload size={15} />
            Upload logo
          </Button>
        </>
      )}
    </section>
  );
}
