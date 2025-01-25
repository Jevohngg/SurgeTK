// utils/taxBrackets.js

/**
 * 2023 U.S. Federal Tax Brackets (simplified)
 * Feel free to add more statuses or refine the bracket cutoffs as needed.
 * You can update these each year.
 */
const taxBrackets2023 = {
    single: [
      { max: 11000, rate: 0.10 },
      { max: 44725, rate: 0.12 },
      { max: 95375, rate: 0.22 },
      { max: 182100, rate: 0.24 },
      { max: 231250, rate: 0.32 },
      { max: 578125, rate: 0.35 },
      { max: Infinity, rate: 0.37 },
    ],
    marriedFilingJointly: [
      { max: 22000, rate: 0.10 },
      { max: 89450, rate: 0.12 },
      { max: 190750, rate: 0.22 },
      { max: 364200, rate: 0.24 },
      { max: 462500, rate: 0.32 },
      { max: 693750, rate: 0.35 },
      { max: Infinity, rate: 0.37 },
    ],
    // Add more statuses if needed (Married Filing Separately, Head of Household, etc.)
  };
  
  /**
   * Utility function to fetch the bracket array based on filingStatus.
   * We standardize the key to something in our brackets.
   */
  function getBracketArray(filingStatus) {
    // Convert to lowerCase / remove spaces, etc., if needed
    switch (filingStatus) {
      case 'Married Filing Jointly':
        return taxBrackets2023.marriedFilingJointly;
      case 'Single':
        // For "Head of Household" or "Married Filing Separately", define your logic or fallback
        return taxBrackets2023.single;
      default:
        // fallback if unknown
        return taxBrackets2023.single;
    }
  }
  
  function getMarginalTaxBracket(annualIncome, filingStatus) {
    // If there's no annual income at all, return null or a special indicator
    if (!annualIncome || annualIncome <= 0) {
      return null; 
    }
  
    const bracketArray = getBracketArray(filingStatus);
  
    for (const bracket of bracketArray) {
      if (annualIncome <= bracket.max) {
        return bracket.rate;
      }
    }
    return 0.37; // fallback
  }
  
  
  module.exports = {
    getMarginalTaxBracket,
  };
  