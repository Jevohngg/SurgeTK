document.addEventListener('DOMContentLoaded', () => {
  console.log('🚀 Asset Allocation JS Loaded');

  // Determines which mapping container is currently visible
  function getActiveMappingContainer() {
    const account = document.getElementById('account-mapping-fields-container');
    const buckets = document.getElementById('buckets-mapping-fields-container');

    if (account && !account.closest('.import-step').classList.contains('hidden')) {
      return account;
    }
    if (buckets && !buckets.closest('.import-step').classList.contains('hidden')) {
      return buckets;
    }
    return null;
  }

  function synchronizeColumns(container) {
    if (!container) return;
    const selects = container.querySelectorAll('select');
    const selectedValues = Array.from(selects).map(s => s.value).filter(v => v);

    selects.forEach(sel => {
      const curr = sel.value;
      Array.from(sel.options).forEach(opt => {
        if (!opt.value) {
          opt.disabled = false;
        } else if (opt.value === curr) {
          opt.disabled = false;
        } else {
          opt.disabled = selectedValues.includes(opt.value);
        }
      });
    });
  }

  document.querySelectorAll('.add-allocation-btn').forEach(button => {
    button.addEventListener('click', () => {
      const field = button.getAttribute('data-field'); // e.g. 'cash'
      const activeContainer = getActiveMappingContainer();
      if (!activeContainer) return;

      const container = activeContainer.querySelector(`#${field}-allocation-container`);
      if (!container) return;

      const selectToClone = container.querySelector('select');
      if (!selectToClone) return;

      const newWrapper = document.createElement('div');
      newWrapper.className = 'allocation-select-wrapper d-flex mt-1';

      const newSelect = selectToClone.cloneNode(true);
      newSelect.value = '';
      newSelect.classList.add('form-select');

      newSelect.addEventListener('change', () => {
        synchronizeColumns(activeContainer);
      });

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'btn btn-sm btn-danger ms-2';
      removeBtn.textContent = '-';
      removeBtn.addEventListener('click', () => {
        newWrapper.remove();
        synchronizeColumns(activeContainer);
      });

      newWrapper.appendChild(newSelect);
      newWrapper.appendChild(removeBtn);
      container.appendChild(newWrapper);

      synchronizeColumns(activeContainer);
    });
  });
});
