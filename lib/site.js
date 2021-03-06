var fs = require('fs-extra');
var path = require('path');
var glob = require('glob');
var minimatch = require('minimatch');
var mkdirp = require('mkdirp');
var natural = require('natural');
var inflector = new natural.NounInflector();
var Handlebars = require('handlebars');
var connect = require('connect');
var DeepWatch = require('deep-watch');
var _ = require('lodash-node/modern');

var events = require('./events');
var Config = require('./config');
var Template = require('./template');
var Post = require('./post');
var Page = require('./page');
var Query = require('./query');
var Taxonomy = require('./taxonomy');
var Permalink = require('./permalink');

var PostManager = require('./post-manager');

function Site(options) {

  this.config = new Config(options);

  // TODO: consider making site itself an event emitter
  this.events = events;

  // expose local modules
  // TODO: depricate these in favor of the new stuff below
  this.Post = Post;
  this.Page = Page;
  this.Query = Query;
  this.Taxonomy = Taxonomy;
  this.Permalink = Permalink;

  // TODO: this is the new stuff, once it's done remove the old stuff above
  this.posts = new PostManager(this.config.taxonomyTypes);

  // expose the Handlebars instance so 3rd party plugins don't
  // accidentally `require()` the wrong one
  this.Handlebars = Handlebars;
}


_.assign(Site.prototype, {

  _createPlaceholders: function() {
    var _this = this;

    // files are just regulars files that need to be copied
    this._files = [];

    // taxonomies are stored in the `_taxonomies`
    // object keyed by the taxonomy type
    this._taxonomies = {};
    _.each(_this.config.taxonomyTypes, function(taxonomyType) {
      _this._taxonomies[inflector.pluralize(taxonomyType)] = [];
    });
  },

  _walkPosts: function() {
    var postTypes = this.config.postTypes;
    var taxonomies = this._taxonomies;
    var _this = this;

    _.each(postTypes, function(postType) {
      var postTypePlural = inflector.pluralize(postType);
      var postTypeFiles = glob.sync('_' + postTypePlural + '/*');
      _.each(postTypeFiles, function(filename) {

        var file = Template.getOrCreateFromFile(filename, _this.config);

        // if this is a draft and includeDrafts isn't set, ignore this post
        if (file.data.draft && !_this.config.includeDrafts) return;

        // create post objects for each file within a post type directory
        var post = new Post(file, postType, _this.config);
        _this.posts.add(post);

        // if the post specifies a layout, then create a page out of it too
        // TODO: unless the post is a draft and publishing drafts is turned off
        if (post.template.data.layout) new Page(post, _this.config);
      });

    });
  },

  _getFiles: function fn(_path, excludes) {

    // Argument shifting
    if (Array.isArray(_path)) {
      excludes = _path;
      _path = '.';
    }
    if (!excludes) excludes = [];

    var searchedFiles = fs.readdirSync(_path);
    var returnedFiles = [];

    function shouldExclude(file, excludes) {
      return excludes.some(function(exclude) {
        return minimatch(file, exclude);
      });
    }

    for (var i = 0, file; file = searchedFiles[i]; i++) {
      file = path.join(_path, file);

      if (shouldExclude(file, excludes)) continue;

      if (fs.statSync(file).isDirectory()) {
        returnedFiles = returnedFiles.concat(fn(file, excludes));
      } else {
        returnedFiles.push(file);
      }
    }
    return returnedFiles;
  },

  _walkFiles: function() {

    var _this = this;
    var files = this._getFiles('.', this.config.excludeFiles);

    // add files from the includeFiles config option
    files.push.apply(files, _this.config.includeFiles);

    // add files in the _pages directory
    files.push.apply(files, glob.sync('_pages/*'));

    _.each(files, function(filename) {
      var file = Template.getOrCreateFromFile(filename, _this.config);

      // for files with data, add to pages, otherwise add to files
      var fileHasData = Object.keys(file.data).length;
      if (fileHasData) {
        // files without a permalink should use their filename instead
        // of the default permalink since it's assumed they exist at
        // the same location as their destination
        if (!file.data.permalink) file.data.permalink = filename;

        new Page(file, _this.config);
      }
      else {
        _this._files.push(filename);
      }
    });
  },

  _registerPartials: function() {
    _.each(glob.sync(this.config.partialsDirectory + '/**/*.*'), function(filename) {
      var partial = path.basename(filename, path.extname(filename));
      Handlebars.registerPartial(partial, fs.readFileSync(filename, 'utf-8'));
    });
  },

  _loadPlugins: function() {

    var _this = this;

    // get system plugins
    var systemPluginDir = path.resolve(__dirname, '../plugins');
    var systemPlugins = glob.sync('**/*.js', {cwd: systemPluginDir});

    // get local plugins
    var localPlugins = glob.sync('**/*.js', {cwd: this.config.pluginDirectory});


    // don't load system plugins if there's a local plugin by the same name
    systemPlugins = _.without.apply(_, [systemPlugins].concat(localPlugins));

    // don't load plugins if they've been excluded
    systemPlugins = _.without.apply(_, [systemPlugins].concat(this.config.excludePlugins));
    localPlugins = _.without.apply(_, [localPlugins].concat(this.config.excludePlugins));

    // require system plugins
    _.each(systemPlugins, function(filename) {
      require(path.resolve(systemPluginDir, filename)).call(_this);
    });

    // require local plugins
    _.each(localPlugins, function(filename) {
      require(path.resolve(_this.config.pluginDirectory, filename)).call(_this);
    });
  },

  _ensureCleanDestination: function() {
    // remove any previously generated _site files
    fs.removeSync(this.config.destination);
  },

  _paginate: function() {
    var _this = this;
    Page.each(function(page) {
      // TODO: is passing all the posts here the best way?
      page.paginate(_this.posts.all());
    });
  },

  _renderPosts: function() {
    this.posts.all().forEach(function(post) {
      post.render();
    });
  },

  _renderPages: function() {
    Page.each(function(page) {
      page.render();
      page.write();
    });
  },

  _copyFiles: function() {
    var _this = this;

    _.each(this._files, function(filename) {
      var destination = path.join(_this.config.destination, filename);

      events.emit('beforeCopy', filename);

      // TODO: since we've already read this file, look into way
      // to avoid doing this again. Maybe storing the buffer...
      fs.outputFileSync(destination, fs.readFileSync(filename));

      events.emit('afterCopy', filename);
      console.log('Copying ' + filename + ' to ' + destination);
    });
  },

  _clearCaches: function() {
    this.posts = new PostManager(this.config.taxonomyTypes);
    Template.reset();
    Page.reset();
    Taxonomy.reset();
  },

  build: function() {

    // scan files for data
    this._createPlaceholders();
    this._walkPosts();
    this._walkFiles();
    this._ensureCleanDestination();
    this._registerPartials();
    this._loadPlugins();

    events.emit('beforeBuild');

    // create the new site
    this._paginate();

    events.emit('beforeRender');

    this._renderPosts();
    this._renderPages();
    this._copyFiles();

    events.emit('afterBuild');
  },

  rebuild: function() {
    // TODO: instead of removing listeners and clearing caches, consider a way
    // to just call build again with the following functions:
    // _registerPartials()
    // _loadPlugins()

    this.events.removeAllListeners();
    this._clearCaches();
    this.build();
  },

  serve: function() {

    var _this = this;

    this.build();

    var watchOptions = { exclude: this.config.watchExcludes };
    var dw = new DeepWatch('.', watchOptions, this.rebuild.bind(this));

    dw.start();

    connect()
      .use(connect.logger('dev'))
      .use(connect.static(this.config.destination))
      .listen(this.config.port);
  }

});

module.exports = Site;
