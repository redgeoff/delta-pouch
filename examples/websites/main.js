'use strict';

/* exported doPurge, editSite, removeSite, saveSite, cleanup */
/* global PouchDB, Promise */

var sites = [], curSite = null, db = new PouchDB('websites'),
    remoteCouch = (location.search ? 'https://delta-pouch.iriscouch.com'
      : 'http://127.0.0.1:5984') + '/websites';

function setFormValues(site) {
  document.getElementById('name').value = site.name ? site.name : '';
  document.getElementById('url').value = site.url ? site.url : '';
  curSite = db.clone(site); // save so we can identify changes later
}

function getFormValues() {
  return { name: document.getElementById('name').value, url: document.getElementById('url').value };
}

function setFormVisible(visible) {
  document.getElementById('form').style.display = visible ? 'block' : 'none';
  document.getElementById('newButton').style.display = !visible ? 'block' : 'none';
}

function getItemHtml(site) {
  return '<button onclick="editSite(\'' + site.$id + '\')">Edit</button>' +
    '<button onclick="removeSite(\'' + site.$id + '\')">Delete</button> ' +
    site.name + ': ' + site.url;
}

function addItem(site) {
  var siteList = document.getElementById('siteList'), li = document.createElement('li');
  li.id = site.$id;
  li.innerHTML = getItemHtml(site);
  siteList.appendChild(li);
}

function updateItem(site) {
  var item = document.getElementById(site.$id);
  item.innerHTML = getItemHtml(site);
}

function deleteItem(id) {
  document.getElementById('siteList').removeChild(document.getElementById(id));
}

function indexOf(id) {
  for (var i in sites) {
    if (sites[i].$id === id) {
      return i;
    }
  }
  return null;    
}

function getSite(id) {
  var i = indexOf(id);
  return i === null ? null : sites[i];
}

function deleteSite(id) {
  var i = indexOf(id);
  if (i !== null) {
    sites.splice(i, 1);
  }
}

function updateSite(site) {
  var i = indexOf(site.$id);
  if (i !== null) {
    sites[i] = site; 
  }
}

function addSiteAndItem(site) {
  sites.push(site);
  addItem(site);
}

function updateSiteAndItem(changes) {
  var site = db.merge(getSite(changes.$id), changes);
  updateSite(site);
  updateItem(site);
}

function deleteSiteAndItem(id) {
  deleteSite(id);
  deleteItem(id);
}

function editSite(id) {
  setFormValues(id ? getSite(id) : {});
  setFormVisible(true);
}

function removeSite(id) {
  db.delete(id);
}

function saveChanges() {
  db.saveChanges(curSite, getFormValues());
}

function saveNew() {
  db.save(getFormValues());
}

function saveSite() {
  if (curSite.$id) { // existing?
    saveChanges();
  } else {
    saveNew();
  }
  setFormVisible(false);
}

db.deltaInit();

db.delta
  .on('create', addSiteAndItem)
  .on('update', updateSiteAndItem)
  .on('delete', deleteSiteAndItem);

db.info(function (err, info) {
  db.changes({
    since: info.update_seq,
    live: true
  });
});

var opts = { live: true };
db.replicate.to(remoteCouch, opts);
db.replicate.from(remoteCouch, opts);

db.all().then(function (docs) {
  for (var i in docs) {
    addSiteAndItem(docs[i]);
  }
});

// NOTE: this function does not cause the UI to update. It is provided only for testing purposes.
function purge() {
  var promises = [];
  return db.allDocs({include_docs: true}).then(function (doc) {
    doc.rows.forEach(function (el) {
      promises.push(db.getAndRemove(el.doc._id));
    });
    return Promise.all(promises);
  });
}

function doPurge() {
  purge().then(function () {
    console.log('purge done');
  });
}

function cleanup() {
  db.cleanup().then(function () {
    console.log('cleanup done');
  });
}