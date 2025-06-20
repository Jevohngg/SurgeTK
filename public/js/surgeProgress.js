/***************************************************************************
 * public/js/surgeProgress.js  – handles real‑time build status
 * Replaces the entire previous file.
 ***************************************************************************/
(function () {
    const popup   = document.getElementById('surge-progress-popup');
    if (!popup) return;                                   // not on Surge pages
  
    /* ───────────── local refs ──────────────────────────────────────────── */
    const bar        = document.getElementById('surgeProgressBar');
    const percentTxt = document.getElementById('surgeProgressPercent');
    const inner      = document.getElementById('surgeInnerContent');
    const finalIcBox = document.getElementById('surgeFinalIconContainer');
    const finalMsg   = document.getElementById('surgeFinalMessage');
    const closeBtn   = document.getElementById('surgeProgressCloseBtn');
  
    let total = 0;            // immutable after first progress packet
    let completed = 0;
  
    closeBtn.onclick = () => (popup.style.display = 'none');
  
    /* ───────────── socket wire‑up ─────────────────────────────────────── */
    const socket = io(window.SOCKET_IO_ORIGIN || undefined);
  
    socket.on('surge:progress', (p) => {
      /* p = { surgeId, householdId, completed, total } */
      if (!total) total = p.total;                        // first tick locks it
      completed = p.completed;
  
      const pct = Math.round((completed / total) * 100);
      bar.style.width         = `${pct}%`;
      bar.setAttribute('aria-valuenow', pct);
      percentTxt.textContent  = `${pct}%`;
  
      if (popup.style.display !== 'block') popup.style.display = 'block';
    });
  
    socket.on('surge:allDone', async (p) => {
      /* p = { surgeId, action, successCount, errorCount, total, zipUrl? } */
  
      /* 1️⃣ lock progress bar at 100 % */
      bar.style.width = '100%';
      percentTxt.textContent = '100%';
  
      /* 2️⃣ swap UI – hide inner content, show final message only */
      inner.classList.add('d-none');
      finalIcBox.style.display = 'block';
      finalMsg.textContent =
        `Finished Preparing (${p.successCount}/${p.total}) Advisor Packets`;   // both numbers now defined
      finalMsg.style.display = 'block';
      closeBtn.disabled = false;
      closeBtn.style.pointerEvents = 'auto';
  
      /* 3️⃣ Follow‑up actions */
      if (p.action === 'save-download' && p.zipUrl) {
        window.location.href = p.zipUrl;                    // trigger browser DL
      }
  
      if (p.action === 'save-print') {
        await sequentialPrint(p.surgeId);
      }
    });
  
    /* Helper – fetch‑to‑blob so we can print same‑origin without CORS errors */
    async function sequentialPrint(surgeId) {
      const liEls = [...document.querySelectorAll('#selectedHouseholdList li')];
      for (let idx = 0; idx < liEls.length; idx++) {
        const hhId = liEls[idx].dataset.id;
        try {
          const res = await fetch(`/api/surge/${surgeId}/packet/${hhId}`);
          if (!res.ok) throw new Error(`link ${res.status}`);
          const { url } = await res.json();
  
          /* Fetch PDF as Blob then stream via blob:// (same origin) */
          const pdfBlob = await fetch(url).then(r => r.blob());
          const src     = URL.createObjectURL(pdfBlob);
  
          await new Promise((resolve) => {
            const iframe = document.createElement('iframe');
            iframe.style.display = 'none';
            iframe.src = src;
            iframe.onload = () => {
              iframe.contentWindow.focus();            // some browsers need this
              iframe.contentWindow.print();
              URL.revokeObjectURL(src);
              resolve();
            };
            document.body.appendChild(iframe);
          });
        } catch (err) {
          console.error('[Surge] print error:', err);
        }
      }
    }
  })();
  