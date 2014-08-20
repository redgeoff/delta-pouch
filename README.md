Delta Pouch
=====

[![Build Status](https://travis-ci.org/redgeoff/delta-pouch.svg)](https://travis-ci.org/redgeoff/delta-pouch)

A PouchDB plugin for partial updates that uses the every-doc-is-a-delta storage pattern. You can use delta pouch to enable collaborative editing of the same docs.

Example
----

```js
var db = new PouchDB('pages');

// Create a new page
db.save({ url: 'google.com', views: 0 }).then(function (doc) {
  // Update only the views attribute
  db.save({
    $id: doc.id, // Set the id
    views: 1 });
});
```

Note: if you tried something similar with the `db.put()` built into pouchdb, the url attribute would be blanked out.

Live Demo: Profile
----
[Profile Demo](http://redgeoff.github.io/delta-pouch/examples/profile/?iris)

Live Demo: Websites
----
[Websites Demo](http://redgeoff.github.io/delta-pouch/examples/websites/?iris)

Usage
----

To use this plugin, include it after `pouchdb.js` in your HTML page:

```html
<script src="pouchdb.js"></script>
<script src="pouchdb.delta-pouch.js"></script>
```

Or to use it in Node.js, just npm install it:

```
npm install delta-pouch
```

And then attach it to the `PouchDB` object:

```js
var PouchDB = require('pouchdb');
PouchDB.plugin(require('delta-pouch'));
```

More Examples:
----

**Create doc**
```js
db.save({ url: 'google.com', views: 0 }).then(function (doc) {
  // doc.$id is the id of the created doc
});
```

**Update doc**
```js
db.save({
    $id: doc.$id, // id from creation
    views: 1 });
});
```

**Delete doc**
```js
db.delete(doc.$id);
```

**Fetch all docs**
```js
db.all().then(function (docs) {
  // docs is an "associate array" of docs
});
```

**Cleanup**
```js
db.cleanup().then(function () {
  // clean up has completed
});
```
Delta pouch stores every change as a doc. The cleanup() function removes any changes that are no longer needed and should probably be run via a periodic background process like a node cron job. It is not necessary to use the cleanup() function, but it is advisable as it reduces unneeded syncing and data storage.

**Listen for events**
```js
db.deltaInit();
db.delta
  .on('create', function (doc) {
    // e.g. doc = { $id: 123, url: 'google.com', views: 0  }
  })
  .on('update', function (changes) {
    // e.g. changes = { $id: 123, views: 1  }
  })
  .on('delete', function (id) {
    // e.g. id = 123
  });
```

**Save changes**
```js
var oldDoc = { $id: 123, url: 'google.com', views: 0 };
var newDoc = { url: 'google.com', views: 1 };
db.saveChanges(oldDoc, newDoc).then(function (changes) {
  // changes = { $id: 123, views: 1 };
});
```

Running the included examples
----
Note: you must have couchdb installed and Admin Party enabled

    npm install
    npm run dev

Visit the target example in your browser, e.g. http://127.0.0.1:8001/examples/websites

Contributing
----
Interested in [contributing](CONTRIBUTING.md)?
