// Load modules
var Boom = require('boom'); // error handling https://github.com/hapijs/boom
var Hoek = require('hoek'); // hapi utilities https://github.com/hapijs/hoek
var JWT  = require('jsonwebtoken'); // https://github.com/docdis/learn-json-web-tokens
var pkg  = require('../package.json');
var internals = {}; // Declare internals >> see: http://hapijs.com/styleguide

exports.register = function (server, options, next) {
  server.auth.scheme('jwt', internals.implementation);
  next();
};

exports.register.attributes = { // hapi requires attributes for a plugin.
  pkg: pkg                      // See: http://hapijs.com/tutorials/plugins
};

internals.isFunction = function (functionToCheck) {
 var getType = {};
 return functionToCheck && getType.toString.call(functionToCheck) === '[object Function]';
};

internals.implementation = function (server, options) {
  Hoek.assert(options, 'options are required for jwt auth scheme'); // pre-auth checks
  Hoek.assert(options.key, 'options must contain secret key or key lookup function'); // no signing key
  Hoek.assert(typeof options.validateFunc === 'function', 'options.validateFunc must be a valid function');

  var scheme = {
    authenticate: function (request, reply) {
      var auth;
      if(request.query.token) { // tokens via url: https://github.com/dwyl/hapi-auth-jwt2/issues/19
        auth = request.query.token;
      } // JWT tokens in cookie: https://github.com/dwyl/hapi-auth-jwt2/issues/55
      // else if (request.headers.cookie) {
      //   var cookie = request.headers.cookie.replace(/token=/gi, '');
      //   if(cookie.indexOf(';') > -1) { // cookie has options set
      //     cookie = cookie.substring(0, cookie.indexOf(';'));
      //   }
      //   auth = cookie;
      // }
      else {
        auth = request.headers.authorization;
      }
      if (!auth && (request.auth.mode === 'optional' || request.auth.mode === 'try')) {
        return reply.continue({ credentials: {} });
      }
      else {
        if (!auth) {
          return reply(Boom.unauthorized('Missing auth token'));
        }
        else { // strip pointless "Bearer " label & any whitespace > http://git.io/xP4F
          var token = auth.replace(/Bearer/gi,'').replace(/ /g,'');
          // rudimentary check for JWT validity see: http://git.io/xPBn for JWT format
          if (token.split('.').length !== 3) {
            return reply(Boom.unauthorized('Invalid token format', 'Token'));
          }
          else { // attempt to verify the token *asynchronously*
            var keyFunc = (internals.isFunction(options.key)) ? options.key : function (decoded, callback) { callback(null, options.key); };
            keyFunc(JWT.decode(token), function (err, key, extraInfo) {
              if (err) {
                return reply(Boom.wrap(err));
              }
              if (extraInfo) {
                request.plugins[pkg.name] = { extraInfo: extraInfo };
              }
              var verifyOptions = options.verifyOptions || {};
              JWT.verify(token, key, verifyOptions, function (err, decoded) {
                if (err) { // for 'try' mode we need to pass back the decoded token even if verification failed
                  var credentials = JWT.decode(token);
                  if (err.name === 'TokenExpiredError') {
                    return reply(Boom.unauthorized('Token expired', 'Token'), null, { credentials: credentials });
                  }
                  else {
                    return reply(Boom.unauthorized('Invalid token', 'Token'), null, { credentials: credentials });
                  }
                }
                else { // see: http://hapijs.com/tutorials/auth for validateFunc signature
                  options.validateFunc(decoded, request, function (err, valid, credentials) { // bring your own checks
                    if (err) { // err sent as Boom attributes https://github.com/hapijs/boom#boomunauthorizedmessage-scheme-attributes
                      return reply(Boom.unauthorized('Invalid token', 'Token'), null, err)
                    }
                    else if (!valid) {
                      return reply(Boom.unauthorized('Invalid credentials', 'Token'), null, { credentials: credentials || decoded });
                    }
                    else {
                      return reply.continue({ credentials: credentials || decoded });
                    }
                  });
                }
              });
            });
          }
        }
      }
    }
  };
  return scheme;
};
