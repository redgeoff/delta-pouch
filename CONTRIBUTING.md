
Building
----
    npm install
    npm run build

Your plugin is now located at `dist/pouchdb.delta-pouch.js` and `dist/pouchdb.delta-pouch.min.js` and is ready for distribution.

Testing
----

### In Node

This will run the tests in Node:

    npm test

You can also check for 100% code coverage using:

    npm run coverage

Run single test

    ./node_modules/mocha/bin/mocha -g '<regex>' test/index.js


### In the browser

Run `npm run dev` and then point your favorite browser to [http://127.0.0.1:8001/test/index.html](http://127.0.0.1:8001/test/index.html).

The query param `?grep=mysearch` will search for tests matching `mysearch`.

### Automated browser tests

You can run e.g.

    CLIENT=selenium:firefox npm test
    CLIENT=selenium:phantomjs npm test

This will run the tests automatically and the process will exit with a 0 or a 1 when it's done. Firefox uses IndexedDB, and PhantomJS uses WebSQL.

Build & Publish
----
Let VERSION be the next version, something like 1.0.7

    tin -v VERSION
    npm run build
    git add -A
    git commit -m 'VERSION'
    git tag vVERSION
    git push origin master --tags
    npm publish
