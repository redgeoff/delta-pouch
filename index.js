'use strict';

var utils = require('./pouch-utils'); // TODO: is it ok that this causes warnings with uglifyjs??
var Promise = utils.Promise;

function empty(obj) {
  for (var i in obj) { // jshint unused:false
    return false;
  }
  return true;
}

exports.clone = function (obj) {
  return JSON.parse(JSON.stringify(obj));
};

exports.merge = function (obj1, obj2) {
  var merged = {};
  for (var i in obj1) {
    merged[i] = obj1[i];
  }
  for (i in obj2) {
    merged[i] = obj2[i];
  }
  return merged;
};

// Note: this function is roughly compatible with bluebirdjs's reduce
function reduce(items, reducer, i) {
  return new Promise(function (fulfill) {
    if (items[i]) {
      return reducer(null, items[i], i, items.length).then(function () {
        return reduce(items, reducer, i + 1);
      });
    } else {
      fulfill();
    }
  });
}

function save(db, doc) {
  doc.$createdAt = (new Date()).toJSON();
  return db.post(doc);
}

exports.save = function (doc) {
  return save(this, doc);
};

exports.delete = function (id) {
  return save(this, {$id: id, $deleted: true});
};

exports.all = function () {
  var db = this;
  var docs = {},
    deletions = {};
  return db.allDocs({include_docs: true}).then(function (doc) {

    // sort by createdAt as cannot guarantee that order preserved by pouch/couch
    doc.rows.sort(function (a, b) {
      return a.doc.$createdAt > b.doc.$createdAt;
    });

    doc.rows.forEach(function (el) {
      if (!el.doc.$id) { // first delta for doc?
        el.doc.$id = el.doc._id;
      }
      if (el.doc.$deleted) { // deleted?
        delete(docs[el.doc.$id]);
        deletions[el.doc.$id] = true;
      } else if (!deletions[el.doc.$id]) { // update before any deletion?
        if (docs[el.doc.$id]) { // exists?
          docs[el.doc.$id] = exports.merge(docs[el.doc.$id], el.doc);
        } else {
          docs[el.doc.$id] = el.doc;
        }
      }
    });
    return docs;
  });
};

// TODO: refactor to use events like pouch, e.g. on('update', cb)??
// TODO: create a more customizable construct for deletions, e.g. deletions.wasDeleted(),
//       deletions.setDeleted()??
exports.onCreate = function (object, getItem, deletions, onCreate, onUpdate, onDelete) {
  var db = this;
  db.get(object.id).then(function (doc) {
    doc.$id = doc.$id ? doc.$id : doc._id;
    if (!deletions[doc.$id]) { // not previously deleted?
      var item = getItem(doc.$id);
      if (item) { // existing?
        if (doc.$deleted) { // deleted?
          deletions[doc.$id] = true;
          onDelete(doc.$id);
        } else {
          onUpdate(db.merge(item, doc));
        }
      } else if (doc.$deleted) { // deleted?
        deletions[doc.$id] = true;
      } else {
        onCreate(doc);
      }
    }
  });
};

function getChanges(item, updates) {
  var changes = {}, change = false;
  for (var i in updates) {
    if (item[i] !== updates[i]) {
      change = true;
      changes[i] = updates[i];
      item[i] = updates[i];
    }
  }
  return change ? changes : null;
}

exports.saveChanges = function (item, updates, onChange) {
  var db = this, changes = getChanges(item, updates); // afterwards, item contains the updates
  if (changes !== null) {
    changes.$id = item.$id;
    db.save(changes).then(function () {
      onChange(item);
    });
  }
};

function getAndRemove(db, id) {
  return db.get(id).then(function (object) {
    return db.remove(object);
  }).catch(function (err) {
    // If the doc isn't found, no biggie. Else throw.
    /* istanbul ignore if */
    if (err.status !== 404) {
      throw err;
    }
  });
}

/*
 * We need a second pass for deletions as client 1 may delete and then
 * client 2 updates afterwards
 * e.g. {id: 1, title: 'one'}, {$id: 1, $deleted: true}, {$id: 1, title: 'two'}
 */
function removeDeletions(db, doc, deletions) {
  var promises = [];
  doc.rows.forEach(function (el) {
    if (deletions[el.doc.$id]) { // deleted?
      promises.push(getAndRemove(db, el.id));
    }
  });
  // promise shouldn't fulfill until all deletions have completed
  return Promise.all(promises);
}

function cleanupDoc(db, el, docs, deletions) {
  return db.get(el.doc._id).then(function (object) {
    var promises = [];

    if (!el.doc.$id) { // first delta for doc?
      el.doc.$id = el.doc._id;
    }

    if (el.doc.$deleted || deletions[el.doc.$id]) { // deleted?
      deletions[el.doc.$id] = true;
      promises.push(db.remove(object));
    } else if (docs[el.doc.$id]) { // exists?
      var undef = false;
      for (var k in el.doc) {
        if (typeof docs[el.doc.$id][k] === 'undefined') {
          undef = true;
          break;
        }
      }
      if (undef) {
        docs[el.doc.$id] = exports.merge(docs[el.doc.$id], el.doc);
      } else { // duplicate update, remove
        promises.push(db.remove(object));
      }
    } else {
      docs[el.doc.$id] = el.doc;
    }

    // promise shouldn't fulfill untill all deletions have completed
    return Promise.all(promises);
  });
}

// TODO: also create fn like noBufferCleanup that uses REST to cleanup??
//       This way can use timestamp so not cleaning same range each time
exports.cleanup = function () {
  var db = this;
  return db.allDocs({ include_docs: true }).then(function (doc) {

    var docs = {}, deletions = {};

    // reverse sort by createdAt
    doc.rows.sort(function (a, b) {
      return a.doc.$createdAt < b.doc.$createdAt;
    });

    return reduce(doc.rows, function (total, current) {
      return cleanupDoc(db, current, docs, deletions);
    }, 0).then(function () {
      if (!empty(deletions)) {
        return removeDeletions(db, doc, deletions);
      }
    });

  });
};

/* istanbul ignore next */
if (typeof window !== 'undefined' && window.PouchDB) {
  window.PouchDB.plugin(exports);
}
