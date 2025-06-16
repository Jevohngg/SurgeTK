// /public/js/valueAddVideo.js
(() => {
  function initVideoModal() {
    // Helper ─ build the embed URL
    const vimeoURL = id =>
      `https://player.vimeo.com/video/${id}?autoplay=1&title=0&byline=0&portrait=0`;

    // Grab modal elements
    const modal   = document.getElementById('learnMoreVideoModal');
    const iframe  = document.getElementById('learnMoreIframe');
    const spinner = modal?.querySelector('.video-spinner');

    // We do still require modal+iframe.  If those are missing, we can't do anything:
    if (!modal || !iframe) return;

    // 1) Universal click-handler for anything that looks like a video trigger
    document
      .querySelectorAll(
        '[data-video-id][data-bs-toggle="modal"][data-bs-target="#learnMoreVideoModal"]'
      )
      .forEach(trigger => {
        trigger.addEventListener('click', e => {
          e.preventDefault();
          const vid = trigger.dataset.videoId;
          if (!vid) return;

          // show spinner (if it exists) + hide iframe until load
          spinner?.classList.remove('d-none');
          iframe.style.opacity = 0;
          iframe.src = vimeoURL(vid);

          // pop the modal
          bootstrap.Modal.getOrCreateInstance(modal).show();
        });
      });

    // 2) When the iframe finishes loading, hide spinner + fade in
    iframe.addEventListener('load', () => {
      spinner?.classList.add('d-none');
      iframe.style.opacity = 1;
    });

    // 3) Tear down on close
    modal.addEventListener('hidden.bs.modal', () => {
      iframe.src = '';
      spinner?.classList.remove('d-none');
      iframe.style.opacity = 0;
    });
  }

  // If the DOM is still loading, wait; otherwise run now
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initVideoModal);
  } else {
    initVideoModal();
  }
})();
