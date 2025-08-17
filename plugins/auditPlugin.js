// plugins/auditPlugin.js
'use strict';

const { logActivity, shallowDiff } = require('../utils/activityLogger');

/**
 * Mongoose audit plugin
 * - Logs create/update/delete across:
 *   • save() (new + existing)
 *   • findOneAndUpdate / updateOne / findByIdAndUpdate
 *   • findOneAndDelete / deleteOne / findByIdAndDelete
 *
 * Requirements at call sites (unchanged from your current approach):
 * - For document saves:
 *     doc.$locals.activityCtx = req.activityCtx   // before doc.save()
 * - For query-based writes:
 *     Model.findOneAndUpdate(filter, update, { activityCtx: req.activityCtx, ... })
 *     // or
 *     query.setOptions({ activityCtx: req.activityCtx })
 *
 * Notes:
 * - This plugin never throws; logging failures won't block your writes.
 * - If no context is provided, it still logs with a null/empty ctx.
 */
module.exports = function auditPlugin(schema, options = {}) {
  const entityType  = options.entityType || schema?.options?.collection || 'Other';
  const displayFrom = typeof options.displayFrom === 'function' ? options.displayFrom : null;

  const makeDisplay = (doc) => {
    try {
      return displayFrom ? displayFrom(doc) : `${entityType} #${doc?._id}`;
    } catch {
      return `${entityType} #${doc?._id}`;
    }
  };

  // ───────────────────────────────────────────────────────────
  // CREATE / UPDATE via .save()  (document middleware)
  // ───────────────────────────────────────────────────────────
  schema.pre('save', { document: true, query: false }, async function preSave(next) {
    try {
      this.$locals = this.$locals || {};
      this.$locals._wasNew = this.isNew;

      if (!this.isNew) {
        // IMPORTANT: fetch the persisted (pre‑mutation) version for accurate diffs
        const original = await this.constructor.findById(this._id).lean();
        this.$locals._before = original || null;
      }
      next();
    } catch (e) {
      // never block writes on logging prep
      next();
    }
  });

  schema.post('save', { document: true, query: false }, async function postSave(doc) {
    try {
      // Prefer $locals (what your controllers set); fall back to internal if present
      const ctx    = doc.$locals?.activityCtx || doc.$__.activityCtx || null;
      const wasNew = !!doc.$locals?._wasNew;

      if (wasNew) {
        // CREATE
        await logActivity(ctx, {
          entity: { type: entityType, id: doc._id, display: makeDisplay(doc) },
          action: 'create',
          before: null,
          after : doc.toObject({ depopulate: true }),
          diff  : null
        });
        return;
      }

      // UPDATE
      const before = doc.$locals?._before || null;
      const after  = doc.toObject({ depopulate: true });
      const diff   = shallowDiff(before || {}, after || {});
      if (Object.keys(diff).length === 0) return; // nothing meaningful changed

      await logActivity(ctx, {
        entity: { type: entityType, id: doc._id, display: makeDisplay(after) },
        action: 'update',
        before, after, diff
      });
    } catch (err) {
      // never block the app on logging issues
      console.error('[auditPlugin:post(save)]', err?.message);
    }
  });

  // ───────────────────────────────────────────────────────────
  // UPDATE via findOneAndUpdate / updateOne / findByIdAndUpdate
  // ───────────────────────────────────────────────────────────
  const UPDATE_METHODS = ['findOneAndUpdate', 'updateOne', 'findByIdAndUpdate'];

  schema.pre(UPDATE_METHODS, async function preUpdate(next) {
    try {
      // getFilter() in Mongoose ≥6, fallback to getQuery() for older versions
      const filter = typeof this.getFilter === 'function' ? this.getFilter() : this.getQuery();
      const before = await this.model.findOne(filter).lean();
      this.setOptions({ activityBefore: before });
      next();
    } catch (err) {
      next(); // don't block write on logging prep
    }
  });

  schema.post(UPDATE_METHODS, async function postUpdate() {
    try {
      const ctx    = this.options?.activityCtx || null;
      const before = this.options?.activityBefore || null;
      if (!before) return;

      // Use the _id from "before" to reliably fetch the updated doc
      const after = await this.model.findById(before._id).lean();
      if (!after) return; // doc disappeared (unlikely on updateOne), skip

      const diff = shallowDiff(before || {}, after || {});
      if (Object.keys(diff).length === 0) return;

      await logActivity(ctx, {
        entity: { type: entityType, id: after._id, display: makeDisplay(after) },
        action: 'update',
        before, after, diff
      });
    } catch (err) {
      console.error('[auditPlugin:post(update)]', err?.message);
    }
  });

  // ───────────────────────────────────────────────────────────
  // DELETE via findOneAndDelete / deleteOne / findByIdAndDelete
  // ───────────────────────────────────────────────────────────
  const DELETE_METHODS = ['findOneAndDelete', 'deleteOne', 'findByIdAndDelete'];

  schema.pre(DELETE_METHODS, async function preDelete(next) {
    try {
      const filter = typeof this.getFilter === 'function' ? this.getFilter() : this.getQuery();
      const before = await this.model.findOne(filter).lean();
      this.setOptions({ activityBefore: before });
      next();
    } catch (err) {
      next();
    }
  });

  schema.post(DELETE_METHODS, async function postDelete() {
    try {
      const ctx    = this.options?.activityCtx || null;
      const before = this.options?.activityBefore || null;
      if (!before) return;

      await logActivity(ctx, {
        entity: { type: entityType, id: before._id, display: makeDisplay(before) },
        action: 'delete',
        before,
        after: null,
        diff : null
      });
    } catch (err) {
      console.error('[auditPlugin:post(delete)]', err?.message);
    }
  });

  // ───────────────────────────────────────────────────────────
  // (Optional) Document-level deleteOne (e.g., doc.deleteOne())
  // ───────────────────────────────────────────────────────────
  // This covers the rare case you call `someDoc.deleteOne()` instead of query helpers.
  schema.pre('deleteOne', { document: true, query: false }, async function preDocDelete(next) {
    try {
      this.$locals = this.$locals || {};
      // fetch the persisted doc (it may have changed since load)
      const original = await this.constructor.findById(this._id).lean();
      this.$locals._beforeDelete = original || null;
      next();
    } catch (err) {
      next();
    }
  });

  schema.post('deleteOne', { document: true, query: false }, async function postDocDelete() {
    try {
      const ctx    = this.$locals?.activityCtx || null;
      const before = this.$locals?._beforeDelete || null;
      if (!before) return;

      await logActivity(ctx, {
        entity: { type: entityType, id: before._id, display: makeDisplay(before) },
        action: 'delete',
        before,
        after: null,
        diff : null
      });
    } catch (err) {
      console.error('[auditPlugin:post(doc.deleteOne)]', err?.message);
    }
  });

  // ───────────────────────────────────────────────────────────
  // (Optional) insertMany support — logs one entry per doc created.
  // Uncomment if you want create logs for bulk inserts.
  // ───────────────────────────────────────────────────────────
  /*
  schema.post('insertMany', async function (docs, next) {
    try {
      for (const d of docs || []) {
        await logActivity(null, {
          entity: { type: entityType, id: d._id, display: makeDisplay(d) },
          action: 'create',
          before: null,
          after : d,
          diff  : null
        });
      }
      next();
    } catch (err) {
      console.error('[auditPlugin:post(insertMany)]', err?.message);
      next();
    }
  });
  */
};
