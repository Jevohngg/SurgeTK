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

  function updateAssistantPermissionHelp(selectId, helpId) {
    const selectEl = document.getElementById(selectId);
    const helpEl = document.getElementById(helpId);
    if (!selectEl || !helpEl) return;

    const val = selectEl.value; // 'admin' or 'inherit'
    let html = '';

    switch (val) {
      case 'admin':
        // "Admin" => “Full System Access”
        html = `
  • Full System Access
  `;
        break;
      case 'inherit':
        // “Inherit Advisor(s) Permissions”
        html = `
  • Follows all assigned Lead Advisor(s)’ Households  
  • Follows assigned Lead Advisor(s)’ System Settings Access
  `;
        break;
      default:
        html = '';
    }

    helpEl.innerHTML = html;
  }

  function updateLeadAdvisorPermissionHelp() {
    if (!leadAdvisorPermissionSelect || !leadAdvisorPermissionHelp) return;
    const val = leadAdvisorPermissionSelect.value;
    let text = '';

    switch (val) {
      case 'admin':
        // “Lead Advisor - Admin” => "Full System Access"
        text = `
  • Full System Access
  `;
        break;
      case 'all':
        // “Lead Advisor - All”
        text = `
  • View & Edit: All Households  
  • View Only: System Settings
  `;
        break;
      case 'limited':
        // “Lead Advisor - Limited”
        text = `
  • View & Edit: Assigned Households  
  • View Only: Firm Wide Households  
  • View Only: System Settings
  `;
        break;
      case 'selfOnly':
        // “Lead Advisor - Self Only”
        text = `
  • View & Edit: Assigned Households Only  
  • No Access: Firm Wide Households  
  • No Access: System Settings
  `;
        break;
      default:
        text = '';
    }

    leadAdvisorPermissionHelp.innerHTML = text;
  }

  // ======================
  // HELPER: Team Member Permission Text
  // ======================
  function updateTeamMemberPermissionHelp(selectId, helpId) {
    const selectEl = document.getElementById(selectId);
    const helpEl = document.getElementById(helpId);
    if (!selectEl || !helpEl) return;

    const val = selectEl.value; // 'admin','viewEdit','viewOnly'
    let html = '';

    switch(val) {
      case 'admin':
        html = `
        • Full System Admin
      `;
        break;
      case 'viewEdit':
        html = `
        • View & Edit: All Households<br>
        • No Access: System Settings
      `;
        break;
      case 'viewOnly':
        html = `
        • View Only: All Households<br>
        • No Access: System Settings
      `;
        break;
      default:
        html = '';
    }

    helpEl.innerHTML = html;
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
    leadAdvisorOptions.forEach(leadAdvisor => {
      const label = document.createElement('label');
      label.classList.add('dropdown-item', 'form-check-label');

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.classList.add('form-check-input', 'assistantLeadAdvisorCheckbox');
      input.value = leadAdvisor._id;

      const displayName = `${leadAdvisor.firstName || ''} ${leadAdvisor.lastName || ''}`.trim() || leadAdvisor.email;

      label.appendChild(input);
      label.appendChild(document.createTextNode(` ${displayName} (${leadAdvisor.email})`));

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

    // Store the array of IDs in JSON
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

  // For the 'Assistant' permissions
  if (assistantPermissionSelect) {
    assistantPermissionSelect.addEventListener('change', () => {
      updateAssistantPermissionHelp('assistantPermissionSelect', 'assistantPermissionHelp');
    });
  }

  // For the 'Team Member' permissions
  if (teamMemberPermissionSelect) {
    teamMemberPermissionSelect.addEventListener('change', () => {
      updateTeamMemberPermissionHelp('teamMemberPermissionSelect', 'teamMemberPermissionHelp');
    });
  }

  // In "edit-team-member-modal" for Assistant
  const editAssistantPermissionSelect = document.getElementById('editAssistantPermissionSelect');
  if (editAssistantPermissionSelect) {
    editAssistantPermissionSelect.addEventListener('change', () => {
      updateAssistantPermissionHelp('editAssistantPermissionSelect', 'editAssistantPermissionHelp');
    });
  }

  // For Team Member in the edit modal
  const editTeamMemberPermissionSelect = document.getElementById('editTeamMemberPermissionSelect');
  if (editTeamMemberPermissionSelect) {
    editTeamMemberPermissionSelect.addEventListener('change', () => {
      updateTeamMemberPermissionHelp('editTeamMemberPermissionSelect', 'editTeamMemberPermissionHelp');
    });
  }

  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  // MANUAL TOGGLING OF THE DROPDOWN
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

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
      let alsoAdvisorChecked = false;
      if (selectedRole === 'admin' && adminAlsoAdvisorCheckbox && adminAlsoAdvisorCheckbox.checked) {
        alsoAdvisorChecked = true;
      }

      // Sub-permissions
      let leadAdvisorPermissionValue = '';
      if (selectedRole === 'leadAdvisor' && leadAdvisorPermissionSelect) {
        leadAdvisorPermissionValue = leadAdvisorPermissionSelect.value;
      }

      let assistantToLeadAdvisors = [];
      if (selectedRole === 'assistant') {
        // parse from the gatherAssistantLeadAdvisors() or from the hidden input
        assistantToLeadAdvisors = gatherAssistantLeadAdvisors();
        // Filter out any empty or "undefined" entries
        assistantToLeadAdvisors = assistantToLeadAdvisors.filter(
          id => id && id !== 'undefined'
        );
      }

      let assistantPermissionValue = '';
      if (selectedRole === 'assistant' && assistantPermissionSelect) {
        assistantPermissionValue = assistantPermissionSelect.value;
      }

      let teamMemberPermissionValue = '';
      if (selectedRole === 'teamMember' && teamMemberPermissionSelect) {
        teamMemberPermissionValue = teamMemberPermissionSelect.value;
      }

      // Build the request body for /team/invite
      const body = {
        email,
        role: selectedRole,
        alsoAdvisor: alsoAdvisorChecked,
        leadAdvisorPermission: leadAdvisorPermissionValue,
        assistantToLeadAdvisors,
        assistantPermission: assistantPermissionValue,
        teamMemberPermission: teamMemberPermissionValue
      };

      try {
        // We now POST to /team/invite (not /settings/team/invite)
        const response = await fetch('/settings/team/invite', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
          },
          body: JSON.stringify(body)
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

    // === UNLINKED ADVISORS LOGIC ===

  const unlinkedAdvisorsBody = document.getElementById('unlinked-advisors-body');
    async function loadUnlinkedAdvisors() {
      try {
        const resp = await fetch('/settings/team/unlinked-advisors', { credentials: 'include' });
        if (!resp.ok) {
          console.warn('[DEBUG] Could not load unlinked advisors');
          return;
        }
        const data = await resp.json();
        if (!data.success) {
          console.warn('[DEBUG] No success from unlinked advisors fetch');
          return;
        }
        renderUnlinkedAdvisors(data.unlinkedAdvisors);
      } catch (error) {
        console.error('[DEBUG] loadUnlinkedAdvisors error:', error);
      }
    }

    function renderUnlinkedAdvisors(advisors) {
      unlinkedAdvisorsBody.innerHTML = '';
      if (!advisors || !advisors.length) {
        const row = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 4;
        td.innerText = 'No unlinked Redtail advisors.';
        row.appendChild(td);
        unlinkedAdvisorsBody.appendChild(row);
        return;
      }
    
      advisors.forEach(advisor => {
        const tr = document.createElement('tr');
    
        // 1) Name cell
        const tdName = document.createElement('td');
        tdName.innerText = advisor.advisorName || `(ID: ${advisor.redtailAdvisorId})`;
        tdName.classList.add('unlinked-advisor-name-cell'); // Add a custom class
        tr.appendChild(tdName);
    
        // 2) Type cell
        const tdType = document.createElement('td');
        tdType.innerText = advisor.type || 'unknown';
        tdType.classList.add('unlinked-advisor-type-cell'); // Add a custom class
        tr.appendChild(tdType);
    
        // 3) Select cell
        const tdSelect = document.createElement('td');
        tdSelect.classList.add('unlinked-advisor-select-cell'); // Add a custom class
        const select = document.createElement('select');
        select.classList.add('form-select', 'link-advisor-select');
    
        // Placeholder
        const placeholderOption = document.createElement('option');
        placeholderOption.value = '';
        placeholderOption.innerText = '-- Link to LeadAdvisor --';
        placeholderOption.disabled = true;
        placeholderOption.selected = true;
        select.appendChild(placeholderOption);
    
        leadAdvisorOptions.forEach(la => {
          const opt = document.createElement('option');
          opt.value = la._id;
          opt.innerText = la.email || 'Lead Advisor';
          select.appendChild(opt);
        });
        tdSelect.appendChild(select);
        tr.appendChild(tdSelect);
    
        // 4) Actions cell
        const tdActions = document.createElement('td');
        tdActions.classList.add('unlinked-advisor-actions-cell'); // Add a custom class
        const linkBtn = document.createElement('button');
        linkBtn.classList.add('btn', 'btn-primary', 'btn-sm');
        linkBtn.innerText = 'Link';
    
        linkBtn.addEventListener('click', async () => {
          const chosenUserId = select.value;
          if (!chosenUserId) {
            showAlert('error', 'Please select a leadAdvisor before linking.');
            return;
          }
          await linkRedtailAdvisor(advisor.redtailAdvisorId, chosenUserId);
        });
    
        tdActions.appendChild(linkBtn);
        tr.appendChild(tdActions);
    
        unlinkedAdvisorsBody.appendChild(tr);
      });
    }
    

    async function linkRedtailAdvisor(redtailAdvisorId, userId) {
      try {
        const resp = await fetch('/settings/team/link-advisor', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ redtailAdvisorId, userId })
        });
        const data = await resp.json();
        if (resp.ok) {
          showAlert('success', data.message || 'Successfully linked advisor.');
          // Refresh
          loadUnlinkedAdvisors();
          loadUnlinkedImportedAdvisors();
          loadTeamMembers();
        } else {
          showAlert('error', data.message || 'Failed to link advisor.');
        }
      } catch (err) {
        console.error('[DEBUG] linkRedtailAdvisor error:', err);
        showAlert('error', 'Error linking Redtail advisor.');
      }
    }
  

  //=====================
  // LOAD TEAM MEMBERS
  //=====================
  async function loadTeamMembers() {
    try {
      // GET /team/users
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

      // Display seat usage
      const advisorSeatsElem = document.getElementById('advisor-seats-remaining');
      const nonAdvisorSeatsElem = document.getElementById('nonadvisor-seats-remaining');
      if (advisorSeatsElem) advisorSeatsElem.textContent = advisorSeatsRemaining;
      if (nonAdvisorSeatsElem) nonAdvisorSeatsElem.textContent = nonAdvisorSeatsRemaining;

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
        tdPermissions.innerText = member.permissions ? capitalize(member.permissions) : 'Assistant';
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
          // Only show "Edit" if not pending
          if (member.status !== 'pending') {
            const editBtn = createEditButton(member);
            tdActions.appendChild(editBtn);
          }

          // Show "Remove" if not the current user or if they're pending
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

      // === UNLINKED ADVISORS LOGIC: load if admin
      if (isAdminAccess) {
        loadUnlinkedAdvisors();
        loadUnlinkedImportedAdvisors();
      }

    } catch (error) {
      console.error('Error loading team members:', error);
      showAlert('error', 'Failed to load team members.');
    }
  }

  /**
   * Decide which members are "lead advisors" so we can populate the "assistant to" field
   * A user is considered a lead advisor if roles includes 'leadAdvisor'
   */
  function parseLeadAdvisors(members) {
    leadAdvisorOptions = [];
    if (!Array.isArray(members)) return;

    members.forEach(m => {
      if (Array.isArray(m.roles) && m.roles.includes('leadAdvisor')) {
        leadAdvisorOptions.push(m);
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

  const editLeadAdvisorPermissionContainer = document.getElementById('edit-leadadvisor-container');
  const editLeadAdvisorPermissionSelect = document.getElementById('editLeadAdvisorPermissionSelect');
  const editLeadAdvisorPermissionHelp = document.getElementById('editLeadAdvisorPermissionHelp');

  const editAssistantDropdownContainer = document.getElementById('edit-assistant-to-dropdown-container');
  const editAssistantLeadAdvisorDisplayInput = document.getElementById('editAssistantLeadAdvisorDisplayInput');
  const editAssistantLeadAdvisorHiddenInput = document.getElementById('editAssistantLeadAdvisorHiddenInput');
  const editAssistantLeadAdvisorDropdownMenu = document.getElementById('editAssistantLeadAdvisorDropdownMenu');
  const editAssistantPermissionContainer = document.getElementById('edit-assistant-permission-container');
  const editTeamMemberPermissionContainer = document.getElementById('edit-team-member-permission-container');

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
      if (editAlsoAdvisorContainer) editAlsoAdvisorContainer.style.display = 'flex';
    } else if (role === 'leadAdvisor') {
      if (editLeadAdvisorPermissionContainer) editLeadAdvisorPermissionContainer.style.display = 'block';
      updateEditLeadAdvisorPermissionHelp();
    } else if (role === 'assistant') {
      if (editAssistantDropdownContainer) editAssistantDropdownContainer.style.display = 'block';
      if (editAssistantPermissionContainer) editAssistantPermissionContainer.style.display = 'flex';
      populateEditAssistantDropdown();
    } else if (role === 'teamMember') {
      if (editTeamMemberPermissionContainer) editTeamMemberPermissionContainer.style.display = 'flex';
    }
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

  function populateEditAssistantDropdown() {
    if (!editAssistantLeadAdvisorDropdownMenu || !editAssistantLeadAdvisorDisplayInput) return;
    editAssistantLeadAdvisorDropdownMenu.innerHTML = '';

    if (!leadAdvisorOptions || leadAdvisorOptions.length === 0) {
      const label = document.createElement('label');
      label.classList.add('dropdown-item');
      label.textContent = 'No Lead Advisors found.';
      editAssistantLeadAdvisorDropdownMenu.appendChild(label);

      editAssistantLeadAdvisorDisplayInput.value = '';
      editAssistantLeadAdvisorHiddenInput.value = '';
      return;
    }

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
      input.addEventListener('change', () => {
        updateEditAssistantSelections();
      });
      editAssistantLeadAdvisorDropdownMenu.appendChild(label);
    });
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
    editAssistantLeadAdvisorDisplayInput.value = names.join(', ');
  }

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

  function openEditModal(member) {
    const editUserIdInput = document.getElementById('edit-user-id');
    if (!editUserIdInput || !editRoleSelect) {
      console.warn('[DEBUG] Missing required edit modal fields!');
      return;
    }

    editUserIdInput.value = member._id;

    const editUserEmailText = document.getElementById('editUserEmailText');
    if (editUserEmailText) {
      editUserEmailText.textContent = `Editing Roles & Permissions for ${member.email}`;
    }

    let primaryRole = '';
    if (Array.isArray(member.roles) && member.roles.length > 0) {
      if (member.roles.includes('admin')) primaryRole = 'admin';
      else if (member.roles.includes('leadAdvisor')) primaryRole = 'leadAdvisor';
      else if (member.roles.includes('assistant')) primaryRole = 'assistant';
      else if (member.roles.includes('teamMember')) primaryRole = 'teamMember';
    }
    editRoleSelect.value = primaryRole;
    editHandleRoleChange();

    if (
      primaryRole === 'admin' &&
      (member.roles.includes('leadAdvisor') || member.roles.includes('advisor'))
    ) {
      if (editAlsoAdvisorCheckbox) editAlsoAdvisorCheckbox.checked = true;
    } else if (editAlsoAdvisorCheckbox) {
      editAlsoAdvisorCheckbox.checked = false;
    }

    if (primaryRole === 'leadAdvisor' && member.leadAdvisorPermission) {
      editLeadAdvisorPermissionSelect.value = member.leadAdvisorPermission;
      updateEditLeadAdvisorPermissionHelp();
    } else if (editLeadAdvisorPermissionSelect) {
      editLeadAdvisorPermissionSelect.value = '';
      updateEditLeadAdvisorPermissionHelp();
    }

    if (primaryRole === 'assistant') {
      if (editAssistantPermissionSelect && member.assistantPermission) {
        editAssistantPermissionSelect.value = member.assistantPermission;
        updateAssistantPermissionHelp('editAssistantPermissionSelect', 'editAssistantPermissionHelp');
      } else if (editAssistantPermissionSelect) {
        editAssistantPermissionSelect.value = '';
      }
      populateEditAssistantDropdown();
      if (Array.isArray(member.assistantToLeadAdvisors) && member.assistantToLeadAdvisors.length) {
        setTimeout(() => {
          precheckEditAssistantAdvisors(member.assistantToLeadAdvisors);
        }, 10);
      }
    }

    if (primaryRole === 'teamMember') {
      if (editTeamMemberPermissionSelect && member.teamMemberPermission) {
        editTeamMemberPermissionSelect.value = member.teamMemberPermission;
        updateTeamMemberPermissionHelp('editTeamMemberPermissionSelect','editTeamMemberPermissionHelp');
      }
    }

    editModalInstance.show();
  }

  if (leadAdvisorPermissionSelect) {
    leadAdvisorPermissionSelect.addEventListener('change', () => {
      updateLeadAdvisorPermissionHelp();
    });
  }

  if (editLeadAdvisorPermissionSelect) {
    editLeadAdvisorPermissionSelect.addEventListener('change', () => {
      updateEditLeadAdvisorPermissionHelp();
    });
  }

  const applyPlaceholderColor = (selectId) => {
    const select = document.getElementById(selectId);
    if (select && select.value === '') {
      select.style.display = 'block';
      select.offsetHeight; // trigger reflow
      select.style.color = '#c3c3cb';
    }
  };

  // Apply directly to each select field
  applyPlaceholderColor('assistantPermissionSelect');
  applyPlaceholderColor('invite-role');
  applyPlaceholderColor('teamMemberPermissionSelect');
  applyPlaceholderColor('leadAdvisorPermissionSelect');
  applyPlaceholderColor('editAssistantPermissionSelect');
  applyPlaceholderColor('editLeadAdvisorPermissionSelect');
  applyPlaceholderColor('editTeamMemberPermissionSelect');

  if (editTeamMemberForm) {
    editTeamMemberForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const userId = document.getElementById('edit-user-id').value;
      const newRole = editRoleSelect.value;

      let alsoAdvisor = false;
      if (newRole === 'admin' && editAlsoAdvisorCheckbox && editAlsoAdvisorCheckbox.checked) {
        alsoAdvisor = true;
      }

      let leadAdvisorPermissionVal = '';
      let assistantToLeadAdvisorsVal = [];
      let assistantPermissionVal = '';
      let teamMemberPermissionVal = '';

      if (newRole === 'leadAdvisor' && editLeadAdvisorPermissionSelect) {
        leadAdvisorPermissionVal = editLeadAdvisorPermissionSelect.value || '';
      }
      if (newRole === 'assistant') {
        const hiddenVal = editAssistantLeadAdvisorHiddenInput.value || '[]';
        assistantToLeadAdvisorsVal = JSON.parse(hiddenVal).filter(
          id => id && id !== 'undefined'
        );
        if (editAssistantPermissionSelect) {
          assistantPermissionVal = editAssistantPermissionSelect.value || '';
        }
      }
      if (newRole === 'teamMember' && editTeamMemberPermissionSelect) {
        teamMemberPermissionVal = editTeamMemberPermissionSelect.value || '';
      }

      const bodyObj = {
        role: newRole,
        alsoAdvisor,
        leadAdvisorPermission: leadAdvisorPermissionVal,
        assistantToLeadAdvisors: assistantToLeadAdvisorsVal,
        assistantPermission: assistantPermissionVal,
        teamMemberPermission: teamMemberPermissionVal
      };

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
      // advisor: 'Advisor (Legacy)',
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


  // 1) A function to load the unlinked imported advisors
async function loadUnlinkedImportedAdvisors() {
  try {
    const resp = await fetch('/settings/team/unlinked-imported-advisors', { credentials: 'include' });
    if (!resp.ok) {
      console.warn('[DEBUG] Could not load unlinked imported advisors');
      return;
    }
    const data = await resp.json();
    if (!data.success) {
      console.warn('[DEBUG] No success from unlinked imported advisors fetch');
      return;
    }
    renderUnlinkedImportedAdvisors(data.unlinkedImportedAdvisors);
  } catch (error) {
    console.error('[DEBUG] loadUnlinkedImportedAdvisors error:', error);
  }
}

function renderUnlinkedImportedAdvisors(advisors) {
  const tableBody = document.getElementById('unlinked-imported-advisors-body');
  if (!tableBody) return;

  tableBody.innerHTML = '';
  if (!advisors || advisors.length === 0) {
    const row = document.createElement('tr');
    const td = document.createElement('td');
    // Since we have 4 columns, set colSpan to 4
    td.colSpan = 4; 
    td.innerText = 'No unlinked imported advisors.';
    row.appendChild(td);
    tableBody.appendChild(row);
    return;
  }

  advisors.forEach(advisor => {
    const tr = document.createElement('tr');

    // 1) Name cell
    const tdName = document.createElement('td');
    tdName.classList.add('unlinked-advisor-name-cell'); 
    tdName.textContent = advisor.importedAdvisorName || '(Unknown)';
    tr.appendChild(tdName);

    // 2) Type cell — for consistency, let's label them "Imported"
    const tdType = document.createElement('td');
    tdType.classList.add('unlinked-advisor-type-cell');
    tdType.textContent = 'Imported';
    tr.appendChild(tdType);

    // 3) Select cell — same class as in Redtail code
    const tdSelect = document.createElement('td');
    tdSelect.classList.add('unlinked-advisor-select-cell'); 
    const select = document.createElement('select');
    select.classList.add('form-select', 'link-advisor-select');
    // Placeholder
    const placeholderOption = document.createElement('option');
    placeholderOption.value = '';
    placeholderOption.innerText = '-- Link to LeadAdvisor --';
    placeholderOption.disabled = true;
    placeholderOption.selected = true;
    select.appendChild(placeholderOption);

    // Use leadAdvisorOptions array (populated elsewhere)
    leadAdvisorOptions.forEach(la => {
      const opt = document.createElement('option');
      opt.value = la._id;
      opt.innerText = la.email || (la.firstName + ' ' + la.lastName);
      select.appendChild(opt);
    });
    tdSelect.appendChild(select);
    tr.appendChild(tdSelect);

    // 4) Actions cell
    const tdActions = document.createElement('td');
    tdActions.classList.add('unlinked-advisor-actions-cell'); 
    const linkBtn = document.createElement('button');
    linkBtn.classList.add('btn', 'btn-primary', 'btn-sm');
    linkBtn.innerText = 'Link';

    linkBtn.addEventListener('click', async () => {
      const chosenUserId = select.value;
      if (!chosenUserId) {
        showAlert('error','Please select an advisor before linking.');
        return;
      }
      await linkImportedAdvisor(advisor._id, chosenUserId);
    });
    tdActions.appendChild(linkBtn);
    tr.appendChild(tdActions);

    tableBody.appendChild(tr);
  });
}


// 3) The link function
async function linkImportedAdvisor(importedAdvisorId, userId) {
  try {
    const resp = await fetch('/settings/team/link-imported-advisor', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ importedAdvisorId, userId })
    });
    const data = await resp.json();
    if (resp.ok) {
      showAlert('success', data.message || 'Successfully linked imported advisor.');
      // Refresh
      loadUnlinkedImportedAdvisors();
      loadTeamMembers();
    } else {
      showAlert('error', data.message || 'Failed to link imported advisor.');
    }
  } catch (err) {
    console.error('[DEBUG] linkImportedAdvisor error:', err);
    showAlert('error','Error linking imported advisor.');
  }
}



});
