// Sidebar toggle functionality for collapsing/expanding
document.querySelectorAll('.sidebar-toggle-icon').forEach(icon => {
  icon.addEventListener('click', () => {
      const sidebar = document.querySelector('.sidebar');
      const logo = document.querySelector('.company-logo img');
      const isCollapsed = sidebar.classList.toggle('collapsed'); // Toggle collapsed class on sidebar

      if (isCollapsed) {
          logo.src = '/images/favicon.svg';
          localStorage.setItem('sidebarCollapsed', 'true'); // Save collapsed state
      } else {
          logo.src = '/images/surgetk_logo_vertical_blue.svg';
          localStorage.setItem('sidebarCollapsed', 'false'); // Save expanded state
      }
  });
});

// Apply the saved sidebar state before the DOM is fully loaded
if (localStorage.getItem('sidebarCollapsed') === 'true') {
  document.documentElement.classList.add('sidebar-collapsed', 'no-transition');
} else {
  document.documentElement.classList.add('no-transition');
}

// Remove the 'no-transition' class after the page has loaded
window.addEventListener('load', () => {
  document.documentElement.classList.remove('no-transition');
});


// Immediately apply the collapsed state before the DOM is fully loaded
if (localStorage.getItem('sidebarCollapsed') === 'true') {
  document.documentElement.classList.add('sidebar-collapsed'); // Or target a specific container
}

// Apply the saved sidebar state on page load without flickering
document.addEventListener('DOMContentLoaded', () => {
  console.log("JS is loaded and DOM is ready!");


  const form = document.getElementById('connect-redtail-form');
  console.log("connect-redtail-form is:", form);
    form.addEventListener('submit', async function(e) {
      e.preventDefault();

      const environment = document.getElementById('redtailEnvironment').value;
      const username = document.getElementById('redtailUsername').value;
      const password = document.getElementById('redtailPassword').value;

      try {
        const response = await fetch('/api/integrations/redtail/connect', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ environment, username, password })
        });
        const data = await response.json();

        if (data.success) {
         
          showAlert('success', 'Redtail connected successfully!');
          // Optionally close modal:
          const modalEl = document.getElementById('connectRedtailModal');
          const modal = bootstrap.Modal.getInstance(modalEl);
          modal.hide();
        } else {
          showAlert('danger', 'Error connecting to Redtail: ' + data.message);
        }
      } catch (err) {
        console.error('Error:', err);
        showAlert('danger', 'An error occurred while connecting to Redtail.');
      }
    });







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
  
  












