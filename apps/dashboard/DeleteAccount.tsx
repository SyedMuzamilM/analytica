import { useRef, useState, useEffect, type FormEvent } from "react";
import { startAuthentication } from "@simplewebauthn/browser";
import { Button } from "@cloudflare/kumo/components/button";
import { Input } from "@cloudflare/kumo/components/input";
import { Fingerprint, Trash2, X } from "lucide-react";
import type { AuthStatus } from "../../packages/contracts";
import { api, friendlyError, post } from "./api";

function DeletionDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const current = dialog.current;
    current?.showModal();
    return () => current?.close();
  }, []);
  async function remove(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const before = await api<AuthStatus>("/api/auth/status");
      const options = await post<{
        challengeId: string;
        options: Parameters<typeof startAuthentication>[0]["optionsJSON"];
      }>("/api/auth/login/options");
      const response = await startAuthentication({
        optionsJSON: options.options,
      });
      await post("/api/auth/login/verify", {
        challengeId: options.challengeId,
        response,
      });
      const after = await api<AuthStatus>("/api/auth/status");
      if (!before.user || after.user?.id !== before.user.id)
        throw new Error(
          "That passkey belongs to a different account. Close this dialog and sign in to the account you want to delete.",
        );
      await api("/api/auth/account", {
        method: "DELETE",
        body: JSON.stringify({ confirmation }),
      });
      window.location.assign("/login?deleted=1");
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="modal"
      aria-label="Delete your account"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="modal-heading">
        <h2>Delete your account</h2>
        <Button
          shape="square"
          variant="ghost"
          aria-label="Close dialog"
          disabled={busy}
          onClick={onClose}
        >
          <X size={18} />
        </Button>
      </div>
      <form className="deletion-form" onSubmit={remove}>
        <p>
          This removes your passkeys, recovery codes and sessions immediately.
          Projects in workspaces where you are the only owner stop collecting
          and enter background deletion. Shared-owner workspaces stay with their
          other owners. This cannot be undone.
        </p>
        <Input
          label="Type DELETE to confirm"
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          required
          pattern="DELETE"
          autoComplete="off"
        />
        {error && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}
        <Button
          type="submit"
          variant="destructive"
          disabled={confirmation !== "DELETE"}
          loading={busy}
        >
          <Fingerprint size={16} />
          Verify passkey and delete account
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={onClose}
        >
          Keep my account
        </Button>
      </form>
    </dialog>
  );
}
export function DeleteAccount({ demo }: { demo: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="panel settings-panel deletion-panel">
      <h2>Delete your account</h2>
      <p>
        Finished testing? You can permanently remove this account. Your
        credentials are deleted immediately, and your owned projects, analytics
        and uploaded images are scheduled for cleanup.
      </p>
      <Button
        variant="secondary-destructive"
        disabled={demo}
        onClick={() => setOpen(true)}
      >
        <Trash2 size={15} />
        Delete account
      </Button>
      {open && <DeletionDialog onClose={() => setOpen(false)} />}
    </section>
  );
}
