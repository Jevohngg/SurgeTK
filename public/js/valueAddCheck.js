document.addEventListener('DOMContentLoaded', async () => {
    try {
      const householdIdEl = document.getElementById('household-id');
      const householdId = householdIdEl ? householdIdEl.value : null;
      if (!householdId) {
        console.warn('No household ID found in the DOM.');
        return;
      }
  
      // 1) Fetch all ValueAdds for the household
      const response = await fetch(`/api/value-add/household/${householdId}`);
      if (!response.ok) throw new Error('Failed to fetch Value Adds');
  
      const valueAdds = await response.json();
  
      // 2) Grab the specific DOM elements for Guardrails & Buckets
      const guardrailsCard = document.getElementById('openGuardrails');
      const guardrailsIcon = guardrailsCard?.querySelector('.status-icon');
  
      const bucketsCard = document.getElementById('openBuckets');
      const bucketsIcon = bucketsCard?.querySelector('.status-icon');
  
      // 3) Find the relevant ValueAdd docs
      const guardrailsValueAdd = valueAdds.find(v => v.type === 'GUARDRAILS');
      const bucketsValueAdd = valueAdds.find(v => v.type === 'BUCKETS');
  
      // -----------------------------------------------------------
      // CREATE A SINGLE TOOLTIP DIV FOR CUSTOM HOVER TEXT
      // -----------------------------------------------------------
      const tooltip = document.createElement('div');
      tooltip.classList.add('value-add-tooltip');
      document.body.appendChild(tooltip);
  
      // State to track if tooltip is currently visible
      let isTooltipVisible = false;
  
      /**
       * Show the tooltip with a smooth fade-in.
       * @param {HTMLElement} iconElement - The icon near which we place the tooltip.
       * @param {string} message - The text to show in the tooltip.
       * @param {boolean} isWarning - If true, apply a warning style; otherwise, green style.
       */
      function showTooltip(iconElement, message, isWarning) {
        // 1) Set the text
        tooltip.textContent = message;
  
        // 2) Remove old classes, add new
        tooltip.classList.remove('fade-out', 'green-mode', 'warning-mode');
        tooltip.classList.add(isWarning ? 'warning-mode' : 'green-mode');
  
        // 3) Make it visible (display block) so we can measure
        tooltip.style.display = 'block';
  
        // 4) Measure the icon + tooltip
        const rect = iconElement.getBoundingClientRect();
        const tooltipWidth = tooltip.offsetWidth;
        const tooltipHeight = tooltip.offsetHeight;
  
        // 5) Position it below and centered
        const left = rect.left + window.scrollX + (rect.width / 2) - (tooltipWidth / 2);
        const top = rect.top + window.scrollY + rect.height + 8;
  
        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
  
        // 6) Fade in by adding the 'show' class
        requestAnimationFrame(() => {
          tooltip.classList.add('show');
          isTooltipVisible = true;
        });
      }
  
      /**
       * Hide the tooltip with a smooth fade-out.
       */
      function hideTooltip() {
        if (!isTooltipVisible) return;
  
        tooltip.classList.remove('show');  // triggers transition to opacity: 0
        tooltip.classList.add('fade-out'); // optional: helps if you want a fade-out class
  
        // After the transition, set display: none
        setTimeout(() => {
          tooltip.style.display = 'none';
          tooltip.classList.remove('fade-out', 'green-mode', 'warning-mode');
          isTooltipVisible = false;
        }, 200); // match your CSS transition duration
      }
  
      /**
       * Attach mouseenter/mouseleave events to show/hide the tooltip.
       * @param {HTMLElement} iconElement
       * @param {string} text - The tooltip message
       * @param {boolean} isWarning - Distinguish styling (orange vs green)
       */
      function attachTooltipEvents(iconElement, text, isWarning) {
        if (!iconElement) return;
  
        iconElement.addEventListener('mouseenter', () => {
          if (text) {
            showTooltip(iconElement, text, isWarning);
          }
        });
        iconElement.addEventListener('mouseleave', () => {
          hideTooltip();
        });
      }
  
      /**
       * Set the icon content & style based on warnings. Then attach tooltip.
       * @param {HTMLElement} iconElement
       * @param {Object} valueAddDoc
       * @param {string} label
       */
      function setValueAddIcon(iconElement, valueAddDoc, label = '') {
        if (!iconElement) return;
      
        const hasAssets = householdData?.totalAccountValue > 0;
      
        // CASE A: No ValueAdd doc
        if (!valueAddDoc) {
          if (hasAssets) {
            iconElement.textContent = 'check_circle';
            iconElement.classList.remove('warning-icon');
            iconElement.classList.add('green-icon');
            attachTooltipEvents(iconElement, `${label} Value Add not generated yet.`, false);
          } else {
            iconElement.textContent = 'warning';
            iconElement.classList.remove('green-icon');
            iconElement.classList.add('warning-icon');
            attachTooltipEvents(iconElement, `Household has no assets.`, true);
          }
          return;
        }
      
        // SPECIAL CASE for BUCKETS: Even if doc exists, show warning if no assets
        if (valueAddDoc.type === 'BUCKETS' && !hasAssets) {
          iconElement.textContent = 'warning';
          iconElement.classList.remove('green-icon');
          iconElement.classList.add('warning-icon');
          attachTooltipEvents(iconElement, `Household has no assets.`, true);
          return;
        }
      
        // CASE B: ValueAdd exists – check for warnings
        const hasWarnings = Array.isArray(valueAddDoc.warnings) && valueAddDoc.warnings.length > 0;
      
        if (hasWarnings) {
          iconElement.textContent = 'warning';
          iconElement.classList.remove('green-icon');
          iconElement.classList.add('warning-icon');
      
          let tooltipMsg = valueAddDoc.warnings.join('\n');
          if (valueAddDoc.type === 'BUCKETS') {
            tooltipMsg = 'Some accounts are missing asset allocations. Please fix them for an accurate Buckets analysis!';
          }
      
          attachTooltipEvents(iconElement, tooltipMsg, true);
        } else {
          iconElement.textContent = 'check_circle';
          iconElement.classList.remove('warning-icon');
          iconElement.classList.add('green-icon');
          attachTooltipEvents(iconElement, 'No issues!', false);
        }
      }
      
      
      
  
      // 5) Apply to Guardrails & Buckets
      setValueAddIcon(guardrailsIcon, guardrailsValueAdd, 'Guardrails');
      setValueAddIcon(bucketsIcon, bucketsValueAdd, 'Buckets');
  
    } catch (err) {
      console.error('Error fetching or displaying ValueAdds:', err);
    }
  });
  