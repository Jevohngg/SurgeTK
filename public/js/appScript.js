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
    const sidebar = document.querySelector('.sidebar');
    const logo = document.querySelector('.company-logo img');
    const isCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';

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

    // Dropdown functionality for user avatar with fade-in and fade-out effect
    const dropdownToggle = document.querySelector('.user-avatar');
    const dropdownMenu = document.querySelector('.dropdown-menu');

    if (dropdownToggle && dropdownMenu) {
        dropdownToggle.addEventListener('click', function (event) {
            event.stopPropagation();

            if (dropdownMenu.classList.contains('show')) {
                dropdownMenu.classList.remove('show');
                dropdownMenu.classList.add('fade-out');

                setTimeout(() => {
                    dropdownMenu.classList.remove('fade-out');
                    dropdownMenu.style.display = 'none';
                }, 300); // Match this delay to the CSS animation duration
            } else {
                dropdownMenu.classList.remove('fade-out');
                dropdownMenu.style.display = 'block';
                dropdownMenu.classList.add('show');
            }
        });

        // Close dropdown if clicking outside
        document.addEventListener('click', function (event) {
            if (!dropdownMenu.contains(event.target) && !dropdownToggle.contains(event.target)) {
                if (dropdownMenu.classList.contains('show')) {
                    dropdownMenu.classList.remove('show');
                    dropdownMenu.classList.add('fade-out');

                    setTimeout(() => {
                        dropdownMenu.classList.remove('fade-out');
                        dropdownMenu.style.display = 'none';
                    }, 300);
                }
            }
        });
    }
});
