// Sidebar toggle functionality for collapsing/expanding
document.querySelectorAll('.sidebar-toggle-icon').forEach(icon => {
    icon.addEventListener('click', () => {
        const sidebar = document.querySelector('.sidebar');
        const logo = document.querySelector('.company-logo img');
        const isCollapsed = sidebar.classList.toggle('collapsed'); // Toggle collapsed class on sidebar

        if (isCollapsed) {
            logo.src = '/images/collapsedIcon.png';
            localStorage.setItem('sidebarCollapsed', 'true'); // Save collapsed state
        } else {
            logo.src = '/images/InvictusLogo.png';
            localStorage.setItem('sidebarCollapsed', 'false'); // Save expanded state
        }
    });
});

// Apply the saved sidebar state on page load without flickering
document.addEventListener('DOMContentLoaded', () => {
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
            window.location.href = '/settings';
        });
    }

    if (isCollapsed) {
        sidebar.classList.add('collapsed');
        logo.src = '/images/collapsedIcon.png';
        logo.style.opacity = 1; // Ensure the icon is visible without animation
    } else {
        sidebar.classList.remove('collapsed');
        logo.src = '/images/InvictusLogo.png';
        logo.style.opacity = 1;
    }

    const currentPath = window.location.pathname;

    document.querySelectorAll('.nav-item a').forEach(link => {
        if (link.getAttribute('href') === currentPath) {
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
        notificationIcon.addEventListener('click', async function (event) {
            
            event.stopPropagation();
            closeAllDropdowns(notificationDropdown);

            if (notificationDropdown.classList.contains('show-notification')) {
                notificationDropdown.classList.remove('show-notification');
                notificationDropdown.classList.add('fade-out');

                setTimeout(() => {
                    notificationDropdown.classList.remove('fade-out');
                    notificationDropdown.style.display = 'none';
                }, 300);
            } else {
                notificationDropdown.classList.remove('fade-out');
                notificationDropdown.style.display = 'block';
                notificationDropdown.classList.add('show-notification');

                // Fetch notifications from the server
                const response = await fetch('/notifications');
                const notifications = await response.json();
                renderNotifications(notifications);
            }
        });

        document.addEventListener('click', function (event) {
            if (!notificationDropdown.contains(event.target) && !notificationIcon.contains(event.target)) {
                closeAllDropdowns();
            }
        });
    }

  
    // Function to render notifications
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
              <div class="notification-title">${notification.title}</div>
              <div class="notification-message">${notification.message}</div>
              <div class="notification-timestamp">${new Date(
                notification.timestamp
              ).toLocaleString()}</div>
            </div>
          `;
  
          // Add click event to open modal
          notificationItem.addEventListener('click', () => {
            openNotificationModal(notification);
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
  
  












