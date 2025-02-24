// teams.js
document.addEventListener('DOMContentLoaded', () => {
  console.log('[DEBUG] isAdminAccess (server):', window.IS_ADMIN_ACCESS);

  // Fallback to false if not defined
  const isAdminAccess = window.IS_ADMIN_ACCESS === true;
  console.log('[DEBUG] isAdminAccess (frontend):', isAdminAccess);

  // Grab the #team panel
  const teamPanel = document.getElementById('team');
  if (!teamPanel) {
    console.warn('[DEBUG] No team panel found in the DOM.');
    return;
  }

  const firmId = teamPanel.getAttribute('data-firm-id');
  const companyId = teamPanel.getAttribute('data-company-id');
  console.log('[DEBUG] firmId:', firmId, 'companyId:', companyId);

  // DOM elements
  const teamMembersBody = document.getElementById('team-members-body');
  const addTeamMemberButton = document.getElementById('add-team-member-button');
  const addTeamMemberModal = document.getElementById('add-team-member-modal');
  const addTeamMemberForm = document.getElementById('add-team-member-form');

  // "Add Team Member" form inputs
  const inviteEmailInput = document.getElementById('invite-email');
  const inviteRoleSelect = document.getElementById('invite-role');       // 'admin'|'advisor'|'assistant'
  const invitePermissionsSelect = document.getElementById('invite-permissions'); // single permission
  const alsoAdvisorContainer = document.getElementById('also-advisor-container');
  const alsoAdvisorCheckbox = document.getElementById('also-advisor-checkbox');

  // Variables for Remove Confirmation Modal
  let removeModalInstance;        // The Bootstrap modal instance
  let removeMemberEmail = null;   // The email of the member to remove

  // Grab the confirmRemoveModal and confirmRemoveBtn
  const confirmRemoveModalElem = document.getElementById('confirmRemoveModal');
  const confirmRemoveBtn = document.getElementById('confirmRemoveBtn');
  const confirmRemoveMessage = document.getElementById('confirmRemoveMessage');

  // Initialize the remove modal if it exists
  if (confirmRemoveModalElem) {
    removeModalInstance = new bootstrap.Modal(confirmRemoveModalElem, { keyboard: false });
  } else {
    console.warn('[DEBUG] No #confirmRemoveModal element found.');
  }

  // If we have a confirmRemoveBtn, attach a click listener
  if (confirmRemoveBtn) {
    confirmRemoveBtn.addEventListener('click', () => {
      // Actually remove the team member now
      if (removeMemberEmail) {
        removeTeamMember(removeMemberEmail);
      }
    });
  }

  // For the Add Team Member modal
  let teamModalInstance;
  if (addTeamMemberModal) {
    teamModalInstance = new bootstrap.Modal(addTeamMemberModal, { keyboard: false });
  } else {
    console.warn('[DEBUG] No #add-team-member-modal element found.');
  }

  // If user is not admin, hide the "Add Team Member" button
  if (!isAdminAccess && addTeamMemberButton) {
    console.log('[DEBUG] Hiding "Add Team Member" button because user is not admin.');
    addTeamMemberButton.style.display = 'none';
  } else if (isAdminAccess && addTeamMemberButton) {
    console.log('[DEBUG] "Add Team Member" button is visible (admin).');
  }

  //=====================
  // AUTO-SET PERMISSIONS
  //=====================
  function autoSetInvitePermission() {
    const selectedRole = inviteRoleSelect.value; // 'admin','advisor','assistant'
    if (selectedRole === 'admin' && alsoAdvisorCheckbox && alsoAdvisorCheckbox.checked) {
      invitePermissionsSelect.value = 'admin';
    }
    else if (selectedRole === 'admin') {
      invitePermissionsSelect.value = 'admin';
    }
    else if (selectedRole === 'advisor') {
      invitePermissionsSelect.value = 'advisor';
    }
    else {
      invitePermissionsSelect.value = 'assistant';
    }
  }

  if (inviteRoleSelect && alsoAdvisorContainer) {
    inviteRoleSelect.addEventListener('change', () => {
      if (inviteRoleSelect.value === 'admin') {
        alsoAdvisorContainer.style.display = 'flex';
      } else {
        alsoAdvisorContainer.style.display = 'none';
        if (alsoAdvisorCheckbox) alsoAdvisorCheckbox.checked = false;
      }
      autoSetInvitePermission();
    });
  }

  if (alsoAdvisorCheckbox) {
    alsoAdvisorCheckbox.addEventListener('change', () => {
      autoSetInvitePermission();
    });
  }

  //=====================
  // LOAD TEAM MEMBERS ON INIT
  //=====================
  loadTeamMembers();

  //=====================
  // OPEN ADD-MEMBER MODAL
  //=====================
  if (addTeamMemberButton && teamModalInstance) {
    addTeamMemberButton.addEventListener('click', () => {
      if (addTeamMemberForm) {
        addTeamMemberForm.reset();
        alsoAdvisorContainer.style.display = 'none';
      }
      teamModalInstance.show();
    });
  }

  //=====================
  // ADD TEAM MEMBER FORM SUBMIT
  //=====================
  // "Add Team Member" form submit handler
if (addTeamMemberForm) {
  addTeamMemberForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = inviteEmailInput.value.trim();
    let role = inviteRoleSelect.value; // 'admin','advisor','assistant'
    const permission = invitePermissionsSelect.value || 'assistant';

    let rolesArray = [role];
    if (role === 'admin' && alsoAdvisorCheckbox && alsoAdvisorCheckbox.checked) {
      rolesArray = ['admin','advisor'];
    }

    try {
      const response = await fetch('/settings/team/invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify({
          email,
          roles: rolesArray,
          permission,
          companyId
        })
      });

      const result = await response.json();

      if (response.ok) {
        // The invite worked
        showAlert('success', result.message || 'Invitation sent!');
        teamModalInstance.hide();
        loadTeamMembers();
      } else {
        // Handle errors
        // >>> Check for seat-limit message specifically <<<
        if (
          response.status === 403 &&
          result.message &&
          result.message.toLowerCase().includes('maximum number of advisor seats')
        ) {
          // Option A: Show an alert with a link/button to open the subscription modal
          showAlert(
            'error',
            result.message 
          );

          // Next, we can listen for a click on that link and launch the "Change Plan" modal
          setTimeout(() => {
            const link = document.getElementById('upgradePlanLink');
            if (link) {
              link.addEventListener('click', (e) => {
                e.preventDefault();
                // If you have a function like openSubscriptionWizard in billing.js:
                // openSubscriptionWizard('pro','monthly', <some default seat count>);
                // Or simply trigger the "Change Plan" button programmatically:
                const changePlanButton = document.getElementById('change-plan-button');
                if (changePlanButton) {
                  changePlanButton.click();
                }
              });
            }
          }, 0);
        } else {
          // Generic error fallback
          showAlert('error', result.message || 'Failed to invite user.');
        }
      }
    } catch (error) {
      console.error('Error inviting team member:', error);
      showAlert('error', 'An error occurred while inviting the team member.');
    }
  });
}


  //=====================
  // LOAD TEAM MEMBERS
  //=====================
  async function loadTeamMembers() {
    try {
      const response = await fetch('/settings/team/users', { credentials: 'include' });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Failed to load team members.');
      }
  
      // Clear the table body
      if (teamMembersBody) {
        teamMembersBody.innerHTML = '';
      }
  
      // Destructure the server response
      const {
        currentUserId,
        currentUserEmail,
        members,
        advisorSeatsRemaining,
        nonAdvisorSeatsRemaining
      } = data;
  
      // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
      // Display seat usage in the header
      // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
      // Make sure you have two elements in the DOM with IDs:
      // #advisor-seats-remaining and #nonadvisor-seats-remaining
      const advisorSeatsElem = document.getElementById('advisor-seats-remaining');
      const nonAdvisorSeatsElem = document.getElementById('nonadvisor-seats-remaining');
      if (advisorSeatsElem) {
        advisorSeatsElem.textContent = advisorSeatsRemaining;
      }
      if (nonAdvisorSeatsElem) {
        nonAdvisorSeatsElem.textContent = nonAdvisorSeatsRemaining;
      }
  
      // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
      // Populate the team members table
      // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
      members.forEach(member => {
        const tr = document.createElement('tr');
        tr.classList.add('team-member-row');
  
        // Avatar cell
        const tdAvatar = document.createElement('td');
        tdAvatar.classList.add('team-member-avatar-cell');
        const img = document.createElement('img');
        img.src = member.avatar || '/images/defaultProfilePhoto.png';
        img.alt = 'User Avatar';
        img.style.width = '40px';
        img.style.height = '40px';
        img.style.objectFit = 'cover';
        img.style.borderRadius = '50%';
        tdAvatar.appendChild(img);
        tr.appendChild(tdAvatar);
  
        // Email cell
        const tdEmail = document.createElement('td');
        tdEmail.classList.add('team-member-email-cell');
        tdEmail.innerText = member.email;
  
        if (member.status === 'pending') {
          const spanPending = document.createElement('span');
          spanPending.classList.add('badge','bg-warning','ms-2');
          spanPending.innerText = 'pending';
          tdEmail.appendChild(spanPending);
        }
  
        if (member.isFirmCreator) {
          const spanCreator = document.createElement('span');
          spanCreator.classList.add('badge', 'bg-info', 'ms-2');
          spanCreator.innerText = 'Creator';
          tdEmail.appendChild(spanCreator);
        }
        tr.appendChild(tdEmail);
  
        // Roles cell
        const tdRole = document.createElement('td');
        tdRole.classList.add('team-member-role-cell');
        tdRole.innerText = formatRoles(member.roles);
        tr.appendChild(tdRole);
  
        // Permission cell
        const tdPermissions = document.createElement('td');
        tdPermissions.classList.add('team-member-permissions-cell');
        tdPermissions.innerText = member.permission ? capitalize(member.permission) : 'Assistant';
        tr.appendChild(tdPermissions);
  
        // Status cell
        const tdStatus = document.createElement('td');
        tdStatus.classList.add('team-member-status-cell');
        tdStatus.innerText = member.status || 'active';
        tr.appendChild(tdStatus);
  
        // Actions cell
        const tdActions = document.createElement('td');
        tdActions.classList.add('team-member-actions-cell');
  
        if (isAdminAccess) {
          // Only show "Edit" if they are not 'pending'
          if (member.status !== 'pending') {
            const editBtn = createEditButton(member);
            tdActions.appendChild(editBtn);
          }
  
          // Show "Remove" if it's not the current user or if they're pending
          // (and not the firm creator, if you like)
          if (member.status !== 'pending' && member.email !== currentUserEmail) {
            const removeBtn = createRemoveButton(member);
            tdActions.appendChild(removeBtn);
          } else if (member.status === 'pending') {
            // You can still show a remove button for pending invites
            const removeBtn = createRemoveButton(member);
            tdActions.appendChild(removeBtn);
          }
        }
  
        tr.appendChild(tdActions);
        teamMembersBody.appendChild(tr);
      });
  
    } catch (error) {
      console.error('Error loading team members:', error);
      showAlert('error', 'Failed to load team members.');
    }
  }
  

  //=====================
  // CREATE REMOVE BUTTON
  //=====================
  function createRemoveButton(member) {
    const removeBtn = document.createElement('button');
    removeBtn.classList.add('btn','btn-sm','icon-btn','btn-danger');
    removeBtn.setAttribute('title','Remove');

    const removeIcon = document.createElement('span');
    removeIcon.classList.add('material-symbols-outlined');
    removeIcon.innerText = 'delete';
    removeBtn.appendChild(removeIcon);

    // Instead of confirm(), we open the Bootstrap modal
    removeBtn.addEventListener('click', () => {
      showRemoveConfirmationModal(member.email);
    });
    return removeBtn;
  }

  /**
   * Show the Bootstrap confirmation modal for removing a member.
   * @param {string} email - The email of the member to remove.
   */
  function showRemoveConfirmationModal(email) {
    removeMemberEmail = email;
    if (confirmRemoveMessage) {
      confirmRemoveMessage.textContent = `Are you sure you want to remove ${email}?`;
    }
    if (removeModalInstance) {
      removeModalInstance.show();
    } else {
      console.warn('[DEBUG] removeModalInstance is not available.');
    }
  }

  //=====================
  // CREATE EDIT BUTTON
  //=====================
  function createEditButton(member) {
    const editBtn = document.createElement('button');
    editBtn.classList.add('btn','btn-sm','icon-btn','btn-secondary','ms-2');
    editBtn.setAttribute('title','Edit');

    const editIcon = document.createElement('span');
    editIcon.classList.add('material-symbols-outlined');
    editIcon.innerText = 'edit';
    editBtn.appendChild(editIcon);

    editBtn.addEventListener('click', () => {
      openEditModal(member);
    });
    return editBtn;
  }

  //=====================
  // REMOVE TEAM MEMBER
  //=====================
  async function removeTeamMember(email) {
    console.log('[DEBUG] Removing team member:', email);
    try {
      const response = await fetch('/settings/team/remove', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify({ email })
      });

      const result = await response.json();
      console.log('[DEBUG] removeTeamMember response:', result);

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

    // After trying to remove, hide the modal if it's still open
    if (removeModalInstance) {
      removeModalInstance.hide();
    }
  }

  //=====================
  // EDIT MODAL CODE
  //=====================
  let editModalInstance;
  const editModalElement = document.getElementById('edit-team-member-modal');
  if (editModalElement) {
    editModalInstance = new bootstrap.Modal(editModalElement, { keyboard: false });
  } else {
    console.warn('[DEBUG] No #edit-team-member-modal element found.');
  }

  const editTeamMemberForm = document.getElementById('edit-team-member-form');
  const editRoleSelect = document.getElementById('edit-role');
  const editPermissionsSelect = document.getElementById('edit-permissions');
  const editAlsoAdvisorContainer = document.getElementById('editAlsoAdvisorContainer');
  let editAlsoAdvisorCheckbox;
  if (editAlsoAdvisorContainer) {
    editAlsoAdvisorCheckbox = document.getElementById('editAlsoAdvisorCheckbox');
  }

  // If user chooses "Admin", show "Also advisor"
  if (editRoleSelect && editAlsoAdvisorContainer) {
    editRoleSelect.addEventListener('change', () => {
      if (editRoleSelect.value === 'admin') {
        editAlsoAdvisorContainer.style.display = 'flex';
      } else {
        editAlsoAdvisorContainer.style.display = 'none';
        if (editAlsoAdvisorCheckbox) editAlsoAdvisorCheckbox.checked = false;
      }
    });
  }

  function openEditModal(member) {
    const editUserIdInput = document.getElementById('edit-user-id');
    if (!editUserIdInput || !editRoleSelect) {
      console.warn('[DEBUG] Missing required edit modal fields!');
      return;
    }

    // Pre-fill
    editUserIdInput.value = member._id;

    // Derive primary role from roles array
    let primaryRole = 'assistant';
    if (Array.isArray(member.roles) && member.roles.length > 0) {
      if (member.roles.includes('admin')) {
        primaryRole = 'admin';
      } else if (member.roles.includes('advisor')) {
        primaryRole = 'advisor';
      } else {
        primaryRole = 'assistant';
      }
    }
    editRoleSelect.value = primaryRole;

    // Single permission
    const perm = member.permission || 'assistant';
    editPermissionsSelect.value = perm;

    // If they have admin => check "also advisor" if includes advisor
    if (primaryRole === 'admin') {
      editAlsoAdvisorContainer.style.display = 'flex';
      if (member.roles && member.roles.includes('advisor')) {
        editAlsoAdvisorCheckbox.checked = true;
      } else {
        editAlsoAdvisorCheckbox.checked = false;
      }
    } else {
      editAlsoAdvisorContainer.style.display = 'none';
      editAlsoAdvisorCheckbox.checked = false;
    }

    editModalInstance.show();
  }

  if (editTeamMemberForm) {
    editTeamMemberForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const userId = document.getElementById('edit-user-id').value;
      let newRole = editRoleSelect.value; // 'admin','advisor','assistant'
      const newPermission = editPermissionsSelect.value || 'assistant';

      let rolesArray = [newRole];
      if (newRole === 'admin' && editAlsoAdvisorCheckbox && editAlsoAdvisorCheckbox.checked) {
        rolesArray = ['admin','advisor'];
      }

      try {
        const response = await fetch(`/settings/team/users/${userId}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
          },
          body: JSON.stringify({
            roles: rolesArray,
            permission: newPermission
          })
        });

        const result = await response.json();
        if (response.ok) {
          showAlert('success', result.message || 'User updated successfully.');
          editModalInstance.hide();
          loadTeamMembers();
        } else {
          showAlert('error', result.message || 'Failed to update user.');
        }
      } catch (error) {
        console.error('Error updating user:', error);
        showAlert('error', 'An error occurred while updating user.');
      }
    });
  } else {
    console.warn('[DEBUG] No #edit-team-member-form found.');
  }

  //=====================
  // HELPER FUNCTIONS
  //=====================
  function formatRoles(rolesArray) {
    if (!Array.isArray(rolesArray) || rolesArray.length === 0) {
      return 'None';
    }
    const ROLE_DISPLAY_MAP = {
      admin: 'Admin',
      advisor: 'Advisor',
      assistant: 'Assistant'
    };
    const mapped = rolesArray.map(r => ROLE_DISPLAY_MAP[r] || r);
    return mapped.join(', ');
  }

  function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function showAlert(type, message) {
    const alertContainer = document.getElementById('alert-container');
    if (!alertContainer) {
      console.warn('[DEBUG] No #alert-container found. Cannot show alert:', message);
      return;
    }

    const alert = document.createElement('div');
    alert.className = `alert ${type === 'success' ? 'alert-success' : 'alert-error'}`;
    alert.setAttribute('role','alert');

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

    // Force reflow
    void alert.offsetWidth;
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
