import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { consumePendingAction } from "@admin/spotlight/pendingAction";
import type { ChangeEvent } from "react";
import { Button } from "@ui/components/Button";
import { UploadIcon } from "pixel-art-icons/icons/upload";
import {
  getEditorActivationErrors,
  subscribeEditorActivationErrors,
} from "./hooks/editorPluginActivationErrors";
import { subscribePluginEvents } from "./utils/pluginEventStream";
import type {
  CmsPluginsPayload,
  InstalledPlugin,
  PluginManifest,
  PluginPermission,
} from "@core/plugin-sdk";
import {
  collectEnabledAdminPages,
  parsePluginManifest,
} from "@core/plugins/manifest";
import { PluginCard } from "./components/PluginCard/PluginCard";
import { PluginRemoveDialog } from "./components/PluginRemoveDialog/PluginRemoveDialog";
import { PermissionReviewSection } from "./components/PermissionReviewSection";
import {
  inspectCmsPluginPackage,
  installCmsPluginPackage,
  installCmsPluginManifest,
  installCmsPluginPack,
  listCmsPlugins,
  removeCmsPlugin,
  restartCmsPlugin,
  setCmsPluginEnabled,
} from "@core/persistence";
import { AdminPageLayout } from "@admin/layouts";
import { notifyCmsPluginsChanged } from "./utils/pluginEvents";
import { CMS_SITE_RELOAD_EVENT } from "@site/hooks/usePersistence";
import { PluginSettingsDialog } from "./components/PluginSettingsDialog/PluginSettingsDialog";
import { PluginSchedulesDialog } from "./components/PluginSchedulesDialog/PluginSchedulesDialog";
import { StepUpCancelledMessage, useStepUp } from "@admin/shared/StepUp";
import styles from "./PluginsPage.module.css";

function notifyCmsSiteReload(): void {
  window.dispatchEvent(new Event(CMS_SITE_RELOAD_EVENT));
}

/**
 * Heuristic — does this error message look like it came from the plugin
 * sandbox layer? The install-time literal scan and the QuickJS runtime
 * both surface specific phrases; if any are present, we attach a "learn
 * more" link to `docs/plugins/sandbox.md` so the site owner has a clear
 * next step beyond the bare error.
 */
function isSandboxRelatedError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('sandbox') ||
    lower.includes("'node:") ||
    lower.includes('"node:') ||
    lower.includes("'bun:") ||
    lower.includes("could not load module") ||
    lower.includes('forbidden literal') ||
    lower.includes('requires permission') ||
    lower.includes('networkallowedhosts')
  );
}

const emptyPayload: CmsPluginsPayload = { plugins: [], adminPages: [] };

interface PendingInstall {
  manifest: PluginManifest;
  file?: File;
  /**
   * If set, this upload upgrades an already-installed plugin from the given
   * version to `manifest.version`. The dialog renders upgrade-aware copy
   * ("Update X from 1.0.0 to 1.1.0") and the confirm button reflects the
   * verb. The host detects upgrades server-side independently — this flag
   * exists purely so the UI can show the delta before the user clicks
   * confirm.
   */
  upgradeFromVersion?: string;
  /**
   * Permissions the user previously granted to the existing install. Used to
   * compute the diff against the new manifest's requested permissions:
   *   • `manifest.permissions ∩ previouslyGranted` — already approved (no re-confirmation needed, but we still show them so the user has full context).
   *   • `manifest.permissions \ previouslyGranted` — NEW in this upgrade. These are the ones we highlight prominently.
   *   • `previouslyGranted \ manifest.permissions` — dropped (the new manifest no longer requests them; they get auto-revoked).
   */
  previouslyGrantedPermissions?: PluginPermission[];
}

function updatePlugin(
  payload: CmsPluginsPayload,
  plugin: InstalledPlugin,
): CmsPluginsPayload {
  const existing = payload.plugins.findIndex(
    (candidate) => candidate.id === plugin.id,
  );
  const plugins =
    existing === -1
      ? [plugin, ...payload.plugins]
      : payload.plugins.map((candidate) =>
          candidate.id === plugin.id ? plugin : candidate,
        );
  const adminPages = collectEnabledAdminPages(plugins);
  return { plugins, adminPages };
}

export function PluginsPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { runStepUp } = useStepUp();

  // Auto-open the file picker when the spotlight queued a `plugins.install`
  // action from another workspace. Defer to the next tick so the input ref
  // is mounted before we trigger .click() on it.
  useEffect(() => {
    const pending = consumePendingAction("plugins.install");
    if (!pending) return;
    const id = setTimeout(() => fileInputRef.current?.click(), 0);
    return () => clearTimeout(id);
  }, []);

  const [payload, setPayload] = useState<CmsPluginsPayload>(emptyPayload);
  const [loading, setLoading] = useState(true);
  const [busyPluginId, setBusyPluginId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingInstall, setPendingInstall] = useState<PendingInstall | null>(
    null,
  );
  const [settingsPluginId, setSettingsPluginId] = useState<string | null>(null);
  const [schedulesPluginId, setSchedulesPluginId] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<InstalledPlugin | null>(null);

  // Editor-side activation failures (per pluginId → error message). Populated
  // by `useInstalledEditorPlugins` after each refresh; surfaced on the plugin
  // card alongside the server-side `lastError`.
  const editorActivationErrors = useSyncExternalStore(
    subscribeEditorActivationErrors,
    getEditorActivationErrors,
    getEditorActivationErrors,
  );

  async function loadPlugins() {
    setLoading(true);
    setError(null);
    try {
      setPayload(await listCmsPlugins());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load plugins");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadPlugins();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  // Live refresh — when ANY plugin event arrives (crash, recovered, parked,
  // restarted, installed, updated, uninstalled, enabled, disabled), re-fetch
  // the list so the user sees the latest state without leaving the page. The
  // EventSource is shared across consumers (PluginsNavBadge, toast bridge)
  // so we don't open one socket per subscriber.
  useEffect(() => {
    const unsubscribe = subscribePluginEvents(() => {
      void loadPlugins();
    });
    return unsubscribe;
  }, []);

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;

    setUploading(true);
    setError(null);
    try {
      const manifest = file.name.toLowerCase().endsWith(".zip")
        ? await inspectCmsPluginPackage(file)
        : parsePluginManifest(JSON.parse(await file.text()));

      // Detect upgrade vs. fresh install client-side so we can render the
      // right copy in the confirmation dialog. The server detects upgrades
      // independently — this is purely a UX hint (and a way to force the
      // dialog to show even when no new permissions are being requested).
      const existing = payload.plugins.find((p) => p.id === manifest.id);
      const upgradeFromVersion =
        existing && existing.version !== manifest.version
          ? existing.version
          : undefined;
      // Previously-granted permissions on the existing install. The dialog
      // uses this to highlight NEW permissions in the upgrade so the site
      // owner can spot a permission expansion before clicking "Update".
      const previouslyGrantedPermissions = existing
        ? existing.grantedPermissions
        : undefined;

      // Always show the dialog for upgrades, even with zero new permissions.
      // The site owner deserves to see a "yes, upgrade 1.0.0 → 1.1.0"
      // confirmation before we replace a working plugin.
      if (manifest.permissions.length > 0 || upgradeFromVersion) {
        setPendingInstall({
          manifest,
          file: file.name.toLowerCase().endsWith(".zip") ? file : undefined,
          upgradeFromVersion,
          previouslyGrantedPermissions,
        });
      } else {
        await installPendingPlugin(
          {
            manifest,
            file: file.name.toLowerCase().endsWith(".zip") ? file : undefined,
          },
          [],
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not install plugin");
    } finally {
      setUploading(false);
    }
  }

  async function installPendingPlugin(
    pending: PendingInstall,
    grantedPermissions = pending.manifest.permissions,
  ) {
    setUploading(true);
    setError(null);
    try {
      // Installing / upgrading a plugin is a sensitive action — the server
      // requires a fresh `step_up` auth window. `runStepUp` runs the action
      // optimistically first; if the server replies `step_up_required`, it
      // pops a password-confirm dialog and retries.
      const result = await runStepUp(() =>
        pending.file
          ? installCmsPluginPackage(pending.file as File, grantedPermissions)
          : installCmsPluginManifest(pending.manifest, grantedPermissions),
      );
      if (result.plugins.length > 0) {
        setPayload({ plugins: result.plugins, adminPages: result.adminPages });
      } else if (result.plugin) {
        setPayload((current) =>
          updatePlugin(current, result.plugin as InstalledPlugin),
        );
      } else {
        await loadPlugins();
      }
      notifyCmsPluginsChanged();
      // Auto-install path on the server may have also imported the bundled
      // pack — refresh the editor's site state so any newly imported VCs /
      // pages / classes appear immediately.
      if (
        pending.manifest.pack &&
        grantedPermissions.includes("visualComponents.register")
      ) {
        notifyCmsSiteReload();
      }
      setPendingInstall(null);
    } catch (err) {
      // User dismissed the step-up dialog — treat as no-op, not an error.
      if (err instanceof Error && err.message === StepUpCancelledMessage) return;
      setError(err instanceof Error ? err.message : "Could not install plugin");
    } finally {
      setUploading(false);
    }
  }

  async function togglePlugin(plugin: InstalledPlugin) {
    setBusyPluginId(plugin.id);
    setError(null);
    try {
      const result = await runStepUp(() => setCmsPluginEnabled(plugin.id, !plugin.enabled));
      if (result.plugins.length > 0) {
        setPayload({ plugins: result.plugins, adminPages: result.adminPages });
      } else if (result.plugin) {
        setPayload((current) =>
          updatePlugin(current, result.plugin as InstalledPlugin),
        );
      }
      notifyCmsPluginsChanged();
    } catch (err) {
      if (err instanceof Error && err.message === StepUpCancelledMessage) return;
      setError(err instanceof Error ? err.message : "Could not update plugin");
    } finally {
      setBusyPluginId(null);
    }
  }

  /**
   * Manually restart a plugin parked in `error` state. Resets the host's
   * crash budget for this plugin, clears its historical crash events, then
   * re-loads + re-activates. Used from the "Restart" button on the plugin
   * card.
   */
  async function restartPlugin(plugin: InstalledPlugin) {
    setBusyPluginId(plugin.id);
    setError(null);
    try {
      const result = await runStepUp(() => restartCmsPlugin(plugin.id));
      if (result.plugins.length > 0) {
        setPayload({ plugins: result.plugins, adminPages: result.adminPages });
      } else if (result.plugin) {
        setPayload((current) =>
          updatePlugin(current, result.plugin as InstalledPlugin),
        );
      }
      notifyCmsPluginsChanged();
    } catch (err) {
      if (err instanceof Error && err.message === StepUpCancelledMessage) return;
      setError(err instanceof Error ? err.message : "Could not restart plugin");
    } finally {
      setBusyPluginId(null);
    }
  }

  async function installPluginPack(plugin: InstalledPlugin) {
    setBusyPluginId(plugin.id);
    setError(null);
    try {
      const summary = await runStepUp(() => installCmsPluginPack(plugin.id));
      const installedCount =
        summary.installed.visualComponents.length +
        summary.installed.pages.length +
        summary.installed.classes.length;
      const replacedCount =
        summary.replaced.visualComponents.length +
        summary.replaced.pages.length +
        summary.replaced.classes.length;
      setError(
        `Installed pack from ${plugin.name}: ${installedCount} item(s), ${replacedCount} replaced.`,
      );
      notifyCmsPluginsChanged();
      // The pack writes Visual Components, pages, and classes directly to the
      // draft site at the DB level. Tell the editor's persistence layer to
      // re-pull so the new content shows up in the Site Explorer / canvas
      // without a full browser reload.
      notifyCmsSiteReload();
    } catch (err) {
      if (err instanceof Error && err.message === StepUpCancelledMessage) return;
      setError(err instanceof Error ? err.message : "Could not install plugin pack");
    } finally {
      setBusyPluginId(null);
    }
  }

  async function executeRemovePlugin(plugin: InstalledPlugin) {
    setBusyPluginId(plugin.id);
    setError(null);
    try {
      await runStepUp(() => removeCmsPlugin(plugin.id));
      setPayload((current) => ({
        plugins: current.plugins.filter(
          (candidate) => candidate.id !== plugin.id,
        ),
        adminPages: current.adminPages.filter(
          (page) => page.pluginId !== plugin.id,
        ),
      }));
      notifyCmsPluginsChanged();
    } catch (err) {
      if (err instanceof Error && err.message === StepUpCancelledMessage) {
        return;
      }
      // The host's DELETE handler runs the plugin's `uninstall` lifecycle
      // hook, removes runtime registrations, drops the DB row, and deletes
      // the on-disk asset folder. If that flow returns an error we'd land
      // in a confusing state where the plugin row may have been deleted
      // server-side but the UI still shows it. Re-fetch the canonical list
      // so the card reflects reality regardless of the failure mode.
      setError(err instanceof Error ? err.message : "Could not remove plugin");
      await loadPlugins();
    } finally {
      setBusyPluginId(null);
    }
  }

  return (
    <AdminPageLayout
      workspace="plugins"
      title="Plugins"
      titleId="plugins-title"
      description="Install admin extensions and control what they add to the CMS."
      actions={(
        <>
          <Button
            variant="primary"
            size="md"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            <UploadIcon size={15} aria-hidden="true" />
            <span>{uploading ? "Uploading" : "Upload Plugin"}</span>
          </Button>
          <input
            ref={fileInputRef}
            className={styles.fileInput}
            aria-label="Plugin file"
            type="file"
            accept="application/json,.json,.plugin.json,.pbplugin,.zip,application/zip"
            onChange={(event) => void handleUpload(event)}
          />
        </>
      )}
    >
      <div className={styles.pluginsBody} data-testid="plugins-admin-canvas">
            {error && (
              <div role="alert">
                <p className={styles.error}>{error}</p>
                {isSandboxRelatedError(error) && (
                  <p className={styles.errorHint}>
                    This looks like a plugin sandbox issue. See the{' '}
                    <a
                      href="https://github.com/davidbabinec/page-builder/blob/main/docs/plugins/sandbox.md"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      sandbox documentation
                    </a>
                    {' '}for what's allowed inside plugin code.
                  </p>
                )}
              </div>
            )}

            {pendingInstall && (
              <PermissionReviewSection
                pending={pendingInstall}
                uploading={uploading}
                onCancel={() => setPendingInstall(null)}
                onConfirm={() => void installPendingPlugin(pendingInstall)}
              />
            )}

            <div className={styles.pluginsList} aria-label="Installed plugins">
              {loading ? (
                <p className={styles.emptyState}>Loading plugins...</p>
              ) : payload.plugins.length === 0 ? (
                <p className={styles.emptyState}>No plugins installed yet.</p>
              ) : (
                payload.plugins.map((plugin) => (
                  <PluginCard
                    key={plugin.id}
                    plugin={plugin}
                    busy={busyPluginId === plugin.id}
                    editorActivationError={editorActivationErrors[plugin.id]}
                    onOpenSettings={(p) => setSettingsPluginId(p.id)}
                    onOpenSchedules={(p) => setSchedulesPluginId(p.id)}
                    onInstallPack={(p) => void installPluginPack(p)}
                    onRestart={(p) => void restartPlugin(p)}
                    onToggle={(p) => void togglePlugin(p)}
                    onRemove={(p) => setPendingRemove(p)}
                  />
                ))
              )}
            </div>

            {settingsPluginId && (
              <PluginSettingsDialog
                pluginId={settingsPluginId}
                pluginName={
                  payload.plugins.find((p) => p.id === settingsPluginId)?.name ??
                  settingsPluginId
                }
                onClose={() => setSettingsPluginId(null)}
                onSaved={() => {
                  notifyCmsPluginsChanged();
                  void loadPlugins();
                }}
              />
            )}

            {schedulesPluginId && (
              <PluginSchedulesDialog
                pluginId={schedulesPluginId}
                pluginName={
                  payload.plugins.find((p) => p.id === schedulesPluginId)?.name ??
                  schedulesPluginId
                }
                onClose={() => setSchedulesPluginId(null)}
              />
            )}

            {pendingRemove && (
              <PluginRemoveDialog
                plugin={pendingRemove}
                busy={busyPluginId === pendingRemove.id}
                onClose={() => setPendingRemove(null)}
                onConfirm={async () => {
                  const target = pendingRemove;
                  setPendingRemove(null);
                  await executeRemovePlugin(target);
                }}
              />
            )}
      </div>
    </AdminPageLayout>
  );
}
