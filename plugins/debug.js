var Handlebars = require('handlebars')

Handlebars.registerHelper('debug', function(obj) {
  debugger
  return obj
})
