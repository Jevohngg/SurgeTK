// utils/filenameHelper.js
const slugify = str =>
    str.toLowerCase()
       .replace(/[^a-z0-9]+/g, '-')   // collapse everything not alphanum
       .replace(/^-+|-+$/g, '')       // trim leading/trailing dashes
       .substr(0, 80);                // safety limit
  
  module.exports.buildFilename = ({ householdName, surgeName, ext }) => {
    const parts = [householdName, surgeName]
      .filter(Boolean)
      .map(slugify)
      .join('_');
    return `${parts || 'packet'}.${ext}`;
  };

  module.exports.slugify = slugify;  
  