;(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);throw new Error("Cannot find module '"+o+"'")}var f=n[o]={exports:{}};t[o][0].call(f.exports,function(e){var n=t[o][1][e];return s(n?n:e)},f,f.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){

},{}],2:[function(require,module,exports){
// shim for using process in browser

var process = module.exports = {};

process.nextTick = (function () {
    var canSetImmediate = typeof window !== 'undefined'
    && window.setImmediate;
    var canPost = typeof window !== 'undefined'
    && window.postMessage && window.addEventListener
    ;

    if (canSetImmediate) {
        return function (f) { return window.setImmediate(f) };
    }

    if (canPost) {
        var queue = [];
        window.addEventListener('message', function (ev) {
            var source = ev.source;
            if ((source === window || source === null) && ev.data === 'process-tick') {
                ev.stopPropagation();
                if (queue.length > 0) {
                    var fn = queue.shift();
                    fn();
                }
            }
        }, true);

        return function nextTick(fn) {
            queue.push(fn);
            window.postMessage('process-tick', '*');
        };
    }

    return function nextTick(fn) {
        setTimeout(fn, 0);
    };
})();

process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];

process.binding = function (name) {
    throw new Error('process.binding is not supported');
}

// TODO(shtylman)
process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};

},{}],3:[function(require,module,exports){
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

function save(db, doc) {
  doc.$createdAt = (new Date()).toJSON();
  return db.post(doc);
}

exports.save = function (doc) {
  return save(this, doc);
};

exports["delete"] = function (id) {
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
  })["catch"](function (err) {
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

},{"./pouch-utils":22}],4:[function(require,module,exports){
if (typeof Object.create === 'function') {
  // implementation from standard node.js 'util' module
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    ctor.prototype = Object.create(superCtor.prototype, {
      constructor: {
        value: ctor,
        enumerable: false,
        writable: true,
        configurable: true
      }
    });
  };
} else {
  // old school shim for old browsers
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    var TempCtor = function () {}
    TempCtor.prototype = superCtor.prototype
    ctor.prototype = new TempCtor()
    ctor.prototype.constructor = ctor
  }
}

},{}],5:[function(require,module,exports){
'use strict';

module.exports = INTERNAL;

function INTERNAL() {}
},{}],6:[function(require,module,exports){
'use strict';
var Promise = require('./promise');
var reject = require('./reject');
var resolve = require('./resolve');
var INTERNAL = require('./INTERNAL');
var handlers = require('./handlers');
var noArray = reject(new TypeError('must be an array'));
module.exports = function all(iterable) {
  if (Object.prototype.toString.call(iterable) !== '[object Array]') {
    return noArray;
  }

  var len = iterable.length;
  var called = false;
  if (!len) {
    return resolve([]);
  }

  var values = new Array(len);
  var resolved = 0;
  var i = -1;
  var promise = new Promise(INTERNAL);
  
  while (++i < len) {
    allResolver(iterable[i], i);
  }
  return promise;
  function allResolver(value, i) {
    resolve(value).then(resolveFromAll, function (error) {
      if (!called) {
        called = true;
        handlers.reject(promise, error);
      }
    });
    function resolveFromAll(outValue) {
      values[i] = outValue;
      if (++resolved === len & !called) {
        called = true;
        handlers.resolve(promise, values);
      }
    }
  }
};
},{"./INTERNAL":5,"./handlers":7,"./promise":9,"./reject":11,"./resolve":12}],7:[function(require,module,exports){
'use strict';
var tryCatch = require('./tryCatch');
var resolveThenable = require('./resolveThenable');
var states = require('./states');

exports.resolve = function (self, value) {
  var result = tryCatch(getThen, value);
  if (result.status === 'error') {
    return exports.reject(self, result.value);
  }
  var thenable = result.value;

  if (thenable) {
    resolveThenable.safely(self, thenable);
  } else {
    self.state = states.FULFILLED;
    self.outcome = value;
    var i = -1;
    var len = self.queue.length;
    while (++i < len) {
      self.queue[i].callFulfilled(value);
    }
  }
  return self;
};
exports.reject = function (self, error) {
  self.state = states.REJECTED;
  self.outcome = error;
  var i = -1;
  var len = self.queue.length;
  while (++i < len) {
    self.queue[i].callRejected(error);
  }
  return self;
};

function getThen(obj) {
  // Make sure we only access the accessor once as required by the spec
  var then = obj && obj.then;
  if (obj && typeof obj === 'object' && typeof then === 'function') {
    return function appyThen() {
      then.apply(obj, arguments);
    };
  }
}
},{"./resolveThenable":13,"./states":14,"./tryCatch":15}],8:[function(require,module,exports){
module.exports = exports = require('./promise');

exports.resolve = require('./resolve');
exports.reject = require('./reject');
exports.all = require('./all');
},{"./all":6,"./promise":9,"./reject":11,"./resolve":12}],9:[function(require,module,exports){
'use strict';

var unwrap = require('./unwrap');
var INTERNAL = require('./INTERNAL');
var resolveThenable = require('./resolveThenable');
var states = require('./states');
var QueueItem = require('./queueItem');

module.exports = Promise;
function Promise(resolver) {
  if (!(this instanceof Promise)) {
    return new Promise(resolver);
  }
  if (typeof resolver !== 'function') {
    throw new TypeError('reslover must be a function');
  }
  this.state = states.PENDING;
  this.queue = [];
  this.outcome = void 0;
  if (resolver !== INTERNAL) {
    resolveThenable.safely(this, resolver);
  }
}

Promise.prototype['catch'] = function (onRejected) {
  return this.then(null, onRejected);
};
Promise.prototype.then = function (onFulfilled, onRejected) {
  if (typeof onFulfilled !== 'function' && this.state === states.FULFILLED ||
    typeof onRejected !== 'function' && this.state === states.REJECTED) {
    return this;
  }
  var promise = new Promise(INTERNAL);

  
  if (this.state !== states.PENDING) {
    var resolver = this.state === states.FULFILLED ? onFulfilled: onRejected;
    unwrap(promise, resolver, this.outcome);
  } else {
    this.queue.push(new QueueItem(promise, onFulfilled, onRejected));
  }

  return promise;
};

},{"./INTERNAL":5,"./queueItem":10,"./resolveThenable":13,"./states":14,"./unwrap":16}],10:[function(require,module,exports){
'use strict';
var handlers = require('./handlers');
var unwrap = require('./unwrap');

module.exports = QueueItem;
function QueueItem(promise, onFulfilled, onRejected) {
  this.promise = promise;
  if (typeof onFulfilled === 'function') {
    this.onFulfilled = onFulfilled;
    this.callFulfilled = this.otherCallFulfilled;
  }
  if (typeof onRejected === 'function') {
    this.onRejected = onRejected;
    this.callRejected = this.otherCallRejected;
  }
}
QueueItem.prototype.callFulfilled = function (value) {
  handlers.resolve(this.promise, value);
};
QueueItem.prototype.otherCallFulfilled = function (value) {
  unwrap(this.promise, this.onFulfilled, value);
};
QueueItem.prototype.callRejected = function (value) {
  handlers.reject(this.promise, value);
};
QueueItem.prototype.otherCallRejected = function (value) {
  unwrap(this.promise, this.onRejected, value);
};
},{"./handlers":7,"./unwrap":16}],11:[function(require,module,exports){
'use strict';

var Promise = require('./promise');
var INTERNAL = require('./INTERNAL');
var handlers = require('./handlers');
module.exports = reject;

function reject(reason) {
	var promise = new Promise(INTERNAL);
	return handlers.reject(promise, reason);
}
},{"./INTERNAL":5,"./handlers":7,"./promise":9}],12:[function(require,module,exports){
'use strict';

var Promise = require('./promise');
var INTERNAL = require('./INTERNAL');
var handlers = require('./handlers');
module.exports = resolve;

var FALSE = handlers.resolve(new Promise(INTERNAL), false);
var NULL = handlers.resolve(new Promise(INTERNAL), null);
var UNDEFINED = handlers.resolve(new Promise(INTERNAL), void 0);
var ZERO = handlers.resolve(new Promise(INTERNAL), 0);
var EMPTYSTRING = handlers.resolve(new Promise(INTERNAL), '');

function resolve(value) {
  if (value) {
    if (value instanceof Promise) {
      return value;
    }
    return handlers.resolve(new Promise(INTERNAL), value);
  }
  var valueType = typeof value;
  switch (valueType) {
    case 'boolean':
      return FALSE;
    case 'undefined':
      return UNDEFINED;
    case 'object':
      return NULL;
    case 'number':
      return ZERO;
    case 'string':
      return EMPTYSTRING;
  }
}
},{"./INTERNAL":5,"./handlers":7,"./promise":9}],13:[function(require,module,exports){
'use strict';
var handlers = require('./handlers');
var tryCatch = require('./tryCatch');
function safelyResolveThenable(self, thenable) {
  // Either fulfill, reject or reject with error
  var called = false;
  function onError(value) {
    if (called) {
      return;
    }
    called = true;
    handlers.reject(self, value);
  }

  function onSuccess(value) {
    if (called) {
      return;
    }
    called = true;
    handlers.resolve(self, value);
  }

  function tryToUnwrap() {
    thenable(onSuccess, onError);
  }
  
  var result = tryCatch(tryToUnwrap);
  if (result.status === 'error') {
    onError(result.value);
  }
}
exports.safely = safelyResolveThenable;
},{"./handlers":7,"./tryCatch":15}],14:[function(require,module,exports){
// Lazy man's symbols for states

exports.REJECTED = ['REJECTED'];
exports.FULFILLED = ['FULFILLED'];
exports.PENDING = ['PENDING'];
},{}],15:[function(require,module,exports){
'use strict';

module.exports = tryCatch;

function tryCatch(func, value) {
  var out = {};
  try {
    out.value = func(value);
    out.status = 'success';
  } catch (e) {
    out.status = 'error';
    out.value = e;
  }
  return out;
}
},{}],16:[function(require,module,exports){
'use strict';

var immediate = require('immediate');
var handlers = require('./handlers');
module.exports = unwrap;

function unwrap(promise, func, value) {
  immediate(function () {
    var returnValue;
    try {
      returnValue = func(value);
    } catch (e) {
      return handlers.reject(promise, e);
    }
    if (returnValue === promise) {
      handlers.reject(promise, new TypeError('Cannot resolve promise with itself'));
    } else {
      handlers.resolve(promise, returnValue);
    }
  });
}
},{"./handlers":7,"immediate":17}],17:[function(require,module,exports){
'use strict';
var types = [
  require('./nextTick'),
  require('./mutation.js'),
  require('./messageChannel'),
  require('./stateChange'),
  require('./timeout')
];
var draining;
var queue = [];
function drainQueue() {
  draining = true;
  var i, oldQueue;
  var len = queue.length;
  while (len) {
    oldQueue = queue;
    queue = [];
    i = -1;
    while (++i < len) {
      oldQueue[i]();
    }
    len = queue.length;
  }
  draining = false;
}
var scheduleDrain;
var i = -1;
var len = types.length;
while (++ i < len) {
  if (types[i] && types[i].test && types[i].test()) {
    scheduleDrain = types[i].install(drainQueue);
    break;
  }
}
module.exports = immediate;
function immediate(task) {
  if (queue.push(task) === 1 && !draining) {
    scheduleDrain();
  }
}
},{"./messageChannel":18,"./mutation.js":19,"./nextTick":1,"./stateChange":20,"./timeout":21}],18:[function(require,module,exports){
var global=typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {};'use strict';

exports.test = function () {
  if (global.setImmediate) {
    // we can only get here in IE10
    // which doesn't handel postMessage well
    return false;
  }
  return typeof global.MessageChannel !== 'undefined';
};

exports.install = function (func) {
  var channel = new global.MessageChannel();
  channel.port1.onmessage = func;
  return function () {
    channel.port2.postMessage(0);
  };
};
},{}],19:[function(require,module,exports){
var global=typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {};'use strict';
//based off rsvp https://github.com/tildeio/rsvp.js
//license https://github.com/tildeio/rsvp.js/blob/master/LICENSE
//https://github.com/tildeio/rsvp.js/blob/master/lib/rsvp/asap.js

var Mutation = global.MutationObserver || global.WebKitMutationObserver;

exports.test = function () {
  return Mutation;
};

exports.install = function (handle) {
  var called = 0;
  var observer = new Mutation(handle);
  var element = global.document.createTextNode('');
  observer.observe(element, {
    characterData: true
  });
  return function () {
    element.data = (called = ++called % 2);
  };
};
},{}],20:[function(require,module,exports){
var global=typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {};'use strict';

exports.test = function () {
  return 'document' in global && 'onreadystatechange' in global.document.createElement('script');
};

exports.install = function (handle) {
  return function () {

    // Create a <script> element; its readystatechange event will be fired asynchronously once it is inserted
    // into the document. Do so, thus queuing up the task. Remember to clean up once it's been called.
    var scriptEl = global.document.createElement('script');
    scriptEl.onreadystatechange = function () {
      handle();

      scriptEl.onreadystatechange = null;
      scriptEl.parentNode.removeChild(scriptEl);
      scriptEl = null;
    };
    global.document.documentElement.appendChild(scriptEl);

    return handle;
  };
};
},{}],21:[function(require,module,exports){
'use strict';
exports.test = function () {
  return true;
};

exports.install = function (t) {
  return function () {
    setTimeout(t, 0);
  };
};
},{}],22:[function(require,module,exports){
var process=require("__browserify_process"),global=typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {};'use strict';

var Promise;
/* istanbul ignore next */
if (typeof window !== 'undefined' && window.PouchDB) {
  Promise = window.PouchDB.utils.Promise;
} else {
  Promise = typeof global.Promise === 'function' ? global.Promise : require('lie');
}
/* istanbul ignore next */
exports.once = function (fun) {
  var called = false;
  return exports.getArguments(function (args) {
    if (called) {
      console.trace();
      throw new Error('once called  more than once');
    } else {
      called = true;
      fun.apply(this, args);
    }
  });
};
/* istanbul ignore next */
exports.getArguments = function (fun) {
  return function () {
    var len = arguments.length;
    var args = new Array(len);
    var i = -1;
    while (++i < len) {
      args[i] = arguments[i];
    }
    return fun.call(this, args);
  };
};
/* istanbul ignore next */
exports.toPromise = function (func) {
  //create the function we will be returning
  return exports.getArguments(function (args) {
    var self = this;
    var tempCB = (typeof args[args.length - 1] === 'function') ? args.pop() : false;
    // if the last argument is a function, assume its a callback
    var usedCB;
    if (tempCB) {
      // if it was a callback, create a new callback which calls it,
      // but do so async so we don't trap any errors
      usedCB = function (err, resp) {
        process.nextTick(function () {
          tempCB(err, resp);
        });
      };
    }
    var promise = new Promise(function (fulfill, reject) {
      try {
        var callback = exports.once(function (err, mesg) {
          if (err) {
            reject(err);
          } else {
            fulfill(mesg);
          }
        });
        // create a callback for this invocation
        // apply the function in the orig context
        args.push(callback);
        func.apply(self, args);
      } catch (e) {
        reject(e);
      }
    });
    // if there is a callback, call it back
    if (usedCB) {
      promise.then(function (result) {
        usedCB(null, result);
      }, usedCB);
    }
    promise.cancel = function () {
      return this;
    };
    return promise;
  });
};

exports.inherits = require('inherits');
exports.Promise = Promise;

},{"__browserify_process":2,"inherits":4,"lie":8}]},{},[3])
;