// utils/roleUtils.js

/**
 * deriveSinglePermission(roles)
 * 
 * Derives a single "permission" string from the roles array.
 * This is for backward compatibility with older code.
 * 
 * Priority order:
 *   1) admin => "admin"
 *   2) leadAdvisor => "advisor"
 *   3) assistant => "assistant"
 *   4) teamMember => "teamMember"
 *   else => "unassigned"
 */
function deriveSinglePermission(rolesArray) {
    if (!Array.isArray(rolesArray)) return 'unassigned';
  
    if (rolesArray.includes('admin')) return 'admin';
    if (rolesArray.includes('leadAdvisor')) return 'advisor';
    if (rolesArray.includes('assistant')) return 'assistant';
    if (rolesArray.includes('teamMember')) return 'teamMember';
  
    return 'unassigned';
  }
  
  /**
   * deriveRoleAndPermission(userDoc)
   * 
   * Determines the "display role" (a single role string)
   * and "display permission" (the sub-permission) 
   * for use in tables, edit modals, etc.
   * 
   * If roles includes "admin", display role = 'admin'
   * else if leadAdvisor => 'leadAdvisor'
   * else if assistant => 'assistant'
   * else if teamMember => 'teamMember'
   * else => 'unassigned'
   * 
   * Then the sub-permission is read from the corresponding
   * field (leadAdvisorPermission, assistantPermission, etc.),
   * or "admin" if the role is admin, or "unassigned" as fallback.
   */
  function deriveRoleAndPermission(userDoc) {
    const roles = Array.isArray(userDoc.roles) ? userDoc.roles : [];
    let displayRole = 'unassigned';
  
    if (roles.includes('admin')) {
      displayRole = 'admin';
    } else if (roles.includes('leadAdvisor')) {
      displayRole = 'leadAdvisor';
    } else if (roles.includes('assistant')) {
      displayRole = 'assistant';
    } else if (roles.includes('teamMember')) {
      displayRole = 'teamMember';
    }
  
    let displayPermission = 'unassigned';
    switch (displayRole) {
      case 'admin':
        // "Admin" typically just means 'admin' permission
        displayPermission = 'admin';
        break;
      case 'leadAdvisor':
        displayPermission = userDoc.leadAdvisorPermission || 'all';
        break;
      case 'assistant':
        displayPermission = userDoc.assistantPermission || 'inherit';
        break;
      case 'teamMember':
        displayPermission = userDoc.teamMemberPermission || 'viewEdit';
        break;
      default:
        displayPermission = 'unassigned';
        break;
    }
  
    return { displayRole, displayPermission };
  }
  
  module.exports = {
    deriveSinglePermission,
    deriveRoleAndPermission
  };
  