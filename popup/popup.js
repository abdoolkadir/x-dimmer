/*
 * =============================================================================
 * X DIMMER — POPUP INTERACTION LOGIC
 * =============================================================================
 *
 * PURPOSE:
 * Handles all user interactions in the X Dimmer popup UI.
 * The popup is the primary interface for users to control the extension.
 *
 * RESPONSIBILITIES:
 * 1. Read the current dim mode state from chrome.storage.local on popup open
 * 2. Update the toggle switch and status text to reflect current state
 * 3. Handle toggle switch clicks — write new state to chrome.storage.local
 * 4. Visually update the popup UI to reflect ON/OFF state (add/remove classes)
 *
 * HOW TOGGLE PROPAGATION WORKS:
 * When the user clicks the toggle in this popup:
 * 1. This popup.js writes the new state to chrome.storage.local
 * 2. The content script (content-script-dim-theme-injector.js) listens for
 *    chrome.storage.onChanged and injects/removes the CSS accordingly
 * 3. The background service worker also listens and updates the badge
 * 4. ALL open X/Twitter tabs receive the change simultaneously
 *
 * This event-driven architecture means we don't need to manually message
 * each tab or keep track of which tabs have X open. Chrome's storage API
 * handles the broadcast for us, which is elegant and reliable.
 *
 * WHY NOT DIRECT TAB MESSAGING:
 * We considered using chrome.tabs.sendMessage to directly tell content scripts
 * to toggle, but that approach has drawbacks:
 * - Requires tracking which tabs have X open
 * - Fails silently if a tab's content script hasn't loaded yet
 * - Requires the "tabs" permission which some users find invasive
 * Using chrome.storage.onChanged is permission-free (we already need "storage")
 * and automatically reaches all listeners everywhere.
 * =============================================================================
 */


/* -----------------------------------------------------------------------
 * DOM REFERENCES
 * Cache DOM element references at load time to avoid repeated queries.
 * -----------------------------------------------------------------------
 */

/** The checkbox input that powers the toggle switch */
const dimmerToggleCheckboxElement = document.getElementById('dimmer-toggle-checkbox');

/** The status text ("Active" / "Inactive") next to the toggle */
const dimmerStatusTextElement = document.getElementById('dimmer-status-text');

/** The main popup container (for adding disabled/enabled classes) */
const popupContainerElement = document.querySelector('.x-dimmer-popup-container');


/* -----------------------------------------------------------------------
 * STATE INITIALIZATION
 * Read the current state from storage and update the UI accordingly.
 * This runs every time the popup is opened because Chrome destroys
 * and recreates the popup each time the user clicks the extension icon.
 * -----------------------------------------------------------------------
 */

/**
 * Reads the stored dim mode preference and sets up the popup UI.
 * 
 * Called immediately when the popup opens (DOMContentLoaded).
 * 
 * DEFAULT VALUE:
 * If no value is stored (shouldn't happen after install, but just in case),
 * we default to true (enabled) to match the behavior of the content script
 * and the default set during installation.
 */
async function initializePopupStateFromStorage() {
  try {
    const storedPreferences = await chrome.storage.local.get({
      xDimmerEnabled: true,  /* Default to enabled */
    });

    const isEnabled = storedPreferences.xDimmerEnabled;

    /* Update the toggle checkbox to match stored state */
    dimmerToggleCheckboxElement.checked = isEnabled;

    /* Update the visual state of the popup */
    updatePopupVisualStateToReflectToggle(isEnabled);

  } catch (error) {
    /*
     * If storage read fails, assume enabled (since that's the default).
     * This is a defensive fallback for edge cases like extension updates
     * where storage might be temporarily unavailable.
     */
    console.error('[X Dimmer Popup] Failed to read storage:', error);
    dimmerToggleCheckboxElement.checked = true;
    updatePopupVisualStateToReflectToggle(true);
  }
}


/* -----------------------------------------------------------------------
 * TOGGLE HANDLER
 * Handles the user clicking the toggle switch.
 * -----------------------------------------------------------------------
 */

/**
 * Handles the toggle switch change event.
 * Writes the new state to chrome.storage.local, which triggers:
 * - Content scripts to inject/remove the dim CSS on all X tabs
 * - Background service worker to update the toolbar badge
 * 
 * WHY ASYNC:
 * chrome.storage.local.set returns a Promise in MV3.
 * We await it to ensure the write completes before updating the UI.
 * In practice, storage writes are near-instant, but awaiting is correct.
 */
async function handleDimmerToggleChange() {
  const isNowEnabled = dimmerToggleCheckboxElement.checked;

  try {
    /* Write the new state to storage — this triggers listeners everywhere */
    await chrome.storage.local.set({
      xDimmerEnabled: isNowEnabled,
    });

    /* Update the popup's visual state to match */
    updatePopupVisualStateToReflectToggle(isNowEnabled);

  } catch (error) {
    /*
     * If storage write fails (very rare), revert the checkbox
     * to avoid a state mismatch between the UI and stored state.
     */
    console.error('[X Dimmer Popup] Failed to write storage:', error);
    dimmerToggleCheckboxElement.checked = !isNowEnabled;
  }
}


/* -----------------------------------------------------------------------
 * UI STATE UPDATES
 * Visual feedback functions that update the popup appearance.
 * -----------------------------------------------------------------------
 */

/**
 * Updates the popup UI to reflect whether dim mode is enabled or disabled.
 * 
 * When ENABLED:
 * - Status text shows "Active" in blue (#1D9BF0)
 * - Popup container has no "disabled" class (full vibrancy)
 * - Moon icon is fully opaque
 * 
 * When DISABLED:
 * - Status text shows "Inactive" in gray (#71767B)
 * - Popup container gets "x-dimmer-popup-disabled" class (muted look)
 * - Moon icon becomes semi-transparent and desaturated
 * 
 * @param {boolean} isEnabled - Whether dim mode is currently active
 */
function updatePopupVisualStateToReflectToggle(isEnabled) {
  if (isEnabled) {
    dimmerStatusTextElement.textContent = 'Active';
    dimmerStatusTextElement.classList.remove('x-dimmer-status-inactive');
    popupContainerElement.classList.remove('x-dimmer-popup-disabled');
  } else {
    dimmerStatusTextElement.textContent = 'Inactive';
    dimmerStatusTextElement.classList.add('x-dimmer-status-inactive');
    popupContainerElement.classList.add('x-dimmer-popup-disabled');
  }
}


/* -----------------------------------------------------------------------
 * EVENT LISTENERS
 * Wire up the toggle switch to our handler.
 * -----------------------------------------------------------------------
 */

/* Listen for toggle switch changes */
dimmerToggleCheckboxElement.addEventListener('change', handleDimmerToggleChange);


/* -----------------------------------------------------------------------
 * INITIALIZATION
 * Run state initialization when the popup DOM is ready.
 * 
 * We use DOMContentLoaded because it fires after the HTML is parsed
 * but before images/stylesheets finish loading. This gives us the
 * fastest possible UI initialization.
 * -----------------------------------------------------------------------
 */
document.addEventListener('DOMContentLoaded', initializePopupStateFromStorage);
