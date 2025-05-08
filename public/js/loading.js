(function () {
  const originalFetch = window.fetch;
  const overlay = document.getElementById('global-loading-overlay');
    
  let loaderTimer = null;
  const DELAY_MS = 300; // The threshold for showing the loader

  function showGlobalLoaderWithDelay() {
    // Clear any existing timer (if multiple requests quickly in succession)
    if (loaderTimer) {
      clearTimeout(loaderTimer);
    }

    // Only apply the .show class if the request is still in flight after DELAY_MS
    loaderTimer = setTimeout(() => {
      overlay.classList.add('show');
    }, DELAY_MS);
  }

  function hideGlobalLoader() {
    // If the request finishes before the timer is triggered, we won't show the overlay at all
    clearTimeout(loaderTimer);
    loaderTimer = null;

    // Also ensure we remove the .show class if it was added
    overlay.classList.remove('show');
  }

  // Override window.fetch globally
  window.fetch = async function (resource, config = {}) {
    function isProgressContainerOpen() {
      const progressContainer = document.getElementById('progress-container');
      if (!progressContainer) return false;
      // If it does NOT have the .hidden class, we treat it as "open"
      return !progressContainer.classList.contains('hidden');
    }
    
    // 1) Extract our custom skipGlobalLoader option
    const skipLoader = config.skipGlobalLoader || false;

    // 2) Remove skipGlobalLoader from config so it doesn't cause issues 
    //    for the real fetch call 
    delete config.skipGlobalLoader;

    // 3) If skipLoader is false, run the global loader logic
    if (!skipLoader && !isProgressContainerOpen()) {
      showGlobalLoaderWithDelay();
    }
    

    try {
      // 4) Perform the actual fetch
      const response = await originalFetch(resource, config);
      return response;
    } catch (error) {
      throw error;
    } finally {
      // 5) Hide the loader once finished (unless we never displayed it)
      hideGlobalLoader();
    }
  };
})();

  