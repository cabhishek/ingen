var events = require('../lib/events')
  , minify = require('html-minifier').minify

// http://perfectionkills.com/experimenting-with-html-minifier/#options
var options = {
  removeIgnored: false,
  removeComments: true,
  removeCommentsFromCDATA: true,
  removeCDATASectionsFromCDATA: true,
  collapseWhitespace: true,
  collapseBooleanAttributes: true,
  removeAttributeQuotes: true,
  removeRedundantAttributes: true,
  useShortDoctype: true,
  removeEmptyAttributes: true,
  removeEmptyElements: false,
  removeOptionalTags: false,
  removeScriptTypeAttributes: true,
  removeStyleLinkTypeAttributes: true
}

events.on('beforeWrite', function(page) {
  // page.content = minify(page.content, options)
})
