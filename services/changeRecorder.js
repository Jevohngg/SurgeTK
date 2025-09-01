// services/changeRecorder.js
let opCounter = 0;

const toPlain = (doc) => {
  if (!doc) return doc;
  if (typeof doc.toObject === 'function') {
    return doc.toObject({ depopulate: true, virtuals: false, getters: false, minimize: true, versionKey: true });
  }
  return doc;
};

const resetOpIndex = () => { opCounter = 0; };
const nextOpIndex = () => ++opCounter;

async function recordCreate({ report, modelName, doc }) {
  report.changes.push({
    model: modelName,
    op: 'create',
    opIndex: nextOpIndex(),
    docId: doc._id,
    after: toPlain(doc)
  });
}

async function recordUpdate({ report, modelName, id, before, after }) {
  report.changes.push({
    model: modelName,
    op: 'update',
    opIndex: nextOpIndex(),
    docId: id,
    before: toPlain(before),
    after: toPlain(after) // include __v or updatedAt for conflict checking
  });
}

async function recordDelete({ report, modelName, before }) {
  report.changes.push({
    model: modelName,
    op: 'delete',
    opIndex: nextOpIndex(),
    docId: before._id,
    before: toPlain(before)
  });
}

module.exports = { resetOpIndex, recordCreate, recordUpdate, recordDelete };
