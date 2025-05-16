// public/js/import.js

document.addEventListener('DOMContentLoaded', () => {
    console.log('import js file here');
  
    const importHouseholds = document.getElementById('import-households');
    const importModal = document.getElementById('universal-import-modal');
    const uploadHouseholdsForm = document.getElementById('upload-households-form');
  
    if (importHouseholds && importModal) {
      importHouseholds.addEventListener('click', (e) => {
        e.preventDefault();
        console.log('click');
  
        if (uploadHouseholdsForm) {
          uploadHouseholdsForm.reset();
          if (typeof resetUploadState === 'function') {
            resetUploadState(); // optional safety
          }
        }
  
        const modalInstance = new bootstrap.Modal(importModal);
        modalInstance.show();
      });
    } else {
      console.error('Import households button or modal element not found.');
    }
  });
  