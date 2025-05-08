// assetAllocationMapping.js
document.addEventListener('DOMContentLoaded', () => {

    function synchronizeAccountColumns() {
        const accountMappingContainer = document.getElementById('account-mapping-fields-container');
        if (!accountMappingContainer) return;
        const selects = accountMappingContainer.querySelectorAll('select');
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

    // 1) Listen for clicks on the plus (+) buttons
    document.querySelectorAll('.add-allocation-btn').forEach(button => {
      button.addEventListener('click', () => {
        const field = button.getAttribute('data-field'); // e.g., "cash", "income"
        const containerId = `${field}-allocation-container`; // e.g., "cash-allocation-container"
        const container = document.getElementById(containerId);
        if (!container) return;
  
        // 2) Clone the existing select
        const existingSelect = container.querySelector('select.form-select');
        if (!existingSelect) return;
  
        // Create a small wrapper for the new select + remove button
        const newWrapper = document.createElement('div');
        newWrapper.classList.add('allocation-select-wrapper', 'd-flex', 'mt-1');
  
        const newSelect = existingSelect.cloneNode(true);
        newSelect.value = ''; // reset to default
  
        // *** Add a change listener so that if user picks a column,
        // we re-run synchronizeAccountColumns() to disable it globally.
        newSelect.addEventListener('change', () => {
          synchronizeAccountColumns();
       
        });
  
        // OPTIONAL: Add a remove button
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'btn btn-sm btn-danger ms-2 remove-allocation-btn';
        removeBtn.innerText = '-';
  
        removeBtn.addEventListener('click', () => {
          newWrapper.remove();
          // *** After removing, re-run sync so any freed-up option
          // becomes available in other selects:
          synchronizeAccountColumns();
       
        });
  
        newWrapper.appendChild(newSelect);
        newWrapper.appendChild(removeBtn);
  
        container.appendChild(newWrapper);
  
        // *** Also call synchronizeAccountColumns immediately so that
        // the new select’s empty value doesn’t cause conflicts:
        synchronizeAccountColumns();

      });
    });
  });
  