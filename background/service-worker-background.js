/*
 * =============================================================================
 * X DIMMER — BACKGROUND SERVICE WORKER
 * =============================================================================
 *
 * PURPOSE:
 * This is the Manifest V3 background service worker for X Dimmer.
 * In MV3, background scripts are event-driven service workers that wake up
 * when needed and go to sleep when idle. This is more efficient than the
 * persistent background pages of MV2.
 *
 * RESPONSIBILITIES:
 * 1. Handle extension installation and update events
 * 2. Set default storage values on first install
 * 3. Update the extension badge/icon to reflect the current state
 * 4. Handle any cross-tab communication if needed
 *
 * WHY WE NEED THIS:
 * Even though the content script handles most of the logic, we need the
 * service worker for:
 * - Setting initial storage values on install (content script can't do this
 *   reliably because it only runs when the user visits x.com)
 * - Managing the extension icon badge (showing ON/OFF state)
 * - Handling extension lifecycle events (install, update)
 *
 * STORAGE SCHEMA:
 * chrome.storage.local:
 *   - xDimmerEnabled: boolean (default: true) — master on/off toggle
 *   - xDimmerInstalledVersion: string — tracks installed version for migrations
 * =============================================================================
 */


/* -----------------------------------------------------------------------
 * EXTENSION LIFECYCLE EVENTS
 * -----------------------------------------------------------------------
 */

/**
 * Handles the extension being installed or updated.
 * 
 * ON FIRST INSTALL:
 * - Sets default preferences in chrome.storage.local
 * - xDimmerEnabled defaults to true because users install this extension
 *   specifically to get dim mode back — having it off would be confusing
 *
 * ON UPDATE:
 * - Could be used for storage schema migrations in future versions
 * - Logs the update for debugging purposes
 * 
 * REASON FOR chrome.runtime.onInstalled:
 * This event fires once per install or update, making it the right place
 * for one-time setup. The content script's storage.get() with defaults
 * handles the case where storage hasn't been initialized yet, but this
 * event lets us set values proactively.
 */
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    /* 
     * First-time installation — set defaults.
     * We enable the dim theme by default because that's why
     * the user installed the extension in the first place.
     */
    await chrome.storage.local.set({
      xDimmerEnabled: true,
      xDimmerInstalledVersion: chrome.runtime.getManifest().version,
    });

    /* Update the badge to show the extension is active */
    updateExtensionBadgeToReflectState(true);

    console.log('[X Dimmer] Extension installed — dim mode enabled by default');
  } else if (details.reason === 'update') {
    /*
     * Extension updated — preserve existing preferences.
     * In the future, we might need migration logic here if
     * the storage schema changes between versions.
     */
    const currentVersion = chrome.runtime.getManifest().version;
    await chrome.storage.local.set({
      xDimmerInstalledVersion: currentVersion,
    });

    console.log(`[X Dimmer] Extension updated to v${currentVersion}`);
  }
});


/* -----------------------------------------------------------------------
 * BADGE MANAGEMENT
 * -----------------------------------------------------------------------
 * The badge is the small text overlay on the extension icon in the toolbar.
 * We use it to show a quick visual indicator of whether dim mode is ON or OFF.
 * - When ON: small blue dot or "ON" text
 * - When OFF: no badge (icon appears more muted)
 * -----------------------------------------------------------------------
 */

/**
 * Updates the extension toolbar icon badge to reflect the current state.
 * 
 * When enabled: Shows a small blue dot badge (using a single space as text
 * with a blue background) to indicate the extension is actively modifying X.
 * 
 * When disabled: Clears the badge to show a clean icon, indicating the
 * extension is installed but not currently active.
 * 
 * WHY A BADGE AND NOT DIFFERENT ICONS:
 * Swapping entire icon sets (enabled vs disabled) would require additional
 * icon assets and adds complexity. A badge is simpler, widely understood,
 * and Chrome handles it efficiently without needing to load new images.
 * 
 * @param {boolean} isEnabled - Whether dim mode is currently active
 */
function updateExtensionBadgeToReflectState(isEnabled) {
  if (isEnabled) {
    /* Show a small "ON" indicator with X's blue accent color */
    chrome.action.setBadgeText({ text: ' ' });
    chrome.action.setBadgeBackgroundColor({ color: '#1D9BF0' });
  } else {
    /* Clear the badge when disabled */
    chrome.action.setBadgeText({ text: '' });
  }
}


/* -----------------------------------------------------------------------
 * STORAGE CHANGE LISTENER
 * -----------------------------------------------------------------------
 * Listen for storage changes to keep the badge in sync.
 * The popup writes to storage, and this listener updates the badge.
 * This is more reliable than having the popup directly set the badge
 * because the popup closes when the user clicks away.
 * -----------------------------------------------------------------------
 */

/**
 * Listens for changes to the xDimmerEnabled storage key.
 * Updates the badge whenever the user toggles the extension.
 * 
 * This fires whether the change came from:
 * - The popup UI
 * - The content script (if it ever modifies storage)
 * - Chrome's storage API from any other context
 */
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;

  if (changes.xDimmerEnabled) {
    const isNowEnabled = changes.xDimmerEnabled.newValue;
    updateExtensionBadgeToReflectState(isNowEnabled);
  }
});


/* -----------------------------------------------------------------------
 * INITIALIZATION — RESTORE BADGE STATE ON SERVICE WORKER WAKE-UP
 * -----------------------------------------------------------------------
 * MV3 service workers can be killed and restarted by Chrome at any time.
 * When the service worker wakes up, we need to restore the badge state
 * based on the stored preference. Otherwise, the badge would disappear
 * every time the service worker is recycled.
 * -----------------------------------------------------------------------
 */

/**
 * Restores the badge state from storage.
 * Called immediately when the service worker starts.
 * 
 * WHY IMMEDIATELY:
 * Service workers in MV3 are ephemeral. They start, process events, and
 * can be terminated after ~30 seconds of inactivity. Each time the worker
 * restarts, all in-memory state is lost. The badge text is part of Chrome's
 * persistent API state, but we re-set it for safety.
 */
async function restoreBadgeStateFromStorage() {
  try {
    const preferences = await chrome.storage.local.get({ xDimmerEnabled: true });
    updateExtensionBadgeToReflectState(preferences.xDimmerEnabled);
  } catch (error) {
    console.error('[X Dimmer] Failed to restore badge state:', error);
  }
}

/* Run restoration immediately when service worker loads */
restoreBadgeStateFromStorage();
