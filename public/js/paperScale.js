/* paperScale.js
 * Dynamically scale .paper-container based on available width.
 * Assumes the paper is designed at 8.5in wide (CSS inches = 96px each).
 */

(function () {
    'use strict';

    // paperScale.js – add near top
const BREAKPOINT_MIN_CONTAINER = 980;  // scale only if container narrower than this
const BREAKPOINT_MIN_VIEWPORT  = 1100; // optional: also require viewport to be small

  
    const INCH = 96;
    const PAPER_WIDTH_IN = 8.5;                 // your iframe/paper width
    const PAPER_WIDTH_PX = PAPER_WIDTH_IN * INCH; // 816px
    const MIN_SCALE = 0.1;                      // don't shrink beyond this
    const SELECTOR = '.paper-container';
  
    // Cache of base (unscaled) heights
    const BASE_SIZE = new WeakMap();

    // paperScale.js – add these helpers
function clearScale(paper) {
    const target = paper.querySelector('.iframe-wrapper') || paper.firstElementChild || paper;
    target.style.transform = 'none';
    target.style.width = `${PAPER_WIDTH_PX}px`;
    const baseH = getBaseHeight(target);
    paper.style.width = `${PAPER_WIDTH_PX}px`;
    paper.style.height = `${baseH}px`;
    paper.style.marginLeft = 'auto';
    paper.style.marginRight = 'auto';
    const shell = paper.parentElement?.classList.contains('paper-scale-shell') ? paper.parentElement : null;
    if (shell) shell.style.height = `${baseH}px`;
  }
  
  
 // paperScale.js – upgrade getBaseHeight to read iframe content when same-origin
function getBaseHeight(target) {
    const cached = BASE_SIZE.get(target);
    if (cached && cached.h) return cached.h;
  
    const prev = target.style.transform;
    target.style.transform = 'none';
  
    let h = target.getBoundingClientRect().height;
  
    const iframeEl = target.querySelector('iframe');
    if (iframeEl) {
      try {
        // Same-origin? Use document height for accuracy.
        const doc = iframeEl.contentDocument;
        if (doc && doc.documentElement) {
          const body = doc.body;
          const docH = Math.max(
            body?.scrollHeight || 0,
            doc.documentElement.scrollHeight || 0,
            body?.offsetHeight || 0,
            doc.documentElement.offsetHeight || 0
          );
          h = Math.max(h, docH);
        }
      } catch (_) {
        // cross-origin — ignore; fallback to min-height parsing below
      }
  
      // Parse CSS min-height (e.g., "11in") as a floor
      const css = getComputedStyle(iframeEl);
      if (css.minHeight && css.minHeight !== '0px') {
        const tmp = document.createElement('div');
        tmp.style.position = 'absolute';
        tmp.style.visibility = 'hidden';
        tmp.style.height = css.minHeight;
        document.body.appendChild(tmp);
        h = Math.max(h, tmp.getBoundingClientRect().height || 0);
        document.body.removeChild(tmp);
      }
    }
  
    target.style.transform = prev;
    BASE_SIZE.set(target, { h });
    return h;
  }
  
  
    const debounce = (fn, wait = 100) => {
      let t;
      return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
    };
  
    function ensureWrapped(paper) {
      if (paper.parentElement && paper.parentElement.classList.contains('paper-scale-shell')) {
        return paper.parentElement;
      }
      const shell = document.createElement('div');
      shell.className = 'paper-scale-shell';
      paper.parentNode.insertBefore(shell, paper);
      shell.appendChild(paper);
      paper.dataset.scaled = '1';
      return shell;
    }
  
    function scaleOne(paper) {


      const shell = ensureWrapped(paper);
const available = shell.clientWidth || shell.getBoundingClientRect().width || PAPER_WIDTH_PX;
const viewportW = window.innerWidth || available;

if (available >= BREAKPOINT_MIN_CONTAINER && viewportW >= BREAKPOINT_MIN_VIEWPORT) {
    clearScale(paper);
    return;
  }
  
      // Compute scale: shrink only
      let scale = Math.min(1, available / PAPER_WIDTH_PX);
      if (MIN_SCALE) scale = Math.max(MIN_SCALE, scale);
  
      // Elements
      const target = paper.querySelector('.iframe-wrapper') || paper.firstElementChild || paper;
  
      // 1) Visually scale the inner paper (for fidelity)
      target.style.width = `${PAPER_WIDTH_PX}px`;    // design width
      target.style.transform = `scale(${scale})`;    // visual scale
  
      // 2) Shrink the container’s layout width
      const scaledWidth = Math.round(PAPER_WIDTH_PX * scale);
      paper.style.width = `${scaledWidth}px`;
  
      // 3) Height sync: use natural height × scale
      const baseH = getBaseHeight(target);
      const scaledHeight = baseH * scale;
      paper.style.height = `${scaledHeight}px`;
      shell.style.height = `${scaledHeight}px`;
  
      // 4) Center horizontally
      const avail = Math.max(available, 0);
      const pad = Math.max(0, (avail - scaledWidth) / 2);
      paper.style.marginLeft = `${pad}px`;
      paper.style.marginRight = `${pad}px`;
    }
  
    const rescaleAll = debounce(() => {
      document.querySelectorAll(SELECTOR).forEach(scaleOne);
    }, 60);
  
    function observeDynamicHeights(paper) {
      const target = paper.querySelector('.iframe-wrapper') || paper.firstElementChild || paper;
      const refresh = () => { BASE_SIZE.delete(target); scaleOne(paper); };
  
      const ro = new ResizeObserver(refresh);
      ro.observe(target);
  
      const iframe = paper.querySelector('iframe');
      if (iframe) iframe.addEventListener('load', refresh);
    }
  
    document.addEventListener('DOMContentLoaded', () => {
      const papers = document.querySelectorAll(SELECTOR);
      if (!papers.length) return;
  
      papers.forEach((p) => {
        ensureWrapped(p);
        observeDynamicHeights(p);
      });
  
      // Initial pass + on resize
      rescaleAll();
      window.addEventListener('resize', rescaleAll);
  
      // SPA/hot-swap support
      const mo = new MutationObserver(rescaleAll);
      mo.observe(document.body, { childList: true, subtree: true });
    });
  })();
  // paperScale.js – after DOMContentLoaded block, add late passes to catch fonts/layout
window.addEventListener('load', () => {
    rescaleAll();
    // one more pass in case webfonts / late layout shift
    setTimeout(rescaleAll, 120);
    requestAnimationFrame(() => requestAnimationFrame(rescaleAll));
  });
  window.addEventListener('pageshow', rescaleAll);
  