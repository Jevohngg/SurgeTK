// Frontend JavaScript function to compute age from a date string
function calculateAge(dobString) {
    if (!dobString) return null;
  
    const dob = new Date(dobString);
    if (isNaN(dob.getTime())) {
      return null;
    }
  
    const now = new Date();
    let age = now.getFullYear() - dob.getFullYear();
    const monthDiff = now.getMonth() - dob.getMonth();
  
    // If the current month/day is before the birth month/day, subtract 1 year
    if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) {
      age--;
    }
    return age;
  }
  
  // On DOM load, find all span#clientAge elements and replace their content
  document.addEventListener('DOMContentLoaded', () => {


    

      // 1. Find all elements that have the DOB text
  //    (Use your actual selector where the raw date is shown)
  const dobElements = document.querySelectorAll('p.contactSubDOB');

  dobElements.forEach(el => {
    // 2. Get the current text content (e.g. "Fri Mar 10 1972 00:00:00 GMT-0800 (Pacific Standard Time)")
    const rawDOB = el.textContent.trim();
    
    // 3. Try parsing it as a Date
    const dobDate = new Date(rawDOB);
    if (isNaN(dobDate.getTime())) {
      // If invalid date, just leave it as is (or display '---')
      return;
    }
    
    // 4. Format as "Mar 10 1972" (short month, day, year, no comma)
    const options = { month: 'short', day: 'numeric', year: 'numeric' };
    const formattedDOB = dobDate
      .toLocaleDateString('en-US', options)
      .replace(/,/g, ''); // remove commas

    // 5. Replace the text content with the nice format
    el.textContent = formattedDOB;
  });



    // We changed the query from 'p#clientAge' to 'span#clientAge'
    // because the Pug template uses span.member-age#clientAge
    const ageElements = document.querySelectorAll('span#clientAge');
    ageElements.forEach(el => {
      const dobString = el.dataset.dob; // e.g. "1972-03-10T08:00:00.000Z"
      const age = calculateAge(dobString);
  
      if (age !== null) {
        el.textContent = `(${age})`;
      } else {
        el.textContent = '(N/A)';
      }
    });
  });
  