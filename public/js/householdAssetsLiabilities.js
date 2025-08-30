// public/js/householdAssetsLiabilities.js
document.addEventListener('DOMContentLoaded', () => {
  const householdId = document.getElementById('household-id').value;

  /********************************************************
   * Copy of your existing accounts showAlert function
   ********************************************************/
  function showAlert(type, message, options = {}) {
    const alertContainer = document.getElementById('alert-container');
    if (!alertContainer) return;

    const alert = document.createElement('div');
    alert.id = type === 'success' ? 'passwordChangeSuccess' : 'errorAlert';
    alert.className = `alert ${type === 'success' ? 'alert-success' : 'alert-error'}`;
    alert.setAttribute('role', 'alert');

    const iconContainer = document.createElement('div');
    iconContainer.className = type === 'success' ? 'success-icon-container' : 'error-icon-container';
    const icon = document.createElement('i');
    icon.className = type === 'success' ? 'far fa-check-circle' : 'far fa-times-circle';
    iconContainer.appendChild(icon);

    const closeContainer = document.createElement('div');
    closeContainer.className = type === 'success' ? 'success-close-container' : 'error-close-container';
    const closeIcon = document.createElement('span');
    closeIcon.className = 'material-symbols-outlined successCloseIcon';
    closeIcon.innerText = 'close';
    closeContainer.appendChild(closeIcon);

    const textContainer = document.createElement('div');
    textContainer.className = type === 'success' ? 'success-text' : 'error-text';
    const title = document.createElement('h3');
    title.innerText = type === 'success' ? 'Success!' : 'Error!';
    const text = document.createElement('p');
    text.innerText = message;

    textContainer.appendChild(title);
    textContainer.appendChild(text);

    if (options.undo) {
      const undoButton = document.createElement('button');
      undoButton.className = 'alert-undo-button';
      undoButton.innerText = 'Undo';
      undoButton.addEventListener('click', () => {
        options.undoCallback();
        closeAlert(alert);
      });
      textContainer.appendChild(undoButton);
    }

    alert.appendChild(iconContainer);
    alert.appendChild(closeContainer);
    alert.appendChild(textContainer);

    alertContainer.prepend(alert);

    void alert.offsetWidth;
    alert.classList.add('show');

    setTimeout(() => closeAlert(alert), 5000);
    closeIcon.addEventListener('click', () => closeAlert(alert));

    function closeAlert(a) {
      a.classList.add('exit');
      setTimeout(() => {
        if (a && a.parentNode) {
          a.parentNode.removeChild(a);
        }
      }, 500);
    }
  }

  /********************************************************
   * Debounce helper
   ********************************************************/
  function debounce(fn, delay = 300) {
    let to;
    return (...args) => {
      clearTimeout(to);
      to = setTimeout(() => fn(...args), delay);
    };
  }

  /********************************************************
   * Shared dropdown handler
   ********************************************************/
  function attachDropdownHandlers(container, viewCb, editCb, deleteCb) {
    const btn = container.querySelector('.three-dots-btn');
    const menu = container.querySelector('.dropdown-menu');
    btn.addEventListener('click', e => {
      e.stopPropagation();
      menu.classList.toggle('show');
    });
    document.addEventListener('click', () => menu.classList.remove('show'));

    menu.querySelector('.view-asset')?.addEventListener('click', viewCb);
    menu.querySelector('.edit-asset')?.addEventListener('click', editCb);
    menu.querySelector('.delete-asset')?.addEventListener('click', deleteCb);
  }

  /********************************************************
   * ASSETS LOGIC
   ********************************************************/
  let aPage  = 1,
      aTotal = 0,
      aPages = 1,
      // Default sort by assetNumber ascending
      aSort  = 'assetNumber',
      aOrder = 'asc',
      aSearch= '';

  const aBody        = document.getElementById('assets-table-body'),
        aSearchInput = document.getElementById('search-assets'),
        aAddBtn      = document.getElementById('add-asset-button'),
        eAddBtn      = document.getElementById('empty-add-asset-button'),
        aSelectAll   = document.getElementById('select-all-assets'),
        aSelBox      = document.querySelector('.selection-container-assets'),
        aSelCount    = document.getElementById('assets-selection-count'),
        aClear       = document.getElementById('clear-assets-selection'),
        aDelSel      = document.getElementById('delete-selected-assets'),
        aPagination  = document.querySelector('#assets-pagination ul.pagination'),
        aPageInfo    = document.getElementById('assets-pagination-info');

  const selectedAssets = new Set();

  // This flag is used to prevent repeated show/hide transitions colliding
  let isTransitioningAssets = false;

  // 1) Show the selection container
  function showAssetsSelectionContainer() {
    if (isTransitioningAssets) return;
    isTransitioningAssets = true;
    aSelBox.classList.remove('hidden');
    aSelBox.classList.add('visible');
    aSelBox.setAttribute('aria-hidden', 'false');
    aSelBox.addEventListener('transitionend', () => {
      isTransitioningAssets = false;
    }, { once: true });
  }

  // 2) Hide the selection container
  function hideAssetsSelectionContainer() {
    if (isTransitioningAssets) return;
    isTransitioningAssets = true;
    aSelBox.classList.remove('visible');
    aSelBox.setAttribute('aria-hidden', 'true');
    aSelBox.addEventListener('transitionend', () => {
      isTransitioningAssets = false;
    }, { once: true });
  }

  // 3) Called whenever the selection changes
  function updateAssetsSelectionContainer() {
    const n = selectedAssets.size;
    if (n > 0) {
      if (!aSelBox.classList.contains('visible')) {
        showAssetsSelectionContainer();
      }
      aSelCount.textContent = `${n} asset${n > 1 ? 's' : ''} selected`;
    } else {
      if (aSelBox.classList.contains('visible')) {
        hideAssetsSelectionContainer();
      }
    }
  }



  



  function fetchAssets() {
    fetch(
      `/api/households/${householdId}/assets?page=${aPage}&limit=10` +
      `&sortField=${encodeURIComponent(aSort)}` +
      `&sortOrder=${encodeURIComponent(aOrder)}` +
      (aSearch ? `&search=${encodeURIComponent(aSearch)}` : '')
    )
      .then(r => r.json())
      .then(({ assets, totalAssets, currentPage, totalPages }) => {
        aBody.innerHTML = '';
        aTotal = totalAssets;
        aPage = currentPage;
        aPages = totalPages;

        if (!assets.length) {
          document.querySelector('.empty-state.assets').classList.remove('hidden');
          document.querySelector('.table-container.assets').classList.add('hidden');
        } else {
          document.querySelector('.empty-state.assets').classList.add('hidden');
          document.querySelector('.table-container.assets').classList.remove('hidden');
        }

        assets.forEach(a => {
          const tr = document.createElement('tr');
          tr.dataset.id = a._id;

          // checkbox cell
          const td0 = document.createElement('td');
          td0.classList.add('inputTh');
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.classList.add('asset-checkbox');
          cb.dataset.id = a._id;
          if (selectedAssets.has(a._id)) cb.checked = true;
          td0.append(cb);
          tr.append(td0);

          // Owner cell
          const td1 = document.createElement('td');
          td1.classList.add('assetOwnerCell');
          // assume API now returns asset.owners = [ {firstName,lastName}, ...]
if (Array.isArray(a.owners) && a.owners.length > 1) {
  td1.textContent = 'Joint';
} else if (a.owners[0]) {
  td1.textContent = `${a.owners[0].firstName} ${a.owners[0].lastName}`;
} else {
  td1.textContent = '—';
}

          tr.append(td1);

          // assetType
          const tdType = document.createElement('td');
          tdType.classList.add('typeCell');
          tdType.textContent = a.assetType || '—';
          tr.append(tdType);

          // assetName
          const tdName = document.createElement('td');
          tdName.classList.add('assetNameCell');
          tdName.textContent = a.assetName || '—';
          tr.append(tdName);

          // assetValue
          const tdVal = document.createElement('td');
          tdVal.classList.add('assetValueCell');
          tdVal.textContent = `$${(a.assetValue || 0).toLocaleString()}`;
          tr.append(tdVal);

          // actions
          const tdA = document.createElement('td');
          tdA.classList.add('actionsCell');
          tdA.innerHTML = `
            <div class="dropdown">
              <button class="btn btn-link p-0 three-dots-btn assets-more-button ">
                <i class="fas fa-ellipsis-v"></i>
              </button>
              <ul class="dropdown-menu">
                <li><a class="dropdown-item view-asset" href="#">View</a></li>
                <li><a class="dropdown-item edit-asset" href="#">Edit</a></li>
                <li><a class="dropdown-item delete-asset text-danger" href="#">Delete</a></li>
              </ul>
            </div>`;
          tr.append(tdA);

          aBody.append(tr);

          // Checkbox handler
          cb.addEventListener('change', () => {
            if (cb.checked) {
              selectedAssets.add(a._id);
            } else {
              selectedAssets.delete(a._id);
            }
            // Update "Select All" state
            const allCheckboxes = document.querySelectorAll('.asset-checkbox');
            const allChecked = [...allCheckboxes].every(x => x.checked);
            aSelectAll.checked = allChecked;
            aSelectAll.indeterminate =
              !allChecked && [...allCheckboxes].some(x => x.checked);

            updateAssetsSelectionContainer();
          });

          // attach dropdown handlers
          attachDropdownHandlers(
            tdA,
            () => viewAsset(a._id),
            () => editAsset(a._id),
            () => confirmDeleteAsset(a._id)
          );
        });

        renderAssetPagination();
      })
      .catch(() => showAlert('danger', 'Error fetching assets.'));
  }

  function renderAssetPagination() {
    aPagination.innerHTML = '';

    function mk(label, enabled, cb) {
      const li = document.createElement('li');
      li.classList.add('page-item');
      if (!enabled) li.classList.add('disabled');

      const btn = document.createElement('button');
      btn.classList.add('page-link');
      btn.textContent = label;
      if (enabled) btn.addEventListener('click', cb);
      li.appendChild(btn);
      return li;
    }

    aPagination.appendChild(
      mk('Prev', aPage > 1, () => {
        aPage--;
        fetchAssets();
      })
    );

    for (let i = Math.max(1, aPage - 2); i <= Math.min(aPages, aPage + 2); i++) {
      const li = mk(i, i !== aPage, () => {
        aPage = i;
        fetchAssets();
      });
      if (i === aPage) {
        li.classList.add('active');
      }
      aPagination.appendChild(li);
    }

    aPagination.appendChild(
      mk('Next', aPage < aPages, () => {
        aPage++;
        fetchAssets();
      })
    );

    aPageInfo.textContent = `Page ${aPage} of ${aPages} | Total: ${aTotal}`;
  }

  // View Asset
  function viewAsset(id) {
    fetch(`/api/assets/${id}`)
      .then(r => r.json())
      .then(a => {
        const modal = new bootstrap.Modal(document.getElementById('viewAssetModal'));
// Before you build your `html`…
const owners = Array.isArray(a.owners)
  ? a.owners
  : (a.owner ? [a.owner] : []);
let ownerName = '—';
if (owners.length > 1) {
  ownerName = 'Joint';
} else if (owners.length === 1) {
  ownerName = `${owners[0].firstName} ${owners[0].lastName}`;
}

// then your html:
let html = `<p><strong>Owner:</strong> ${ownerName}</p>`;


        ['assetType', 'assetNumber'].forEach(f => {
          html += `<p><strong>${f.replace(/([A-Z])/g, ' $1')}:</strong> ${a[f] || '—'}</p>`;
        });
        html += `<p><strong>Display Name:</strong> ${a.assetName || '—'}</p>`;
        html += `<p><strong>Value:</strong> $${a.assetValue.toLocaleString()}</p>`;
        html += `<p><strong>Created:</strong> ${new Date(a.createdAt).toLocaleString()}</p>`;
        html += `<p><strong>Updated:</strong> ${new Date(a.updatedAt).toLocaleString()}</p>`;

        document.getElementById('view-asset-content').innerHTML = html;
        modal.show();
      });
  }

  // Edit Asset
  function editAsset(id) {
    fetch(`/api/assets/${id}`)
      .then(r => r.json())
      .then(a => {
        document.getElementById('editAssetId').value = a._id;
        const ownerSelect = document.getElementById('editAssetOwner');
        if (Array.isArray(a.owners) && a.owners.length > 1) {
          ownerSelect.value = 'joint';
        } else if (Array.isArray(a.owners) && a.owners.length === 1) {
          ownerSelect.value = a.owners[0]._id;
        } else {
          ownerSelect.value = '';
        }
        
        document.getElementById('editAssetType').value = a.assetType || '';
        document.getElementById('editAssetNumber').value = a.assetNumber || '';
        document.getElementById('editAssetValue').value = a.assetValue || 0;
        document.getElementById('editAssetName').value = a.assetName || '';
        new bootstrap.Modal(document.getElementById('editAssetModal')).show();
      });
  }

  // Confirm Delete Single
  function confirmDeleteAsset(id) {
    const dlg = new bootstrap.Modal(document.getElementById('deleteConfirmationModal'));
    const messageEl = document.getElementById('delete-modal-message');
    if (messageEl) {
      messageEl.textContent = 'Are you sure you want to delete this asset? This action cannot be undone and will remove all associated asset data.';
    }
    dlg.show();

    document.getElementById('confirm-delete').onclick = () => {
      fetch(`/api/assets/${id}`, { method: 'DELETE' })
        .then(r => r.json())
        .then(r => {
          showAlert('success', r.message || 'Deleted');
          fetchAssets();
        })
        .catch(() => showAlert('danger', 'Delete failed'))
        .finally(() => dlg.hide());
    };
  }

  // Bulk "select all"
  aSelectAll.addEventListener('change', () => {
    const allCbs = document.querySelectorAll('.asset-checkbox');
    allCbs.forEach(cb => {
      cb.checked = aSelectAll.checked;
      if (aSelectAll.checked) {
        selectedAssets.add(cb.dataset.id);
      } else {
        selectedAssets.delete(cb.dataset.id);
      }
    });
    updateAssetsSelectionContainer();
  });

  // Clear selection link
  aClear.addEventListener('click', e => {
    e.preventDefault();
    selectedAssets.clear();
    document.querySelectorAll('.asset-checkbox').forEach(cb => (cb.checked = false));
    aSelectAll.checked = false;
    aSelectAll.indeterminate = false;
    updateAssetsSelectionContainer();
  });

  // Bulk delete
  aDelSel.addEventListener('click', () => {
    if (!selectedAssets.size) return;

    const dlg = new bootstrap.Modal(document.getElementById('deleteConfirmationModal'));
    const messageEl = document.getElementById('delete-modal-message');
    if (messageEl) {
      messageEl.textContent = 'Are you sure you want to delete the selected assets? This action cannot be undone and will remove all associated asset data.';
    }
    dlg.show();

    document.getElementById('confirm-delete').onclick = () => {
      fetch(`/api/assets/bulk-delete`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetIds: [...selectedAssets] })
      })
        .then(response => {
          if (!response.ok) {
            return response.json().then(err => {
              throw new Error(err.message || 'Bulk delete failed with server error');
            });
          }
          return response.json();
        })
        .then(r => {
          showAlert('success', r.message);
          selectedAssets.clear();
          updateAssetsSelectionContainer();
          fetchAssets();
        })
        .catch(err => {
          showAlert('danger', err.message || 'Bulk delete failed');
        })
        .finally(() => dlg.hide());
    };
  });

  // SORTING LOGIC: handle clicks on the i.sort-icon elements
  // -------------------------------------------------------
  const sortIcons = document.querySelectorAll('.sort-icon');
  sortIcons.forEach(icon => {
    icon.addEventListener('click', () => {
      // Grab which field to sort by from data-field
      const field = icon.getAttribute('data-field');

      // If the user clicks the same field again, we flip aOrder
      if (aSort === field) {
        aOrder = aOrder === 'asc' ? 'desc' : 'asc';
      } else {
        // otherwise set new sort field, default to ascending
        aSort = field;
        aOrder = 'asc';
      }
      // Re-fetch
      fetchAssets();
    });
  });
  // -------------------------------------------------------

  // Search
  aSearchInput.addEventListener('input', debounce(() => {
    aSearch = aSearchInput.value.trim();
    aPage = 1;
    fetchAssets();
  }, 300));

  // Add Asset button
  aAddBtn.addEventListener('click', () => {
    document.getElementById('assetId').value = '';
    document.getElementById('assetType').value = '';
    document.getElementById('assetNumber').value = '';
    document.getElementById('assetValue').value = '';
    document.getElementById('assetName').value = '';
    new bootstrap.Modal(document.getElementById('addAssetModal')).show();
  });

  // Also handle the "Add" button in the empty-state area
  eAddBtn?.addEventListener('click', () => {
    document.getElementById('assetId').value = '';
    document.getElementById('assetType').value = '';
    document.getElementById('assetNumber').value = '';
    document.getElementById('assetValue').value = '';
    document.getElementById('assetName').value = '';
    new bootstrap.Modal(document.getElementById('addAssetModal')).show();
  });

  // Add Asset form submit
  document.getElementById('add-asset-form').addEventListener('submit', e => {
    e.preventDefault();
    const data = {
      owner      : document.getElementById('assetOwner').value,
      assetType  : document.getElementById('assetType').value,
      assetNumber: document.getElementById('assetNumber').value,
      assetValue : parseFloat(document.getElementById('assetValue').value),
      assetName: document.getElementById('assetName').value
    };
    fetch(`/api/households/${householdId}/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
      .then(r => r.json())
      .then(r => {
        if (r.message?.toLowerCase().includes('success')) {
          const modalEl = document.getElementById('addAssetModal');
          const modal   = bootstrap.Modal.getInstance(modalEl);
          if (modal) modal.hide();

          // Reset form
          document.getElementById('add-asset-form').reset();
          showAlert('success', r.message);
          fetchAssets();
        } else {
          showAlert('danger', r.message);
        }
      })
      .catch(() => showAlert('danger', 'Error adding asset.'));
  });

  // Edit Asset form submit
  document.getElementById('edit-asset-form').addEventListener('submit', e => {
    e.preventDefault();
    const id = document.getElementById('editAssetId').value;
    const data = {
      owner      : document.getElementById('editAssetOwner').value,
      assetType  : document.getElementById('editAssetType').value,
      assetNumber: document.getElementById('editAssetNumber').value,
      assetValue : parseFloat(document.getElementById('editAssetValue').value),
      assetName: document.getElementById('editAssetName').value
    };
    fetch(`/api/households/${householdId}/assets/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
      .then(r => r.json())
      .then(r => {
        if (r.message?.toLowerCase().includes('success')) {
          const editModalEl = document.getElementById('editAssetModal');
          const editModal   = bootstrap.Modal.getInstance(editModalEl);
          if (editModal) editModal.hide();

          showAlert('success', r.message);
          fetchAssets();
        } else {
          showAlert('danger', r.message);
        }
      })
      .catch(() => showAlert('danger', 'Error updating asset.'));
  });

  // Initial load
  fetchAssets();














  /********************************************************
   * LIABILITIES LOGIC
   ********************************************************/

  // build a map of client IDs → display names for fallback
  const clientSelect = document.getElementById('editLiabilityOwner');
  const clientMap = {};
  if (clientSelect) {
    Array.from(clientSelect.options).forEach(opt => {
      if (opt.value) clientMap[opt.value] = opt.text;
    });
  }

  /**
   * Like attachDropdownHandlers, but for liabilities
   */
  function attachLiabilityDropdownHandlers(container, viewCb, editCb, deleteCb) {
    const btn  = container.querySelector('.three-dots-btn');
    const menu = container.querySelector('.dropdown-menu');

    btn.addEventListener('click', e => {
      e.stopPropagation();
      menu.classList.toggle('show');
    });
    document.addEventListener('click', () => menu.classList.remove('show'));

    menu.querySelector('.view-liability').addEventListener('click', e => {
      e.preventDefault();
      viewCb();
    });
    menu.querySelector('.edit-liability').addEventListener('click', e => {
      e.preventDefault();
      editCb();
    });
    menu.querySelector('.delete-liability').addEventListener('click', e => {
      e.preventDefault();
      deleteCb();
    });
  }

  // avoid transition collisions
  let isTransitioningLiabilities = false;
  function showLiabilitiesSelectionContainer() {
    if (isTransitioningLiabilities) return;
    isTransitioningLiabilities = true;
    lSelBox.classList.remove('hidden');
    lSelBox.classList.add('visible');
    lSelBox.setAttribute('aria-hidden', 'false');
    lSelBox.addEventListener('transitionend', () => {
      isTransitioningLiabilities = false;
    }, { once: true });
  }
  function hideLiabilitiesSelectionContainer() {
    if (isTransitioningLiabilities) return;
    isTransitioningLiabilities = true;
    lSelBox.classList.remove('visible');
    lSelBox.setAttribute('aria-hidden', 'true');
    lSelBox.addEventListener('transitionend', () => {
      isTransitioningLiabilities = false;
    }, { once: true });
  }

  let lPage   = 1,
      lTotal  = 0,
      lPages  = 1,
      lSort   = 'accountLoanNumber',
      lOrder  = 'asc',
      lSearch = '';

  const lBody        = document.getElementById('liabilities-table-body'),
        lSearchInput = document.getElementById('search-liabilities'),
        lAddBtn      = document.getElementById('add-liability-button'),
        elAddBtn     = document.getElementById('empty-add-liability-button'),
        lSelectAll   = document.getElementById('select-all-liabilities'),
        lSelBox      = document.querySelector('.selection-container-liabilities.liabilities'),
        lSelCount    = document.getElementById('liabilities-selection-count'),
        lClear       = document.getElementById('clear-liabilities-selection'),
        lDelSel      = document.getElementById('delete-selected-liabilities'),
        lPagination  = document.querySelector('#liabilities-pagination ul.pagination'),
        lPageInfo    = document.getElementById('liabilities-pagination-info');

  const selectedLiabilities = new Set();

  function fetchLiabilities() {
    fetch(
      `/api/households/${householdId}/liabilities` +
      `?page=${lPage}&limit=10&sortField=${lSort}&sortOrder=${lOrder}` +
      (lSearch ? `&search=${encodeURIComponent(lSearch)}` : '')
    )
      .then(r => r.json())
      .then(({ liabilities, totalLiabilities, currentPage, totalPages }) => {
        lBody.innerHTML = '';
        lTotal = totalLiabilities;
        lPage  = currentPage;
        lPages = totalPages;

        if (!liabilities.length) {
          document.querySelector('.empty-state.liabilities').classList.remove('hidden');
          document.querySelector('.table-container.liabilities').classList.add('hidden');
        } else {
          document.querySelector('.empty-state.liabilities').classList.add('hidden');
          document.querySelector('.table-container.liabilities').classList.remove('hidden');
        }

        liabilities.forEach(l => {
          const tr = document.createElement('tr');
          tr.dataset.id = l._id;

          // checkbox
          const td0 = document.createElement('td');
          td0.classList.add('inputTh');
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.classList.add('liability-checkbox');
          cb.dataset.id = l._id;
          if (selectedLiabilities.has(l._id)) cb.checked = true;
          td0.append(cb);
          tr.append(td0);

          // owner cell (array of owners)
          const td1 = document.createElement('td');
          td1.classList.add('liability-owner-cell');
          if (Array.isArray(l.owners) && l.owners.length > 1) {
            td1.textContent = 'Joint';
          } else if (Array.isArray(l.owners) && l.owners.length === 1) {
            const o = l.owners[0];
            td1.textContent = `${o.firstName} ${o.lastName}`;
          } else {
            td1.textContent = '—';
          }
          tr.append(td1);

          // liabilityType
          const tdType = document.createElement('td');
          tdType.classList.add('liability-type-cell');
          tdType.textContent = l.liabilityType || '—';
          tr.append(tdType);

          // liabilityName
          const tdName = document.createElement('td');
          tdName.classList.add('liabilityNameCell');
          tdName.textContent = l.liabilityName || '—';
          tr.append(tdName);

          // outstandingBalance
          const tdBal = document.createElement('td');
          tdBal.classList.add('liability-balance-cell');
          tdBal.textContent = `$${(l.outstandingBalance||0).toLocaleString()}`;
          tr.append(tdBal);

          // actions
          const tdA = document.createElement('td');
          tdA.classList.add('actionsCell');
          tdA.innerHTML = `
            <div class="dropdown">
              <button class="btn btn-link p-0 three-dots-btn liabilities-more-button">
                <i class="fas fa-ellipsis-v"></i>
              </button>
              <ul class="dropdown-menu">
                <li><a class="dropdown-item view-liability" href="#">View</a></li>
                <li><a class="dropdown-item edit-liability" href="#">Edit</a></li>
                <li><a class="dropdown-item delete-liability text-danger" href="#">Delete</a></li>
              </ul>
            </div>`;
          tr.append(tdA);
          lBody.append(tr);

          // handlers
          cb.addEventListener('change', () => {
            cb.checked ? selectedLiabilities.add(l._id) : selectedLiabilities.delete(l._id);
            updateLiabilitySelectionBox();
          });
          attachLiabilityDropdownHandlers(
            tdA,
            () => viewLiability(l._id),
            () => editLiability(l._id),
            () => confirmDeleteLiability(l._id)
          );
        });

        renderLiabilityPagination();
      })
      .catch(() => showAlert('danger','Error fetching liabilities.'));
  }

  function renderLiabilityPagination() {
    lPagination.innerHTML = '';
    function mk(label, enabled, cb) {
      const li = document.createElement('li');
      li.classList.add('page-item');
      if (!enabled) li.classList.add('disabled');
      const btn = document.createElement('button');
      btn.classList.add('page-link');
      btn.textContent = label;
      if (enabled) btn.addEventListener('click', cb);
      li.append(btn);
      return li;
    }

    lPagination.append(mk('Prev', lPage > 1, () => { lPage--; fetchLiabilities(); }));

    for (let i = Math.max(1, lPage - 2); i <= Math.min(lPages, lPage + 2); i++) {
      const li = mk(i, i !== lPage, () => { lPage = i; fetchLiabilities(); });
      if (i === lPage) li.classList.add('active');
      lPagination.append(li);
    }

    lPagination.append(mk('Next', lPage < lPages, () => { lPage++; fetchLiabilities(); }));

    lPageInfo.textContent = `Page ${lPage} of ${lPages} | Total: ${lTotal}`;
  }

  function updateLiabilitySelectionBox() {
    const n = selectedLiabilities.size;
    if (n > 0) {
      showLiabilitiesSelectionContainer();
      lSelCount.textContent = n === 1 ? '1 liability selected' : `${n} liabilities selected`;
    } else {
      hideLiabilitiesSelectionContainer();
    }
    const boxes = Array.from(document.querySelectorAll('.liability-checkbox'));
    const allChecked = boxes.length && boxes.every(cb => cb.checked);
    const someChecked = boxes.some(cb => cb.checked);
    lSelectAll.checked = allChecked;
    lSelectAll.indeterminate = !allChecked && someChecked;
  }

  function viewLiability(id) {
    fetch(`/api/liabilities/${id}`)
      .then(r => r.json())
      .then(l => {
        const modal = new bootstrap.Modal(document.getElementById('viewLiabilityModal'));
        let ownerName = '—';
        if (Array.isArray(l.owners)) {
          if (l.owners.length > 1) ownerName = 'Joint';
          else if (l.owners.length === 1) {
            ownerName = `${l.owners[0].firstName} ${l.owners[0].lastName}`;
          }
        }
        let html = `<p><strong>Owner:</strong> ${ownerName}</p>`;
        ['liabilityType','creditorName','accountLoanNumber'].forEach(f => {
          html += `<p><strong>${f.replace(/([A-Z])/g,' $1')}:</strong> ${l[f] || '—'}</p>`;
        });
        html += `<p><strong>Liability Name:</strong> ${l.liabilityName || '—'}</p>`;
        html += `<p><strong>Balance:</strong> $${(l.outstandingBalance||0).toLocaleString()}</p>`;
        const rate = typeof l.interestRate === 'number'
          ? l.interestRate.toFixed(2) + '%'
          : '—';
        html += `<p><strong>Interest Rate:</strong> ${rate}</p>`;
        const payment = typeof l.monthlyPayment === 'number'
          ? '$' + l.monthlyPayment.toLocaleString()
          : '—';
        html += `<p><strong>Monthly Payment:</strong> ${payment}</p>`;
        html += `<p><strong>Payoff Date:</strong> ${l.estimatedPayoffDate
                     ? new Date(l.estimatedPayoffDate).toLocaleDateString()
                     : '—'}</p>`;
        document.getElementById('view-liability-content').innerHTML = html;
        modal.show();
      })
      .catch(() => showAlert('danger','Error loading liability details.'));
  }

  function editLiability(id) {
    fetch(`/api/liabilities/${id}`)
      .then(r => r.json())
      .then(l => {
        const ownerSelect = document.getElementById('editLiabilityOwner');
        if (Array.isArray(l.owners) && l.owners.length > 1) {
          ownerSelect.value = 'joint';
        } else if (Array.isArray(l.owners) && l.owners[0]) {
          ownerSelect.value = l.owners[0]._id;
        } else {
          ownerSelect.value = '';
        }
        document.getElementById('editLiabilityId').value           = l._id || '';
        document.getElementById('editLiabilityType').value         = l.liabilityType  || '';
        document.getElementById('editLiabilityName').value          = l.liabilityName   || '';
        document.getElementById('editCreditorName').value          = l.creditorName   || '';
        document.getElementById('editAccountLoanNumber').value     = l.accountLoanNumber || '';
        document.getElementById('editOutstandingBalance').value    = l.outstandingBalance ?? '';
        document.getElementById('editInterestRate').value          = l.interestRate     ?? '';
        document.getElementById('editMonthlyPayment').value        = l.monthlyPayment   ?? '';
        document.getElementById('editEstimatedPayoffDate').value   = l.estimatedPayoffDate
          ? l.estimatedPayoffDate.split('T')[0]
          : '';
        new bootstrap.Modal(document.getElementById('editLiabilityModal')).show();
      })
      .catch(() => showAlert('danger', 'Error loading liability for edit.'));
  }

  function confirmDeleteLiability(id) {
    const dlg = new bootstrap.Modal(document.getElementById('deleteConfirmationModal'));
    document.getElementById('delete-modal-message').textContent =
      'Are you sure you want to delete this liability? This action cannot be undone.';
    dlg.show();
    document.getElementById('confirm-delete').onclick = () => {
      fetch(`/api/liabilities/${id}`, { method: 'DELETE' })
        .then(r => r.json())
        .then(r => {
          showAlert('success', r.message);
          fetchLiabilities();
        })
        .catch(() => showAlert('danger','Delete failed'))
        .finally(() => dlg.hide());
    };
  }

  // header checkbox
  lSelectAll.addEventListener('change', () => {
    const checked = lSelectAll.checked;
    selectedLiabilities.clear();
    if (checked) {
      document.querySelectorAll('.liability-checkbox').forEach(cb => {
        selectedLiabilities.add(cb.dataset.id);
      });
    }
    document.querySelectorAll('.liability-checkbox').forEach(cb => {
      cb.checked = checked;
    });
    updateLiabilitySelectionBox();
  });

  // clear selection
  lClear.addEventListener('click', e => {
    e.preventDefault();
    selectedLiabilities.clear();
    document.querySelectorAll('.liability-checkbox').forEach(cb => cb.checked = false);
    lSelectAll.checked = false;
    updateLiabilitySelectionBox();
  });

  // bulk delete
  lDelSel.addEventListener('click', () => {
    if (!selectedLiabilities.size) return;
    const dlg = new bootstrap.Modal(document.getElementById('deleteConfirmationModal'));
    document.getElementById('delete-modal-message').textContent =
      'Are you sure you want to delete the selected liabilities? This action cannot be undone.';
    dlg.show();
    document.getElementById('confirm-delete').onclick = () => {
      fetch(`/api/liabilities/bulk-delete`, {
        method: 'DELETE',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ liabilityIds: [...selectedLiabilities] })
      })
        .then(async (response) => {
          const body = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(body.message || 'Bulk delete failed with server error');
          }
          return body;
        })
        .then((body) => {
          showAlert('success', body.message || 'Selected liabilities deleted successfully.');
          selectedLiabilities.clear();
          fetchLiabilities();
        })
        .catch((err) => {
          showAlert('danger', err.message || 'Bulk delete failed');
        })
        .finally(() => dlg.hide());
      
    };
  });

  // search
  lSearchInput.addEventListener('input', debounce(() => {
    lSearch = lSearchInput.value.trim();
    lPage = 1;
    fetchLiabilities();
  }, 300));

  // add‐liability modal
  const addLiabilityModalEl = document.getElementById('addLiabilityModal');
  const addLiabilityModal   = bootstrap.Modal.getOrCreateInstance(addLiabilityModalEl);

  lAddBtn.addEventListener('click', () => {
    document.getElementById('liabilityId').value           = '';
    document.getElementById('liabilityType').value         = '';
    document.getElementById('liabilityName').value         = '';
    document.getElementById('creditorName').value          = '';
    document.getElementById('accountLoanNumber').value     = '';
    document.getElementById('outstandingBalance').value    = '';
    document.getElementById('interestRate').value          = '';
    document.getElementById('monthlyPayment').value        = '';
    document.getElementById('estimatedPayoffDate').value   = '';
    addLiabilityModal.show();
  });
  elAddBtn.addEventListener('click', () => {
    document.getElementById('liabilityId').value           = '';
    document.getElementById('liabilityType').value         = '';
    document.getElementById('liabilityName').value         = '';
    document.getElementById('creditorName').value          = '';
    document.getElementById('accountLoanNumber').value     = '';
    document.getElementById('outstandingBalance').value    = '';
    document.getElementById('interestRate').value          = '';
    document.getElementById('monthlyPayment').value        = '';
    document.getElementById('estimatedPayoffDate').value   = '';
    addLiabilityModal.show();
  });

  // add‐liability submit
  document.getElementById('add-liability-form').addEventListener('submit', e => {
    e.preventDefault();
    const data = {
      owner:               document.getElementById('liabilityOwner').value,
      liabilityType:       document.getElementById('liabilityType').value,
      liabilityName:       document.getElementById('liabilityName').value,
      creditorName:        document.getElementById('creditorName').value,
      accountLoanNumber:   document.getElementById('accountLoanNumber').value,
      outstandingBalance:  parseFloat(document.getElementById('outstandingBalance').value),
      interestRate:        parseFloat(document.getElementById('interestRate').value),
      monthlyPayment:      parseFloat(document.getElementById('monthlyPayment').value),
      estimatedPayoffDate: document.getElementById('estimatedPayoffDate').value
    };
    fetch(`/api/households/${householdId}/liabilities`, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(data)
    })
      .then(r => r.json())
      .then(r => {
        if (r.message.toLowerCase().includes('success')) {
          addLiabilityModal.hide();
          showAlert('success', r.message);
          fetchLiabilities();
        } else {
          showAlert('danger', r.message);
        }
      })
      .catch(() => showAlert('danger','Error adding liability.'));
  });

  // edit‐liability submit
  document.getElementById('edit-liability-form').addEventListener('submit', e => {
    const editLiabilityModalEl = document.getElementById('editLiabilityModal');
    const editLiabilityModal   = bootstrap.Modal.getOrCreateInstance(editLiabilityModalEl);
    e.preventDefault();
    const id = document.getElementById('editLiabilityId').value;
    const data = {
      owner:               document.getElementById('editLiabilityOwner').value,
      liabilityType:       document.getElementById('editLiabilityType').value,
      liabilityName:       document.getElementById('editLiabilityName').value,
      creditorName:        document.getElementById('editCreditorName').value,
      accountLoanNumber:   document.getElementById('editAccountLoanNumber').value,
      outstandingBalance:  parseFloat(document.getElementById('editOutstandingBalance').value),
      interestRate:        parseFloat(document.getElementById('editInterestRate').value),
      monthlyPayment:      parseFloat(document.getElementById('editMonthlyPayment').value),
      estimatedPayoffDate: document.getElementById('editEstimatedPayoffDate').value
    };
    fetch(`/api/liabilities/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(data)
    })
      .then(r => r.json())
      .then(r => {
        if (r.message.toLowerCase().includes('success')) {
          editLiabilityModal.hide();
          showAlert('success', r.message);
          fetchLiabilities();
        } else {
          showAlert('danger', r.message);
        }
      })
      .catch(() => showAlert('danger','Error updating liability.'));
  });

  // column sorting
  const liabilitySortIcons = document.querySelectorAll('#liabilities th .sort-icon');
  liabilitySortIcons.forEach(icon => {
    icon.addEventListener('click', () => {
      const field = icon.getAttribute('data-field');
      if (lSort === field) {
        lOrder = lOrder === 'asc' ? 'desc' : 'asc';
      } else {
        lSort = field;
        lOrder = 'asc';
      }
      fetchLiabilities();
    });
  });

  // initial load
  fetchLiabilities();


});
