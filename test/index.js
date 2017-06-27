/*jshint expr:true */
'use strict';

var Pouch = require('pouchdb');

// Use mem adapter as level down adapter has problems running on virtualbox:
// https://github.com/Level/levelup/issues/222
Pouch.plugin(require('pouchdb-adapter-memory'));

var deltaPlugin = require('../');
Pouch.plugin(deltaPlugin);

var chai = require('chai');
chai.use(require("chai-as-promised"));

chai.should(); // var should = chai.should();
var Promise = require('bluebird');

var dbs;
if (process.browser) {
  dbs = 'testdb' + Math.random() +
    ',http://localhost:5984/testdb' + Math.round(Math.random() * 100000);
} else {
  dbs = process.env.TEST_DB ? process.env.TEST_DB : 'testdb';
}

dbs.split(',').forEach(function (db) {
  var dbType = /^http/.test(db) ? 'http' : 'local';
  tests(db, dbType);
});

function length(obj) {
  var n = 0;
  for (var i in obj) { // jshint unused:false
    n++;
  }
  return n;
}

function setTimeoutPromise(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

function tests(dbName, dbType) {

  var db;

  // Wait a millsecond after saving before resolving to prevent two saves on the same millisecond.
  // It is "fine" if two saves occur on the same millisecond, but it is impossible to guarantee test
  // results when this happens.
  function save(doc) {
    return db.save(doc).then(function (response) {
      return setTimeoutPromise(1).then(function () {
        return response;
      });
    });
  }

  beforeEach(function () {
    db = new Pouch(dbName, {adapter: 'memory'});
    return db;
  });

  afterEach(function () {
    return db.destroy();
  });

  describe(dbType, function () {

    this.timeout(5000); // increase timeout for TravisCI

    function saveTrash() {
      return save({ title: 'take out trash' }).then(function (doc) {
        return save({ $id: doc.id, priority: 'medium' }).then(function () {
          return save({ $id: doc.id, title: 'take out trash and recycling' }).then(function () {
            return save({ $id: doc.id, priority: 'high' }).then(function () {
              return doc.id;
            });
          });
        });
      });
    }

    function assertAllDocs(objs) {
      return db.all().then(function (docs) {
        length(docs).should.equal(length(objs));
        for (var i in objs) {
          assertContains(docs[i], objs[1]);
        }
      });
    }

    function assertContains(obj1, obj2) {
      for (var i in obj2) {
        obj2[i].should.equal(obj1[i]);
      }
    }

    function AssertFunctionFactory(callback, resolve, reject) {
      return function () {
        try {
          // monkey-patch
          callback.apply(this, arguments);
          resolve();
        } catch (err) {
          reject(err);
        }
      };
    }

    function AssertNeverFactory(resolve, reject, name) {
      setTimeout(function () {
        resolve();
      }, 500);
      return function () {
        reject(new Error(name + ' should never be called'));
      };
    }

    function saveDishes() {
      return save({ priority: 'low' }).then(function (doc) {
        return save({ $id: doc.id, title: 'clean dishes' }).then(function () {
          return save({ $id: doc.id, title: 'clean & dry dishes' }).then(function () {
            return save({ $id: doc.id, priority: 'medium' }).then(function () {
              return doc.id;
            });
          });
        });
      });
    }

    function deleteTrash(useDoc) {
      return saveTrash().then(function (trashId) {
        return saveDishes().then(function (dishesId) {
          return db.delete(useDoc ? { $id: dishesId } : trashId).then(function () {
            // save after delete shouldn't change docs
            return save({ $id: trashId, title: 'replace trash bag' }).then(function () {
              var docs = {};
              docs[dishesId] = { title: 'clean & dry dishes', priority: 'medium' };
              return assertAllDocs(docs).then(function () {
                return dishesId;
              });
            });
          });
        });
      });
    }

    function cleanup() {
      return db.cleanup().then(function () {
        return db.allDocs({ include_docs: true }).then(function (doc) {
          doc.rows.sort(function (a, b) {
            return a.doc.$createdAt > b.doc.$createdAt;
          });
          return doc;
        });
      });
    }

    it('should clone', function () {
      var doc = { title: 'take out trash', priority: 'low' }, clonedDoc = db.clone(doc);
      clonedDoc.title = 'clean dishes';
      doc.title.should.eql('take out trash');
    });

    it('should save', function () {
      var doc = { title: 'take out trash', priority: 'low' };
      return save(doc).then(function (response) {
        response.should.eql({ ok: true, id: response.id, rev: response.rev, $id: response.$id });
      });
    });

    it('should delete', function () {
      return db.delete(123).then(function (response) {
        response.should.eql({ ok: true, id: response.id, rev: response.rev, $id: response.$id});
      });
    });

    it('should delete with doc', function () {
      return deleteTrash(true);
    });

    it('delete should throw error when no $id', function (done) {
      try {
        db.delete({});
      } catch (err) {
        done();
      }
    });

    it('all should call callback even when no docs', function () {
      return db.all().then(function (docs) {
        docs.should.deep.equal({});
      });
    });

    it('should update doc and be reflected in all', function () {
      return saveTrash().then(function (id) {
        var docs = {};
        docs[id] = { title: 'take out trash and recycling', priority: 'high' };
        return assertAllDocs(docs);
      });
    });

    it('should update docs and be reflected in all', function () {
      return saveTrash().then(function (trashId) {
        return saveDishes().then(function (dishesId) {
          var docs = {};
          docs[trashId] = { title: 'take out trash and recycling', priority: 'high' };
          docs[dishesId] = { title: 'clean & dry dishes', priority: 'medium' };
          return assertAllDocs(docs);
        });
      });
    });

    it('should delete doc and be reflected in all', function () {
      return deleteTrash();
    });

    it('should cleanup when no docs', function () {
      return db.cleanup();
    });

    it('should cleanup updates and be reflected in all', function () {
      return saveTrash().then(function (dishesId) {
        return cleanup().then(function (doc) {
          assertContains(doc.rows[0].doc,
            { _id: dishesId, title: 'take out trash' });
          assertContains(doc.rows[1].doc,
            { $id: dishesId, priority: 'medium' });
        });
      });
    });

    it('should cleanup deletions and be reflected in all', function () {
      return saveTrash().then(function (trashId) {
        return db.delete(trashId).then(function () {
          return cleanup().then(function (doc) {
            doc.rows.length.should.equal(0);
          });
        });
      });
    });

    it('should cleanup deletions and a following update and be reflected in all', function () {
      return saveTrash().then(function (trashId) {
        return db.delete(trashId).then(function () {
          // save after delete shouldn't change docs
          return save({ $id: trashId, title: 'replace trash bag' }).then(function () {
            return cleanup().then(function (doc) {
              doc.rows.length.should.equal(0);
            });
          });
        });
      });
    });

    it('should cleanup docs and be reflected in all', function () {
      return deleteTrash().then(function (dishesId) {
        return cleanup().then(function (doc) {
          assertContains(doc.rows[0].doc,
            { _id: dishesId, priority: 'low' });
          assertContains(doc.rows[1].doc,
            { $id: dishesId, title: 'clean dishes' });
        });
      });
    });

    it('should save changes', function () {
      var item = { $id: 1, title: 'take out trash', priority: 'high'},
          updates = { title: 'take out recycling', priority: 'high' };
      return db.saveChanges(item, updates).then(function (response) {
        (typeof response).should.not.equal('undefined');
        assertContains(response,
          { $id: item.$id, title: updates.title });
        var docs = {};
        docs[item.$id] = { $id: item.$id, title: updates.title };
        return assertAllDocs(docs);
      });
    });

    it('should save no changes', function () {
      var item = { $id: 1, title: 'take out trash', priority: 'high'}, updates = {};
      return db.saveChanges(item, updates);
    });

    it('should emit create', function () {
      var item = { title: 'take out trash' };
      db.deltaInit();
      return new Promise(function (resolve, reject) {
        db.delta.on('create', new AssertFunctionFactory(function (doc) {
          assertContains(doc, { $id: doc.$id });
        }, resolve, reject));
        save(item);
      });
    });

    it('should not emit create when already deleted', function () {
      return saveTrash().then(function (trashId) {
        return db.delete(trashId).then(function () {
          var item = { $id: trashId, title: 'put out trash cans' };
          db.deltaInit();
          var promise = new Promise(function (resolve, reject) {
            db.delta.on('create', new AssertNeverFactory(resolve, reject));
          });
          save(item);
          return promise;
        });
      });
    });

    it('should emit update', function () {
      var item1 = { title: 'take out trash' };
      return save(item1).then(function (object1) {
        var item2 = { $id: object1.id, title: 'take out recycling' };
        db.deltaInit();
        var promise = new Promise(function (resolve, reject) {
          db.delta.on('update', new AssertFunctionFactory(function (doc) {
            assertContains(doc, item2);
          }, resolve, reject));
        });
        save(item2);
        return promise;
      });
    });

    it('should not emit update when already deleted', function () {
      return saveTrash().then(function (trashId) {
        db.deltaInit();
        return db.delete(trashId).then(function () {
          return new Promise(function (resolve, reject) {
            // wait for the deletion to be marked before performing the update
            db.delta.on('delete', function () {
              var item = { $id: trashId, title: 'put out trash cans' };
              db.delta.on('update', new AssertNeverFactory(resolve, reject, 'update'));
              save(item);
            });
          });
        });
      });
    });

    it('should emit delete', function () {
      return saveTrash().then(function (trashId) {
        db.deltaInit();
        var promise = new Promise(function (resolve, reject) {
          db.delta.on('delete', new AssertFunctionFactory(function (id) {
            id.should.equal(trashId);
          }, resolve, reject));
        });
        db.delete(trashId);
        return promise;
      });
    });

    it('should getAndRemove', function () {
      // Note: getAndRemove already tested by cleanup
      return db.getAndRemove('123');
    });

    // TODO: test simulatenous client updates/deletes
  });
}
