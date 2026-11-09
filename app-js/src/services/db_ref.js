'use strict';
// Thin re-export of the runtime data layer, so services can `require('./db_ref')`
// from within src/services without a long relative path. Same object as
// require('../db/runtime').
module.exports = require('../db/runtime');
