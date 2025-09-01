// public/js/undoImport.js
document.addEventListener('DOMContentLoaded', () => {
    let currentImportId = null;
    const modalEl = document.getElementById('undoImportModal');
    if (!modalEl) return;
    const modal = new bootstrap.Modal(modalEl);
    const progressBar = document.getElementById('undo-progress');
    const progressContainer = document.getElementById('undo-progress-container');
    const statusEl = document.getElementById('undo-status');
    const confirmBtn = document.getElementById('undo-confirm');

    function showAlert(type, message, options = {}) {
        const alertContainer = document.getElementById('alert-container');
        if (!alertContainer) {
          console.warn('No #alert-container element found in DOM.');
          return; // or fallback to console
        }
    
        const alert = document.createElement('div');
        alert.id = type === 'success' ? 'passwordChangeSuccess' : 'errorAlert';
        alert.className = `alert ${
          type === 'success' ? 'alert-success' : 'alert-error'
        }`;
        alert.setAttribute('role', 'alert');
    
        // Icon container
        const iconContainer = document.createElement('div');
        iconContainer.className =
          type === 'success' ? 'success-icon-container' : 'error-icon-container';
        const icon = document.createElement('i');
        icon.className = type === 'success' ? 'far fa-check-circle' : 'far fa-times-circle';
        iconContainer.appendChild(icon);
    
        // Close button container
        const closeContainer = document.createElement('div');
        closeContainer.className =
          type === 'success' ? 'success-close-container' : 'error-close-container';
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
    
        // Optional: Undo logic
        function closeAlert(alertEl) {
          alertEl.classList.add('exit');
          setTimeout(() => {
            if (alertEl && alertEl.parentNode) {
              alertEl.parentNode.removeChild(alertEl);
            }
          }, 500);
        }
    
        if (options.undo) {
          const undoButton = document.createElement('button');
          undoButton.className = 'alert-undo-button';
          undoButton.innerText = 'Undo';
          undoButton.addEventListener('click', () => {
            options.undoCallback?.();
            closeAlert(alert);
          });
          textContainer.appendChild(undoButton);
        }
    
        // Build the alert
        alert.appendChild(iconContainer);
        alert.appendChild(closeContainer);
        alert.appendChild(textContainer);
    
        // Put it at top
        alertContainer.prepend(alert);
    
        // Animate in
        void alert.offsetWidth;
        alert.classList.add('show');
    
        // Auto-close after 5s
        setTimeout(() => closeAlert(alert), 5000);
        closeIcon.addEventListener('click', () => closeAlert(alert));
      }
  
    // reset on open
    document.body.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-undo-import');
      if (!btn) return;
      currentImportId = btn.dataset.importId;
      progressContainer?.classList.add('d-none');
      progressBar.style.width = '0%';
      progressBar.textContent = '0%';
      statusEl.textContent = '';
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = 'Confirm Undo';
      modal.show();
    });
  
    // reset on close
    modalEl.addEventListener('hidden.bs.modal', () => {
      progressContainer?.classList.add('d-none');
      progressBar.style.width = '0%';
      progressBar.textContent = '0%';
      statusEl.textContent = '';
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = 'Confirm Undo';
    });
  
    confirmBtn?.addEventListener('click', async () => {
      if (!currentImportId) return;
  
      // spinner + disable
      const originalHtml = confirmBtn.innerHTML;
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Undoing...`;
  
      // show progress UI
      progressContainer?.classList.remove('d-none');
      progressBar.style.width = '0%';
      progressBar.textContent = '0%';
      statusEl.textContent = 'starting...';
  
      // 1) start undo
      let startedOk = false;
      try {
        const res = await fetch(`/api/new-import/${currentImportId}/undo`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include'
        });
        if (!res.ok) {
          const { error } = await res.json().catch(() => ({}));
          statusEl.textContent = error || 'Undo failed to start.';
          confirmBtn.disabled = false;
          confirmBtn.innerHTML = originalHtml;
          return;
        }
        startedOk = true;
      } catch (e) {
        statusEl.textContent = e.message || 'Undo request failed.';
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = originalHtml;
        return;
      }
  
      // 2) progress via SSE, fallback to polling on error
      let es;
      try { es = new EventSource(`/api/new-import/${currentImportId}/undo/stream`, { withCredentials: true }); } catch (_) {}
  
      const updateUI = ({ status, progress, error }) => {
        if (typeof progress === 'number') {
          progressBar.style.width = `${progress}%`;
          progressBar.textContent = `${progress}%`;
        }
        if (status) statusEl.textContent = status;
        const rowSpan = document.querySelector(`.undo-inline-progress[data-import-id="${currentImportId}"]`);
        if (rowSpan && typeof progress === 'number') rowSpan.textContent = `Undo running... ${progress}%`;
  
                if (status === 'done') {
                  setTimeout(() => {
                    bootstrap.Modal.getInstance(modalEl)?.hide();
                    showAlert('success', 'Undo successful');
                    window.location.reload();
                  }, 600);
                }
                if (status === 'failed') {
                  // keep the modal open and let the user retry or close
                  progressBar.classList.add('bg-danger');
                  statusEl.textContent = error ? `failed: ${error}` : 'failed';
                  confirmBtn.disabled = false;
                  confirmBtn.innerHTML = 'Try Again';
                  showAlert('error', error || 'Undo failed. Nothing was changed.');
                }
      };
  
      if (es) {
        es.onmessage = (evt) => {
          try { updateUI(JSON.parse(evt.data)); } catch {}
        };
        es.onerror = () => {
          es.close();
          // fallback to polling
          pollStatus(updateUI);
        };
      } else {
        // no SSE support
        pollStatus(updateUI);
      }
    });
  
    function pollStatus(update) {
      const tick = async () => {
        try {
          const r = await fetch(`/api/new-import/${currentImportId}/undo/status`, { credentials: 'include' });
          const data = await r.json();
          update(data);
          if (data.status === 'done' || data.status === 'failed') return;
        } catch (_) {}
        setTimeout(tick, 1000);
      };
      tick();
    }
  });
  