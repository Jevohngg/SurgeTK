// public/js/errorDashboard.js
document.addEventListener('DOMContentLoaded', () => {
    const socket = io();
  
    socket.on('newError', (errorData) => {
      const notification = document.createElement('div');
      notification.className = 'alert alert-danger alert-dismissible fade show';
      notification.innerHTML = `
        <strong>New Error:</strong> ${errorData.message}
        <br><small>${errorData.url} - ${new Date(errorData.timestamp).toLocaleString()}</small>
        <button type="button" class="close" data-dismiss="alert">&times;</button>
      `;
      document.body.appendChild(notification);
      
      // Auto-remove after 5 seconds
      setTimeout(() => notification.remove(), 5000);
    });
  });