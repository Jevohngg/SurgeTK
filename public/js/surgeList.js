// public/js/surgeList.js
document.addEventListener('DOMContentLoaded', () => {
    const tableBody = document.querySelector('#wSurgeTable tbody');
    const createBtn = document.getElementById('openCreateSurgeBtn');
    const modalEl   = document.getElementById('createSurgeModal');
    const form      = document.getElementById('createSurgeForm');
  
    const loadSurges = async () => {
      const res = await fetch('/api/surge?page=1&limit=50');
      const { surges } = await res.json();
      tableBody.innerHTML = '';
      surges.forEach(s => {
        const tr = document.createElement('tr');
        tr.classList.add('clickable-row');
        tr.innerHTML = `
          <td>${s.name}</td>
          <td>${new Date(s.startDate).toLocaleDateString()} – ${new Date(s.endDate).toLocaleDateString()}</td>
          <td><span class="badge bg-${statusColor(s.status)}">${s.status}</span></td>
          <td>${s.preparedCount}/${s.householdCount}</td>
        `;
      
        // when clicking anywhere on the row, go to detail page
        tr.addEventListener('click', () => {
          window.location.href = `/surge/${s._id}`;
        });
      
        tableBody.appendChild(tr);
      });
    };
  
    const statusColor = (st) => ({
      upcoming: 'secondary',
      active:   'success',
      past:     'dark'
    }[st] || 'light');
  
    // modal controls
    const bsModal = new bootstrap.Modal(modalEl);
    createBtn.addEventListener('click', () => bsModal.show());
  
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const body = {
        name: form.surgeName.value.trim(),
        startDate: form.startDate.value,
        endDate: form.endDate.value
      };
      const res = await fetch('/api/surge', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
      if (res.ok) {
        bsModal.hide();
        await loadSurges();
      } else {
        alert('Error creating surge');
      }
    });
  
    loadSurges();
  });
  