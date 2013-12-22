var marked = require('marked')
  , hljs = require("highlight.js")
  , events = require('../lib/events')


marked.setOptions({
  highlight: function(code, lang) {
    return lang
      ? hljs.highlight(lang, code).value
      : hljs.highlightAuto(code).value
  }
})

events.on('afterRenderContent', function(page) {
  if (page.extension == '.md') {
    page.permalink = page.permalink.replace(/\.md$/, '.html')
    page.content = marked(page.content)
  }
})
