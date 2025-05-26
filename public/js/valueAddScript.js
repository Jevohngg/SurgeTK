// public/js/valueAddScript.js


document.addEventListener('DOMContentLoaded', function() {
    // 1) Identify the householdId from the existing global or hidden input
    const householdId = window.householdId; 
    if (!householdId) {
      console.warn('No householdId found in window. Dropdown navigation may fail.');
      return;
    }
  
    // 2) Get references to the dropdown elements
    const dropdownTrigger = document.getElementById('valueAddDropdownTrigger');
    const dropdownMenu = document.getElementById('valueAddDropdownMenu');
    const dropdownContainer = document.querySelector('.value-adds-title.dropdown');
  
    if (!dropdownTrigger || !dropdownMenu) {
      console.warn('Could not find the Value Add dropdown elements.');
      return;
    }
  
    // 3) Determine the current Value Add from the URL
    const currentPath = window.location.pathname; 
    let currentValueAdd = '';
    if (currentPath.includes('/buckets')) {
      console.log('BUCKETS!!!')
      currentValueAdd = 'buckets';
    } else if (currentPath.includes('/guardrails')) {
      console.log('GUARDRAILS!!!')
      currentValueAdd = 'guardrails';
    } else if (currentPath.includes('/beneficiary')) {
      currentValueAdd = 'beneficiary';
      console.log('BENEFICIARY!!!')
    }else if (currentPath.includes('/net-worth')) {
      currentValueAdd = 'netWorth';
      console.log('NETWORTH!!!')
      console.log(currentValueAdd)
    }
  
    // 4) Mark the correct item with a check + active class
    const menuItems = dropdownMenu.querySelectorAll('li.dropdown-item');
    menuItems.forEach(item => {
      if (item.dataset.value === currentValueAdd) {
        item.classList.add('checked', 'active');
      } else {
        item.classList.remove('checked', 'active');
      }
    });
  
    // 5) Toggle the dropdown open/close on click
    let isOpen = false;
    dropdownTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      isOpen = !isOpen;
      if (isOpen) {
        dropdownContainer.classList.add('open');
        dropdownMenu.classList.add('d-flex');
      } else {
        dropdownContainer.classList.remove('open');
        dropdownMenu.classList.remove('d-flex');
      }
    });
  
    // 6) Close the dropdown if clicking outside
    document.addEventListener('click', function(e) {
      if (!dropdownContainer.contains(e.target)) {
        isOpen = false;
        dropdownContainer.classList.remove('open');
        dropdownMenu.classList.remove('d-flex');
      }
    });
  
    // 7) Listen for clicks on the dropdown items => navigate
    menuItems.forEach(item => {
      item.addEventListener('click', () => {
        const selectedValueAdd = item.dataset.value;
        if (selectedValueAdd === currentValueAdd) {
          isOpen = false;
          dropdownContainer.classList.remove('open');
          dropdownMenu.classList.remove('d-flex');
          return;
        }
  
        const newUrl = `/households/${householdId}/${selectedValueAdd}`;
        window.location.href = newUrl;
      });
    });
  });
  