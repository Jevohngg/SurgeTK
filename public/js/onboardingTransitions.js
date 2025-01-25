document.addEventListener('DOMContentLoaded', () => {
    const onboardingHeader      = document.getElementById('onboardingHeader');
    const initialOptions        = document.getElementById('initialOptions');
    const btnShowFirmForm       = document.getElementById('btnShowFirmForm');
    const createFirmFormParent  = document.getElementById('createFirmFormContainer');
    const btnBackToOptions      = document.getElementById('btnBackToOptions');
  
    // Fade out multiple elements at once
    function fadeOutElements(...elements) {
      elements.forEach(el => {
        el.classList.add('fade-exit', 'fade-exit-active');
      });
      setTimeout(() => {
        elements.forEach(el => {
          el.style.display = 'none';
          el.classList.remove('fade-exit', 'fade-exit-active');
        });
      }, 300);
    }
  
    // Fade in an element
    function fadeInElement(el, displayType = 'flex') {
      el.style.display = displayType;
      el.classList.add('fade-enter');
      requestAnimationFrame(() => {
        el.classList.add('fade-enter-active');
      });
    }
  
    // Fade out an element
    function fadeOutElement(el) {
      el.classList.remove('fade-enter', 'fade-enter-active');
      el.classList.add('fade-exit', 'fade-exit-active');
      setTimeout(() => {
        el.style.display = 'none';
        el.classList.remove('fade-exit', 'fade-exit-active');
      }, 300);
    }
  
    // Show the "Set Up Firm" form, hide both the header & the initial options
    if (btnShowFirmForm) {
      btnShowFirmForm.addEventListener('click', () => {
        fadeOutElements(onboardingHeader, initialOptions);
  
        // After the same delay, fade in the createFirmForm container
        setTimeout(() => {
          fadeInElement(createFirmFormParent, 'flex');
        }, 300);
      });
    }
  
    // Back button: hide the createFirmForm, show the header & initial options
    if (btnBackToOptions) {
      btnBackToOptions.addEventListener('click', () => {
        fadeOutElement(createFirmFormParent);
  
        // After the same delay, fade in the header & initial options
        setTimeout(() => {
          fadeInElement(onboardingHeader, 'flex');
          fadeInElement(initialOptions, 'flex');
        }, 300);
      });
    }
  });
  