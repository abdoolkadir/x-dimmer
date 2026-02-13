/*
 * =============================================================================
 * X DIMMER — CONTENT SCRIPT: DIM THEME INJECTOR
 * =============================================================================
 *
 * PURPOSE:
 * This content script runs on x.com and twitter.com pages. It is responsible
 * for injecting (or removing) the dim theme CSS overrides into the page.
 * It runs at document_start (before the page renders) so users never see
 * the flash of the pure-black "Lights Out" theme before the dim kicks in.
 *
 * HOW IT WORKS:
 * 1. On load, checks chrome.storage.local for the "xDimmerEnabled" flag
 * 2. If enabled, injects the dim-theme-override-styles.css into the page <head>
 * 3. Sets up a MutationObserver to handle dynamically-added elements that
 *    X styles with inline background-color: rgb(0, 0, 0) after page load
 * 4. Listens for chrome.storage.onChanged events so toggling in the popup
 *    instantly updates all open X/Twitter tabs without requiring a reload
 *
 * WHY DOCUMENT_START:
 * We inject at document_start (configured in manifest.json) because:
 * - It prevents the "flash of black" that would occur if we waited for
 *   DOMContentLoaded or load events
 * - The <style> element is ready before X's own styles fully paint
 * - This gives the smoothest, most seamless user experience
 *
 * WHY MUTATIONOBSERVER:
 * X/Twitter is a Single Page Application (SPA) that dynamically renders
 * content via React. New tweets, modals, menus, and UI elements are added
 * to the DOM constantly as the user scrolls, clicks, and navigates.
 * Many of these elements receive inline style="background-color: rgb(0, 0, 0)"
 * which our CSS attribute selectors catch, but some edge cases need JS help.
 * The MutationObserver watches for these and applies corrections.
 *
 * STORAGE KEYS:
 * - "xDimmerEnabled" (boolean) — whether dim mode is active (default: true)
 * - "xDimmerIntensity" (number 0-100) — how much to shift toward dim vs black
 *   (100 = full dim navy, 0 = original lights out black, default: 100)
 * =============================================================================
 */


/* -----------------------------------------------------------------------
 * CONFIGURATION CONSTANTS
 * These define the color mapping from "Lights Out" to "Dim" palette.
 * Having them here (in addition to CSS) allows the JS MutationObserver
 * to handle inline styles that CSS attribute selectors might miss.
 * -----------------------------------------------------------------------
 */

/**
 * Color mapping from X's "Lights Out" RGB values to "Dim" equivalents.
 * Each entry maps a Lights Out color (as "r,g,b" string) to its Dim replacement.
 * 
 * This is used by the MutationObserver to find and replace inline background colors.
 * The CSS file handles most cases, but dynamically injected inline styles sometimes
 * slip through, especially in modals, popovers, and lazy-loaded content.
 */
const LIGHTS_OUT_TO_DIM_COLOR_MAP = {
  '0, 0, 0':      '21, 32, 43',     // #000000 → #15202B (primary background)
  '22, 24, 28':    '25, 39, 52',     // #16181C → #192734 (secondary surfaces)
  '21, 24, 28':    '25, 39, 52',     // slight variant of secondary
  '32, 35, 39':    '34, 48, 60',     // #202327 → #22303C (elevated surfaces)
  '29, 31, 35':    '30, 39, 50',     // #1D1F23 → #1E2732 (hover states)
  '39, 44, 48':    '34, 48, 60',     // another hover variant
  '47, 51, 54':    '56, 68, 77',     // #2F3336 → #38444D (borders)
};

/**
 * A unique identifier for our injected <style> element.
 * We use this to find and remove/replace it when toggling the extension.
 * The ID is deliberately verbose to avoid conflicts with X's own DOM.
 */
const INJECTED_STYLE_ELEMENT_ID = 'x-dimmer-extension-dim-theme-overrides';

/**
 * A unique identifier for the inline-style-fix <style> element.
 * This contains dynamically generated CSS from the MutationObserver.
 */
const DYNAMIC_FIXES_STYLE_ELEMENT_ID = 'x-dimmer-extension-dynamic-fixes';

/**
 * Debounce interval (ms) for MutationObserver processing.
 * We batch DOM mutations and process them in requestAnimationFrame
 * to avoid performance issues from processing every single mutation.
 * 
 * 100ms is a good balance between responsiveness and performance.
 * Users won't notice a 100ms delay in background color changes,
 * but it prevents excessive DOM scanning during rapid scrolling.
 */
const MUTATION_OBSERVER_DEBOUNCE_MS = 100;


/* -----------------------------------------------------------------------
 * STATE VARIABLES
 * -----------------------------------------------------------------------
 */

/** Whether the dim theme is currently active (injected into the page). */
let isDimThemeCurrentlyActive = false;

/** Reference to the MutationObserver instance for cleanup. */
let domMutationObserverInstance = null;

/** Timer ID for debouncing MutationObserver callbacks. */
let mutationDebounceTimerId = null;

/** 
 * Cached reference to the CSS text of our dim theme.
 * We fetch this once from the extension's bundled CSS file
 * and reuse it to avoid repeated fetch() calls.
 */
let cachedDimThemeCssText = null;


/* -----------------------------------------------------------------------
 * CSS INJECTION AND REMOVAL
 * These functions handle adding/removing the dim theme <style> element.
 * -----------------------------------------------------------------------
 */

/**
 * Fetches the dim theme CSS from the extension's bundled file.
 * Uses chrome.runtime.getURL to get the proper extension:// URL.
 * The result is cached in cachedDimThemeCssText for reuse.
 * 
 * WHY FETCH INSTEAD OF INLINE:
 * We keep the CSS in a separate file (dim-theme-override-styles.css) because:
 * 1. It's easier to maintain and read (400+ lines of CSS)
 * 2. It can be edited independently of the JS logic
 * 3. Chrome DevTools shows it as a proper stylesheet for debugging
 * 
 * @returns {Promise<string>} The CSS text content
 */
async function fetchDimThemeCssFromExtensionBundle() {
  if (cachedDimThemeCssText) {
    return cachedDimThemeCssText;
  }

  try {
    const cssFileUrl = chrome.runtime.getURL('content/dim-theme-override-styles.css');
    const response = await fetch(cssFileUrl);
    cachedDimThemeCssText = await response.text();
    return cachedDimThemeCssText;
  } catch (error) {
    console.error('[X Dimmer] Failed to fetch dim theme CSS:', error);
    return '';
  }
}


/**
 * Injects the dim theme CSS into the page's <head> as a <style> element.
 * If the element already exists, it updates the content (in case of CSS changes).
 * Also starts the MutationObserver to handle dynamic inline styles.
 * 
 * This is the primary function called when the extension is enabled.
 * It's called on page load (if enabled) and when the user toggles on.
 * 
 * SEQUENCE:
 * 1. Fetch the CSS text (from cache or extension bundle)
 * 2. Create or find the <style> element
 * 3. Set its content to the CSS text
 * 4. Append to <head> (or document.documentElement if head isn't ready yet)
 * 5. Start the MutationObserver for inline style fixes
 * 6. Do an initial scan of existing elements for inline style fixes
 */
async function injectDimThemeIntoPage() {
  const cssText = await fetchDimThemeCssFromExtensionBundle();
  if (!cssText) {
    console.warn('[X Dimmer] No CSS text available to inject');
    return;
  }

  /* Find existing style element or create a new one */
  let styleElement = document.getElementById(INJECTED_STYLE_ELEMENT_ID);
  if (!styleElement) {
    styleElement = document.createElement('style');
    styleElement.id = INJECTED_STYLE_ELEMENT_ID;
    styleElement.setAttribute('type', 'text/css');
  }

  /* Set the CSS content */
  styleElement.textContent = cssText;

  /* Append to the document — use documentElement if <head> isn't ready yet
   * (which happens when we run at document_start) */
  const targetParent = document.head || document.documentElement;
  if (!styleElement.parentNode) {
    targetParent.appendChild(styleElement);
  }

  isDimThemeCurrentlyActive = true;

  /* Start watching for dynamically added elements with inline black backgrounds */
  startMutationObserverForInlineStyleFixes();

  /* Do an initial scan of the current DOM for any existing inline black backgrounds */
  scanAndFixExistingInlineBlackBackgrounds();

  console.log('[X Dimmer] Dim theme injected successfully');
}


/**
 * Removes the dim theme CSS from the page, restoring X's original styling.
 * Also stops the MutationObserver since we no longer need to fix inline styles.
 * 
 * This is called when the user toggles the extension off.
 * The removal is instant — no transition because users want immediate feedback
 * when they explicitly disable a feature.
 */
function removeDimThemeFromPage() {
  /* Remove the main dim theme <style> element */
  const styleElement = document.getElementById(INJECTED_STYLE_ELEMENT_ID);
  if (styleElement) {
    styleElement.remove();
  }

  /* Remove the dynamic fixes <style> element */
  const dynamicFixesElement = document.getElementById(DYNAMIC_FIXES_STYLE_ELEMENT_ID);
  if (dynamicFixesElement) {
    dynamicFixesElement.remove();
  }

  /* Stop the MutationObserver */
  stopMutationObserver();

  /* Revert any inline style changes we made directly via JS */
  revertAllInlineStyleFixesToOriginal();

  isDimThemeCurrentlyActive = false;
  console.log('[X Dimmer] Dim theme removed');
}


/* -----------------------------------------------------------------------
 * MUTATION OBSERVER — HANDLING DYNAMIC INLINE STYLES
 * -----------------------------------------------------------------------
 * X/Twitter is a React SPA that constantly adds/modifies DOM elements.
 * Many elements get inline background-color applied by React's style prop.
 * Our CSS attribute selectors (e.g., [style*="background-color: rgb(0, 0, 0)"])
 * handle most of these, but there are edge cases:
 *   - Elements where X uses shorthand "background" instead of "background-color"
 *   - Elements styled after our CSS rules are evaluated
 *   - Elements in shadow DOM or deeply nested structures
 *
 * The MutationObserver watches for these cases and applies direct fixes.
 * -----------------------------------------------------------------------
 */

/**
 * Starts the MutationObserver that watches for DOM changes.
 * Observes the entire document for:
 *   - childList: new elements added to the DOM
 *   - attributes: style attribute changes on existing elements
 *   - subtree: observe the entire tree, not just direct children
 *
 * We filter on attributeFilter: ['style'] to only trigger on style changes,
 * which significantly reduces the number of mutations we need to process.
 */
function startMutationObserverForInlineStyleFixes() {
  /* Don't create duplicate observers */
  if (domMutationObserverInstance) {
    return;
  }

  domMutationObserverInstance = new MutationObserver(handleDomMutationsBatched);

  /* Start observing once the document body exists */
  const startObserving = () => {
    if (document.body) {
      domMutationObserverInstance.observe(document.body, {
        childList: true,       /* Watch for new/removed child elements */
        attributes: true,      /* Watch for attribute changes */
        subtree: true,         /* Watch the entire subtree, not just direct children */
        attributeFilter: ['style'],  /* Only trigger on style attribute changes */
      });
    } else {
      /* If body doesn't exist yet (document_start), wait for it */
      const bodyWatcher = new MutationObserver(() => {
        if (document.body) {
          bodyWatcher.disconnect();
          domMutationObserverInstance.observe(document.body, {
            childList: true,
            attributes: true,
            subtree: true,
            attributeFilter: ['style'],
          });
        }
      });
      bodyWatcher.observe(document.documentElement, { childList: true });
    }
  };

  startObserving();
}


/**
 * Stops the MutationObserver and cleans up.
 * Called when the dim theme is disabled.
 */
function stopMutationObserver() {
  if (domMutationObserverInstance) {
    domMutationObserverInstance.disconnect();
    domMutationObserverInstance = null;
  }
  if (mutationDebounceTimerId) {
    clearTimeout(mutationDebounceTimerId);
    mutationDebounceTimerId = null;
  }
}


/**
 * Handles DOM mutations in a batched/debounced manner.
 * Instead of processing every single mutation immediately, we collect them
 * and process in the next animation frame after a debounce period.
 * 
 * WHY DEBOUNCE:
 * X can trigger hundreds of mutations per second during scrolling.
 * Processing each one individually would cause jank and high CPU usage.
 * By batching with requestAnimationFrame, we align our work with the
 * browser's rendering cycle and process all pending mutations at once.
 * 
 * @param {MutationRecord[]} mutationsList - Array of mutation records
 */
function handleDomMutationsBatched(mutationsList) {
  if (mutationDebounceTimerId) {
    clearTimeout(mutationDebounceTimerId);
  }

  mutationDebounceTimerId = setTimeout(() => {
    requestAnimationFrame(() => {
      processMutationsForInlineStyleFixes(mutationsList);
    });
  }, MUTATION_OBSERVER_DEBOUNCE_MS);
}


/**
 * Processes collected mutations and fixes any black inline backgrounds.
 * 
 * For each mutation:
 * - If childList: scan all added nodes for black backgrounds
 * - If attribute (style): check if the element now has a black background
 * 
 * @param {MutationRecord[]} mutationsList - Array of mutation records to process
 */
function processMutationsForInlineStyleFixes(mutationsList) {
  if (!isDimThemeCurrentlyActive) return;

  const elementsToCheck = new Set();

  for (const mutation of mutationsList) {
    if (mutation.type === 'childList') {
      /* New nodes were added — collect them for checking */
      for (const addedNode of mutation.addedNodes) {
        if (addedNode.nodeType === Node.ELEMENT_NODE) {
          elementsToCheck.add(addedNode);
          /* Also check children of the added node */
          const descendants = addedNode.querySelectorAll('*');
          for (const desc of descendants) {
            elementsToCheck.add(desc);
          }
        }
      }
    } else if (mutation.type === 'attributes') {
      /* An existing element's style attribute changed */
      if (mutation.target.nodeType === Node.ELEMENT_NODE) {
        elementsToCheck.add(mutation.target);
      }
    }
  }

  /* Now check each collected element and fix black backgrounds */
  for (const element of elementsToCheck) {
    fixElementInlineBlackBackground(element);
  }
}


/**
 * Checks a single element's inline style for black-family backgrounds
 * and replaces them with the dim equivalents.
 * 
 * HOW IT WORKS:
 * 1. Read the element's inline style.backgroundColor (or style.background)
 * 2. If it contains a "Lights Out" color from our map, replace it
 * 3. Store the original color in a data attribute so we can revert later
 * 
 * WHY DATA ATTRIBUTES:
 * We store original colors in data-x-dimmer-original-bg so that when the
 * user disables the extension, we can restore the exact original colors.
 * Without this, disabling would require a page reload.
 * 
 * @param {HTMLElement} element - The DOM element to check and potentially fix
 */
function fixElementInlineBlackBackground(element) {
  if (!element || !element.style) return;

  /* Skip media elements — we never want to dim images/videos */
  const tagName = element.tagName?.toLowerCase();
  if (['img', 'video', 'canvas', 'picture', 'source'].includes(tagName)) return;

  const inlineBg = element.style.backgroundColor;
  if (!inlineBg) return;

  /* Extract RGB values from the inline style.
   * IMPORTANT: X uses BOTH rgb() and rgba() formats for backgrounds.
   * For example: rgba(0, 0, 0, 1.00) — this is pure black in rgba form.
   * The regex below matches both rgb(r, g, b) and rgba(r, g, b, a) formats
   * by using rgba? (the 'a' is optional). We only need the R, G, B values
   * to look up the color in our map — the alpha is preserved separately. */
  const rgbMatch = inlineBg.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!rgbMatch) return;

  const rgbKey = `${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]}`;
  const dimReplacement = LIGHTS_OUT_TO_DIM_COLOR_MAP[rgbKey];

  if (dimReplacement) {
    /* Store the original value for reverting */
    if (!element.dataset.xDimmerOriginalBg) {
      element.dataset.xDimmerOriginalBg = inlineBg;
    }
    /* If the original was rgba, preserve the alpha channel so we don't
     * break any transparency that X intentionally applied (e.g., semi-
     * transparent headers with backdrop blur). If it's a solid rgba with
     * alpha 1.0, using rgb() is fine and equivalent. */
    const alphaMatch = inlineBg.match(/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)/);
    if (alphaMatch && parseFloat(alphaMatch[1]) < 1) {
      /* Semi-transparent — keep the alpha value */
      element.style.backgroundColor = `rgba(${dimReplacement}, ${alphaMatch[1]})`;
    } else {
      /* Fully opaque — use rgb() */
      element.style.backgroundColor = `rgb(${dimReplacement})`;
    }
  }
}


/**
 * Scans the entire current DOM for elements with black inline backgrounds.
 * Called once when the dim theme is first injected to catch any elements
 * that were already rendered before we started observing.
 * 
 * Uses querySelectorAll with [style*=] selectors to efficiently find
 * elements with inline background colors matching our Lights Out palette.
 */
function scanAndFixExistingInlineBlackBackgrounds() {
  if (!document.body) return;

  /* Query for elements with inline background-color styles */
  const allStyledElements = document.body.querySelectorAll('[style*="background"]');
  for (const element of allStyledElements) {
    fixElementInlineBlackBackground(element);
  }
}


/**
 * Reverts all inline style fixes we applied back to their original values.
 * Called when the dim theme is disabled so the page returns to its
 * original "Lights Out" appearance without requiring a reload.
 * 
 * Uses the data-x-dimmer-original-bg attribute we stored earlier to
 * restore exact original values.
 */
function revertAllInlineStyleFixesToOriginal() {
  const fixedElements = document.querySelectorAll('[data-x-dimmer-original-bg]');
  for (const element of fixedElements) {
    element.style.backgroundColor = element.dataset.xDimmerOriginalBg;
    delete element.dataset.xDimmerOriginalBg;
  }
}


/* -----------------------------------------------------------------------
 * STORAGE & STATE MANAGEMENT
 * -----------------------------------------------------------------------
 * We use chrome.storage.local to persist the user's preferences.
 * The storage.onChanged listener ensures all open X tabs stay in sync
 * when the user toggles the extension from any tab's popup.
 * -----------------------------------------------------------------------
 */

/**
 * Initializes the extension state on page load.
 * Reads the stored preference and injects/removes the theme accordingly.
 * 
 * DEFAULT BEHAVIOR:
 * If no preference is stored (first install), we default to ENABLED (true).
 * This is intentional because:
 * - Users install this extension specifically to get dim mode back
 * - Having it off by default would be confusing ("I installed it but nothing happened")
 * - Users who want to temporarily disable can easily toggle in the popup
 */
async function initializeDimThemeStateOnPageLoad() {
  try {
    const storedPreferences = await chrome.storage.local.get({
      xDimmerEnabled: true,  /* Default to enabled on first install */
    });

    if (storedPreferences.xDimmerEnabled) {
      await injectDimThemeIntoPage();
    }
  } catch (error) {
    /* 
     * If storage access fails (rare, but possible during extension updates),
     * default to injecting the theme since that's what users installed for.
     */
    console.error('[X Dimmer] Failed to read storage, defaulting to enabled:', error);
    await injectDimThemeIntoPage();
  }
}


/**
 * Listens for changes to chrome.storage.local.
 * When the user toggles the extension via the popup, the popup writes to
 * chrome.storage.local, and this listener fires in ALL open X/Twitter tabs.
 * 
 * This is how we achieve instant, cross-tab synchronization without
 * needing the background service worker to send messages to each tab.
 */
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;

  if (changes.xDimmerEnabled) {
    const isNowEnabled = changes.xDimmerEnabled.newValue;

    if (isNowEnabled && !isDimThemeCurrentlyActive) {
      injectDimThemeIntoPage();
    } else if (!isNowEnabled && isDimThemeCurrentlyActive) {
      removeDimThemeFromPage();
    }
  }
});


/* -----------------------------------------------------------------------
 * INITIALIZATION
 * -----------------------------------------------------------------------
 * Kick off the extension when the content script loads.
 * Since we run at document_start, the DOM may not be fully ready.
 * The injectDimThemeIntoPage function handles this gracefully by
 * appending to document.documentElement if <head> isn't ready yet.
 * -----------------------------------------------------------------------
 */
initializeDimThemeStateOnPageLoad();
