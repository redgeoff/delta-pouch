'use strict';

var utils = require('./pouch-utils'); // TODO: is it ok that this causes warnings with uglifyjs??
var Promise = utils.Promise;

var events = require('events');

function empty(obj) {
  for (var i in obj) { // jshint unused:false
    return false;
  }
  return true;
}

function isString(obj) {
  return typeof obj === 'string' || obj instanceof String;
}

function isNumeric(obj) {
  return !isNaN(obj);
}

function notDefined(obj) {
  return typeof obj === 'undefined';
}

exports.delta = new events.EventEmitter();

exports.deltaInit = function () {
  this.on('create', function (object) {
    onCreate(this, object);
  });
  this.on('destroyed', function () {
    onDestroyed(this);
  });
};

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

function save(db, doc) {
  doc.$createdAt = (new Date()).toJSON();
  return db.post(doc);
}

exports.save = function (doc) {
  return save(this, doc);
};

exports.delete = function (docOrId) {
  var id = isString(docOrId) || isNumeric(docOrId) ? docOrId : docOrId.$id;
  if (notDefined(id)) {
    throw new Error('missing $id');
  }
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

var deletions = {};

exports.wasDeleted = function (id) {
  return deletions[id] ? true : false;
};

exports.markDeletion = function (id) {
  deletions[id] = true;
};

function onCreate(db, object) {
  db.get(object.id).then(function (doc) {
    var id = doc.$id ? doc.$id : doc._id;
    if (!exports.wasDeleted(id)) { // not previously deleted?
      if (doc.$deleted) { // deleted?
        exports.markDeletion(id);
        exports.delta.emit('delete', id);
      } else if (doc.$id) { // update?
        exports.delta.emit('update', doc);
      } else {
        doc.$id = id;
        exports.delta.emit('create', doc);
      }
    }
  });
}

function onDestroyed(db) {
  db.delta.removeAllListeners();
}

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

exports.saveChanges = function (item, updates) {
  var db = this, changes = getChanges(item, updates); // afterwards, item contains the updates
  if (changes !== null) {
    changes.$id = item.$id;
    return db.save(changes).then(function () {
      return item;
    });
  }
  return Promise.resolve();
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

exports.getAndRemove = function (id) {
  return getAndRemove(this, id);
};

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
  // promise shouldn't resolve until all deletions have completed
  return Promise.all(promises);
}

function cleanupDoc(db, el, docs, deletions) {
  return db.get(el.doc._id).then(function (object) {

    if (!el.doc.$id) { // first delta for doc?
      el.doc.$id = el.doc._id;
    }

    if (el.doc.$deleted || deletions[el.doc.$id]) { // deleted?
      deletions[el.doc.$id] = true;
      return db.remove(object);
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
        return db.remove(object);
      }
    } else {
      docs[el.doc.$id] = el.doc;
    }
  });
}

// TODO: also create fn like noBufferCleanup that uses REST to cleanup??
//       This way can use timestamp so not cleaning same range each time
exports.cleanup = function () {
  var db = this;
  return db.allDocs({ include_docs: true }).then(function (doc) {

    var docs = {}, deletions = {}, chain = Promise.resolve();

    // reverse sort by createdAt
    doc.rows.sort(function (a, b) {
      return a.doc.$createdAt < b.doc.$createdAt;
    });

    // The cleanupDoc() calls must execute in sequential order
    doc.rows.forEach(function (el) {
      chain = chain.then(function () { return cleanupDoc(db, el, docs, deletions); });
    });

    return chain.then(function () {
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
