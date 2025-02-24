// utils/subscriptionUtils.js

/**
 * Calculates seat limits for a given firm, based on subscription tier and seats purchased.
 * @param {Object} firm - The CompanyID document from MongoDB.
 * @returns {Object} { maxAdvisors, maxNonAdvisors }
 */
function calculateSeatLimits(firm) {
    if (!firm) return { maxAdvisors: 0, maxNonAdvisors: 0 };
  
    const tier = firm.subscriptionTier;
    
    if (tier === 'free') {
      return {
        maxAdvisors: parseInt(process.env.FREE_TIER_ADVISOR_LIMIT || '1', 10),
        maxNonAdvisors: parseInt(process.env.FREE_TIER_NON_ADVISOR_LIMIT || '2', 10),
      };
    }
  
    if (tier === 'enterprise') {
      // Suppose enterprise is unlimited:
      return { maxAdvisors: Number.MAX_SAFE_INTEGER, maxNonAdvisors: Number.MAX_SAFE_INTEGER };
    }
  
    // Pro tier logic
    const seats = firm.seatsPurchased || 0;
    const advisorPerSeat = parseInt(process.env.PRO_SEAT_ADVISOR || '1', 10);
    const nonAdvisorPerSeat = parseInt(process.env.PRO_SEAT_NON_ADVISOR || '2', 10);
  
    return {
      maxAdvisors: seats * advisorPerSeat,
      maxNonAdvisors: seats * nonAdvisorPerSeat,
    };
  }
  
  module.exports = { calculateSeatLimits };
  