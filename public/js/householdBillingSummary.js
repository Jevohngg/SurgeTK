// public/js/householdBillingSummary.js
(function () {
    const box = document.getElementById('annualBillingDataBox');
    if (!box) return;
  
    const moreBtn = box.querySelector('.summary-more-button');
    const menu    = box.querySelector('.summary-billing-menu');
  
    function closeMenu() {
      if (!menu) return;
      if (menu.classList.contains('show-more-menu')) {
        menu.classList.add('fade-out');
        menu.addEventListener('animationend', () => {
          menu.classList.remove('fade-out', 'show-more-menu');
          menu.style.display = 'none';
          moreBtn?.setAttribute('aria-expanded', 'false');
        }, { once: true });
      }
    }
  
    function openMenu() {
      if (!menu) return;
      // Close any other open menus on the page (reuse your existing pattern)
      document.querySelectorAll('.dropdown-menu.show-more-menu, .dropdown-menu.fade-out').forEach(m => {
        if (m !== menu) {
          m.classList.remove('show-more-menu', 'fade-out');
          m.style.display = 'none';
        }
      });
      menu.style.display = 'block';
      menu.classList.add('show-more-menu');
      moreBtn?.setAttribute('aria-expanded', 'true');
    }
  
    moreBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      const isShown = menu?.classList.contains('show-more-menu');
      if (isShown) closeMenu(); else openMenu();
    });
  
    document.addEventListener('click', (e) => {
      if (box.contains(e.target)) return; // clicks inside the box are handled
      closeMenu();
    });

    breakdownLink?.addEventListener('click', (e) => {
      e.preventDefault();
      closeMenu();
      const modalEl = document.getElementById('householdBillingBreakdownModal');
      if (!modalEl) return;
      const m = bootstrap.Modal.getOrCreateInstance(modalEl);
      m.show();
    
      // Init tooltips inside the modal
      const tooltipEls = modalEl.querySelectorAll('[data-bs-toggle="tooltip"]');
      tooltipEls.forEach(el => new bootstrap.Tooltip(el, { container: modalEl }));
    });
    
  
    // Hook "See breakdown"
    const breakdownLink = box.querySelector('.js-open-household-billing-breakdown');
    breakdownLink?.addEventListener('click', (e) => {
      e.preventDefault();
      closeMenu();
      const modalEl = document.getElementById('householdBillingBreakdownModal');
      if (!modalEl) return;
      const m = bootstrap.Modal.getOrCreateInstance(modalEl);
      m.show();
    });
  })();
  