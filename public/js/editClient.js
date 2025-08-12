// public/js/editClient.js

/**
 * Alert Function
 * Displays alert messages to the user.
 * @param {string} type - Type of alert ('success' or 'danger').
 * @param {string} message - The alert message.
 * @param {Object} [options] - Additional options (e.g., undo callback).
 */
function showAlert(type, message, options = {}) {
    const alertContainer = document.getElementById('alert-container');
    if (!alertContainer) return;
  
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
  
    // closeAlert helper
    function closeAlert(alertEl) {
      alertEl.classList.add('exit');
      setTimeout(() => {
        if (alertEl && alertEl.parentNode) {
          alertEl.parentNode.removeChild(alertEl);
        }
      }, 500);
    }
  
    // If undo is provided
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
  
    // Fade in
    void alert.offsetWidth;
    alert.classList.add('show');
  
    // Auto-close
    setTimeout(() => closeAlert(alert), 5000);
    closeIcon.addEventListener('click', () => closeAlert(alert));
  }
  
  document.addEventListener('DOMContentLoaded', () => {
    const memberCards = document.querySelectorAll('.household-member-card');
    const editForm = document.getElementById('editClientForm');
    const saveBtn = document.getElementById('saveClientBtn');
    const cancelBtn = document.getElementById('cancelEditBtn');
    const deleteClientBtn = document.getElementById('deleteClientBtn');
  
    // Bootstrap modals
    const editClientModalEl = document.getElementById('editClientModal');
    const confirmDeleteModalEl = document.getElementById('confirmDeleteModal');
    const editClientModal = new bootstrap.Modal(editClientModalEl, {
      backdrop: 'static',
      keyboard: true
    });
    const confirmDeleteModal = new bootstrap.Modal(confirmDeleteModalEl, {
      backdrop: 'static',
      keyboard: true
    });
  
    // For image handling
    const fileInput = document.getElementById('editProfilePhoto');
    const previewImg = document.getElementById('editProfilePhotoPreview');
    const uploadImageBtn = document.getElementById('uploadImageBtn');
    const removeImageBtn = document.getElementById('removeImageBtn');
  
    // Confirm delete elements
    const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
    const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
  
    let currentClientId = null; // track which client is being edited (or potentially deleted)
  
    // Clicking on a client card => open the Edit modal
    memberCards.forEach(card => {
      card.addEventListener('click', () => {
        currentClientId = card.getAttribute('data-client-id');
        openEditModal(currentClientId);
        console.log('[EditClient] Clicked card for clientId:', currentClientId);
      });
    });
  
    /**
     * openEditModal:
     * Fetch data from /api/households/client/:clientId,
     * populate fields, show the modal.
     */
    async function openEditModal(clientId) {
      try {
        const res = await fetch(`/api/households/client/${clientId}`);
        if (!res.ok) {
          showAlert('danger', `Failed to retrieve client: ${res.statusText}`);
          return;
        }
        const data = await res.json();
        const client = data.client;
    
        document.getElementById('editClientId').value = client._id;
        document.getElementById('editFirstName').value = client.firstName || '';
        document.getElementById('editLastName').value = client.lastName || '';
        document.getElementById('editDeceasedLiving').value = client.deceasedLiving || 'Living';
        document.getElementById('editEmail').value = client.email || '';
        document.getElementById('editPhoneNumber').value =
          client.mobileNumber || client.homePhone || '';
    
        // DOB
        if (client.dob) {
          const d = new Date(client.dob);
          document.getElementById('editDob').value = d.toISOString().slice(0, 10);
          
        } else {
          document.getElementById('editDob').value = '';
        }
        if (client.retirementDate) {
          const rd = new Date(client.retirementDate);
          document.getElementById('editRetirementDate').value = rd.toISOString().slice(0, 10);
        } else {
          document.getElementById('editRetirementDate').value = '';
        }
    
        // Monthly Income
        document.getElementById('editMonthlyIncome').value = client.monthlyIncome || 0;
    
        // ✅ NEW: Occupation
        document.getElementById('editOccupation').value = client.occupation || '';
        document.getElementById('editEmployer').value = client.employer || '';
    
        // Photo
        if (client.profilePhoto) {
          previewImg.src = client.profilePhoto;
          previewImg.style.display = 'block';
        } else {
          previewImg.src = '/images/defaultProfilePhoto.png';
          previewImg.style.display = 'block';
        }
        fileInput.value = '';
    
        editClientModal.show();
      } catch (err) {
        console.error('[EditClient] Error opening modal:', err);
        showAlert('danger', 'Unable to open edit modal');
      }
    }
    
  
    // "UPLOAD IMAGE" => trigger hidden file input
    if (uploadImageBtn) {
      uploadImageBtn.addEventListener('click', () => {
        fileInput.click();
      });
    }
  
    // On file input change => update preview
    if (fileInput) {
      fileInput.addEventListener('change', () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        const fileURL = URL.createObjectURL(file);
        previewImg.src = fileURL;
        previewImg.style.display = 'block';
      });
    }
  
    // Remove image => revert to default
    if (removeImageBtn) {
      removeImageBtn.addEventListener('click', () => {
        fileInput.value = '';
        previewImg.src = '/images/defaultProfilePhoto.png';
        previewImg.style.display = 'block';
      });
    }
  
    // SAVE
    saveBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        const formData = new FormData(editForm);
        const clientId = document.getElementById('editClientId').value;
  
        const res = await fetch(`/api/households/client/${clientId}`, {
          method: 'POST',
          body: formData
        });
        const result = await res.json();
  
        if (!res.ok) {
          showAlert('danger', result.message || 'Failed to update client');
          return;
        }
        showAlert('success', 'Client updated successfully');
        editClientModal.hide();
      } catch (err) {
        console.error('[EditClient] Error saving client:', err);
        showAlert('danger', 'Error occurred while saving client info');
      }
    });
  
    // CANCEL
    cancelBtn.addEventListener('click', (e) => {
      e.preventDefault();
      editClientModal.hide();
    });
  
    // DELETE => show confirm modal, but hide the edit modal first
    if (deleteClientBtn) {
      deleteClientBtn.addEventListener('click', () => {
        editClientModal.hide();    // Hide the edit modal
        confirmDeleteModal.show(); // Then show confirm modal
      });
    }
  
    // CANCEL DELETE => just hide confirm modal
    if (cancelDeleteBtn) {
      cancelDeleteBtn.addEventListener('click', () => {
        confirmDeleteModal.hide();
      });
    }
  
    // CONFIRM DELETE => send DELETE request
    if (confirmDeleteBtn) {
      confirmDeleteBtn.addEventListener('click', async () => {
        try {
          if (!currentClientId) {
            showAlert('danger', 'No client selected to delete!');
            return;
          }
          const res = await fetch(`/api/households/client/${currentClientId}`, {
            method: 'DELETE'
          });
          const result = await res.json();
  
          if (!res.ok) {
            showAlert('danger', result.message || 'Failed to delete client');
            return;
          }
  
          // If the server sends a redirect path (e.g. removing entire household)
          if (result.redirect) {
            window.location.href = result.redirect;
            return;
          }
  
          showAlert('success', 'Client deleted successfully');
          confirmDeleteModal.hide();
          // Optionally remove from DOM or reload
          // location.reload();
  
        } catch (err) {
          console.error('[EditClient] Error deleting client:', err);
          showAlert('danger', 'Error occurred while deleting client');
        }
      });
    }
  });
  