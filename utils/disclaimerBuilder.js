// utils/disclaimerBuilder.js
// ----------------------------------------------------------
//  SINGLE SOURCE OF TRUTH for wording *and* presentation
// ----------------------------------------------------------

const DISCLAIMER_START_TEMPLATE =
  'Generated for the clients of {{ADVISOR_HTML}}.';
const DISCLAIMER_END_TEMPLATE =
  'Value Add copyright SurgeTK, All rights reserved.';

// Inline only for uppercase -- all other styling should live in your global CSS
const DISCLAIMER_INLINE_STYLE = 'text-transform:uppercase;';

/**
 * Builds the full, wrapped disclaimer string.
 *
 * @param {Object} opts
 * @param {Object} opts.household – Household doc with populated leadAdvisors[]
 * @param {string} opts.customText – the user-editable middle section
 * @returns {string} HTML snippet ready to be injected into a template
 */
function buildDisclaimer({ household, customText = '' } = {}) {
  // 1) Advisor HTML
  const advisors = (household?.leadAdvisors || [])
    .map(a => `${a.firstName} ${a.lastName}`.trim())
    .filter(Boolean);

  let advisorHtml;
  if (advisors.length > 0) {
    const advisorStr =
      advisors.length === 1
        ? advisors[0]
        : advisors.slice(0, -1).join(' and ') + ' and ' + advisors.slice(-1);
    advisorHtml = `<strong>${advisorStr}</strong>`;
  } else {
    advisorHtml = `<strong style="color:red;">⚠️ NO ADVISORS ASSIGNED</strong>`;
  }

  // 2) Assemble sentences
  const startSentence = DISCLAIMER_START_TEMPLATE.replace(
    '{{ADVISOR_HTML}}',
    advisorHtml
  );
  const middle = (customText || '').trim();
  const endSentence = DISCLAIMER_END_TEMPLATE;

  const rawCombined = [startSentence, middle, endSentence]
    .filter(Boolean)
    .join(' ');
  const combined = rawCombined.toUpperCase();

  // 3) Wrap with only our uppercase style
  const styleAttr = DISCLAIMER_INLINE_STYLE
    ? ` style="${DISCLAIMER_INLINE_STYLE}"`
    : '';
  return `<div${styleAttr}>${combined}</div>`;
}

module.exports = { buildDisclaimer };
