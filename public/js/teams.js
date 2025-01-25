document.addEventListener('DOMContentLoaded', () => {
    const teamPanel = document.getElementById('team');
    if (!teamPanel) return; // No team panel present

    const firmId = teamPanel.getAttribute('data-firm-id');
    const companyId = teamPanel.getAttribute('data-company-id');
    const isSuperAdmin = teamPanel.getAttribute('data-superadmin') === 'true';

    const teamMembersBody = document.getElementById('team-members-body');
    const addTeamMemberButton = document.getElementById('add-team-member-button');
    const addTeamMemberModal = document.getElementById('add-team-member-modal');
    const addTeamMemberForm = document.getElementById('add-team-member-form');
    const inviteEmailInput = document.getElementById('invite-email');
    const inviteRoleSelect = document.getElementById('invite-role');
    const invitePermissionsTextarea = document.getElementById('invite-permissions');

    let teamModalInstance;
    if (addTeamMemberModal) {
        teamModalInstance = new bootstrap.Modal(addTeamMemberModal, {keyboard:false});
    }

    // Only show "Add Team Member" button if super admin
    if (!isSuperAdmin && addTeamMemberButton) {
        addTeamMemberButton.style.display = 'none';
    }

    // Load Team Members on init
    loadTeamMembers();

    // Event listener to open "Add Team Member" modal
    if (addTeamMemberButton && teamModalInstance) {
        addTeamMemberButton.addEventListener('click', () => {
            addTeamMemberForm.reset();
            teamModalInstance.show();
        });
    }

    // Handle form submission for adding a team member
    if (addTeamMemberForm) {
        addTeamMemberForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const email = inviteEmailInput.value.trim();
            const role = inviteRoleSelect.value;
            const permissionsText = invitePermissionsTextarea.value.trim();
            let permissions = {};

            if (permissionsText) {
                try {
                    permissions = JSON.parse(permissionsText);
                } catch (err) {
                    // If parsing fails, fallback to a simple interpretation or show error
                    showAlert('error', 'Permissions must be valid JSON.');
                    return;
                }
            }

            // Send invite request to backend
            try {
                const response = await fetch('/settings/team/invite', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Requested-With': 'XMLHttpRequest'
                    },
                    body: JSON.stringify({
                        email,
                        role,
                        permissions,
                        companyId // Pass companyId so the email can include it
                    })
                });

                const result = await response.json();
                if (response.ok) {
                    showAlert('success', result.message || 'Invitation sent!');
                    teamModalInstance.hide();
                    // Refresh the team list to include the new pending user
                    loadTeamMembers();
                } else {
                    showAlert('error', result.message || 'Failed to invite user.');
                }
            } catch (error) {
                console.error('Error inviting team member:', error);
                showAlert('error', 'An error occurred while inviting the team member.');
            }
        });
    }

    // Function to load team members from backend
    async function loadTeamMembers() {
        try {
            const response = await fetch('/settings/team/users');

            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.message || 'Failed to load team members.');
            }

            // Clear existing rows
            teamMembersBody.innerHTML = '';

            data.members.forEach(member => {
                const tr = document.createElement('tr');
                tr.classList.add('team-member-row'); // row-level class
            
                // Avatar Cell
                const tdAvatar = document.createElement('td');
                tdAvatar.classList.add('team-member-avatar-cell');  // <--- Unique cell class
                const img = document.createElement('img');
                img.src = member.avatar || '/images/defaultProfilePhoto.png';
                img.alt = 'User Avatar';
                img.style.width = '40px';
                img.style.height = '40px';
                img.style.objectFit = 'cover';
                img.style.borderRadius = '50%';
                tdAvatar.appendChild(img);
                tr.appendChild(tdAvatar);
            
                // Email Cell
                const tdEmail = document.createElement('td');
                tdEmail.classList.add('team-member-email-cell');  // <--- Unique cell class
                tdEmail.innerText = member.email;
                if (member.status === 'pending') {
                    const spanPending = document.createElement('span');
                    spanPending.classList.add('badge', 'bg-warning', 'ms-2');
                    spanPending.innerText = 'pending';
                    tdEmail.appendChild(spanPending);
                }
                tr.appendChild(tdEmail);
            
                // Role Cell
                const tdRole = document.createElement('td');
                tdRole.classList.add('team-member-role-cell');  // <--- Unique cell class
                tdRole.innerText = formatRole(member.role);
                tr.appendChild(tdRole);
            
                // Permissions Cell
                const tdPermissions = document.createElement('td');
                tdPermissions.classList.add('team-member-permissions-cell'); // <--- Unique cell class
                tdPermissions.innerText = member.permissions 
                  ? JSON.stringify(member.permissions) 
                  : 'None';
                tr.appendChild(tdPermissions);
            
                // Status Cell
                const tdStatus = document.createElement('td');
                tdStatus.classList.add('team-member-status-cell'); // <--- Unique cell class
                tdStatus.innerText = member.status || 'active';
                tr.appendChild(tdStatus);
            
                // Actions Cell (only if super admin)
                if (isSuperAdmin) {
                    const tdActions = document.createElement('td');
                    tdActions.classList.add('team-member-actions-cell');  // <--- Unique cell class
            
                    if (member.email !== data.currentUserEmail) {
                        const removeBtn = document.createElement('button');
                        removeBtn.classList.add('btn', 'btn-sm', 'btn-danger');
                        removeBtn.innerText = 'Remove';
                        removeBtn.addEventListener('click', () => {
                            removeTeamMember(member.email);
                        });
                        tdActions.appendChild(removeBtn);
                    }
                    tr.appendChild(tdActions);
                }
            
                teamMembersBody.appendChild(tr);
            });
            

        } catch (error) {
            console.error('Error loading team members:', error);
            showAlert('error', 'Failed to load team members.');
        }
    }


    // Define a mapping of internal role names to display names
const ROLE_DISPLAY_MAP = {
    'super_admin': 'Super Admin',
    'admin': 'Admin',
    'advisor': 'Advisor',
    'assistant': 'Assistant'
  };
  
  // A helper function that returns a display-friendly role name
  function formatRole(role) {
    return ROLE_DISPLAY_MAP[role] || role; // Fallback to original if not found
  }
  


    // Function to remove a team member
    async function removeTeamMember(email) {
        if (!confirm(`Are you sure you want to remove ${email}?`)) return;

        try {
            const response = await fetch('/settings/team/remove', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: JSON.stringify({ email })
            });

            const result = await response.json();
            if (response.ok) {
                showAlert('success', result.message || `${email} removed successfully.`);
                loadTeamMembers();
            } else {
                showAlert('error', result.message || 'Failed to remove team member.');
            }
        } catch (error) {
            console.error('Error removing team member:', error);
            showAlert('error', 'An error occurred while removing the team member.');
        }
    }

    /**
     * Displays a custom alert message.
     * Reuse the showAlert function from settings.js if it's globally available.
     * If not, implement here again or ensure it's globally accessible.
     */
    function showAlert(type, message) {
        const alertContainer = document.getElementById('alert-container');
        if (!alertContainer) return;

        const alert = document.createElement('div');
        alert.className = `alert ${type === 'success' ? 'alert-success' : 'alert-error'}`;
        alert.setAttribute('role', 'alert');

        const iconContainer = document.createElement('div');
        iconContainer.className = type === 'success' ? 'success-icon-container' : 'error-icon-container';
        const icon = document.createElement('i');
        icon.className = type === 'success' ? 'far fa-check-circle' : 'far fa-times-circle';
        iconContainer.appendChild(icon);

        const closeContainer = document.createElement('div');
        closeContainer.className = type === 'success' ? 'success-close-container' : 'error-close-container';
        const closeIcon = document.createElement('span');
        closeIcon.className = 'material-symbols-outlined successCloseIcon';
        closeIcon.innerText = 'close';
        closeContainer.appendChild(closeIcon);

        const textContainer = document.createElement('div');
        textContainer.className = 'success-text';
        const title = document.createElement('h3');
        title.innerText = type === 'success' ? 'Success!' : 'Error!';
        const text = document.createElement('p');
        text.innerText = message;
        textContainer.appendChild(title);
        textContainer.appendChild(text);

        alert.appendChild(iconContainer);
        alert.appendChild(closeContainer);
        alert.appendChild(textContainer);

        alertContainer.prepend(alert);

        void alert.offsetWidth; // Force reflow
        alert.classList.add('show');

        setTimeout(() => closeAlert(alert), 5000);
        closeIcon.addEventListener('click', () => closeAlert(alert));
    }

    function closeAlert(alert) {
        alert.classList.add('exit');
        setTimeout(() => {
            if (alert && alert.parentNode) {
                alert.parentNode.removeChild(alert);
            }
        }, 500);
    }

});
