'use strict';
var fs = require('fs'),
    util = require('util'),
    check = require('syntax-error'),
    EventEmitter = require('events').EventEmitter,
    glob = require('glob'),
    path = require('path'),
    cwd = process.cwd();

function FileNotFoundError(f) { Error.call(this); this.name = 'FileNotFoundError'; this.message = (f?'File "'+f+'" not found':'File not found'); }
util.inherits(FileNotFoundError, Error);

function AlreadyExistsError(e) { Error.call(this); this.name = 'AlreadyExistsError'; this.message = (e?e+' already exists':'Already exists'); }
util.inherits(AlreadyExistsError, Error);

function DoesntExistError(e) { Error.call(this); this.name = 'DoesntExistError'; this.message = (e?e+' doesn\'t exist':'Doesn\'t exist'); }
util.inherits(DoesntExistError, Error);

function MissingDepsError(e, list) { Error.call(this); this.name = 'MissingDepsError'; this.message = 'Missing dependencies for module '+e; this.deps = list; }
util.inherits(MissingDepsError, Error);

function HasDepsError(e, list) { Error.call(this); this.name = 'HasDepsError'; this.message = 'Dependent modules still loaded for module '+e; this.deps = list; }
util.inherits(MissingDepsError, Error);

function clearNodes(prefix, list) { var x; for (var i = 0, l = list.length; i < l; i++) { x = require.resolve(prefix+'/'+list[i]); if (require.cache[x]) { delete require.cache[x]; } } }
function checkcode(prefix, n, isCore) {
  var m, p, err;
  if (!n) { throw new TypeError('n not valid'); }
  p = findModule(prefix, n, isCore).p;
  try { m = fs.readFileSync(p); }
  catch (e) { throw new FileNotFoundError(path); }
  if ((err = check(m, p))) { console.log(err); throw err; }
}

function findModule(prefix, n, isCore) {
  var err, p, isDir, found = true, k = '/modules/'+prefix+'/'+(isCore?'core/':'')+n;
  n = n.replace(/(\.\.|\\|\/)/g, '');
  try { p = require.resolve(cwd+k+'/main.js'); isDir = true; }
  catch (err) {
    try { p = require.resolve(cwd+k+'.js'); isDir = false; }
    catch (err) { found = false; }
  }
  if (found) { return { p: p, isDir: isDir, prefix: cwd }; }
  var statCache = {}, exts = glob.sync(cwd+'/extensions/*', { stat: true, statCache: statCache });
  for (var i = 0, l = exts.length; i < l; i++) {
    if (!statCache[exts[i]].isDirectory()) { continue; }
    try { p = require.resolve(exts[i]+k+'/main.js'); isDir = true; found = true; }
    catch (err) {
      try { p = require.resolve(exts[i]+k+'.js'); isDir = false; found = true; }
      catch (err) { found = false; }
    }
    if (found) { return { p: p, isDir: isDir, prefix: exts[i] }; }
  }
  return undefined;
}

function checkForConflicts() {
  var statCache = {}, files, names = {}, x, tx, cons = [];
  glob.sync(cwd+'/modules/*/core/*.js', { stat: true, statCache: statCache });
  glob.sync(cwd+'/modules/*/*.js', { stat: true, statCache: statCache });
  glob.sync(cwd+'/extensions/*/modules/*/core/*.js', { stat: true, statCache: statCache });
  glob.sync(cwd+'/extensions/*/modules/*/*.js', { stat: true, statCache: statCache });
  files = Object.keys(statCache);
  for (var i = 0, l = files.length; i < l; i++) {
    x = files[i].split('/').reverse();
    tx = x[2]+'/'+x[1]+'/'+x[0];
    if (names[tx]) { cons.push((x[4] == 'extensions'?x[3]+'/':'')+tx); }
    names[tx] = true;
  }
  return cons;
}

function getModList() {
  var files = [], t, arr, n, fn, ext, list;
  list = glob.sync(cwd+'/modules/*/*/main.js', { nodir: true });
  list = list.concat(glob.sync(cwd+'/extensions/*/modules/*/*/main.js', { nodir: true }));
  list = list.concat(glob.sync(cwd+'/modules/*/*.js', { nodir: true }));
  list = list.concat(glob.sync(cwd+'/extensions/*/modules/*/*.js', { nodir: true }));
  for (var i = 0, l = list.length; i < l; i++) {
    arr = list[i].substr(cwd.length).split('/');
    t = require(list[i]);
    n = fn = arr[arr.length-1].replace(/\.js$/i, '');
    ext = (arr[1] == 'extensions'?arr[2]:undefined);
    if ((arr.length == 7) && (ext)) { fn = arr[5]+'/'+arr[6].replace(/\.js$/i, ''); n = arr[5]; }
    else if ((arr.length == 5) && (!ext)) { fn = arr[3]+'/'+arr[4].replace(/\.js$/i, ''); n = arr[3]; }
    files.push({
      fname: fn,
      name: t.name,
      desc: t.desc,
      version: t.version,
      extension: ext,
      loaded: !!(this.__modules?this.__modules[n]:false)
    });
  }
  return files;
}

function deptree() {
  this.list = [];
  this.tree = [];
}
deptree.prototype.add = function (m) {
  var errors = [];
  if (this.has(m.name)) { return false; }
  for (var i = 0, deps = m.depends, l = deps.length; i < l; i++) { if (!this.has(deps[i])) { errors.push(deps[i]); } }
  if (errors.length > 0) { return errors; }
  this.list.push(m);
  this.sort();
  return true;
};
deptree.prototype.rem = function (n) {
  var errors = [], m = this.findInTree(n), lcn = n.toLowerCase();
  if (!m) { return false; }
  if (m.deps.length != 0) { for (var i = 0, deps = m.deps, l = deps.length; i < l; i++) { errors.push(deps[i]); } return errors; }
  for (var i = 0, deps = m.mod.depends, l = deps.length; i < l; i++) {
    m = this.findInTree(deps[i]);
    m.deps.splice(m.deps.indexOf(lcn), 1);
  }
  this.list.splice(this.indexOf(n), 1);
  this.sort();
  return true;
};
deptree.prototype.copyTree = function (fnames, nocore) {
  var out = [];
  for (var i = 0, tree = this.tree, l = tree.length; i < l; i++) {
    if ((nocore) && (tree[i].mod.isCore)) { continue; }
    out.push(fnames===2?tree[i].mod.fullPath:(fnames?tree[i].mod.fname:tree[i].mod.name));
  }
  return out;
};
deptree.prototype.indexOf = function (n) {
  var lcn = n.toLowerCase();
  for (var i = 0, list = this.list, l = list.length; i < l; i++) { if (list[i].name.toLowerCase() == lcn) { return i; } }
  return -1;
};
deptree.prototype.has = function (n) { return !!this.find(n); };
deptree.prototype.find = function (n) { var i = this.indexOf(n); return (i==-1?undefined:this.list[i]); };
deptree.prototype.findInTree = function (n) {
  var lcn = n.toLowerCase();
  for (var i = 0, list = this.tree, l = list.length; i < l; i++) { if (list[i].mod.name.toLowerCase() == lcn) { return list[i]; } }
  return undefined;
};
deptree.prototype.sort = function () {
  var lst = [], marked = {}, k, list = this.list, tree = this.tree;
  // classic tsort
  var findent = function (n) { for (var i = 0, l = list.length; i < l; i++) { if (n == list[i].name) { return list[i]; } } };
  var visit = function (n) {
    if (!marked[n.name]) {
      marked[n.name] = true;
      for (var i = 0, list = n.depends, l = list.length; i < l; i++) { visit(findent(list[i])); }
      lst.unshift({ mod: n, deps: [], priority: 0 });
    }
  };
  for (var i = 0, l = list.length; i < l; i++) { visit(list[i]); }
  lst = lst.reverse();
  // build reverse dep tree (mod x has mods x, y, and z depending on it)
  findent = function (n) { var lcn = n.toLowerCase(); for (var i = 0, l = lst.length; i < l; i++) { if (lcn == lst[i].mod.name.toLowerCase()) { return lst[i]; } } };
  for (var i = 0, l = lst.length; i < l; i++) {
    if (lst[i].mod.depends.length == 0) { continue; }
    for (var x = 0, deps = lst[i].mod.depends, xl = deps.length; x < xl; x++) { findent(deps[x]).deps.push(lst[i].mod.name.toLowerCase()); }
  }
  // generate priority maps
  var addpri = function (m) {
    var p = m.priority, k;
    for (var x = 0, deps = m.deps, xl = deps.length; x < xl; x++) {
      k = findent(deps[x]);
      k.priority = (k.priority||0)+(m.priority+1);
      addpri(k);
    }
  };
  var subpri = function (m) {
    var p = m.priority, k;
    for (var x = 0, deps = m.mod.depends, xl = deps.length; x < xl; x++) {
      k = findent(deps[x]);
      k.priority = (k.priority||0)+(m.priority-1);
      subpri(k);
    }
  };
  for (var i = 0, l = lst.length; i < l; i++) {
    if (lst[i].mod.priority == undefined) { lst[i].priority = lst[i].priority||0; continue; }
    lst[i].priority = (lst[i].priority||0)+lst[i].mod.priority;
    if (lst[i].mod.priority < 0) { subpri(lst[i]); }
    else { addpri(lst[i]); }
  }
  // resort
  var tlst = [], dv;
  for (var i = 0, l = lst.length; i < l; i++) { if (lst[i].priority != 0) { tlst.push(lst[i]); lst.splice(i, 1); i--; l--; } }
  tlst = tlst.sort(function (a,b) { return a.priority-b.priority; });
  for (var i = 0, l = tlst.length-1; i < l; i++) { if ((tlst[i].priority < 0) && (tlst[i+1].priority > 0)) { dv = i+1; break; } }
  if (dv != undefined) {
    lst.splice(0, 0, dv, 0);
    tlst.splice.apply(tlst, lst);
    this.tree = tlst;
  } else if (tlst.length) {
    if (tlst[0].priority < 0) { this.tree = tlst.concat(lst); }
    else { this.tree = lst.concat(tlst); }
  } else { this.tree = lst; }
};

function load(n, e) {
  var m, p, err, isDir = true, isCore = false, prefix;
  if (!n) { throw new TypeError('n not valid'); }
  if (/^core\//i.test(n)) { isCore = true; n = n.replace(/^core\//i, ''); }
  n = n.replace(/(\.\.|\\|\/)/g, '');
  if (e[(isCore?'core/':'')+n]) { throw new AlreadyExistsError((isCore?'Core module ':'Module ')+n); }
  p = findModule(this.__prefix, n, isCore);
  if (!p) { throw new FileNotFoundError(n); }
  isDir = p.isDir; prefix = p.prefix; p = p.p;
  m = fs.readFileSync(p);
  if ((err = check(m, p))) { console.log(err); throw err; }
  try { m = require(p); } catch (err) { console.log(err.stack); unload.call(this, n, e, isCore, true); throw err; }
  if (typeof m.load !== 'function') { throw new DoesntExistError('load function of '+(isCore?'core ':'')+'module '+n); }
  if (typeof m.unload !== 'function') { m.unload = function () {}; }
  m.path = (isCore?'core/':'')+n;
  m.prefix = prefix+'/modules/'+this.__prefix+(isCore?'/core':'')+(isDir?'/'+n:'');
  m.fullPath = p;
  m.priority = (m.priority === undefined ? 0 : m.priority);
  if (!m.depends) { m.depends = []; }
  var a = p.split(path.sep);
  m.fname = (isCore?'core/':'')+(isDir?n:a[a.length-1].replace(/\.js$/i, ''));
  m.isCore = isCore;
  if (!this.__reload) {
    var errored = this.__modulesList.add(m);
    if (errored !== true) { throw new MissingDepsError(m.name, errored); }
  }
  try { m.load.call(this, (isCore?this.tserv||this.__const?this.constructor:this:this)); } catch (err) { console.log(err.stack||err); unload.call(this, n, e, true); throw err; }
  if (!m.files) { m.files = [(isDir?'main.js':n+'.js')]; } else { m.files.push((isDir?'main.js':n+'.js')); }
  e[(isCore?'core/':'')+n] = m;
  return this;
}
function unload(n, e, k) {
  var isCore = false;
  if (!n) { throw new TypeError('n not valid'); return false; }
  if (/^core\//i.test(n)) { isCore = true; n = n.replace(/^core\//i, ''); }
  n = n.replace(/(\.\.|\\|\/)/g, '');
  n = (isCore?'core/':'')+n;
  var erred = false;
  if (!e[n]) { throw new DoesntExistError((isCore?'Core module ':'Module ')+n); }
  if (k) { clearNodes(e[n].prefix, e[n].files); return; }
  var ent = this.__modulesList.findInTree(e[n].name);
  if (!ent) { throw new DoesntExistError((isCore?'Core module ':'Module ')+n); }
  if (!this.__reload) { if (ent.deps.length != 0) { throw new HasDepsError((isCore?'Core module ':'Module ')+n); } }
  clearNodes(e[n].prefix, e[n].files);
  try { e[n].unload.call(this, (isCore?this.tserv||this.__const?this.constructor:this:this)); } catch (err) { console.log(err.stack||err); erred = true; throw err; }
  if ((!this.__reload) && (!erred)) {
    var ret = this.__modulesList.rem(e[n].name);
    if (ret == -1) { throw new Error('Module has loaded dependencies'); }
  }
  delete e[n];
  return this;
}

function loadModule(n) { return load.call(this, n, this.__modules); }
function unloadModule(n, k) { return unload.call(this, n, this.__modules, false, k); }
function reloadModule(n, k) { var m = this.__modules; checkcode.call(this, this.__prefix, n, false); this.__reload = true; unload.call(this, n, m, false, k); var ret = load.call(this, n, m, false, k); this.__reload = false; return ret; }
function getLoadedModules(fnames, nocore) { return this.__modulesList.copyTree(fnames, nocore); }

module.exports = {
  add: function (obj, prefix, constr) {
    if (!obj.constructor.prototype.unloadModule) {
      obj.constructor.prototype.loadModule = loadModule;
      obj.constructor.prototype.unloadModule = unloadModule;
      obj.constructor.prototype.reloadModule = reloadModule;
      obj.constructor.prototype.getLoadedModules = getLoadedModules;
      obj.constructor.prototype.checkForConflicts = checkForConflicts;
      obj.constructor.prototype.getModuleList = getModList;
    }
    obj.__modulesList = new deptree();
    obj.__modules = {};
    obj.__prefix = prefix;
    obj.__const = constr;
  },
  rem: function (obj, r) {
    if (obj.constructor.prototype.unloadModule) {
      delete obj.constructor.prototype.loadModule;
      delete obj.constructor.prototype.unloadModule;
      delete obj.constructor.prototype.reloadModule;
      delete obj.constructor.prototype.getLoadedModules;
      delete obj.constructor.prototype.checkForConflicts;
      delete obj.constructor.prototype.getModuleList;
    }
    if ((obj.__modules) && (!r)) {
      delete obj.__modulesList;
      delete obj.__modules;
      delete obj.__prefix;
      delete obj.__const;
    }
  },
  checkForConflicts: checkForConflicts,
  getModuleList: getModList,
  errors: {
    FileNotFound: FileNotFoundError,
    AlreadyExists: AlreadyExistsError,
    DoesntExist: DoesntExistError
  }
};
