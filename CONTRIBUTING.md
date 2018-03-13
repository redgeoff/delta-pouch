
Building
----
    npm install
    npm run build

Your plugin is now located at `dist/pouchdb.delta-pouch.js` and `dist/pouchdb.delta-pouch.min.js` and is ready for distribution.

Testing
----

### In Node

This will run the tests in Node:

    npm run node-test

You can also check for 100% code coverage using:

    npm run node-full-test

Run single test

    ./node_modules/mocha/bin/mocha -g '<regex>' test/index.js


### In the browser

    $ npm run browser-server
    Use any browser to visit http://127.0.0.1:8001/index.html
    And you can filter the tests, e.g. http://127.0.0.1:8001/index.html?grep=reg-ex


## Automated browser tests

Testing in headless Chrome:

Note: you must have Chrome installed

    $ npm run browser-test

You can also filter the tests, e.g.

    $ npm run browser-test -- -g 'some reg-ex'

Firefox:

Note: you must have Firefox installed

    $ npm run browser-test -- -b selenium:firefox

To test in headless Chrome, generate code coverage and check for 100% coverage:

    $ npm run browser-coverage-full-test

You can then view the test coverage by opening cache/coverage/browser/lcov-report/index.html in any browser


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
