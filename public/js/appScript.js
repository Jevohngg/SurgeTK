// public/js/appScript.js

// Sidebar toggle functionality for collapsing/expanding (desktop)
// and off‑canvas overlay (≤1305px). Ensures mobile drawer is ALWAYS expanded.
(function () {
  const MOBILE_BP = 1305;
  const docEl = document.documentElement;

  const isMobile = () => window.innerWidth <= MOBILE_BP;

  // Elements
  const sidebar = document.querySelector('.sidebar');
  const logo = document.querySelector('.company-logo img');
  const EXPANDED_LOGO = '/images/surgetk_logo_vertical_blue.svg';
  const COLLAPSED_LOGO = '/images/favicon.svg';

  // Ensure a backdrop exists for outside-click close on mobile
  let backdrop = document.querySelector('.sidebar-backdrop');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.className = 'sidebar-backdrop';
    document.body.appendChild(backdrop);
  }

  // ----- Desktop (≥1306px): collapse/expand with persistence -----
  function setDesktopCollapsedState(isCollapsed) {
    if (!sidebar) return;
    sidebar.classList.toggle('collapsed', isCollapsed);
    docEl.classList.toggle('sidebar-collapsed', isCollapsed);
    if (logo) logo.src = isCollapsed ? COLLAPSED_LOGO : EXPANDED_LOGO;
    localStorage.setItem('sidebarCollapsed', String(isCollapsed));
  }

  function toggleDesktop() {
    const isCollapsedNow = sidebar.classList.toggle('collapsed');
    docEl.classList.toggle('sidebar-collapsed', isCollapsedNow);
    if (logo) logo.src = isCollapsedNow ? COLLAPSED_LOGO : EXPANDED_LOGO;
    localStorage.setItem('sidebarCollapsed', String(isCollapsedNow));
  }

  // ----- Mobile (≤1305px): off-canvas overlay (ALWAYS expanded) -----
  function forceMobileExpandedLook() {
    // Remove any desktop "collapsed" presentation so we see full labels on mobile
    if (!sidebar) return;
    sidebar.classList.remove('collapsed');
    docEl.classList.remove('sidebar-collapsed');
    if (logo) logo.src = EXPANDED_LOGO;
  }

  function openMobile() {
    forceMobileExpandedLook();
    sidebar.classList.add('is-mobile-open');
    document.body.classList.add('sidebar-open');
  }
  function closeMobile() {
    sidebar.classList.remove('is-mobile-open');
    document.body.classList.remove('sidebar-open');
  }
  function toggleMobile() {
    // If we’re opening, ensure expanded look first
    const willOpen = !sidebar.classList.contains('is-mobile-open');
    if (willOpen) forceMobileExpandedLook();
    const nowOpen = sidebar.classList.toggle('is-mobile-open');
    document.body.classList.toggle('sidebar-open', nowOpen);
  }

  // Hook up all toggle icons in the header
  document.querySelectorAll('.sidebar-toggle-icon').forEach(icon => {
    icon.addEventListener('click', () => {
      if (isMobile()) {
        toggleMobile();
      } else {
        toggleDesktop();
      }
    });
  });

  // Close the mobile drawer on backdrop click or ESC
  backdrop.addEventListener('click', closeMobile);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isMobile()) closeMobile();
  });

  // ----- Initial state handling -----
  // If head injected an initial collapsed style, remove it early on mobile to avoid layout shift,
  // and ALWAYS ensure expanded look on mobile.
  if (isMobile()) {
    forceMobileExpandedLook();
    const styleTag = document.querySelector('style[data-sidebar-init]');
    if (styleTag) styleTag.remove();
  }

  // Apply no-transition to avoid flicker while we sync classes
  if (localStorage.getItem('sidebarCollapsed') === 'true' && !isMobile()) {
    docEl.classList.add('sidebar-collapsed', 'no-transition');
  } else {
    docEl.classList.add('no-transition');
    docEl.classList.remove('sidebar-collapsed');
  }

  // Remove the 'no-transition' class after the page has loaded
  window.addEventListener('load', () => {
    docEl.classList.remove('no-transition');
  });

  // Reflect saved state onto the actual .sidebar and logo on desktop only
  if (!isMobile() && localStorage.getItem('sidebarCollapsed') === 'true') {
    if (sidebar) sidebar.classList.add('collapsed');
    if (logo) logo.src = COLLAPSED_LOGO;
  }
  // On mobile load, make sure we are visually expanded
  if (isMobile()) {
    forceMobileExpandedLook();
  }

  // If the user resizes across the breakpoint, cleanly switch modes
  let wasMobile = isMobile();
  window.addEventListener('resize', () => {
    const nowMobile = isMobile();
    if (nowMobile !== wasMobile) {
      // Always close any mobile drawer state when switching modes
      closeMobile();

      if (!nowMobile) {
        // Entering desktop: restore collapsed state from localStorage
        const collapsed = localStorage.getItem('sidebarCollapsed') === 'true';
        setDesktopCollapsedState(collapsed);
      } else {
        // Entering mobile: force expanded look (ignore collapsed)
        forceMobileExpandedLook();
      }

      wasMobile = nowMobile;
    }
  });
})();






// Apply the saved sidebar state on page load without flickering
document.addEventListener('DOMContentLoaded', () => {




    console.log("JS is loaded and DOM is ready!");


// 1) Open the disconnect modal when user clicks the “Connected Redtail” container
const openDisconnectModalBtn = document.getElementById('openDisconnectModal');
if (openDisconnectModalBtn) {
  openDisconnectModalBtn.addEventListener('click', () => {
    const disconnectModalEl = document.getElementById('disconnectRedtailModal');
    const bsModal = new bootstrap.Modal(disconnectModalEl);
    bsModal.show();
  });
}

// 2) Handle the "Disconnect" button click
const disconnectBtn = document.getElementById('disconnectRedtailButton');
if (disconnectBtn) {
  disconnectBtn.addEventListener('click', async () => {
    try {
      disconnectBtn.disabled = true; // prevent double-click
      // Optional: show spinner on button, etc.

      // Call our new route
      const response = await fetch('/api/integrations/redtail/disconnect', {
        method: 'POST',
        skipGlobalLoader: true, // if your app uses a global loader
      });
      const data = await response.json();

      if (data.success) {
        showAlert('success', 'Successfully disconnected Redtail.');
        // Optionally close modal
        const disconnectModalEl = document.getElementById('disconnectRedtailModal');
        const bsModal = bootstrap.Modal.getInstance(disconnectModalEl);
        if (bsModal) bsModal.hide();

        // Reload to refresh header state
        setTimeout(() => {
          window.location.reload();
        }, 1000);
      } else {
        showAlert('danger', 'Error: ' + data.message);
      }
    } catch (err) {
      console.error('Error disconnecting Redtail:', err);
      showAlert('danger', 'An error occurred while disconnecting Redtail.');
    } finally {
      disconnectBtn.disabled = false;
    }
  });
}




  // ~~~~~~~~~~~~~~~~~~~~~~~~~~
  // SELECTORS
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~
  const confirmSyncBtn       = document.getElementById('confirmSyncButton');
  const syncStatusContainer  = document.getElementById('redtail-sync-status-container');
  const progressBar          = document.getElementById('syncProgressBar');
  const progressBarContainer = document.getElementById('syncProgressBarContainer');

  const finalMessageEl       = document.getElementById('syncFinalMessage');
  const closeBtn             = document.getElementById('syncStatusCloseBtn');

  const syncPercentageEl     = document.getElementById('syncPercentage');
  const syncETAEl            = document.getElementById('syncETA');
  const finalIconContainer   = document.getElementById('syncFinalIconContainer');
  const finalIcon            = document.getElementById('syncFinalIcon');

  const gifContainer         = document.getElementById('gifContainer');

  // Track progress state
  let highestProgressSoFar   = 0;
  let startTime              = 0;

  const storedSyncStatus  = localStorage.getItem('redtailSyncStatus');  // "success" or "error"
  const storedSyncMessage = localStorage.getItem('redtailSyncMessage'); // e.g. "Sync completed..."

  if (storedSyncStatus && storedSyncMessage) {
    syncStatusContainer.style.display = 'block';
  
    // hide everything *except* the header
    const selectors = [
      '.sync-message',
      '#gifContainer',
      '#syncProgressBarContainer',
      '#syncPercentage',
      '#syncETA'
    ];
  
    selectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        el.classList.add('hidden');
        el.style.setProperty('display','none','important');
        el.hidden = true;
      });
    });
  
    // now explicitly show the header (just in case)
    const hdr = document.querySelector('.sync-header');
    if (hdr) {
      hdr.classList.remove('hidden');
      hdr.style.setProperty('display','flex','important');
      hdr.hidden = false;
    }

    // Hide progress/ETA/percentage
    if (progressBarContainer)     progressBarContainer.style.display = 'none';
    if (syncETAEl)       syncETAEl.style.display   = 'none';
    if (syncPercentageEl) syncPercentageEl.style.display = 'none';

    // Show final message
    finalMessageEl.textContent = storedSyncMessage;
    finalMessageEl.style.display = 'block';

    // Show the icon container
    finalIconContainer.style.display = 'block';

    // Switch icon based on success or error
    if (storedSyncStatus === 'success') {
      finalIcon.textContent = 'check_circle';  // big green check
      finalIcon.style.color = 'green';
    } else {
      finalIcon.textContent = 'error';         // big red error
      finalIcon.style.color = 'red';
    }

    // Hide the "Syncing..." text
    const syncMsg = document.querySelector('.sync-message');
    if (syncMsg) {
      syncMsg.style.display = 'none';
    }

    // Enable close button
    closeBtn.disabled = false;
    closeBtn.style.pointerEvents = 'auto';

    // Clear localStorage so it doesn't persist next time
    localStorage.removeItem('redtailSyncStatus');
    localStorage.removeItem('redtailSyncMessage');
  }


 

// ~~~~~~~~~~~~~~~~~~~~~~~~~~
// 2) Confirm Sync Button: Start sync, show progress UI
// ~~~~~~~~~~~~~~~~~~~~~~~~~~
if (confirmSyncBtn && syncStatusContainer && progressBar) {
  confirmSyncBtn.addEventListener('click', async () => {
    try {
      confirmSyncBtn.classList.add('loading');
      confirmSyncBtn.disabled = true;

      // Show container
      syncStatusContainer.style.display = 'block';

      // Reset progress
      highestProgressSoFar = 0;
      startTime = Date.now();

      // Reset UI elements
      progressBar.style.display   = 'block';
      progressBar.style.width     = '0%';
      progressBar.setAttribute('aria-valuenow', '0');

      syncPercentageEl.style.display = 'inline';
      syncPercentageEl.textContent   = '0%';

      syncETAEl.style.display = 'inline';
      syncETAEl.textContent   = 'calculating...';

      finalMessageEl.textContent     = '';
      finalMessageEl.style.display   = 'none';

      finalIconContainer.style.display = 'none';

      // Hide the "Syncing..." text
      const syncMsg = document.querySelector('.sync-message');
      if (syncMsg) {
        syncMsg.style.display = 'block';
      }

      // Disable close button during sync
      closeBtn.disabled = true;
      closeBtn.style.pointerEvents = 'none';

      // Perform the sync with robust error handling
      const response = await fetch('/api/integrations/redtail/sync', {
        method: 'POST',
        skipGlobalLoader: true,
      });

      // 1) HTTP-status check
      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          text.startsWith('<')
            ? 'Server returned an HTML error page.'
            : text || response.statusText
        );
      }

      // 2) Ensure the response is JSON
      const contentType = response.headers.get('Content-Type') || '';
      if (!contentType.includes('application/json')) {
        const text = await response.text();
        throw new Error('Expected JSON but got: ' + text.slice(0, 200));
      }

      // 3) Parse JSON safely

// 3) Parse JSON safely
const data = await response.json();

/*  At this point the server has replied immediately with
    { success:true, message:'Redtail sync started.' }.
    That just means the background job has been queued.
    Do **nothing** except verify it isn't an outright failure.
*/
if (!data.success) {
  throw new Error(data.message || 'Sync could not be started.');
}



    } catch (err) {
      console.error('Sync‑start error:', err);
      /*  We made no visual change – the user simply keeps seeing
          the progress modal.  If you’d like a toast instead, you
          could call showAlert('danger', err.message);  */
    }
     finally {
      // Hide the confirm modal
      const modalEl = document.getElementById('confirmSyncModal');
      const bsModal = bootstrap.Modal.getInstance(modalEl);
      if (bsModal) bsModal.hide();

      confirmSyncBtn.classList.remove('loading');
      confirmSyncBtn.disabled = false;
    }
  });
}


  // ~~~~~~~~~~~~~~~~~~~~~~~~~~
  // 3) Socket.io real-time progress
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~
  const socket = io();

  socket.on('redtailSyncProgress', (data) => {
    // data = { phase: 'preparing'|'syncing', percent: number }
    const phase     = data.phase || 'syncing';
    const newPercent= data.percent || 0;

    if (!syncStatusContainer) return;

    if (phase === 'preparing') {
      // Show the GIF container
      gifContainer.style.display = 'block';

      // Hide the normal sync stuff
      progressBarContainer.style.display = 'none';
      syncETAEl.style.display            = 'none';
      syncPercentageEl.style.display     = 'none';

      // Hide the "Syncing..." text if you want
      const syncMsg = document.querySelector('.sync-message');
      if (syncMsg) {
        syncMsg.style.display = 'none';
      }
      return;
    }

    // If we reach here => phase === 'syncing'
    gifContainer.style.display      = 'none'; // hide the GIF
    progressBarContainer.style.display = 'block';
    syncETAEl.style.display         = 'inline';
    syncPercentageEl.style.display  = 'inline';

    const syncMsg = document.querySelector('.sync-message');
    if (syncMsg) {
      syncMsg.style.display = 'block';
    }

    if (newPercent < highestProgressSoFar) {
      return;
    }
    highestProgressSoFar = newPercent;

    progressBar.style.width = newPercent + '%';
    progressBar.setAttribute('aria-valuenow', newPercent.toString());
    syncPercentageEl.textContent = Math.floor(newPercent) + '%';

    if (newPercent > 0 && newPercent < 100) {
      const timeSpent         = (Date.now() - startTime) / 1000; // seconds
      const fractionComplete  = newPercent / 100;
      const estimatedTotal    = timeSpent / fractionComplete;
      const estimatedRemaining= estimatedTotal - timeSpent;
      const minutes           = Math.floor(estimatedRemaining / 60);
      const seconds           = Math.floor(estimatedRemaining % 60);
      syncETAEl.textContent   = `${minutes}m ${seconds}s`;
    } else if (newPercent === 100) {
      console.log('percent equals 100');
    
      // 1) reset ETA & enable close button
      syncETAEl.textContent = '0m 0s';
      closeBtn.disabled     = false;
      closeBtn.style.pointerEvents = 'auto';
    
      // 2) hide everything that says "Syncing…" or shows progress, EXCEPT the close button
      const selectors = [
        '.sync-message',
        '#gifContainer',
        '#syncProgressBarContainer',
        '#syncPercentage',
        '#syncETA'
      ];
    
      selectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(el => {
          el.classList.add('hidden');
          el.style.setProperty('display','none','important');
          el.hidden = true;
        });
      });
    
      // 3) make sure our close button is still visible
      closeBtn.classList.remove('hidden');
      closeBtn.style.setProperty('display','inline-block','important');
      closeBtn.hidden = false;
    
      // 3) show final icon + message
      finalIconContainer.style.display = 'block';
      finalMessageEl.textContent       = 'Redtail Sync completed successfully!';
      finalMessageEl.style.display     = 'block';
      finalIcon.textContent            = 'check_circle';
      finalIcon.style.color            = 'green';
    
      // persist for after-refresh state
      localStorage.setItem('redtailSyncStatus', 'success');
      localStorage.setItem('redtailSyncMessage', finalMessageEl.textContent);
    
      // auto‐refresh when done
      setTimeout(() => window.location.reload(), 1500);
    }
    
    
    
  });

  // Close button
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      syncStatusContainer.style.display = 'none';
    });
  }


  

  const syncBtn = document.getElementById('syncRedtailButton');
  if (syncBtn) {
    syncBtn.addEventListener('click', () => {
      // Show the "confirmSyncModal"
      const confirmSyncModalEl = document.getElementById('confirmSyncModal');
      const bsModal = new bootstrap.Modal(confirmSyncModalEl);
      bsModal.show();
    });
  }
  


const form = document.getElementById('connect-redtail-form');
form.addEventListener('submit', async function(e) {
  e.preventDefault();

  // Grab the button
  const connectBtn = document.getElementById('connect-redtail-submit');

  // 1) LOCK the button’s current width/height to prevent collapse
  const originalWidth = connectBtn.offsetWidth;
  const originalHeight = connectBtn.offsetHeight;
  connectBtn.style.width = originalWidth + 'px';
  connectBtn.style.height = originalHeight + 'px';

  // 2) Trigger the loading state
  connectBtn.classList.add('loading');
  connectBtn.disabled = true;

  const environment = document.getElementById('redtailEnvironment').value;
  const username = document.getElementById('redtailUsername').value;
  const password = document.getElementById('redtailPassword').value;

  try {
    const response = await fetch('/api/integrations/redtail/connect', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ environment, username, password }),
      skipGlobalLoader: true,
    });
    const data = await response.json();

    if (data.success) {
      showAlert('success', 'Redtail connected successfully!');
      // Optionally close modal
      const modalEl = document.getElementById('connectRedtailModal');
      const modal = bootstrap.Modal.getInstance(modalEl);
      modal.hide();
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } else {
      // Reset the button state so user can correct credentials & try again
      showAlert('danger', 'Error connecting to Redtail: ' + data.message);
    }
  } catch (err) {
    console.error('Error:', err);
    // Show error
    showAlert('danger', 'An error occurred while connecting to Redtail.');
  } finally {
    // 3) ALWAYS reset the button in finally,
    //    so it’s restored regardless of success or failure
    connectBtn.disabled = false;
    connectBtn.classList.remove('loading');
    connectBtn.style.width = '';
    connectBtn.style.height = '';
  }
});






/**
 * Format a Date into a custom "Last Sync" string:
 * - If today => "Today"
 * - If yesterday => "Yesterday"
 * - If within last 3 days => "Mon" (the weekday short name)
 * - Otherwise same year => "4/14"
 * - If past year => "4/14/2024"
 * Then time => "10:05am" or "10:05pm" (12-hour clock, no seconds)
 * 
 * @param {string|Date} dateInput
 * @returns {string}
 */
function formatLastSync(dateInput) {
  const now = new Date();
  const syncDate = new Date(dateInput);

  // 1) Calculate diff in days
  const diffMs = now - syncDate; 
  const diffInDays = Math.floor(diffMs / (1000 * 60 * 60 * 24)); 

  let datePart;

  if (diffInDays === 0) {
    datePart = 'Today';
  } else if (diffInDays === 1) {
    datePart = 'Yesterday';
  } else if (diffInDays <= 3) {
    // Use weekday short, e.g. "Mon"
    datePart = syncDate.toLocaleString('en-US', { weekday: 'short' }); 
  } else {
    // If same calendar year => "M/D"
    // If different year => "M/D/YYYY"
    const sameYear = (syncDate.getFullYear() === now.getFullYear());
    const month = syncDate.getMonth() + 1;  // JS months are 0-based
    const day = syncDate.getDate();
    const year = syncDate.getFullYear();

    if (sameYear) {
      datePart = `${month}/${day}`;
    } else {
      datePart = `${month}/${day}/${year}`;
    }
  }

  // 2) Format the time: "hh:mmam" or "hh:mmpm"
  let hours = syncDate.getHours();
  let minutes = syncDate.getMinutes();
  const isPm = hours >= 12;
  const ampm = isPm ? 'pm' : 'am';

  // Convert to 12-hour
  hours = hours % 12;
  if (hours === 0) hours = 12;

  // Pad minutes with 0 if needed
  const minutesStr = minutes < 10 ? `0${minutes}` : minutes.toString();

  const timePart = `${hours}:${minutesStr}${ampm}`;

  // Combine
  return `${datePart} ${timePart}`;
}






  // Look for our .last-sync-time element
  const lastSyncEl = document.querySelector('.last-sync-time[data-lastsync]');
  if (lastSyncEl) {
    const rawDate = lastSyncEl.getAttribute('data-lastsync');
    if (rawDate) {
      // Format it
      const customString = formatLastSync(rawDate);
      // Insert the text "Last Sync: <customString>"
      lastSyncEl.textContent = "Last Sync: " + customString;
    }
  }




    // Example path might be "/households/123" (with or without trailing slash)
    const householdDetailsRegex = /^\/households\/[^/]+\/?$/;
    const guardrailsRegex = /^\/households\/[^/]+\/guardrails\/?$/;
    const bucketsRegex = /^\/households\/[^/]+\/buckets\/?$/;
    const currentPath = window.location.pathname;
  
    // 2) If the path matches, hide the banner
    if (householdDetailsRegex.test(currentPath)) {
      const statsBanner = document.querySelector(".stats-banner-container");
      if (statsBanner) {
        statsBanner.style.display = "none"; // Hide the banner
      }
    }

    if (guardrailsRegex.test(currentPath)) {
      const statsBanner = document.querySelector(".stats-banner-container");
      if (statsBanner) {
        statsBanner.style.display = "none"; // Hide the banner
      }
    }

    if (bucketsRegex.test(currentPath)) {
      const statsBanner = document.querySelector(".stats-banner-container");
      if (statsBanner) {
        statsBanner.style.display = "none"; // Hide the banner
      }
    }




  const dropdownMenu = document.querySelector('.dropdown-menu.show-avatar');

  if (dropdownMenu) {
      dropdownMenu.style.display = 'none';
      dropdownMenu.classList.remove('show-avatar');
  }

  const sidebar = document.querySelector('.sidebar');
  const logo = document.querySelector('.company-logo img');
  const isCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';

  const settingsIcon = document.getElementById('settings-icon');
  if (settingsIcon) {
      settingsIcon.addEventListener('click', function () {
          window.location.href = '/settings#account';
      });
  }

  if (isCollapsed) {
      sidebar.classList.add('collapsed');
      logo.src = '/images/favicon.svg';
      logo.style.transition = 'none'; // Disable transition during initialization
      setTimeout(() => {
          sidebar.style.transition = ''; // Re-enable transition after initialization
      }, 100); // Adjust delay as needed
      logo.style.opacity = 1; // Ensure the icon is visible without animation
  } else {
      sidebar.classList.remove('collapsed');
      logo.src = '/images/surgetk_logo_vertical_blue.svg';
      logo.style.transition = 'none'; // Disable transition during initialization
      setTimeout(() => {
          sidebar.style.transition = ''; // Re-enable transition after initialization
      }, 100); // Adjust delay as needed
      logo.style.opacity = 1;
  }


   

const currentFullUrl = window.location.href; // e.g. "http://localhost:3000/settings#company-info"

document.querySelectorAll('.nav-item a').forEach(link => {
  // link.href is the fully resolved URL, e.g. "http://localhost:3000/settings#company-info"
  if (link.href === currentFullUrl) {
    link.parentElement.classList.add('active');
  } else {
    link.parentElement.classList.remove('active');
  }
});


    // Initialize Bootstrap tooltips
    const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    tooltipTriggerList.map(function (tooltipTriggerEl) {
        return new bootstrap.Tooltip(tooltipTriggerEl);
    });

    function closeAllDropdowns(exceptDropdown) {
        if (exceptDropdown !== dropdownMenu && dropdownMenu.classList.contains('show-avatar')) {
            dropdownMenu.classList.remove('show-avatar');
            dropdownMenu.classList.add('fade-out');
            setTimeout(() => {
                dropdownMenu.classList.remove('fade-out');
                dropdownMenu.style.display = 'none';
            }, 300);
        }
    
        if (exceptDropdown !== notificationDropdown && notificationDropdown.classList.contains('show-notification')) {
            notificationDropdown.classList.remove('show-notification');
            notificationDropdown.classList.add('fade-out');
            setTimeout(() => {
                notificationDropdown.classList.remove('fade-out');
                notificationDropdown.style.display = 'none';
            }, 300);
        }
    }

   // Avatar Dropdown Functionality
    const dropdownToggle = document.querySelector('.user-avatar');


    // Avatar Dropdown Functionality
if (dropdownToggle && dropdownMenu) {
    dropdownToggle.addEventListener('click', function (event) {
        event.stopPropagation();

        // Delay closing other dropdowns slightly to avoid initial double-click issue
        setTimeout(() => {
            // Check if the dropdown is already open before closing others
            const isOpen = dropdownMenu.classList.contains('show-avatar');
            if (!isOpen) {
                closeAllDropdowns(dropdownMenu); // Only close others if not already open
            }

            // Toggle avatar dropdown
            if (isOpen) {
                dropdownMenu.classList.remove('show-avatar');
                dropdownMenu.classList.add('fade-out');
                setTimeout(() => {
                    dropdownMenu.classList.remove('fade-out');
                    dropdownMenu.style.display = 'none';
                }, 300);
            } else {
                dropdownMenu.classList.remove('fade-out');
                dropdownMenu.style.display = 'block';
                dropdownMenu.classList.add('show-avatar');
            }
        }, 10); // Slight delay to avoid conflict with the current click event
    });

    document.addEventListener('click', function (event) {
        if (!dropdownMenu.contains(event.target) && !dropdownToggle.contains(event.target)) {
            closeAllDropdowns();
        }
    });
}


    



    // Notification Dropdown Functionality
    const notificationIcon = document.querySelector('.notification-icon-container');
    const notificationDropdown = document.querySelector('.notifications-menu');

    if (notificationIcon && notificationDropdown) {
      notificationIcon.addEventListener('click', function (event) {
        event.stopPropagation();
        closeAllDropdowns(notificationDropdown);
    
        if (notificationDropdown.classList.contains('show-notification')) {
          // Close the dropdown
          notificationDropdown.classList.remove('show-notification');
          notificationDropdown.classList.add('fade-out');
          setTimeout(() => {
            notificationDropdown.classList.remove('fade-out');
            notificationDropdown.style.display = 'none';
          }, 300);
        } else {
          // Open the dropdown and fetch notifications
          notificationDropdown.classList.remove('fade-out');
          notificationDropdown.style.display = 'block';
          notificationDropdown.classList.add('show-notification');
    
          fetchNotifications();
        }
      });

        document.addEventListener('click', function (event) {
            if (!notificationDropdown.contains(event.target) && !notificationIcon.contains(event.target)) {
                closeAllDropdowns();
            }
        });
    }


  

function fetchNotifications() {
  fetch('/notifications')
    .then((response) => response.json())
    .then((notifications) => {
      renderNotifications(notifications);
    })
    .catch((error) => {
      console.error('Error fetching notifications:', error);
    });
}



function undoDeleteNotification(notificationId) {
  fetch(`/notifications/${notificationId}/undo-delete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest', // Optional
    },
  })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        // Re-fetch notifications to update the list
        fetchNotifications();
      } else {
        showAlert('danger', 'Failed to undo deletion.');
      }
    })
    .catch(error => {
      console.error('Error undoing deletion:', error);
      showAlert('danger', 'An error occurred. Please try again.');
    });
}


function showAlert(type, message, options = {}) {
  const alertContainer = document.getElementById('alert-container');
  if (!alertContainer) return; // Exit if alert container doesn't exist

  const alert = document.createElement('div');
  alert.id = type === 'success' ? 'passwordChangeSuccess' : 'errorAlert';
  alert.className = `alert ${type === 'success' ? 'alert-success' : 'alert-error'}`;
  alert.setAttribute('role', 'alert');

  // Icon container
  const iconContainer = document.createElement('div');
  iconContainer.className = type === 'success' ? 'success-icon-container' : 'error-icon-container';
  const icon = document.createElement('i');
  icon.className = type === 'success' ? 'far fa-check-circle' : 'far fa-times-circle';
  iconContainer.appendChild(icon);

  // Close button container
  const closeContainer = document.createElement('div');
  closeContainer.className = type === 'success' ? 'success-close-container' : 'error-close-container';
  const closeIcon = document.createElement('span');
  closeIcon.className = 'material-symbols-outlined successCloseIcon';
  closeIcon.innerText = 'close';
  closeContainer.appendChild(closeIcon);

  // Text container
  const textContainer = document.createElement('div');
  textContainer.className = 'success-text';
  const title = document.createElement('h3');
  title.innerText = type === 'success' ? 'Success!' : 'Error!';
  const text = document.createElement('p');
  text.innerText = message;

  textContainer.appendChild(title);
  textContainer.appendChild(text);


      /**
     * Closes and removes an alert from the DOM.
     * @param {HTMLElement} alert - The alert element to close.
     */
      function closeAlert(alert) {
        alert.classList.add('exit');
        setTimeout(() => {
            if (alert && alert.parentNode) {
                alert.parentNode.removeChild(alert);
            }
        }, 500);
    }

  // If undo option is provided, add undo button
  if (options.undo) {
    const undoButton = document.createElement('button');
    undoButton.className = 'alert-undo-button';
    undoButton.innerText = 'Undo';
    undoButton.addEventListener('click', () => {
      options.undoCallback();
      // Close the alert after undo is clicked
      closeAlert(alert);
    });
    textContainer.appendChild(undoButton);
  }

  // Append elements to the alert
  alert.appendChild(iconContainer);
  alert.appendChild(closeContainer);
  alert.appendChild(textContainer);

  // Prepend alert to the container
  alertContainer.prepend(alert);

  // Trigger fade-in transition
  void alert.offsetWidth;
  alert.classList.add('show');

  // Auto-close alert after 5 seconds
  setTimeout(() => closeAlert(alert), 5000);
  closeIcon.addEventListener('click', () => closeAlert(alert));
}


  
// appScript.js

function deleteNotification(notificationId) {
  fetch(`/notifications/${notificationId}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest', // Optional
    },
  })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        // Remove the notification from the list
        const notificationItem = document.querySelector(`.notification-item[data-id="${notificationId}"]`);
        if (notificationItem) {
          notificationItem.remove();
        }

        // Show success alert with undo option
        showAlert('success', 'Notification deleted.', {
          undo: true,
          undoCallback: () => {
            undoDeleteNotification(notificationId);
          },
        });
      } else {
        showAlert('danger', 'Failed to delete notification.');
      }
    })
    .catch(error => {
      console.error('Error deleting notification:', error);
      showAlert('danger', 'An error occurred. Please try again.');
    });
}


/**
 * Escapes HTML special characters to prevent XSS.
 * @param {string} text - The text to escape.
 * @returns {string} - Escaped text.
 */
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, function(m) { return map[m]; });
}


  /**
 * Formats a date object into a user-friendly string excluding seconds.
 * Example Output: "Sep 15, 2023, 10:30 AM"
 * @param {string|Date} dateInput - The date to format.
 * @returns {string} - Formatted date string.
 */
  function formatTimestamp(dateInput) {
    const date = new Date(dateInput);
    const options = {
      year: 'numeric',
      month: 'short',    // Options: 'numeric', '2-digit', 'long', 'short', 'narrow'
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,      // Set to false for 24-hour format
      // second: undefined, // Explicitly excluding seconds
    };
    
    return date.toLocaleString(undefined, options);
  }

function renderNotifications(notifications) {
  const notificationsMenu = document.querySelector('.notifications-menu');
  notificationsMenu.innerHTML = ''; // Clear existing notifications

  if (notifications.length > 0) {
    notifications.forEach(notification => {
      const notificationItem = document.createElement('div');
      notificationItem.classList.add('notification-item');
      if (!notification.isRead) {
        notificationItem.classList.add('unread');
      }
      notificationItem.dataset.id = notification._id;

      notificationItem.innerHTML = `
        <div class="notification-content">
          <div class="notification-title">${escapeHtml(notification.title)}</div>
          <div class="notification-message">${escapeHtml(notification.message)}</div>
          <div class="notification-timestamp">${formatTimestamp(notification.timestamp)}</div>
        </div>
        <div class="notification-actions">
          <button class="delete-notification-button" data-id="${notification._id}" aria-label="Delete Notification">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      `;

      // Add click event to open modal
      notificationItem.addEventListener('click', () => {
        openNotificationModal(notification);
      });


      // Add click event to delete button
      const deleteButton = notificationItem.querySelector('.delete-notification-button');
      deleteButton.addEventListener('click', (event) => {
        event.stopPropagation(); // Prevent the notification click event
        deleteNotification(notification._id);
      });

      notificationsMenu.appendChild(notificationItem);
    });
  } else {
    notificationsMenu.innerHTML = '<p id="no-notifications-message" style="display: flex; justify-content: center; align-items: center; align-content: center; padding: 16px; font-size: 14px; color: grey;">No notifications</p>';
  }

  // Update the notification badge
  const unreadCount = notifications.filter(n => !n.isRead).length;
  const badge = document.querySelector('.notification-badge');
  if (unreadCount > 0) {
    badge.textContent = unreadCount;
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }
}

});
  
  // Function to open the notification modal
function openNotificationModal(notification) {
    // Create modal content with the fade class for Bootstrap animation
    const modalContent = `
      <div class="modal fade" id="notification-modal" tabindex="-1" aria-labelledby="notificationModalLabel" aria-hidden="true">
        <div class="modal-dialog">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title" id="notificationModalLabel">${notification.title}</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body">
              <p>${notification.message}</p>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
              ${
                notification.link
                  ? `<a href="${notification.link}" class="btn btn-primary">Go to Link</a>`
                  : ''
              }
            </div>
          </div>
        </div>
      </div>
    `;
  
    // Append to body
    document.body.insertAdjacentHTML('beforeend', modalContent);
  
    // Show modal
    const modalElement = document.getElementById('notification-modal');
    const modal = new bootstrap.Modal(modalElement);
    modal.show();
  
    // Mark notification as read
    fetch(`/notifications/${notification._id}/read`, { method: 'POST' });
  
    // Update the notification item styling
    const notificationItem = document.querySelector(
      `.notification-item[data-id="${notification._id}"]`
    );
    if (notificationItem) {
      notificationItem.classList.remove('unread');
    }
  
    // Remove modal from DOM when hidden
    modalElement.addEventListener('hidden.bs.modal', () => {
      modalElement.remove();
    });
  }
  
  












