// /public/js/valueAddVideo.js
(() => {
    // Helper ─ build the embed URL
    const vimeoURL = (id) => `https://player.vimeo.com/video/${id}?autoplay=1&title=0&byline=0&portrait=0`;
  
    // Elements
    const modal       = document.getElementById('learnMoreVideoModal');
    const iframe      = document.getElementById('learnMoreIframe');
    const spinner     = modal?.querySelector('.video-spinner');
  
    if (!modal || !iframe) return;   // safety guard
  
    // 1. Open handler
    document.querySelectorAll('.learn-more-btn').forEach(item => {
      item.addEventListener('click', () => {
        const vid = item.dataset.videoId;
        if (!vid) return;
  
        // show spinner, hide iframe until load fires
        spinner?.classList.remove('d-none');
        iframe.style.opacity = 0;
        iframe.src = vimeoURL(vid);
  
        const bootstrapModal = bootstrap.Modal.getOrCreateInstance(modal);
        bootstrapModal.show();
      });
    });
  
    // 2. When the iframe finishes loading, hide the spinner
    iframe.addEventListener('load', () => {
      spinner?.classList.add('d-none');
      iframe.style.opacity = 1;
    });
  
    // 3. Clean up on modal close to stop audio
    modal.addEventListener('hidden.bs.modal', () => {
      iframe.src = '';          // unload video
      spinner?.classList.remove('d-none');
      iframe.style.opacity = 0;
    });
  })();
  