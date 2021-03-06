
/*!
 * EJS
 * Copyright(c) 2012 TJ Holowaychuk <tj@vision-media.ca>
 * MIT Licensed
 */

/**
 * Module dependencies.
 */

var utils = require('./utils')
  , path = require('path')
  , basename = path.basename
  , dirname = path.dirname
  , extname = path.extname
  , join = path.join
  , fs = require('fs')
  , read = fs.readFileSync;

/**
 * Filters.
 *
 * @type Object
 */

var filters = exports.filters = require('./filters');

/**
 * Intermediate js cache.
 *
 * @type Object
 */

var cache = {};

/**
 * Clear intermediate js cache.
 *
 * @api public
 */

exports.clearCache = function(){
  cache = {};
};

/**
 * the blocks in the inheritance.
 *
 * @type Object
 */
var blocks = {};

/**
 * Translate filtered code into function calls.
 *
 * @param {String} js
 * @return {String}
 * @api private
 */

function filtered(js) {
  return js.substr(1).split('|').reduce(function(js, filter){
    var parts = filter.split(':')
      , name = parts.shift()
      , args = parts.join(':') || '';
    if (args) args = ', ' + args;
    return 'filters.' + name + '(' + js + args + ')';
  });
};

/**
 * Re-throw the given `err` in context to the
 * `str` of ejs, `filename`, and `lineno`.
 *
 * @param {Error} err
 * @param {String} str
 * @param {String} filename
 * @param {String} lineno
 * @api private
 */

function rethrow(err, str, filename, lineno){
  var lines = str.split('\n')
    , start = Math.max(lineno - 3, 0)
    , end = Math.min(lines.length, lineno + 3);

  // Error context
  var context = lines.slice(start, end).map(function(line, i){
    var curr = i + start + 1;
    return (curr == lineno ? ' >> ' : '    ')
      + curr
      + '| '
      + line;
  }).join('\n');

  // Alter exception message
  err.path = filename;
  err.message = (filename || 'ejs') + ':'
    + lineno + '\n'
    + context + '\n\n'
    + err.message;

  throw err;
}

/**
 * Parse the blocks in the `str`
 *
 * @param {String} str
 * @param {Object} options
 * @api private
 */
function replaceBlockContent(str, options){
  var open = options.open || exports.open || '<%'
    , close = options.close || exports.close || '%>'
    , start = 0
    , end = 0
    , blockName = ""
    , blockOpen = open + "block"
    , blockOpenIndex = 0
    , blocks = options._blocks
    , parentBlocks = blocks.parent
    , childBlocks = blocks.child;

  while ((blockOpenIndex = str.indexOf(blockOpen, blockOpenIndex)) >= 0) {
    //to match and parse <%block name%>
    start = blockOpenIndex + blockOpen.length;
    end = str.indexOf(close, start);
    blockName = str.substring(start, end).trim();
    var parentBlock = parentBlocks[blockName];
    if (null == parentBlock) {
      throw new Error("The child template contains a block which name is not in the layout template!");
    }
    // 先生成要替换的内容
    var childBlock = childBlocks[blockName];
    var content = parentBlock;
    if (childBlock) {
      var mode = childBlock.mode;
      if (mode === "prepend") {
        content = childBlock.content + content;

      } else if (mode === "append") {
        content = content + childBlock.content;

      } else {
        content = childBlock.content;
      }
    }
    end = str.indexOf(open + "/block", end);
    end = str.indexOf(close, end);
    str = str.substring(0, blockOpenIndex) + content + str.substring(end + close.length);
  }
  return str;
}

/**
 * 解析模板中的block内容
 * @param str
 * @param options
 * @param child
 */
function parseBlockContent(str, options, isChild) {
  var open = options.open || exports.open || '<%'
    , close = options.close || exports.close || '%>'
    , start = 0
    , end = 0
    , blockName = ""
    , blockPatt = new RegExp(open + "block", "ig")
    , blocks = options._blocks;

  while (blockPatt.exec(str) != null) {
    //to match and parse <%block name%>
    start = blockPatt.lastIndex;
    end = str.indexOf(close, start);
    blockName = str.substring(start, end).trim();
    start = end + close.length;
    end = str.indexOf(open + "/block", start);
    var content = str.substring(start, end).trim();

    if (isChild) {
      var arr = blockName.split(/\s/);
      blockName = arr[0];
      var mode = arr[1] || "replace";
      blocks.child = blocks.child || {};
      var childBlocks = blocks.child;
      childBlocks[blockName] = {
        mode: mode,
        content: content
      };

    } else {
      blocks.parent = blocks.parent || {};
      var parentBlocks = blocks.parent;
      parentBlocks[blockName] = content;
    }
    options.debug && console.log("the block name: " + blockName + "\nthe block str: " + blocks[blockName] + "\n");
  }
}

/**
 * Parse the content `str` in extend file, returning the parsed content and new options.filename.
 *
 * @param {String} str
 * @return {Object}
 * @api private
 */
function extend(str, options){
  if (!options.filename) throw new Error('filename option is required for extend');
  //to process the content in the parent
  //to get the parent filename, e.g. <%+ par %>
  var start = str.indexOf(options.open + "+")
    , parName = str.substring(start + options.open.length + 1, str.indexOf(options.close, start)).trim();

  parName = resolveFilename(parName, options.filename);
  // 先解析parent中的content，这样子模板中的block就会覆盖父模板
  var parentFileContent = read(parName, 'utf8');
  parseBlockContent(parentFileContent, options, false);
  //to process the blocks in the child
  parseBlockContent(str, options, true);
  options.filename = parName;

  return {
    str: replaceBlockContent(parentFileContent, options),
    filename: parName
  };
}

/**
 * Parse the given `str` of ejs, returning the function body.
 *
 * @param {String} str
 * @return {String}
 * @api public
 */

var parse = exports.parse = function(str, options){
  var options = options || {}
    , open = options.open || exports.open || '<%'
    , close = options.close || exports.close || '%>'
    , filename = options.filename
    , compileDebug = options.compileDebug !== false
    , buf = "";

  // add blocks container
  options._blocks = options._blocks || {};

  // the extend symbol must be in the first place of the file if exist
  if (str.trim().indexOf(open + '+') === 0) {
    var extendObj = extend(str, {open: open, close: close, debug: options.debug, filename: filename, _blocks: options._blocks});
    options.filename = extendObj.filename;
    return exports.parse(extendObj.str, options);
  }

  buf += 'var buf = [];';
  if (false !== options._with) buf += '\nwith (locals || {}) { (function(){ ';
  buf += '\n buf.push(\'';

  var lineno = 1;

  var consumeEOL = false;
  for (var i = 0, len = str.length; i < len; ++i) {
    var stri = str[i];
    if (str.slice(i, open.length + i) == open) {
      i += open.length

      var prefix, postfix, line = (compileDebug ? '__stack.lineno=' : '') + lineno;
      switch (str[i]) {
        case '=':
          prefix = "', escape((" + line + ', ';
          postfix = ")), '";
          ++i;
          break;
        case '-':
          prefix = "', (" + line + ', ';
          postfix = "), '";
          ++i;
          break;
        default:
          prefix = "');" + line + ';';
          postfix = "; buf.push('";
      }

      var end = str.indexOf(close, i)
        , js = str.substring(i, end)
        , start = i
        , include = null
        , n = 0;

      if ('-' == js[js.length-1]){
        js = js.substring(0, js.length - 2);
        consumeEOL = true;
      }

      if (0 == js.trim().indexOf('include')) {
        var name = js.trim().slice(7).trim();
        if (!filename) throw new Error('filename option is required for includes');
        var path = resolveFilename(name, filename);
        include = read(path, 'utf8');
        include = exports.parse(include, { filename: path, _with: false, open: open, close: close, compileDebug: compileDebug });
        buf += "' + (function(){" + include + "})() + '";
        js = '';
      }
      // the blocks that not been extended will be parsed as normal ejs
      if (0 == js.trim().indexOf('block')) {
        var tmpStart = str.indexOf(close, start) + close.length;
        end = str.indexOf(open + "/block", start);
        var tmpBlockStr = str.substring(tmpStart, end);
        tmpBlockStr = exports.parse(tmpBlockStr, { filename: filename, _with: false, open: open, close: close, compileDebug: compileDebug });
        buf += "' + (function(){" + tmpBlockStr + "})() + '";
        js = '';
        end = str.indexOf(close, end);
      }

      while (~(n = js.indexOf("\n", n))) n++, lineno++;
      if (js.substr(0, 1) == ':') js = filtered(js);
      if (js) {
        if (js.lastIndexOf('//') > js.lastIndexOf('\n')) js += '\n';
        buf += prefix;
        buf += js;
        buf += postfix;
      }
      i += end - start + close.length - 1;

    } else if (stri == "\\") {
      buf += "\\\\";
    } else if (stri == "'") {
      buf += "\\'";
    } else if (stri == "\r") {
      // ignore
    } else if (stri == "\n") {
      if (consumeEOL) {
        consumeEOL = false;
      } else {
        buf += "\\n";
        lineno++;
      }
    } else {
      buf += stri;
    }
  }

  if (false !== options._with) buf += "'); })();\n} \nreturn buf.join('');";
  else buf += "');\nreturn buf.join('');";
  return buf;
};

/**
 * Compile the given `str` of ejs into a `Function`.
 *
 * @param {String} str
 * @param {Object} options
 * @return {Function}
 * @api public
 */

var compile = exports.compile = function(str, options){
  options = options || {};
  var escape = options.escape || utils.escape;

  var input = JSON.stringify(str)
    , compileDebug = options.compileDebug !== false
    , client = options.client
    , filename = options.filename
      ? JSON.stringify(options.filename)
      : 'undefined';

  if (compileDebug) {
    // Adds the fancy stack trace meta info
    str = [
      'var __stack = { lineno: 1, input: ' + input + ', filename: ' + filename + ' };',
      rethrow.toString(),
      'try {',
      exports.parse(str, options),
      '} catch (err) {',
      '  rethrow(err, __stack.input, __stack.filename, __stack.lineno);',
      '}'
    ].join("\n");
  } else {
    str = exports.parse(str, options);
  }

  if (options.debug) console.log(str);
  if (client) str = 'escape = escape || ' + escape.toString() + ';\n' + str;

  try {
    var fn = new Function('locals, filters, escape, rethrow', str);
  } catch (err) {
    if ('SyntaxError' == err.name) {
      err.message += options.filename
        ? ' in ' + filename
        : ' while compiling ejs';
    }
    throw err;
  }

  if (client) return fn;

  return function(locals){
    return fn.call(this, locals, filters, escape, rethrow);
  }
};

/**
 * Render the given `str` of ejs.
 *
 * Options:
 *
 *   - `locals`          Local variables object
 *   - `cache`           Compiled functions are cached, requires `filename`
 *   - `filename`        Used by `cache` to key caches
 *   - `scope`           Function execution context
 *   - `debug`           Output generated function body
 *   - `open`            Open tag, defaulting to "<%"
 *   - `close`           Closing tag, defaulting to "%>"
 *
 * @param {String} str
 * @param {Object} options
 * @return {String}
 * @api public
 */

exports.render = function(str, options){
  var fn
    , options = options || {};

  if (options.cache) {
    if (options.filename) {
      fn = cache[options.filename] || (cache[options.filename] = compile(str, options));
    } else {
      throw new Error('"cache" option requires "filename".');
    }
  } else {
    fn = compile(str, options);
  }

  options.__proto__ = options.locals;
  return fn.call(options.scope, options);
};

/**
 * Render an EJS file at the given `path` and callback `fn(err, str)`.
 *
 * @param {String} path
 * @param {Object|Function} options or callback
 * @param {Function} fn
 * @api public
 */

exports.renderFile = function(path, options, fn){
  var key = path + ':string';

  if ('function' == typeof options) {
    fn = options, options = {};
  }

  options.filename = path;

  var str;
  try {
    str = options.cache
      ? cache[key] || (cache[key] = read(path, 'utf8'))
      : read(path, 'utf8');
  } catch (err) {
    fn(err);
    return;
  }
  fn(null, exports.render(str, options));
};

/**
 * Resolve include or extend `name` relative to `filename`.
 *
 * @param {String} name
 * @param {String} filename
 * @return {String}
 * @api private
 */

function resolveFilename(name, filename) {
  var path = join(dirname(filename), name);
  var ext = extname(name);
  if (!ext) path += '.ejs';
  return path;
}

// express support

exports.__express = exports.renderFile;

/**
 * Expose to require().
 */

if (require.extensions) {
  require.extensions['.ejs'] = function (module, filename) {
    filename = filename || module.filename;
    var options = { filename: filename, client: true }
      , template = fs.readFileSync(filename).toString()
      , fn = compile(template, options);
    module._compile('module.exports = ' + fn.toString() + ';', filename);
  };
} else if (require.registerExtension) {
  require.registerExtension('.ejs', function(src) {
    return compile(src, {});
  });
}
