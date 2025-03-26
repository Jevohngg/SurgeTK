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

  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  // NEW FIELDS FOR ROLES & SUB-PERMISSIONS (Invite)
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

  // "Add Team Member" form inputs
  const inviteEmailInput = document.getElementById('invite-email');

  // Now we have 'admin','leadAdvisor','assistant','teamMember'
  const inviteRoleSelect = document.getElementById('invite-role');

  // Admin -> Also an Advisor
  const adminAlsoAdvisorContainer = document.getElementById('also-advisor-container');
  const adminAlsoAdvisorCheckbox = document.getElementById('also-advisor-checkbox');

  // Lead Advisor -> Sub-Permission
  const leadAdvisorPermissionContainer = document.getElementById('lead-advisor-permission-container');
  const leadAdvisorPermissionSelect = document.getElementById('leadAdvisorPermissionSelect');
  const leadAdvisorPermissionHelp = document.getElementById('leadAdvisorPermissionHelp');

  // Assistant -> Enhanced Dropdown for "assistant to which lead advisors?" + sub-permission
  const assistantToDropdownContainer = document.getElementById('assistant-to-dropdown-container');
  const assistantLeadAdvisorDropdownMenu = document.getElementById('assistantLeadAdvisorDropdownMenu');

  // This is our read-only "input" that displays selected lead advisors
  const assistantLeadAdvisorDisplayInput = document.getElementById('assistantLeadAdvisorDisplayInput');
  // The hidden input that holds the actual IDs (for form submission)
  const assistantLeadAdvisorHiddenInput = document.getElementById('assistantLeadAdvisorHiddenInput');

  // We'll store the list of lead advisors in memory, so we can show them in the dropdown
  let leadAdvisorOptions = [];

  // Assistant sub-permission
  const assistantPermissionContainer = document.getElementById('assistant-permission-container');
  const assistantPermissionSelect = document.getElementById('assistantPermissionSelect');

  // Team Member -> Sub-Permission
  const teamMemberPermissionContainer = document.getElementById('team-member-permission-container');
  const teamMemberPermissionSelect = document.getElementById('teamMemberPermissionSelect');

  // Variables for Remove Confirmation Modal
  let removeModalInstance;
  let removeMemberEmail = null;

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

  if (confirmRemoveBtn) {
    confirmRemoveBtn.addEventListener('click', () => {
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

  // =============================
  // SHOW/HIDE FIELDS BASED ON ROLE
  // =============================
  if (inviteRoleSelect) {
    inviteRoleSelect.addEventListener('change', () => {
      handleRoleChange();
    });
  }

  function handleRoleChange() {
    const selectedRole = inviteRoleSelect.value; // 'admin','leadAdvisor','assistant','teamMember'

    // Hide all optional containers first
    adminAlsoAdvisorContainer.style.display = 'none';
    leadAdvisorPermissionContainer.style.display = 'none';
    assistantToDropdownContainer.style.display = 'none';
    assistantPermissionContainer.style.display = 'none';
    teamMemberPermissionContainer.style.display = 'none';

    // Then show relevant container(s)
    if (selectedRole === 'admin') {
      adminAlsoAdvisorContainer.style.display = 'flex';
    } else if (selectedRole === 'leadAdvisor') {
      leadAdvisorPermissionContainer.style.display = 'flex';
      updateLeadAdvisorPermissionHelp();
    } else if (selectedRole === 'assistant') {
      // Display the "Assistant to" container
      assistantToDropdownContainer.style.display = 'block';
      populateAssistantToDropdown(); // fill the dropdown with checkboxes
      assistantPermissionContainer.style.display = 'flex';
    } else if (selectedRole === 'teamMember') {
      teamMemberPermissionContainer.style.display = 'flex';
    }
  }

  function updateLeadAdvisorPermissionHelp() {
    if (!leadAdvisorPermissionSelect || !leadAdvisorPermissionHelp) return;
    const val = leadAdvisorPermissionSelect.value;
    let text = '';
    switch(val) {
      case 'admin':
        text = 'Full System Admin.';
        break;
      case 'all':
        text = 'View & Edit all Households. View-Only System Settings.';
        break;
      case 'limited':
        text = 'View & Edit assigned Households. View-Only firm-wide Households.';
        break;
      case 'selfOnly':
        text = 'View & Edit assigned Households only. No access to others.';
        break;
      default:
        text = '';
    }
    leadAdvisorPermissionHelp.textContent = text;
  }

  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  // ASSISTANT DROPDOWN LOGIC
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

  // We'll populate the dropdown with checkboxes for each lead advisor
  function populateAssistantToDropdown() {
    if (!assistantLeadAdvisorDropdownMenu || !assistantLeadAdvisorDisplayInput) return;

    // Clear existing
    assistantLeadAdvisorDropdownMenu.innerHTML = '';

    // If no lead advisors, show a placeholder
    if (!leadAdvisorOptions || leadAdvisorOptions.length === 0) {
      const label = document.createElement('label');
      label.classList.add('dropdown-item');
      label.textContent = 'No Lead Advisors found.';
      assistantLeadAdvisorDropdownMenu.appendChild(label);

      // Clear display & hidden
      assistantLeadAdvisorDisplayInput.value = '';
      assistantLeadAdvisorHiddenInput.value = '';
      return;
    }

    // Otherwise, create a checkbox for each lead advisor
    leadAdvisorOptions.forEach(advisor => {
      const label = document.createElement('label');
      label.classList.add('dropdown-item', 'form-check-label');

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.classList.add('form-check-input', 'assistantLeadAdvisorCheckbox');
      input.value = advisor._id;

      const displayName = `${advisor.firstName || ''} ${advisor.lastName || ''}`.trim() || advisor.email;

      label.appendChild(input);
      label.appendChild(document.createTextNode(` ${displayName} (${advisor.email})`));

      // On change, update the displayed text & hidden input
      input.addEventListener('change', () => {
        updateAssistantLeadAdvisorSelections();
      });

      assistantLeadAdvisorDropdownMenu.appendChild(label);
    });

    // Update in case some were pre-checked
    updateAssistantLeadAdvisorSelections();
  }

  // Gathers checked items, updates the read-only input & hidden input
  function updateAssistantLeadAdvisorSelections() {
    const checkboxes = assistantLeadAdvisorDropdownMenu.querySelectorAll('.assistantLeadAdvisorCheckbox:checked');
    const ids = [];
    const displayNames = [];

    checkboxes.forEach(box => {
      ids.push(box.value);
      const parentLabel = box.closest('label');
      if (parentLabel) {
        const labelText = parentLabel.textContent.trim();
        displayNames.push(labelText);
      }
    });

    // Store the array of IDs in JSON, or comma-separated
    assistantLeadAdvisorHiddenInput.value = JSON.stringify(ids);

    // Display the names in the read-only input
    if (displayNames.length === 0) {
      assistantLeadAdvisorDisplayInput.value = '';
    } else {
      assistantLeadAdvisorDisplayInput.value = displayNames.join(', ');
    }
  }

  // (Optional) A function to gather IDs from the checkboxes—if needed
  function gatherAssistantLeadAdvisors() {
    if (!assistantLeadAdvisorDropdownMenu) return [];
    const checkedBoxes = assistantLeadAdvisorDropdownMenu.querySelectorAll('.assistantLeadAdvisorCheckbox:checked');
    const ids = [];
    checkedBoxes.forEach(chk => {
      ids.push(chk.value);
    });
    return ids;
  }

  // If an admin chooses "Also an Advisor"
  if (adminAlsoAdvisorCheckbox) {
    adminAlsoAdvisorCheckbox.addEventListener('change', () => {
      // Additional UI toggles if needed
    });
  }

  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  // MANUAL TOGGLING OF THE DROPDOWN
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  // We'll use the .show class for fade logic; ensure .dropdown-menu.show has higher opacity, etc.

  if (assistantLeadAdvisorDisplayInput && assistantLeadAdvisorDropdownMenu) {
    assistantLeadAdvisorDisplayInput.addEventListener('click', (e) => {
      e.stopPropagation();
      // Toggle the .show class
      assistantLeadAdvisorDropdownMenu.classList.toggle('show');
    });

    // If user clicks outside the .dropdown-menu or the input, close it
    document.addEventListener('click', (event) => {
      const isClickInsideInput = assistantLeadAdvisorDisplayInput.contains(event.target);
      const isClickInsideMenu = assistantLeadAdvisorDropdownMenu.contains(event.target);

      if (!isClickInsideInput && !isClickInsideMenu) {
        assistantLeadAdvisorDropdownMenu.classList.remove('show');
      }
    });
  }

  //=====================
  // LOAD TEAM MEMBERS ON INIT
  //=====================
  loadTeamMembers();

  //=====================
  // OPEN ADD-MEMBER MODAL
  //=====================
  if (addTeamMemberButton) {
    if (addTeamMemberModal) {
      teamModalInstance = new bootstrap.Modal(addTeamMemberModal, { keyboard: false });
    } else {
      console.warn('[DEBUG] No #add-team-member-modal element found.');
    }

    addTeamMemberButton.addEventListener('click', () => {
      if (addTeamMemberForm) {
        addTeamMemberForm.reset();

  

        // Hide optional fields by default
        adminAlsoAdvisorContainer.style.display = 'none';
        leadAdvisorPermissionContainer.style.display = 'none';
        assistantToDropdownContainer.style.display = 'none';
        assistantPermissionContainer.style.display = 'none';
        teamMemberPermissionContainer.style.display = 'none';

        // Reset read-only input & hidden input
        if (assistantLeadAdvisorDisplayInput) {
          assistantLeadAdvisorDisplayInput.value = '';
        }
        if (assistantLeadAdvisorHiddenInput) {
          assistantLeadAdvisorHiddenInput.value = '';
        }
      }
      if (teamModalInstance) {
        teamModalInstance.show();
      }
    });
  }

  //=====================
  // ADD TEAM MEMBER FORM SUBMIT
  //=====================
  if (addTeamMemberForm) {
    addTeamMemberForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = inviteEmailInput.value.trim();
      const selectedRole = inviteRoleSelect.value; // 'admin','leadAdvisor','assistant','teamMember'
      let rolesArray = [selectedRole];

      // Admin + Also Advisor?
      let alsoAdvisorChecked = false;
      if (selectedRole === 'admin' && adminAlsoAdvisorCheckbox && adminAlsoAdvisorCheckbox.checked) {
        alsoAdvisorChecked = true;
        // For seat-limit logic, push 'leadAdvisor' if that's how you're marking them
        rolesArray.push('leadAdvisor');
      }

      // Sub-permissions
      let leadAdvisorPermissionValue = '';
      if (selectedRole === 'leadAdvisor' && leadAdvisorPermissionSelect) {
        leadAdvisorPermissionValue = leadAdvisorPermissionSelect.value;
      }

      let assistantToLeadAdvisors = [];
      if (selectedRole === 'assistant') {
        // Use gatherAssistantLeadAdvisors or parse the hidden input
        assistantToLeadAdvisors = gatherAssistantLeadAdvisors();
      }

      let assistantPermissionValue = '';
      if (selectedRole === 'assistant' && assistantPermissionSelect) {
        assistantPermissionValue = assistantPermissionSelect.value; // 'admin','inherit'
      }

      let teamMemberPermissionValue = '';
      if (selectedRole === 'teamMember' && teamMemberPermissionSelect) {
        teamMemberPermissionValue = teamMemberPermissionSelect.value; // 'admin','viewEdit','viewOnly'
      }

      // For older code usage: 'admin','advisor','assistant'
      let finalPermission = 'assistant';
      if (rolesArray.includes('admin')) {
        finalPermission = 'admin';
      } else if (rolesArray.includes('advisor') || rolesArray.includes('leadAdvisor')) {
        finalPermission = 'advisor';
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
            permission: finalPermission,
            alsoAdvisor: alsoAdvisorChecked,
            leadAdvisorPermission: leadAdvisorPermissionValue,
            assistantToLeadAdvisors,
            assistantPermission: assistantPermissionValue,
            teamMemberPermission: teamMemberPermissionValue,
            companyId
          })
        });

        const result = await response.json();
        if (response.ok) {
          showAlert('success', result.message || 'Invitation sent!');
          if (teamModalInstance) {
            teamModalInstance.hide();
          }
          loadTeamMembers();
        } else {
          if (
            response.status === 403 &&
            result.message &&
            result.message.toLowerCase().includes('maximum number of advisor seats')
          ) {
            showAlert('error', result.message);
          } else {
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

      if (teamMembersBody) {
        teamMembersBody.innerHTML = '';
      }

      const {
        currentUserId,
        currentUserEmail,
        members,
        advisorSeatsRemaining,
        nonAdvisorSeatsRemaining
      } = data;

      // Parse out lead advisors for the "assistantTo" list
      parseLeadAdvisors(members);

      // Display seat usage in the header
      const advisorSeatsElem = document.getElementById('advisor-seats-remaining');
      const nonAdvisorSeatsElem = document.getElementById('nonadvisor-seats-remaining');
      if (advisorSeatsElem) {
        advisorSeatsElem.textContent = advisorSeatsRemaining;
      }
      if (nonAdvisorSeatsElem) {
        nonAdvisorSeatsElem.textContent = nonAdvisorSeatsRemaining;
      }

      // Populate the team members table
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

          const spanText = document.createElement('span');
          spanText.classList.add('badge-text');
          spanText.innerText = 'Creator';

          spanCreator.appendChild(spanText);
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
          if (member.status !== 'pending' && member.email !== currentUserEmail) {
            const removeBtn = createRemoveButton(member);
            tdActions.appendChild(removeBtn);
          } else if (member.status === 'pending') {
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

  /**
   * Decide which members are "lead advisors" so we can populate the "assistant to" field
   * A user is considered a lead advisor if:
   *   (a) roles includes 'leadAdvisor', or
   *   (b) roles includes 'admin' && 'advisor' (legacy) or 'leadAdvisor'
   */
  function parseLeadAdvisors(members) {
    leadAdvisorOptions = [];
    if (!Array.isArray(members)) return;

    members.forEach(m => {
      if (Array.isArray(m.roles)) {
        if (m.roles.includes('leadAdvisor')) {
          leadAdvisorOptions.push(m);
        } else if (m.roles.includes('admin') && (m.roles.includes('advisor') || m.roles.includes('leadAdvisor'))) {
          leadAdvisorOptions.push(m);
        }
      }
    });
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

    removeBtn.addEventListener('click', () => {
      showRemoveConfirmationModal(member.email);
    });
    return removeBtn;
  }

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

    if (removeModalInstance) {
      removeModalInstance.hide();
    }
  }

// =====================
// EDIT MODAL CODE
// =====================
let editModalInstance;
const editModalElement = document.getElementById('edit-team-member-modal');
if (editModalElement) {
  editModalInstance = new bootstrap.Modal(editModalElement, { keyboard: false });
} else {
  console.warn('[DEBUG] No #edit-team-member-modal element found.');
}

// The form & role select
const editTeamMemberForm = document.getElementById('edit-team-member-form');
const editRoleSelect = document.getElementById('edit-role'); // 'admin','leadAdvisor','assistant','teamMember'

// Admin "Also an Advisor?"
const editAlsoAdvisorContainer = document.getElementById('editAlsoAdvisorContainer');
let editAlsoAdvisorCheckbox;
if (editAlsoAdvisorContainer) {
  editAlsoAdvisorCheckbox = document.getElementById('editAlsoAdvisorCheckbox');
}

// Lead Advisor sub-permission
const editLeadAdvisorPermissionContainer = document.getElementById('edit-leadadvisor-container');
const editLeadAdvisorPermissionSelect = document.getElementById('editLeadAdvisorPermissionSelect');
const editLeadAdvisorPermissionHelp = document.getElementById('editLeadAdvisorPermissionHelp');

// Assistant sub-permission
const editAssistantDropdownContainer = document.getElementById('edit-assistant-to-dropdown-container');
const editAssistantLeadAdvisorDisplayInput = document.getElementById('editAssistantLeadAdvisorDisplayInput');
const editAssistantLeadAdvisorHiddenInput = document.getElementById('editAssistantLeadAdvisorHiddenInput');
const editAssistantLeadAdvisorDropdownMenu = document.getElementById('editAssistantLeadAdvisorDropdownMenu');
const editAssistantPermissionContainer = document.getElementById('edit-assistant-permission-container');
const editAssistantPermissionSelect = document.getElementById('editAssistantPermissionSelect');

// Team Member sub-permission
const editTeamMemberPermissionContainer = document.getElementById('edit-team-member-permission-container');
const editTeamMemberPermissionSelect = document.getElementById('editTeamMemberPermissionSelect');

// Role change => show/hide relevant containers
if (editRoleSelect) {
  editRoleSelect.addEventListener('change', () => {
    editHandleRoleChange();
  });
}

function editHandleRoleChange() {
  if (!editRoleSelect) return;

  // Hide all sub-permission containers first
  if (editAlsoAdvisorContainer) editAlsoAdvisorContainer.style.display = 'none';
  if (editLeadAdvisorPermissionContainer) editLeadAdvisorPermissionContainer.style.display = 'none';
  if (editAssistantDropdownContainer) editAssistantDropdownContainer.style.display = 'none';
  if (editAssistantPermissionContainer) editAssistantPermissionContainer.style.display = 'none';
  if (editTeamMemberPermissionContainer) editTeamMemberPermissionContainer.style.display = 'none';

  const role = editRoleSelect.value;
  if (role === 'admin') {
    // Admin => "Also Advisor?"
    if (editAlsoAdvisorContainer) editAlsoAdvisorContainer.style.display = 'flex';
  } else if (role === 'leadAdvisor') {
    if (editLeadAdvisorPermissionContainer) editLeadAdvisorPermissionContainer.style.display = 'block';
    // If you want a helper text update:
    updateEditLeadAdvisorPermissionHelp();
  } else if (role === 'assistant') {
    if (editAssistantDropdownContainer) editAssistantDropdownContainer.style.display = 'block';
    if (editAssistantPermissionContainer) editAssistantPermissionContainer.style.display = 'flex';
    populateEditAssistantDropdown();
  } else if (role === 'teamMember') {
    if (editTeamMemberPermissionContainer) editTeamMemberPermissionContainer.style.display = 'flex';
  }
}

// Optional helper text for lead advisor
function updateEditLeadAdvisorPermissionHelp() {
  if (!editLeadAdvisorPermissionSelect || !editLeadAdvisorPermissionHelp) return;
  const val = editLeadAdvisorPermissionSelect.value;
  let text = '';
  switch(val) {
    case 'admin':
      text = 'Full System Admin.';
      break;
    case 'all':
      text = 'View & Edit all Households. View-Only System Settings.';
      break;
    case 'limited':
      text = 'View & Edit assigned Households. View-Only firm-wide Households.';
      break;
    case 'selfOnly':
      text = 'View & Edit assigned Households only. No access to others.';
      break;
    default:
      text = '';
  }
  editLeadAdvisorPermissionHelp.textContent = text;
}

// ======================
// Assistant "Populate" 
// ======================
function populateEditAssistantDropdown() {
  if (!editAssistantLeadAdvisorDropdownMenu || !editAssistantLeadAdvisorDisplayInput) return;

  editAssistantLeadAdvisorDropdownMenu.innerHTML = '';

  // If no leadAdvisors
  if (!leadAdvisorOptions || leadAdvisorOptions.length === 0) {
    const label = document.createElement('label');
    label.classList.add('dropdown-item');
    label.textContent = 'No Lead Advisors found.';
    editAssistantLeadAdvisorDropdownMenu.appendChild(label);

    editAssistantLeadAdvisorDisplayInput.value = '';
    editAssistantLeadAdvisorHiddenInput.value = '';
    return;
  }

  // Otherwise, create a checkbox for each leadAdvisor
  leadAdvisorOptions.forEach(advisor => {
    const label = document.createElement('label');
    label.classList.add('dropdown-item', 'form-check-label');

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.classList.add('form-check-input', 'editAssistantLeadAdvisorCheckbox');
    input.value = advisor._id;

    const displayName = `${advisor.firstName || ''} ${advisor.lastName || ''}`.trim() || advisor.email;

    label.appendChild(input);
    label.appendChild(document.createTextNode(` ${displayName} (${advisor.email})`));

    // On change => update
    input.addEventListener('change', () => {
      updateEditAssistantSelections();
    });

    editAssistantLeadAdvisorDropdownMenu.appendChild(label);
  });

  // If we do a pre-check, we do that after openEditModal calls precheck function
  updateEditAssistantSelections();
}

function updateEditAssistantSelections() {
  const checkboxes = editAssistantLeadAdvisorDropdownMenu.querySelectorAll('.editAssistantLeadAdvisorCheckbox:checked');
  const ids = [];
  const names = [];

  checkboxes.forEach(box => {
    ids.push(box.value);
    const label = box.closest('label');
    if (label) {
      names.push(label.textContent.trim());
    }
  });

  editAssistantLeadAdvisorHiddenInput.value = JSON.stringify(ids);
  editAssistantLeadAdvisorDisplayInput.value = names.length ? names.join(', ') : '';
}

// Precheck if user already has assigned leadAdvisors
function precheckEditAssistantAdvisors(advisorIds) {
  if (!Array.isArray(advisorIds)) return;
  const checkboxes = editAssistantLeadAdvisorDropdownMenu.querySelectorAll('.editAssistantLeadAdvisorCheckbox');
  checkboxes.forEach(box => {
    if (advisorIds.includes(box.value)) {
      box.checked = true;
    }
  });
  updateEditAssistantSelections();
}

// Toggle the .show class on the assistant dropdown
if (editAssistantLeadAdvisorDisplayInput && editAssistantLeadAdvisorDropdownMenu) {
  editAssistantLeadAdvisorDisplayInput.addEventListener('click', (e) => {
    e.stopPropagation();
    editAssistantLeadAdvisorDropdownMenu.classList.toggle('show');
  });

  document.addEventListener('click', (event) => {
    const insideInput = editAssistantLeadAdvisorDisplayInput.contains(event.target);
    const insideMenu = editAssistantLeadAdvisorDropdownMenu.contains(event.target);
    if (!insideInput && !insideMenu) {
      editAssistantLeadAdvisorDropdownMenu.classList.remove('show');
    }
  });
}

// ======================
// openEditModal
// ======================
function openEditModal(member) {
  const editUserIdInput = document.getElementById('edit-user-id');
  if (!editUserIdInput || !editRoleSelect) {
    console.warn('[DEBUG] Missing required edit modal fields!');
    return;
  }

  editUserIdInput.value = member._id;

  const editUserEmailText = document.getElementById('editUserEmailText');

  editUserIdInput.value = member._id;

  if (editUserEmailText) {
    // Show "Editing Roles & Permissions for <email>"
    editUserEmailText.textContent = `Editing Roles & Permissions for ${member.email}`;
  }

  // Derive primaryRole from roles
  let primaryRole = '';
  if (Array.isArray(member.roles) && member.roles.length > 0) {
    if (member.roles.includes('admin')) {
      primaryRole = 'admin';
    } else if (member.roles.includes('leadAdvisor')) {
      primaryRole = 'leadAdvisor';
    } else if (member.roles.includes('assistant')) {
      primaryRole = 'assistant';
    } else if (member.roles.includes('teamMember')) {
      primaryRole = 'teamMember';
    }
  }
  editRoleSelect.value = primaryRole;
  editHandleRoleChange();

  // If user is admin + leadAdvisor => "Also Advisor"
  if (
    primaryRole === 'admin' &&
    (member.roles.includes('leadAdvisor') || member.roles.includes('advisor'))
  ) {
    if (editAlsoAdvisorCheckbox) editAlsoAdvisorCheckbox.checked = true;
  } else if (editAlsoAdvisorCheckbox) {
    editAlsoAdvisorCheckbox.checked = false;
  }

  // 1) If leadAdvisor => sub-permission
  if (primaryRole === 'leadAdvisor' && member.leadAdvisorPermission) {
    editLeadAdvisorPermissionSelect.value = member.leadAdvisorPermission;
    updateEditLeadAdvisorPermissionHelp();
  } else if (editLeadAdvisorPermissionSelect) {
    editLeadAdvisorPermissionSelect.value = '';
    updateEditLeadAdvisorPermissionHelp();
  }

  // 2) If assistant => sub-permission
  if (primaryRole === 'assistant') {
    console.log('[DEBUG] This user is an assistant. Sub-permission fields:');
    console.log('[DEBUG] assistantPermission:', member.assistantPermission);
    console.log('[DEBUG] assistantToLeadAdvisors:', member.assistantToLeadAdvisors);
    if (editAssistantPermissionSelect && member.assistantPermission) {
      editAssistantPermissionSelect.value = member.assistantPermission;
    } else if (editAssistantPermissionSelect) {
      editAssistantPermissionSelect.value = '';
    }

    // Populate dropdown
    populateEditAssistantDropdown();
    // Then precheck
    if (Array.isArray(member.assistantToLeadAdvisors) && member.assistantToLeadAdvisors.length) {
      setTimeout(() => {
        precheckEditAssistantAdvisors(member.assistantToLeadAdvisors);
      }, 10);
    }
  }

  // 3) If teamMember => sub-permission
  if (primaryRole === 'teamMember' && member.teamMemberPermission) {
    if (editTeamMemberPermissionSelect) {
      editTeamMemberPermissionSelect.value = member.teamMemberPermission;
    }
  }

  editModalInstance.show();
}





// 2) If they exist, add event listener:
if (leadAdvisorPermissionSelect) {
  leadAdvisorPermissionSelect.addEventListener('change', () => {
    updateLeadAdvisorPermissionHelp();
  });
}

// 3) Define the helper function:
function updateLeadAdvisorPermissionHelp() {
  if (!leadAdvisorPermissionSelect || !leadAdvisorPermissionHelp) return;
  const val = leadAdvisorPermissionSelect.value;
  let text = '';

  switch(val) {
    case 'admin':
      text = 'Full System Admin.';
      break;
    case 'all':
      text = 'View & Edit all Households. View-Only System Settings.';
      break;
    case 'limited':
      text = 'View & Edit assigned Households. View-Only firm-wide Households.';
      break;
    case 'selfOnly':
      text = 'View & Edit assigned Households only. No access to others.';
      break;
    default:
      text = '';
  }

  leadAdvisorPermissionHelp.textContent = text;
}




// If they exist, listen for changes:
if (editLeadAdvisorPermissionSelect) {
  editLeadAdvisorPermissionSelect.addEventListener('change', () => {
    updateEditLeadAdvisorPermissionHelp();
  });
}

function updateEditLeadAdvisorPermissionHelp() {
  if (!editLeadAdvisorPermissionSelect || !editLeadAdvisorPermissionHelp) return;
  const val = editLeadAdvisorPermissionSelect.value;
  let text = '';

  switch(val) {
    case 'admin':
      text = 'Full System Admin.';
      break;
    case 'all':
      text = 'View & Edit all Households. View-Only System Settings.';
      break;
    case 'limited':
      text = 'View & Edit assigned Households. View-Only firm-wide Households.';
      break;
    case 'selfOnly':
      text = 'View & Edit assigned Households only. No access to others.';
      break;
    default:
      text = '';
  }
  editLeadAdvisorPermissionHelp.textContent = text;
}


// ======================
// SUBMIT EDIT FORM
// ======================
if (editTeamMemberForm) {
  editTeamMemberForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const userId = document.getElementById('edit-user-id').value;
    const newRole = editRoleSelect.value; // 'admin','leadAdvisor','assistant','teamMember'
    let rolesArray = [];
    if (newRole) {
      rolesArray.push(newRole);
    }

    // If admin => also advisor
    if (newRole === 'admin' && editAlsoAdvisorCheckbox && editAlsoAdvisorCheckbox.checked) {
      rolesArray.push('leadAdvisor');
    }

    // Sub-permissions
    let leadAdvisorPermissionVal = '';
    let assistantToLeadAdvisorsVal = [];
    let assistantPermissionVal = '';
    let teamMemberPermissionVal = '';

    if (newRole === 'leadAdvisor' && editLeadAdvisorPermissionSelect) {
      leadAdvisorPermissionVal = editLeadAdvisorPermissionSelect.value || '';
    }
    if (newRole === 'assistant') {
      // parse from the hidden input
      const hiddenVal = editAssistantLeadAdvisorHiddenInput.value || '[]';
      assistantToLeadAdvisorsVal = JSON.parse(hiddenVal);
      if (editAssistantPermissionSelect) {
        assistantPermissionVal = editAssistantPermissionSelect.value || '';
      }
    }
    if (newRole === 'teamMember' && editTeamMemberPermissionSelect) {
      teamMemberPermissionVal = editTeamMemberPermissionSelect.value || '';
    }

    // For older code usage:
    let newPermission = 'assistant';
    if (rolesArray.includes('admin')) {
      newPermission = 'admin';
    } else if (rolesArray.includes('leadAdvisor') || rolesArray.includes('advisor')) {
      newPermission = 'advisor';
    }

    // Build patch body
    const bodyObj = {
      roles: rolesArray,
      permission: newPermission
    };
    if (leadAdvisorPermissionVal) bodyObj.leadAdvisorPermission = leadAdvisorPermissionVal;
    if (assistantToLeadAdvisorsVal.length) bodyObj.assistantToLeadAdvisors = assistantToLeadAdvisorsVal;
    if (assistantPermissionVal) bodyObj.assistantPermission = assistantPermissionVal;
    if (teamMemberPermissionVal) bodyObj.teamMemberPermission = teamMemberPermissionVal;

    try {
      const response = await fetch(`/settings/team/users/${userId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify(bodyObj)
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
      advisor: 'Advisor (Legacy)',
      leadAdvisor: 'Lead Advisor',
      assistant: 'Assistant',
      teamMember: 'Team Member'
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
