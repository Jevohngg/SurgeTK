/***************************************************************************
 * public/js/surgeProgress.js  – FIXED helper‑toast wiring
 ***************************************************************************/
(function () {
  const popup = document.getElementById('surge-progress-popup');
  if (!popup) return;

  const overlay   = document.getElementById('surge-screen-overlay'); // NEW
  const bar        = document.getElementById('surgeProgressBar');
  const percentTxt = document.getElementById('surgeProgressPercent');
  const inner      = document.getElementById('surgeInnerContent');
  const finalIcBox = document.getElementById('surgeFinalIconContainer');
  const finalMsg   = document.getElementById('surgeFinalMessage');

  const finalSub = document.getElementById('surgeFinalSubtext');   // NEW
const finalCta = document.getElementById('surgeFinalCta');       // NEW
const refreshBtn = document.getElementById('surgeRefreshBtn');   // NEW


  let total = 0;
  let completed = 0;

  /* ───────────── Helper toast control ───────────── */
  const helper = document.getElementById('surge-helper-toast');
  const SHOW_DELAY_MS = 1400;
  let helperTimerId = null;
  let helperVisible = false;

  function clearHelperTimer () {
    if (helperTimerId) { clearTimeout(helperTimerId); helperTimerId = null; }
  }

  function positionHelperToast () {
    if (!helper || popup.style.display !== 'block') return;
    const rect   = popup.getBoundingClientRect();
    const margin = 12;

    helper.style.width = `${rect.width}px`;
    helper.style.left  = `${rect.left}px`;
    const bottomFromViewport = (window.innerHeight - rect.top) + margin;
    helper.style.bottom = `${bottomFromViewport}px`;
  }

  function showHelperToast () {
    clearHelperTimer();                // we’re firing now
    if (!helper || helperVisible) return;

    // make it participate in layout, then animate in
    helper.style.display = 'block';
    positionHelperToast();
    requestAnimationFrame(() => {
      helper.classList.add('showing');
      helper.setAttribute('aria-hidden', 'false');
      helperVisible = true;
    });
  }

  function hideHelperToast (immediate = false) {
    clearHelperTimer();
    if (!helper) return;

    // If never shown, just hard hide.
    if (!helperVisible) {
      helper.classList.remove('showing');
      helper.setAttribute('aria-hidden', 'true');
      helper.style.display = 'none';
      return;
    }

    const finish = () => {
      if (!helperVisible) helper.style.display = 'none';
      helper.removeEventListener('transitionend', finish);
    };

    helper.classList.remove('showing');
    helper.setAttribute('aria-hidden', 'true');
    helperVisible = false;

    if (immediate) {
      helper.style.display = 'none';
    } else {
      helper.addEventListener('transitionend', finish);
    }
  }

  window.addEventListener('resize', () => { if (helperVisible) positionHelperToast(); });
  window.addEventListener('scroll',  () => { if (helperVisible) positionHelperToast(); });




  /* ───────────── Overlay helpers ───────────── */
  function showOverlay () {
    if (!overlay) return;
    overlay.style.display = 'block';
    // force layout before adding .show for a smooth fade
    // eslint-disable-next-line no-unused-expressions
    overlay.offsetHeight;
    overlay.classList.add('show');
    document.body.classList.add('surge-busy');
    document.body.setAttribute('aria-busy', 'true');
  }

  function hideOverlay () {
      if (!overlay) return;
    overlay.classList.remove('show');
    const done = () => {
      overlay.style.display = 'none';
      overlay.removeEventListener('transitionend', done);
    };
    overlay.addEventListener('transitionend', done);
    // Safety: if transition is skipped, hide shortly after
    setTimeout(done, 220);
    document.body.classList.remove('surge-busy');
    document.body.removeAttribute('aria-busy');
  }


  /* ───────────── socket wire‑up ───────────── */
  const socket = io(window.SOCKET_IO_ORIGIN || undefined);

  socket.on('surge:progress', (p) => {
    if (!total) total = p.total;
    completed = p.completed;

    const pct = Math.round((completed / total) * 100);
    bar.style.width         = `${pct}%`;
    bar.setAttribute('aria-valuenow', pct);
    percentTxt.textContent  = `${pct}%`;

    // First reveal of the progress popup
    if (popup.style.display !== 'block') {
      popup.style.display = 'block';
      showOverlay();  // NEW: show the full-screen overlay
      // Schedule helper toast once, with a delay
      if (!helperTimerId && helper && !helperVisible) {
        helperTimerId = setTimeout(showHelperToast, SHOW_DELAY_MS);
      }
      // Position right away so we don't jank on first frame
      positionHelperToast();
    }
  });

  socket.on('surge:allDone', async (p) => {
    bar.style.width = '100%';
    percentTxt.textContent = '100%';

    inner.classList.add('d-none');
    finalIcBox.style.display = 'block';
    finalMsg.textContent =
      `Finished Preparing (${p.successCount}/${p.total}) Advisor Packets`;
    finalMsg.style.display = 'block';

    if (finalSub) {
      // If you want to tweak per action:
      // const autoText = p.action === 'save-print' ? 'sent to your printer' : 'downloaded automatically';
      // finalSub.innerHTML = `The process is finished. Packets were ${autoText}.<br>You can safely refresh the page to see the updated status.`;
      finalSub.innerHTML =
        'The process is finished. Packets should have been downloaded automatically.<br>' +
        'You can safely refresh the page to see the updated status.';
      finalSub.style.display = 'block';
    }
    if (finalCta) finalCta.style.display = 'block';
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => window.location.reload(), { once: true });
    }

    // Ensure helper goes away
    hideHelperToast();

    if (p.action === 'save-download' && p.zipUrl) {
      window.location.href = p.zipUrl;
    }
    if (p.action === 'save-print') {
      await sequentialPrint(p.surgeId);
    }
    hideOverlay();  // NEW: hide the full-screen overlay
  });

  socket.on('surge:error', (e) => {
    inner.classList.add('d-none');
    finalIcBox.style.display = 'block';
    document.getElementById('surgeFinalIcon').textContent = 'error';
    document.getElementById('surgeFinalIcon').classList.add('text-danger');
    finalMsg.textContent = `Error: ${e.message || 'Unexpected queue error.'}`;
    finalMsg.style.display = 'block';


    hideHelperToast();
    hideOverlay();  // NEW: hide the full-screen overlay
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
  