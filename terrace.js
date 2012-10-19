"use strict";

(function() {

var	AP_SLICE		= Array.prototype.slice;
var	OP_TO_STRING	= Object.prototype.toString;

//	False in a Node environment
//
var DOCUMENT = typeof document === 'undefined' ? false : document;

var OPTIONS	= {
	defaultTransactionTimeout	: 5000,
	charset						: "utf-8",

	//	Reject transactions if any transaction methods error.  Rejected methods will not fire
	//	their #end callback, #then, OR #or. They *will* fire their #always method.
	//
	rejectTransOnError			: false,
	undoStackHeight				: 20
};

//	These are protected method names, which cannot be used by kits.
//	NOTE: There are several Terrrace method names that you probably don't want to
//	override. #get and #set are good examples, though you are free to do that if
//	you'd like. The ones listed here *must not* be overridden.
//
//	@see		#addKit
//
var	PROTECTED_NAMES	= {
	sub			: 1
};

//	@see	#nextId
//
var ID_COUNTER = 1;

//	Array methods to be "normalized" -- See below for how methods using these names are
//	added to Object should they not exist for Arrays in the current interpreter.
//
var ARR_M = [
    "all",          //  alias #every
    "any",          //  alias #some
    "collect",      //  alias #map
    "each",         //  alias #forEach
    "every",
    "filter",
    "foldl",        //  alias #reduce
    "foldr",        //  alias #reduceRight
    "forEach",
    "indexOf",
    "lastIndexOf",
    "map",
    "reduce",
    "reduceRight",
    "reject",
    "select",       //  alias #filter
    "some"
];

//	Used by various trim methods.
//	See bottom of this file for some further initialization.
//
// 	See http://forum.jquery.com/topic/faster-jquery-trim.
//	These are the regexes used for trim-ming operations.
//
//	@see		#trim
//	@see		#trimLeft
//	@see		#trimRight
//
var TRIM_LEFT	= /^\s+/;
var TRIM_RIGHT	= /\s+$/;

//	Whether #trim is a native String method.
//
var NATIVE_TRIM	= !!("".trim);

//	@see 	#subscribe
//
var CHANNELS	= {};
var PUBLISHED   = {};

//	@see 	#addToUndoAndExec
//
var UNDO_STACK 	= [];
var UNDO_INDEX 	= 0;

//	This will be assigned the instantiated Terrace Object, below, and returned to exports.
//
var $;

//	This will be set to Terrace.hoist, as a shortcut, below.
var $H;

//	Tracks kit loading status/kit data during require.
//
//  #__o    The order in which a list of kits will be initialized post-load.
//  #__r    Collection of require data.
//
//	@see	#DOMREQUIRE
//
var KITS = {
    __o : [],
    __r : []
};

//	Shortcuts for common strings
//
var STR_OBJECT 		= "object";
var STR_FUNCTION	= "function";
var STR_STRING		= "string";

//	@see	#url
//
var PARSE_URL		= /^((\w+):)?(\/\/((\w+)?(:(\w+))?@)?([^\/\?:]+)(:(\d+))?)?(\/?([^\/\?#][^\?#]*)?)?(\?([^#]+))?(#(.*))?/;

//  ##ADD_SCRIPT
//
//  Adds a <script> to a document. You may send either a source (ie. a file path)
//	or some js (text) to execute.
//
//	@param	{String}	src		Either a path or some js text. Note that you *must* terminate
//								text you send with a semicolon(;).
//	@param	{Function}	[cb]	A callback to call when script is loaded.
//	@param	{Object}	[doc]	The document whose HEAD the script is attached.
//
//  @see    #require
//  @see    #addScriptFile
//
var ADD_SCRIPT = function(src, cb, doc) {

    doc = doc || DOCUMENT;

	var scriptT	= doc.createElement('script');

	//	Note the setting of async to `true`
	//
	scriptT.type 	= 'text/javascript';
	scriptT.charset	= $.options("charset");
	scriptT.async	= true;
	scriptT.loaded	= false;

	//	#src is either path or text. Text must terminate with a semicolon(;)
	//
	if(";" === src.charAt(src.length -1)) {
		scriptT.text = src;
	} else {
		scriptT.src = src;
	}

	scriptT.onload = scriptT.onreadystatechange = function() {
		if(!this.loaded && (!this.readyState  || this.readyState == "loaded" || this.readyState == "complete")) {
			//	Clear the handlers (memory), and fire.
			//
			scriptT.onload = scriptT.onreadystatechange = null;
			cb && cb();
		}
	};

	//	Attach script element to document. This will initiate an http request.
	//
	doc.getElementsByTagName('script')[0].parentNode.appendChild(scriptT);

	return scriptT;
};

//	##DOMREQUIRE
//
//	Terrace#require needs to work on both client and server. On server, it is essentially
//	an alias for calling Node#require directly, doing some argument passing sugar only.  On
//	the client, we need to actually fetch a file.  This method does that.
//
//	NOTE: Node #require blocks execution until dependency is initialized. In the browser,
//	dependencies are loaded in parallel (async), and during load time the Object chain is
//  blocked (@see #queue, #extend), and restarted when dependencies are done loading. Outside
//  of the Object chain execution of other script on the page is *not* blocked.
//
//	@see	#require
//
var DOMREQUIRE = function(kitName, cont, args, $this, asDependency) {

	//	If this kit path is preceeded by a ! then we have been asked to simply
	//	use what follows as the path (do not alter). This is used when a kit may
	//	have it's own custom sub-kits.
	//
	var chk = kitName.replace("!","");
	var src = $.$n.path + "kits/" + chk

	if(chk === kitName) {
		//	folderWhereThisFileIs/kits/sentName/sentName.js
		//
		src += "/" + kitName + ".js";
	}

	//	Avoid reloading modules.
	//
	if(KITS.hasOwnProperty(kitName)) {
		return;
	} else {
		KITS[kitName] = 1;
	}

	var callback	= function() {

		var r 		= KITS.__r.shift();

		//  If the current kit has dependencies then add them to the requirements list.
		//  Dependencies must be added prior to dependant. Flag for #require to set
		//  the #asDependency argument when it calls back ([true]).
		//
		if(module.dependencies) {
			$.require.apply($, [true].concat(module.dependencies));
			delete module.dependencies;
		}

		KITS.__o[asDependency ? "unshift" : "push"](r);

		//	When no more modules are required, initialize.
		//
		if(KITS.__r.length < 1) {
			//	Now run any onload handlers set on the required scripts. Note that the onload
			//	handlers will be run in the order they were #require-d, and will execute
			//	in Object scope.
			//
			$.each(KITS.__o, function(sOb) {
                //  Initialize the module, sending it any arguments, then call any
                //  module initialization callback.
                //
				KITS[sOb.kitName].call($this, sOb.origArgs);
				sOb.cont.call($this, sOb);

				KITS[sOb.kitName] = 1;

				sOb.snode.parentNode.removeChild(sOb.snode);

			});

			KITS.__o = [];

			$.runQueue('__require');
		}
	};

    var script = ADD_SCRIPT(src, function() {
        KITS[kitName] = module.exports;
        callback && callback();
    })

	// 	@see #callback, above.
	//
	KITS.__r.push({
		src			: src,
		kitName	    : kitName,
		snode		: script,
		cont		: cont || $.noop,
		origArgs	: args || []
	});
};

//	##ITERATOR
//
//	Returns accumulator as modified by passed selective function.
//	This is used by #arrayMethod in cases where there is not a native implementation
//  for a given array method (#map, #filter, etc). It's a fallback, in other words,
//  and hopefully will go vestigial over time.
//
//	Also used by #iterate, being a general iterator over either objects or arrays.
//	NOTE: It is usually more efficient to write your own loop.
//
//	You may break the iteration by returning Boolean `true` from your selective function.
//
//	@param		{Function}		fn		The selective function.
//	@param		{Object}		[targ]	The object to work against. If not sent
//										the default becomes Subject.
//	@param		{Mixed}			[acc]	An accumulator, which is set to result of selective
//										function on each interation through target.
//  @param      {Object}        [ctxt]  A context to run the iterator in.
//	@see	#arrayMethod
//	@see	#iterate
//
var	ITERATOR	= function(fn, targ, acc, ctxt) {

	targ	= targ || $.$;
	ctxt    = ctxt || this;

	var x	= 0;
	var len;
	var n;

	if($.is(Array, targ)) {
		len = targ.length;
		while(x < len) {
			if(targ[x] !== void 0) {
				acc = fn.call(ctxt, targ[x], x, targ, acc);
				if(acc === true) {
					break;
				}
			}
			x++;
		}
	} else {
		for(n in targ) {
			if(targ.hasOwnProperty(n)) {
				acc = fn.call(ctxt, targ[n], n, targ, acc);
				if(acc === true) {
					break;
				}
			}
		}
	}

	return acc;
};

//	##ACCESS
//
//	General accessor for an object.  Will get or set a value on an object.
//
//	@param	{Object}	ob		The object to traverse.
//	@param	{String}	path	A path to follow in the object tree, such as
//								"this.is.a.path". For root, use "" (empty string).
//	@param	{Mixed}		[val]	When setting, send a value.
//
var ACCESS	= function(ob, path, val) {

	var props 	= path ? path.split('.') : [];
	var fPath	= "";
	var	pL		= props.length;
	var	i 		= 0;
	var	p;

	// 	Setting
	//
	//	Note that requesting a path that does not exist will result in that
	//	path being created. This may or may not be what you want. IE:
	//	{ top: { middle: { bottom: { foo: "bar" }}}}
	//
	//	.set("top.middle.new.path", "value") will create:
	//
	//	{ top: { middle: {
	//						bottom: {...}
	//						new:	{ path: "value" }
	//					 }}}
	//
	if(arguments.length > 2) {

		while(i < (pL -1)) {
			p 	= props[i];
			ob 	= ob[p] = (typeof ob[p] === STR_OBJECT) ? ob[p] : {};
			i++;
		}

		//	If #set was called with an empty string as path (ie. the root), simply
		//	update #ob. Otherwise, update at path position.
		//
		if(path === "") {
			ob = val;
		} else {
			ob[props[i]] = val;
		}

		return val;

	// 	Getting
	//
	} else {
		while(((ob = ob[props[i]]) !== void 0) && ++i < pL) {};
	}


	return (ob !== void 0 && ob !== null) ? ob : null;
};

//	##FIND
//
//	Internal utility method.
//
//	@see	#find
//
var FIND 	= function(key, val, path, t, acc, curKey) {

    //  Keep @path a string
    //
    path = !!path ? path : "";
	acc	= acc || {
		first	: null,
		last	: null,
		node	: null,
		nodes	: [],
		paths	: [],
		key		: key,
		value	: val
	};

	var node = t || ACCESS(t, path);
	var p;

	//	Accumulate info on any hits against this node.
	//
	if(typeof val === STR_FUNCTION ? val(curKey, val, key, node) : node[key] === val) {
		if(!acc.first) {
			acc.first = path;
		}
		acc.last = path;
		acc.node = node;
		acc.nodes.push(node);
		acc.paths.push(path);
	}

	//	Recurse if children.
	//
	if(typeof node === STR_OBJECT) {
		for(p in node) {
			if(node[p]) {
				FIND(key, val, path + (path ? "." : "") + p, node[p], acc, p);
			}
		}
	}

	return acc;
};

//	##PUB
//
//	All channel publishing is done through this method, called variously.
//
//	@see	#subscribe
//	@see	#fire
//
var PUB = function(fn, scope, data, subscriberOb) {
	var chan 	= CHANNELS[subscriberOb.channel] || {};
	var r;

	//	If this subscriber respects the chain of command and the chain is
	//	broken, exit.
	//
	if(subscriberOb.chained && chan.broken) {
		return null;
	}

	r = fn.call(scope, data, subscriberOb, chan.broken);
	if(r === null) {
		chan.broken = true;
	}

	//	Indicate that this channel has been published to.  We also store any passed
	//	data here, which is useful should a handler wish to examine previous data
	// 	sent to subscriber.
	//
	//	@see	#subscribe
	//
	PUBLISHED[chan] = data || true;

	if(subscriberOb.once) {
        $.unsubscribe(subscriberOb.channel, function() {
            return this.fn === fn;
        });
	}

	return r;
};

//	##ARRAY_METHOD
//
//	Terrace has several array manipulation methods, such as #each and #map. As they all share
//	some common functionality, and may be superseded by native array methods, this method is
//	provided to "normalize" the various Terrace array method calls. It is called by the
//	appropriate method, defined in the init section at the bottom of this file.
//
//	@param		{String}		meth	The array method.
//	@param		{Object}		[targ]	The object to work against. If not sent
//										the default becomes Subject.
//	@param		{Function}		fn		The selective function.
//	@param		{Mixed}			[arg2]	Usually the scope in which to execute the method, but
//										in the case of #reduce this is an [initialValue].
//
//	@see		#reduce
//	@see		#reduceRight
//	@see		#filter
//	@see		#every
//	@see		#some
//	@see		#map
//	@see		#each
//
var ARRAY_METHOD = function(meth, targ, fn, arg2) {
    if(typeof targ === STR_FUNCTION) {
        arg2    = fn;
        fn      = targ;
        targ    = this.$;

    //	If sent a string as the target object, assume this is a path
    //	in the local model. Fetch that value and set.
    //
    } else if(typeof targ === STR_STRING) {
        targ = this.$get(targ);
    }

    if(typeof targ !== STR_OBJECT) {
        return;
    }

    var scope	= arg2 || this;

    switch(meth) {
        case "each":
        case "forEach":
            return 	ITERATOR.call(this, function(elem, idx, targ) {
                        return fn.call(scope, elem, idx, targ);
                    }, targ);
        break;

        case "collect":
        case "map":
            return	ITERATOR.call(this, function(elem, idx, targ, acc) {
                        acc[idx] = fn.call(scope, elem, idx, targ);
                        return acc;
                    }, targ, []);
        break;

		//  ##select, ##filter
		//
		//  Return array of values which match iterator. Opposite of #reject.
		//
        case "select":
        case "filter":
            return	ITERATOR.call(this, function(elem, idx, targ, acc) {
                        fn.call(scope, elem, idx, targ) && acc.push(elem);
                        return acc;
                    }, targ, []);
        break;

		//  ##reject
		//
		//  Return array of values which do *not* match iterator. Opposite of #filter.
		//
   		case "reject":
   			return ITERATOR.call(this, function(elem, idx, targ, acc) {
				!fn.call(scope, elem, idx, targ) && acc.push(elem);
				return acc;
			}, targ, []);
    	break;

        case "all":
        case "every":
            return 	ITERATOR.call(this, function(elem, idx, targ, acc) {
                        fn.call(scope, elem, idx, targ) && acc.push(1);
                        return acc;
                    }, targ, []).length === targ.length;
        break;

        case "any":
        case "some":
            return	ITERATOR.call(this, function(elem, idx, targ, acc) {
                        fn.call(scope, elem, idx, targ) && acc.push(1);
                        return acc;
                    }, targ, []).length > 0;
        break;

        case "indexOf":
            var off	= arg2 || 0;
            var len = targ.length;
            while(off < len) {
                if(targ[off] === fn) {
                    return off;
                }
                ++off;
            }
            return -1;

        break;

        case "lastIndexOf":
            return  $.indexOf($.copy(targ), fn, arg2);
        break;

        //	Note how the #reduce methods change the argument order passed to the
        //	selective function.
        //
        //	All others	: (element, index, target)
        //	#reduce		: (accumulator, element, index, target)
        //	(or)		: (initial or previous value, current value, index, target)
        //
        //	@see	https://developer.mozilla.org/en/JavaScript/Reference/Global_Objects/Array/Reduce
        //
        case "foldl":
        case "reduce":
            var offset 	= !arg2 ? 1 : 0;
            return	ITERATOR.call(this, function(elem, idx, targ, acc) {
                        return targ[idx + offset]
                                ? fn.call(scope, acc, targ[idx + offset], idx + offset, targ)
                                : acc;
                    }, targ, arg2 || targ[0]);
        break;

        case "foldr":
        case "reduceRight":
            targ 	= $.copy(targ).reverse();
            return 	ARRAY_METHOD.call(this, "reduce", targ, fn, arg2);
        break;
    }
};

//  @see    #argsToArray
//
var ARGS_TO_ARRAY = function(args, offset, end) {
    return AP_SLICE.call(args, offset || 0, end);
};

//	The constructor, used whenever a new Object is needed.
//
//	@constructor
//
var	Terrace = function() {
	//	Subject tracking.
	//
	//	@see		#sub
	//
	this.$		=	[];
	this.$$		= 	[];

	//	Determine the working path of this file in cases where Terrace is being executed
	//	within the browser scope (ie. via a <script> include).
	//
   	var path;
	if(DOCUMENT) {
		var s 	= DOCUMENT.getElementsByTagName("script");
		var k 	= "/terrace";
		var i	= s.length;
		var n;

		while(i--) {
			n = s[i].getAttribute("src");
			if(n && n.indexOf(k) > -1) {
				path = n.split(k)[0];
			}
		}

		//	If we didn't find the Terrace, work off a relative path for modules, and assume
		//	that Terrace was introduced by some other means.
		//
		if(path === false) {
			path = k;
		}
	} else {
		path = __dirname;
	}

	//	Note the trailing slash is always added
	//
	path += "/";

	//	Each Object has a namespace, which is used by various methods. You should not directly
	//	write to this space. You should use the accessor methods, #get and #set.
	//
	this.$n = {

		id			: '',
		path		: path,
		parent		: this,
		isKit		: false,

		//	@see	#advise
		//
		advice		: [],

		//  @see    #ACCESS
		//
		store       : {},

		//  @see    #onChange
		//	@see	#executeChangeBindings
		//
		onChange    	: [],
		changesQueued	: [],

		//	Stores references to the names of extensions
		//
		//	@see		#extend
		//
		extensions	: {},

		currTransaction		: false,
		serialTransaction	: false,

		lastMethodId		: null,
		lastMethodName		: "",

		//	Stores any calls which have had their execution queued.
		//
		//	@see 		#queue
		//	@see		#runQueue
		//	@see		#extend
		//
		Q 	: {}
	};
};

Terrace.prototype = new function() {

	/*******************************************************************************************
	 *	These are methods which are available to Object but which return non-chainable results.
	 *	Here is where you put utility methods, with concrete results that would likely be final.
	 *******************************************************************************************/

	//	##document
	//
	this.document = function() {
		return DOCUMENT;
	};

	//	##noop
	//
	this.noop	= function() {};

	//  ##identity
	//
	this.identity = function(a) {
	    return a;
	};

	//	##uuid
	//
	//	From Math.uuid.js (v1.4)
	//	http://www.broofa.com
	//	mailto:robert@broofa.com
	//
	//	Copyright (c) 2010 Robert Kieffer
	//	Dual licensed under the MIT and GPL licenses.
	//
	this.uuid	= function() {
		var chars 	= '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'.split('');
		var	uuid 	= new Array(36);
		var	rnd		= 0;
		var	r;
		var i;

		for(i = 0; i < 36; i++) {
			if(i==8 || i==13 ||  i==18 || i==23) {
				uuid[i] = '-';
			} else if(i==14) {
				uuid[i] = '4';
			} else {
				if(rnd <= 0x02) rnd = 0x2000000 + (Math.random()*0x1000000)|0;
				r = rnd & 0xf;
				rnd = rnd >> 4;
				uuid[i] = chars[(i == 19) ? (r & 0x3) | 0x8 : r];
			}
		}
		return uuid.join('');
	};

	//	##argsToArray
	//
	this.argsToArray = ARGS_TO_ARRAY;

	//	##options
	//
	//	Accessor for #OPTIONS object.
	//	If *no* arguments passed, entire #OPTIONS object returned.
	//
	//	@param	{String}	[k]	The key in #OPTIONS to return.
	//	@param	{Mixed}		[v]	If passed, set #k to #v.
	//
	this.options	= function(k, v) {

		if(v !== void 0) {
			OPTIONS[k] = v;
		}

		return arguments.length ? OPTIONS[k] : OPTIONS;
	};

	// 	##is
	//
	//	@param		{Mixed}		type		An object type.
	// 	@param		{Mixed}		val			The value to check.
	//	@type		{Boolean}
	//
	// Checks whether `val` is of requested `type`.
	//
	this.is = function(type, val) {

		if(!type || val === void 0) {
			return false;
		}

		var p;

		switch(type) {
			case Array:
				return OP_TO_STRING.call(val) === '[object Array]';
			break;

			case Object:
				return OP_TO_STRING.call(val) === '[object Object]';
			break;

			case "numeric":
				return !isNaN(parseFloat(val)) && isFinite(val);
			break;

			case "element":
				return val.nodeType === 1;
			break;

			case "emptyObject":
				for(p in val) {
					return false;
				}
				return true;
			break;

			default:
				return val.constructor === type;
			break;
		}
	};

	// 	##copy
	//
	//	Returns a copy of the sent object.
	//
	//	It is recommended that you use a shallow copy for true objects (do not send @deep).
	//
	//	An effort is made to protect all possible values, but scope (closures) *cannot*
	//	be preserved, for instance. There is checking for circular references, and if one
	//	is found, the *original* object is returned as is.
	//
	// 	@param		{Object}		[o]		The object to copy.
	//	@param		{String}		[deep]	Whether to do deep copy.
	//										Default is shallow.
	//
    this.copy = function(o, deep) {

        var map		= {};

        var cp = function(ob) {
            var json = window.JSON;
            var fin;
            var p;
            var t;

            if(typeof ob !== STR_OBJECT || ob === null || ob.$n) {
                return ob;
            }

			if(ob instanceof Array) {
				if(!deep) {
					return ob.slice(0);
				}

				fin = [];
				p 	= ob.length;

				while(p--) {
					fin[p] = !deep ? ob[p] : cp(ob[p], deep);
				}

				return fin;
			}

			if(ob instanceof Date) {
				return new Date().setTime(ob.getTime());
			}

        	if(ob instanceof RegExp) {
        		return new RegExp(ob.source);
        	}

			//	DOM nodes. Note that @deep is still in play.
			//
			if(ob.nodeType && typeof ob.cloneNode === STR_FUNCTION) {
				return ob.cloneNode(deep);
			}

			if(deep) {
				if(json) {
					try {
						return json.parse(json.stringify(ob));
					} catch(e) {
						//	Somehow unparseable. Maybe circular ref?
						//
						return ob;
					}
				} else {
					fin = $.noop;
					fin.prototype = ob;
					fin = new fin;

					for(p in ob) {
						if(ob.hasOwnProperty(p)) {
							t = ob[p];
							if(!map[t]) {
								if(typeof t === STR_OBJECT) {
									map[t] = 1;
								}
								fin[p] = cp(t, deep);
							} else {
								//	We've found a circular reference. Exit, returning original.
								//
								fin = ob;
								break;
							}
						}
					}
					return fin;
				}
			} else {
				for(p in ob) {
					map[p] = ob[p];
				}
				return map;
			}
        }
        return cp(o, deep);
    };

	//	##nextId
	//
	//  Simply a counter. You're safe until about +/- 9007199254740992
	//
	this.nextId = function(pref) {
		return (pref || "") + ++ID_COUNTER;
	};

	/*******************************************************************************************
	 *	These methods are internal AND chainable.
	 *******************************************************************************************/

	//	##spawn
	//
	//	Creates a nearly exact copy of this Object, with the main
	//	difference being that this Object namespace is not replicated,
	//	allowing new instance to maintain its own information.
	//
	//	@param		{Mixed}		[init]	Initialization object. If has property #sub then
	//									#sub becomes Subject. All other members are
	//									run through #set(prop, value);
	//
	this.spawn 	= function(init) {

		var n	= new Terrace;

		//	Need to beget all the extensions to this Object.
		//
		var	x 	= this.$n.extensions;
		var sub	= this.$;
		var	e;

		//	Extend the copy with Object extensions.
		//
		//	@see		#extend
		//
		for(e in x) {
			n.extend(e, x[e][0], x[e][1]);
		}

		//	Add any parent/child info.  Note that each Object gets a unique id.
		//
		n.$n.id 	= $.nextId();
		n.$n.parent	= this;

		//	Either array or object...
		//
		if(typeof init === STR_OBJECT) {
			sub = init.sub || sub;
			delete init.sub;

			for(e in init) {
				n.set(e, init[e]);
			}
		}

		n.sub(sub);

		return n;
	};

	//	##clone
	//
	//	This returns a clone of Object (that is, a Terrace Object, not any old object).
	//
	//	@param	{Boolean}	reference	Whether to maintain reference to original values.
	//
	//	@see	#copy
	//
	this.clone	= function(reference) {
		var s 	= this.spawn();
		var p;

		//	Default behavior is to (deep) copy $n values.
		//	If by reference, want the same value.
		//
		reference = reference ? $.identity : $.copy;

		for(p in this.$n) {
			s.$n[p] = reference(this.$n[p], 1);
		}

		//	This has to stay unique.
		//
		s.$n.id = $.nextId();

		return s;
	};

	//	##extend
	//
	//	Adds a chainable method to Object.
	//
	//	@param	{Mixed}		methodName	The name of the function extending Object. If you would
	//									like to send a map of extensions, send an object in
	//									this form:
	//									{
	//										meth1 : function,
	//										meth2 : function
	//									}
	//										OR:
	//									{
	//										meth1 : [function, [opts]],
	//										meth2 : [function, [opts]...]
	//									}
	//									NOTE: if no #opts are sent within method array args,
	//									the #opts argument of #extend itself will be used,
	//									if any. That is, you can override any #extend@opts
	//									on a per-method basis.
	//
	//	@param	{Function}	[fn]		The function to extend Object with.
	//	@param	{Object}	[opts]		A map of options.
	//
	//	RE: opts
	//		@param	{Boolean}	[returnValue]	Default is to create a $returnValue alias
	//											of the method, which is probably what you
	//											want. If you want to nix creation of those
	//											$ methods, set this to false.
	//
	this.extend	= function(methodName, fn, opts) {

		//	Whether or not method result should be stored as Subject and not returned, or
		//	returned as is (without setting as Subject).
		//
		var returnAsValue = false;

		var x;
		var mx;

		opts = opts || {};

		//	Handle a group of methods.
		//
		if($.is(Object, methodName)) {

			if($.is(Object, fn)) {
				opts = fn;
			}

			for(x in methodName) {
				mx = methodName[x];
				if(typeof mx === STR_FUNCTION) {
					this.extend(x, mx, opts);
				} else {
					this.extend(x, mx[0], mx[1] || opts);
				}
			}
			return this;
		}

		//	Cannot use `$` at first character of method name.
		//
		if(methodName.charAt(0) === "$" || methodName.length < 2) {
			throw $.error("Method names cannot begin with `$`, and must be at least 2 characters long. Received: " + methodName);
		}

		//	Note how in the following two operations any existing extensions
        //	with the sent name within Object will be be overwritten. This allows
        //	overriding parent Object methods (similar to js prototype chain),
        //	which allows a kind of polymorphism.  OTOH, this may not be
        //	so neat if you don't want methods to be overwritten...
        //
		var wrappedF = function() {
			var args = ARGS_TO_ARRAY(arguments);

            //	If we are waiting for requirements, store subsequent method
            //	requests, until we have all requirements.  We also need to not
            //	queue `require` itself, and of course, `queue`...
            //
            if((methodName !== 'require' && methodName !== 'queue') && KITS.__r.length) {

            	//	#queue allows flexible arguments length, since we expect to
            	//	be receiving method arguments.
            	//
				$.queue.apply(this, ['__require', methodName].concat(args));
            	return this;
            }

			var methodId		= $.nextId();
			var ns				= this.$n;

			//  Advice is set on root Object (Terrace), and is common to all spawned Objects.
			//
			var advice			= $.$n.advice;
            var postAdvice;

			ns.lastMethodName 	= methodName;
			ns.lastMethodId		= methodId;

            //  If there is advice, run through it, and if any advice returns a value
            //  (anything truthy) immediately return that. Otherwise, continue.
            //
			if(advice.length) {
				var rv;
				var r;
				var i;
				for(i=0; i < advice.length; i++) {
					r = advice[i]({
						$this		: this,
						args		: args,
						methodName	: methodName,
						methodId	: methodId
					});
					rv = rv || r;
				};

				//  When advice sends back a function it is understood to be
				//  post-advice, to be run after execution of method. See below.
				//  Any truthy value will terminate execution immediately.
				//  Otherwise, main method runs as normal.
				//
				if(typeof rv === STR_FUNCTION) {
				    postAdvice = rv;
				} else if(rv) {
					return rv;
				}
			};

			//	Execute the requested method within scope of this module collection.
			//
			var result 	= fn.apply(this, args);

			if(postAdvice) {
			    result = postAdvice.call(this, result);
			}

            //  Generally, a method prefixed by `$` was called.
            //  See below.
            //
			if(returnAsValue) {
				return result;
			}

			//	Undefined results always return Object.
			//
			if(result === void 0) {
				return this;
			}

            //  If we get back an instance of Object, always return that.
            //  NOTE: duck typing, but should be ok, given depth -> $n.Q
            //
            if($.is(Object, result) && result.$n && result.$n.Q) {
                return result;
            }

			// 	The Subject will receive a new value. In order to permit
            // 	#restore, we want to store the current value in Object.$$.
            //
            this.$$ = this.$;
			this.$	= result;

			return this;
		};

		//	Register the extensions for this Object. This registry is relevant when
		//	we want to #spawn.
		//
        if(this.$n) {
        	this.$n.extensions[methodName] = [fn, opts];
        }

		//	Assign the method to this Object. We rewrite #toString as it would now
		//	return the wrapping code and not the function itself. We add a $-prefixed
		//	version, which returns a value directly, instead of updating Subject.
		//
        this[methodName]  			= wrappedF;
        this[methodName].toString 	= function() {
		    return fn.toString();
		};

		//	Default is to provide a method which provides a return value.
		//
		if(opts.returnValue !== false) {
			this["$" + methodName] 		= function() {
				returnAsValue = true;
				var r = wrappedF.apply(this, ARGS_TO_ARRAY(arguments));
				returnAsValue = false;
				return r;
			};
		}

        return this;
	};

    //	##hoist
    //
    //	Creates a method in Terrace prototype, which is immediately inherited by
    //	all current Objects, and will be available to all future objects.
    //	It simply calls #extend on Terrace prototype, and as such accepts the
    //	same arguments as #extend.  Note that there is no checking done on
    //	the method name: you will overwrite existing methods with same name.
   	//	This may or may not be what you want.
    //
    //	@param		{String}		name		The method name.
    //	@param		{Function}		fn			The method.
    //	@param		{Object}		a			Optional argument list.
    //
    //	@see		#extend
    //
    this.hoist = function(n, f, a) {
    	Terrace.prototype.extend(n, f, a);
    	return this;
    };

}	// End Terrace#prototype constructor

/*******************************************************************************************
 *	Creation of main Terrace instance, to be exported.
 *******************************************************************************************/

$ 	= new Terrace();
$H 	= $.hoist;

/*******************************************************************************************
 *	Data accessor methods
 *  @see #ACCESS
 *  @see #FIND
 *******************************************************************************************/

//	##set
//
//	Set #v object at #path location. If no #v is sent, the assumption is that
//	the caller is requesting that the current Subject is to be stored at #path.
//
//	@param	{Mixed}		path	The path to set, ie. "binding.users.235.name". Send a hash of
//								path:val for multiple sets. In case of multiple, second
//								argument (@v) will be treated as @ob argument, and a hash
//								of {path : resolvedValue} form will be returned.
//	@param	{Mixed}		v		The value to set.
//	@param	{Object}	[ob]	The object to set on. If not sent this defaults to this.$n.store.
//
//  Note how after a #set the #executeChangeBindings method of this Object is passed the path,new value.
//
//  @see    #onChange
//	@see	#executeChangeBindings
//
$H("set", function(path, v, ob) {

    var $t	= this;
    var n 	= $t.$n;
    var result;

	if(typeof path === STR_OBJECT) {
		var acc = {};
		var p;
		for(p in path) {
			result = ACCESS(v || n.store, p, path[p]);
			acc[p] = typeof result === STR_FUNCTION ? result() : result;
			$t.executeChangeBindings(p, path[p]);
		}
		return acc;
	}

    if(arguments.length === 1) {
        v = $t.$;
    }

    var result = ACCESS(ob || n.store, path, v);

	result = typeof result === STR_FUNCTION ? result() : result;

	$t.executeChangeBindings(path, result);

    return result;
});

//  ##setIfNone
//
//	Set #v object at #path location if #path does not already exist.
//	Returns false if #path already exists.
//
//  @param  {String}    path    Path to the value object.
//  @param  {Mixed}     [v]     The value to set. If none sent, defaults to Subject.
//  @param  {Object}    [ob]    The object to access. If none set, defaults to $n.store.
//
$H("setIfNone", function(path, v, ob) {

    ob 	= ob || this.$n.store;

    if(ACCESS(ob, path)) {
        return false;
    }

    return this.$set(path, v, ob);
});

//  ##setIfOne
//
//	Set #v object at #path location if #path already exists.
//	Returns false if #path does not already exist.
//
//  @param  {String}    path    Path to the value object.
//  @param  {Mixed}     [v]     The value to set. If none sent, defaults to Subject.
//  @param  {Object}    [ob]    The object to access. If none set, defaults to $n.store.
//
$H("setIfOne", function(path, v, ob) {

    ob 	= ob || this.$n.store;

    if(!ACCESS(ob, path)) {
        return false;
    }

    return this.$set(path, v, ob);
});

//	##unset
//
//	Unsets a value from #ns#store, or sent object.
//
//	TODO: check if what we are unsetting is an array or object or other.
//	Arrays need to be spliced, others can use delete.
//
$H("unset", function(path, obj) {
    var ob		= obj || this.$n.store;
    var props 	= path.split(".");
    var pL 		= props.length;
    var i		= 0;

    //	Simply traverses the data model finding the penultimate node.
    //
    for(; i < pL-1; i++) {
        ob = ob[props[i]];
    }

    delete ob[props[pL-1]];
});

//	##get
//
//	Fetches value at path from #ns#store, or from sent object.
//
//	@param	{Mixed}		path	Either a string path to fetch, or an array of paths. If an
//								array, returns an array of results with result index matching
//								original path index.
//	@param	{Object}	[ob]	The object to access. If none, defaults to $n.store.
//
$H("get", function(path, ob) {
	ob = ob || this.$n.store;

	var result = ob;

	if(typeof path === STR_OBJECT) {
		var p	= path.length;
		while(p--) {
			result 	= ACCESS(ob, path[p]);
			path[p] = typeof result === STR_FUNCTION ? result() : result;
		}
		return path;
	}

	if(!!path) {
		result = ACCESS(ob, path);
	}

    return typeof result === STR_FUNCTION ? result() : result;
});

//	##has
//
//	Returns Boolean indicating if sought node has a non-null value.
//
$H("has", function(path, ob) {
    return ACCESS(ob || this.$n.store, path) !== null;
});

//  ##find
//
//	Returns dot-delimited paths to nodes in an object, as strings.
//
//	@param	{String}	key		The key to check.
//	@param	{Mixed}		val		The sought value of key.
//	@param	{String}	[path]	A base path to start from. Useful to avoid searching the
//								entire tree if we know value is in a given branch.
//	@param	{Object}	[t]		An object to search in. Defaults to $n.store.
//
$H("find", function(key, val, path, t) {
    return FIND(key, val, path, t || this.$n.store);
});

/*******************************************************************************************
 *	Notifications
 *******************************************************************************************/

//	##notify
//
//	Expects either message {String}, or object:
//
//	@param	{String}	[title]	An optional title. This event is published, and may be
//								caught by humanized messaging bits, which may use it.
//	@param	{Number}	[delay]	Milliseconds to hold message for.
//
$H("notify", function(msg, type, ob) {
	ob = ob || {};
	ob = {
		msg		: msg || "??",
		type	: type,
		title	: ob.title	|| "",
		delay	: ob.delay
	}

	$.publish(".notification", ob);

	try {
		console.log(msg);
	} catch(e) {};
});

//	##error
//
//	Essentially an alias for #notify, where the type of "error" is automatically added.
//
//	@param	{String}	[msg]	The error message.
//	@param	{String}	[tit]	The error title.
//
$H("error", function(msg, tit) {
    $.notify(msg, "error", {title: tit || "Error"});
});

/*******************************************************************************************
 *	Asynchronous list methods
 *******************************************************************************************/

//	##asyncEach
//
//	Non-blocking *serial* iteration through an array. Particularly useful if you want
//  to execute an array of blocking functions without blocking the main thread.
//
//	@param	{Function}	fn			The iterator method.
//	@param	{Function{	[finalCb]	A method to call when stack is cleared. Passed the
//									result object.
//	@param	{Array}		[targ]		The array to iterate through. Defaults to Subject.
//
$H("asyncEach", function(fn, finalCb, targ) {
	targ	= targ || ($.is(Array, this.$) ? this.$ : []);
	finalCb	= finalCb || $.noop;

	var	results	= {
		errored	: false,
		last	: null,
		stack	: []
	};
	var $this	= this;
	var len		= targ.length;
	var idx 	= 0;

	//	The iterator function is passed (currentVal, index, resultsObject, next()).
	//  It must call #next to advance through the collection. If the iterator
	//  (immediately) returns false, the chain is terminated and #finalCb is called.
	//  It is ok for the iterator to never call #next (or return false) -- no
	//  side effects. In that case, however, #finalCb will never be called, which may or
	//  may not be what you want.
	//
	var iter = function() {
		if(false === fn.call($this, targ[idx], idx, results, function(err, res) {

			++idx;
			results.errored = results.errored || err;

			//	A undefined result is not stored.
			//
			if(res !== void 0) {
				results.last 	= res;
				results.stack.push(res);
			}

			if(idx < len) {
				$.nextTick(iter);
			} else {
				finalCb.call($this, results);
			}
		})) {
			idx = len;
			finalCb.call($this, results);
			finalCb = $.noop;
		}
	}

	iter();
});

//	##asyncParEach
//
//	Non-blocking *parallel* execution of an array of methods.
//
//	@param	{Function}	fn			The iterator method.
//	@param	{Function{	[finalCb]	A method to call when stack is cleared. Passed the
//									result object.
//	@param	{Array}		[targ]		The array to iterate through. Defaults to Subject.
//
$H("asyncParEach", function(fn, finalCb, targ) {

	targ	= targ || ($.is(Array, this.$) ? this.$ : []);
	finalCb	= finalCb || $.noop;

	var	results	= {
		errored	: false,
		last	: null,
		stack	: []
	};
	var $this	= this;
	var len		= targ.length;
	var idx		= 0;
    var cnt     = 0;

	while(idx < len) {
		fn.call($this, targ[idx], idx, results, function(err, res) {
			results.errored = results.errored || err;
			results.last	= res;

			//	Result set always follows call order, regardless of return order.
			//
			results.stack[idx] = res;

            ++cnt

			if(cnt === len) {
				finalCb.call($this, results);
			}
		});

		++idx;
	}
});

//	##iterate
//
$H("iterate", function(targ, fn, acc) {
	return ITERATOR(fn, targ, acc);
});

//	##arrayToObject
//
//	Converts an array	: ["a", "b", "c"]
//	To					: {"a": 0, "b": 1, "c", 2}
//
//	@param	{Array}		a	An array
//
$H("arrayToObject", function(a) {
	var len = a.length;
	var ob 	= {};

	while(len--) {
		ob[a[len]] = len;
	}

	return ob;
});

//	##objectToArray
//
//	@param	{Object}	o		An object.
//	@param	{Boolean}	[vals]	Normally the returned array is formed by pushing each object
//								property. If #vals is set, the array index === o[prop].
//
$H("objectToArray", function(o, vals) {
	var p;
	var r = [];

	for(p in o) {
		if(vals) {
			r[o[p]] = p;
		} else {
			r.push(p);
		}
	}

	return r;
});

//	##advise
//
//	Request a method to run -pre a chainable method.
//
//	@see	#extend
//
//	@param	{Function}		f		The method.
//
$H("advise", function(f) {
    var x;
    var ad 	= $.$n.advice;
    for(x=0; x < ad.length; x++) {
        if(ad[x] === f) {
            return this;
        }
    }
    ad.push(f);
    return this;
});

//	##unadvise
//
//	Cancel previous advice.
//
//	@see	#advise
//	@see 	#extend
//
//	@param	{Function}		f		The advice method originally sent.
//
$H("unadvise", function(f) {
    var ad 	= $.$n.advice;
    var i	= ad.length;
    while(i--) {
        if(ad[i] === f) {
            break;
        }
    }
});

//	##wait
//
//	Extended timeout. At simplest, will fire callback after given amount of time.
//	Additionally, the caller is sent a control object which can be used to hurry,
//	reset, cancel (etc) the timeout.
//
$H("wait", function(time, cb) {

	if(typeof cb !== STR_FUNCTION) {
		return;
	}

	time = time || $.options("defaultTransactionTimeout");

	var $this	= this;
	var start	= new Date().getTime();
	var tHandle;

	var api = {
		cancel	: function() {
			clearTimeout(tHandle);
		},
		hurry	: function() {
			clearTimeout(tHandle);
			tout();
		},
		reset	: function(newT) {
			time = newT || time;
			clearTimeout(tHandle);
			tHandle = setTimeout(tout, time);
		},
		startTime	: function() {
			return start;
		},
		time	: function() {
			return time;
		}
	}

	var args 	= ARGS_TO_ARRAY(arguments, 2).concat([api]);
	var tout	= function() {
		cb.apply($this, args);
	};

	tHandle = setTimeout(tout, time);

	//	Return a simple api importantly offering a #cancel method for the timeout.
	//
	return api;
});

//	##nextTick
//
//	Node has a more efficient version of setTimeout(func, 0).
//	NOTE the 2nd argument (`0`) is ignored by Node #nextTick.
//
$H("nextTick", function(fn) {
	(DOCUMENT ? setTimeout : process.nextTick)(fn, 0);
});

// 	##sub
//
// 	Creates the Subject for an Object.
//
//	@param 		{Object}		v		Any legal value.
//	@param		{Boolean}		[safe]	Copy the value. Useful if you are worried that the Subject
//										reference (say an array) will be altered elsewhere.
//
$H("sub", function(v, safe) {
	this.$$ = this.$;
    return safe ? $.copy(v, 1) : v;
});

//	##restore
//
//	Whenever the Subject changes the previous Subject is stored
//	in Object.$$.  Here we simply restore that value.  Note that
// 	the current Subject will now be stored in Object.$$, allowing
//	some useful toggling.
//
//	@see		#sub
//	@see		#extend
//
$H('restore', function() {
	return this.$$;
});

//  ##addScript
//
//  Adds any number of scripts to the HEAD of the document.
//
//  @param  {Mixed}     src     May send a single src path, or an array of them.
//  @param  {Function}  [cb]    Called on script loaded. If an array of src's was sent, will
//								be called once after all scripts are loaded.
//  @param  {Object}    [doc]   A DOM document. Default is #DOCUMENT
//
//  @see    #ADD_SCRIPT
//
$H("addScript", function(src, cb, doc) {
    src = $.is(Array, src) ? src : [src];
    var cnt 	= src.length;
    var $this	= this;

    $.each(src, function(s) {
        ADD_SCRIPT(s, function() {
            --cnt;
            if(cnt === 0) {
                cb && cb.call($this);
            }
        }, doc);
    });
});

//	##loadModule
//
//	If working in the DOM, use this as a shortcut for loading modules.
//
//  @param  {String}    src     The location of the module.
//  @param  {Function}  [cb]    Called when loaded.
//  @param  {Objects}   [opts]  Options passed as argument to module initializer.
//
$H("loadModule", function(src, cb, opts) {
	this.addScript(src, function() {
		var m = module.exports.call(this, opts);
		cb && cb.call(this, m);
	});
});

//	##require
//
//	Will accept any number of kit requests, which kits can be passed arguments and
//	callback functions.
//
//	Basic:
//	$.require("dictionary", "router", "uploads");
//
//	With arguments. Here #router receives given argument object:
//	$.require("dictionary", "router", { cache: false }, "uploads")
//
//	With callbacks, arguments, and both:
//	$.require(	"dictionary", function() { console.log('dictionary'); },
//				"router", { cache: false }, function() { console.log('router'); }
//				"uploads")
//
$H("require", function() {

	var args 	= ARGS_TO_ARRAY(arguments);
	var list 	= [];
	var $this	= this;
	var callback;
	var argument;
	var asDep;
	var a;

	//	When we are requiring a dependency #require will receive Boolean `true` as its
	//	first argument.  This information is passed on to #DOMREQUIRE.  The upshot is that
	//	if you want a given module to be initialized prior to any *current* requirements,
	//	pass along this Boolean.
	//
	//	@see	#DOMREQUIRE
	//
	if(args[0] === true) {
		asDep = true;
		args.shift();
	}

	//	Running from tail, accumulating option(objects) and callback(function) and triggering
	//  on kit name(string), unshifting #list to create requirements collection.
	//
	while(a = args.pop()) {
		if(typeof a === STR_STRING) {
			list.unshift([a, argument, callback]);
			callback = argument = null;
		} else if($.is(Object, a)) {
			argument = a;
		} else if(typeof a === STR_FUNCTION) {
			callback = a;
		}
	};

 	//	Because dependencies are added LIFO (vs FIFO for non-deps) we need to reverse
 	//	the load order.
 	//
	if(asDep) {
		list = list.reverse();
	}

	//	Run through kit requests and start the loading process.
	//	When in a Server environment, use the built-in #require method, skipping the
	//	load if alread defined in Terrace (though still calling any sent callback).
	//	Otherwise (client) redirect to #DOMREQUIRE, which also deals with duplicate requests.
	//
	while(a = list.shift()) {
		if(!DOCUMENT) {
			if(!$this[a[0]]) {
				require(__dirname + "/kits/" + a[0]).call($this, a[1]);
			}
			a[2] && a[2].call($this);
		} else {
			DOMREQUIRE(a[0], a[2], a[1], $this, asDep);
		}
	};
});

//	##configure
//
//	Simply a shortcut for adding many k/v's to the #options map.
//
//	@see	#options
//
$H("configure", function(ops) {
	ops = ops || {};
	var p;

	for(p in ops) {
		$.options(p, ops[p]);
	}
});

//	##url
//
//	Parse the parts of a url and return an object. For Nodejs equivalent to calling
//	require("url").parse(url).
//
//	Follows the Nodejs url parse format, which is:
//
//	href: The full URL that was originally parsed. Both the protocol and host are lowercased.
//	Example: 'http://user:pass@host.com:8080/p/a/t/h?query=string#hash'
//
//	protocol: The request protocol, lowercased.
//	Example: 'http:'
//
//	host: The full lowercased host portion of the URL, including port information.
//	Example: 'host.com:8080'
//
//	auth: The authentication information portion of a URL.
//	Example: 'user:pass'
//
//	hostname: Just the lowercased hostname portion of the host.
//	Example: 'host.com'
//
//	port: The port number portion of the host.
//	Example: '8080'
//
//	pathname: The path section of the URL, that comes after the host and before the query, including the initial slash if present.
//	Example: '/p/a/t/h'
//
//	search: The 'query string' portion of the URL, including the leading question mark.
//	Example: '?query=string'
//
//	path: Concatenation of pathname and search.
//	Example: '/p/a/t/h?query=string'
//
//	query: Either the 'params' portion of the query string, or a querystring-parsed object.
//	NOTE:	Querystring parsing option ONLY for Nodejs version
//	Example: 'query=string' or {'query':'string'}
//
//	hash: The 'fragment' portion of the URL including the pound-sign.
//	Example: '#hash'
//
$H("url", function(url, parseQS, sDH) {

	if(!DOCUMENT) {
		return require("url").parse(url, parseQS, sDH);
	}

	url 		= url || window.location.href;
	var m 		= url.match(PARSE_URL);
	var search	= "?" + (m[14] || "");
	var port	= m[10];

	return {
		href		: m[0],
		protocol	: m[2],
		host		: m[8] + (port ? ":" + port : ""),
		auth		: m[5] + ":" + m[7],
		hostname	: m[8],
		port		: port,
		pathname	: m[11],
		search		: search,
		path		: m[11] + search,
		query		: search.replace("?", ""),
		hash		: m[16]
	}
});

//	##addKit
//
//	A kit is a collection of methods in a namespace. If I added a kit like so:
//
//	Terrace.addKit('Geometry', {
//		circle: function() {...},
//		slope:	function() {...},
//	});
//
//	I would now have an interface identified by `Geometry` within an Object, such that
//	this is now possible:
//
//	Terrace
//		.Geometry
//			.circle()
//			.slope()
//			...
//
//	It is important to understand that a kit is a namespace, and as such its Subject is
//	isolated.  Such that:
//
//	Terrace.sub(1);
//	Terrace.Geometry.sub(2);
//
//	Terrace.$			// 1
//	Terrace.Geometry.$	// 2
//
//	Another use for kits is as a simple collection of methods to be mixed into another
//	Object kit. So if you have a kit with useful methods, like a reporting kit, you
//	can add its methods to another kit by calling #addKit:
//
//	this.myKit.addKit(Terrace.reporter)
//
//	@param		{Mixed}		nm			Either a String name for a new kit, or an Object.
//	@param		{Object}	[funcs]		An object containing named functions.
//
$H("addKit", function(nm, funcs) {

	var pro	= Terrace.prototype;
	var f	= $.noop;
	var p;
	var ex;
	var x;

	//	Mixing Object kit, and exiting.
	//
	if($.is(Object, nm)) {
		ex 	= nm.$n.extensions;
		for(x in ex) {
			this.extend(x, ex[x][0], ex[x][1]);
		}
		return this;
	}

	//	Note how kits cannot override existing attributes/methods
	//
	if(this[nm] === void 0) {

		//	Kits exist at the top of the Object chain.  All Objects will
		//	have access to the kit namespace.  Note how we override the
		//	prototype namespace (ns), giving each kit its own.
		//
		//	Note as well that the value of the #advice attribute is passed by
		//	reference from the Terrace #advice attribute, and as such changes to the
		//	advice for Terrace will be reflected in *all* kits.
		//
		f.prototype	= this;
		pro[nm]		= new f;
		pro[nm].$n 	= {
			extensions: [],
			id					: $.nextId(),
			isKit				: nm,
			advice				: $.$n.advice,
			store               : {},

			//  @see    #onChange
			//	@see	#executeChangeBindings
			//
			onChange    	: [],
			changesQueued	: [],

			currTransaction		: false,
			serialTransaction	: false,
			lastMethodId		: null,
			lastMethodName		: "",
			Q					: []
		}

        //	Add requested kit methods. Note that multiple kits can have identically named
        //	methods and that kits can use (most) Object method names.  You are encouraged
        //	to not scatter the same names around, and not to use Object method names, as
        //	much as possible.  This is simply for reasons of readability.
        //
        //	Note as well that if a kit has an #init object map that map will be attached
        //	to kit object get/set map (and then #init is removed).
        //
        //	@see		#PROTECTED_NAMES
        //
        for(p in funcs) {
            if(p === "init") {
            	pro[nm].set(funcs[p]);
            	delete funcs[p];
            } else if(!PROTECTED_NAMES[p]) {
                pro[nm].extend(p, funcs[p]);
            }
        }
	}
});

//	##queue
//
//	Queue Object method calls.  Note that this system only works with Object methods which
//	have been extended (via #extend).
//
//	Internally, queueing happens while #sequence is executing -- any Object methods called
//	while #sequence is active are #queue'd.  These methods are often being passed arguments.
//	Any number of arguments can be passed along to this method, following the required
//	arguments of queue name and method name. These will be passed again when the
//	queued item is called.
//
//	@param		{Mixed}			qn		The queue to add to.
//	@param		{String}		n		The name of the method to queue.
//
//	@see		#require
//	@see 		#queue
//	@see		#runQueue
//	@see		#extend
//
//	@example:	Terrace.queue('myQueue', funcName, valueForA, valueForB)
//
$H('queue', function(qn, n) {

	if($.is(Object, qn)) {
		$.each(qn.items, function(q) {
			q = typeof q === STR_STRING ? [q] : q;
			$.queue.apply(this, [qn.name].concat(q));
		});

		return;
	}
	//	console.log("Q%%% " + n);

    //	Again, note how we are collecting the tail of the arguments object.
    //
   	var args	= ARGS_TO_ARRAY(arguments, 2);
    var ns		= this.$n.Q;
    //	Automatically creates a new queue if none exists, preserving existing.
    //
   	ns[qn] = ns[qn] || [];

   	//	Note that if we are not sent an array, we have either undefined or a
   	//	Function.arguments object.  Both of these other cases are converted to
   	//	arrays.
   	//
   	ns[qn].push([n, args, this]);
});

//	##dequeue
//
//	Removes items from a queue, or clears queue.
//
//	@param		{String}		qn		The name of the queue to work on.
//	@param		{Function}		[fn]	A filter function, which will be passed two arguments
//										representing each queue item (method name, arguments),
//										and causes item removal if it returns true.  If no
//										filter is sent, all queue items are cleared.
//	@see		#queue
//
//
$H('dequeue', function(qn, fn) {

    var ns	= this.$n.Q;
   	var q	= ns[qn] || [];
   	var	n	= q.length;

   	//	Not sent a filter, simply clear queue.
   	//
   	if(qn && (typeof fn !== STR_FUNCTION)) {

   		ns[qn] = [];

   	} else {

   		while(n--) {

   			//	Filtering. If filter function returns true, remove the queue item.
   			//
   			//	q[n][0] === queue[queueName][methodName]
   			//	q[n][1] === queue[queueName][argumentsArray]
   			//
   			if(fn.call(this,q[n][0],q[n][1])) {
   				q.splice(n,1);
   			}
   		}
   	}
});

//	##runQueue
//
//	Executes all queued Object methods in a given queue.
//
//	@param		{String}		qn		The name of the queue.
//	@param		{Boolean}		[keep]	Whether to keep the queue -- default is to
//										delete the queue once run.
//
//	@see		#require
//	@see 		#queue
//	@see		#runQueue
//	@see		#extend
//
$H('runQueue', function(qn, keep) {
    var	ns	= this.$n.Q;
   	var rq	= ns[qn] = ns[qn] || [];
	var	c;

	//	Simply go through the queue and execute the methods, in the proper scope,
	//	applying the stored argument array.
	//
	//	[0]	=== queue[index][methodName]
	//	[1]	=== queue[index][argumentsArray]
	//	[2]	=== queue[index][scope]
	//
	//  Because #methodName may contain a kit method (ie. "string.ucwords") we need to
	//  split and fetch the method name ("ucwords"). Note that the scope ([2]) in this case
	//  will be the kit.
	//
	while(c = rq.shift()) {
		c[2][c[0].split(".").pop()].apply(c[2], c[1]);
	}

	if(!keep) {
		delete ns[qn];
	}
});

//	##branch
//
//	Conditional execution based on a function result.
//
//	@param		{Function}		fn		The decisive function.
//	@param		{Object}		cho		The choice list.  An object which presents functions bound
//										to identifiers representing expected function results.
//
//	If you would like to pass arguments to the function, simply add them in the #branch call.
//
//	@example
//
//			$.branch(	function(a,b) {
//							return a !== b;
//						},
//						{
//							'true': 	f(){...},
//							'false':	f(){...}
//						},
//						'foo', // <- passing arguments to function.
//						'bar');
//
//	Here the conditional will return true, and the truth branch will execute.  Note that you must
//	place quotes around boolean identifiers. Somewhat surprisingly Firefox allows use of unquoted
//	booleans as identifiers, but this excellent behavior is not supported elsewhere.  Note as well
//	that your function can return any value -- it need not be a boolean.  If in the above example
//	you return "ok", any function attached to an "ok" identifier would be executed.
//
$H('branch', function(fn, cho) {

	var r = fn.apply(this, ARGS_TO_ARRAY(arguments, 2));

	//	Note that the executing branch is passed the function result.
	//
	cho[r] && cho[r].call(this, r);
});

//	##within
//
//	Generalized way to execute a function within the scope of an Object. A useful way to
//	have the results of a method executed in another Object scope update the local
//	Object's Subject.
//
//	@param		{Function}		fn			The function to execute.
//	@param		{Mixed}			[t]			An Object.
//
$H('within', function(fn, t) {
	return fn.call(t || this);
});

//	##root
//
//	Reset to main Terrace object (escape a kit scope, for instance).
//
$H('root', function() {
	return $;
});

//	##memoize
//
//	@param		{Function}		f		The function to memoize.
//	@param		{Object}		[scp]	The scope to execute the function within.
//
$H('memoize', function(f, scp) {

	scp		= scp || this;

	var m 	= {};
	var aj	= Array.prototype.join;

	return function() {
		//	Key joins arguments on escape character as delimiter which should be safe.
		//
		var k = aj.call(arguments, "\x1B");
		return m[k] || (m[k] = f.apply(scp, arguments));
	};
});

//	##merge
//
$H('merge', function() {

	var res = {};
	var a	= ARGS_TO_ARRAY(arguments);

	//	If only one argument, we are merging the sent object(s) with Subject.
	//
	if(a.length === 1) {
		a.unshift(this.$);
	}

	$.each(a, function(ob) {
	    $.each(res, function(e, idx, acc) {
			acc[idx] = e;
		}, ob);
	});

	return res;
});

//	##leftTrim
//
//	Removes whitespace from beginning of a string.
//
//	@param		{String}		t		The string to trim.
//
$H('leftTrim',	function(t) {
	t = typeof t === STR_STRING ? t : this.$;
	return t.replace(TRIM_LEFT, "");
});

//	##rightTrim
//
//	Removes whitespace from end of a string.
//
//	@param		{String}		t		The string to trim.
//
$H('rightTrim', function(t) {
	t = typeof t === STR_STRING ? t : this.$;
	return t.replace(TRIM_RIGHT, "");
});

//	##trim
//
//	Removes whitespace from beginning and end of a string.
//
//	@param		{String}		[s]		The string to trim, or Subject.
//
$H('trim',	function(s) {
	s = typeof s === STR_STRING ? s : this.$;
	return 	NATIVE_TRIM
			? s.trim()
			: s.replace(TRIM_LEFT, "").replace(TRIM_RIGHT, "");
});

//  ##after
//
//  Returns a function whose callback will only execute once the function has
//  been called n times.
//
//  @argumentList
//      0   : {Number}      The call instance on which the callback fires.
//      1   : {Function}    The callback to fire
//      [2] : {Object}      A context to fire callback in.
//
//  @example    var confirm = after(notes.length, function() { alert("All notes saved"); })
//              each(notes, function(note) {
//                  note.asyncSave({callback: confirm});
//              });
//
$H('after', function(count, cb, ctxt) {
    return !count ? cb : function() {
        if(!--count) {
            return cb.apply(ctxt, arguments);
        }
    }
});

//  ##bind
//
//  Ensure the execution context of a function.
//
$H('bind', function(f, c) {
    var a = ARGS_TO_ARRAY(arguments, 2);
    return function() {
        return f.apply(c, a.concat(ARGS_TO_ARRAY(arguments)));
    }
});

//  ##bindAll
//
//  Ensures that the execution context of all (or some) of the methods
//  in an object remains the object itself, regardless of the ultimate context
//  within which all (or some) of the object methods are called.
//
//  @argumentList
//      0       : {Object}  The object containing methods to bind.
//      [1..n]  : {String}  Any number of object method names. If none sent, all
//                          object methods are bound.
//
$H('bindAll', function(obj) {;
    var a = ARGS_TO_ARRAY(arguments, 1);
    var f;
    $.each(a.length ? a : $.$objectToArray(obj), function(e, i) {
        f = obj[e];
        typeof f === STR_FUNCTION && (obj[e] = $.$bind(f, obj));
    }, obj);
});

//	##compiledFunction
//
//	Returns a function F which will execute #fbody within the context F is called.
//
//	@param	{String}	fbody	The body of the function to be created.
//
//	@example:	var f = scopedFunction("console.log(foo)");
//				f.apply/call({ foo: "bar" }); // `bar`
//
$H('compiledFunction', function(fbody) {
    return Function(
        "with(this) { return (function(){" + fbody + "})(); };"
    )
});

//	##addToUndoAndExec
//
//	To make a method invocation undoable delegate execution of the method to this.
//
$H('addToUndoAndExec', function(doer, undoer, execScope, args) {

	args = $.is(Array, args) ? $.copy(args) : [];

    var _doer = function() {
        return doer.apply(execScope, args);
    };

	var _undoer = function() {
		return undoer.apply(execScope, args);
	};

	//  When adding, stack must be topped at current index.
	//  (+1 since length is not zero based)
	//
	UNDO_STACK.length = UNDO_INDEX +1;
	UNDO_STACK.push({
		redo    : _doer,
		undo    : _undoer
	})

	if(UNDO_STACK.length > $.options("undoStackHeight")) {
		UNDO_STACK.shift();
	}

	UNDO_INDEX = UNDO_STACK.length -1;

    return _doer();
});

//	##undo
//
$H("undo", function() {
	var command = UNDO_STACK[UNDO_INDEX];
	if(command) {
		command.undo();
		UNDO_INDEX = Math.max(--UNDO_INDEX, 0);

	//	#UNDO_INDEX should never be misaligned. If it is, something has gone terribly
	//	wrong somewhere, Jack.
	//
	} else {
		UNDO_STACK = [];
		UNDO_INDEX = 0;
	}
});

//	##redo
//
$H("redo", function() {
	var command = UNDO_STACK[UNDO_INDEX +1];
	if(command) {
		++UNDO_INDEX;
		command.redo();
	}
});

//	##subscribe
//
//	Watch for the publishing of a named event.
//
//	@param		{Mixed}		chan	The name of channel to listen on. You may send multiple
//									channel names in a space-separated string, eg. "load onEnd".
//	@param		{Function}	fn		Called when event is fired.
//	@param		{Object}	[op]	Options:
//		{Object}	scope 	: 	Scope to fire in;
//		{Boolean}	greedy	: 	Default true. Whether to fire immediately
//								if channel has already been broadcast to.
//		{Boolean}	once	: 	Whether to die once fired.
//		{Boolean}	chained	: 	Subscribers may indicate that they wish to respect a chain of
//								command, where such subscribers will *not* be called if *any*
//								previous subscriber function on a given channel has returned
//								NULL (not falsy -- NULL). Note that on each #publish the
//								chain is reinstated (#broken === false) so null responses
//								only command for the lifespan of individual channel broadcasts.
//
$H('subscribe', function(chan, fn, op) {
	chan = chan.split(" ");
	if(chan.length > 1) {
		$.each(chan, function(c) {
			$.subscribe(c, fn, op)
		});
		return;
	} else {
		chan = chan[0];
	}

    //  Remove duplicates
    //
    $.unsubscribe(chan, function() {
        return this.fn === fn;
    });

	op	= op || {};

   	var scp		= op.scope 	|| this;
   	var grd		= op.greedy === void 0 ? true : op.greedy;
    var p;

	//	This is ultimately the data signature representing an subscriber.
	//
   	var	subscriber	= {
		channel	: chan,
		fn		: fn,
		scope	: scp,
		chained	: !!op.chained,
		once    : op.once
	};

   	//	Automatically create non-existent channels.  Any `chan` sent will be given
   	//	a namespace within which to keep track of its subscribers, without discrimination.
   	//
	var ch = CHANNELS[chan] = CHANNELS[chan] || {
		subscribers	: [],
		broken		: false
	};

   	//	Augment data.
   	//
   	for(p in op) {
   		subscriber[p] = subscriber[p] || op[p];
   	}

   	ch.subscribers.push(subscriber);

    //  Publish immediately to channels which have been published to if the subscriber
    //  is greedy [default].
    //
	//	Some channels will only be published to once. So, some subscribers will want to be
	// 	notified immediately if the event has already fired. An example would be %dom#ready. If
	//	the subscriber request is made after a %dom#ready has already fired, its callback
	// 	will never fire, which is probably not the desired behavior.
	//
	if(grd && PUBLISHED[chan]) {
		PUB(fn, scp, PUBLISHED[chan], subscriber);
	}

	$.publish(".subscribed", subscriber);

	return subscriber;
});

//	#subscribeOnce
//
//	Once notified, the subscriber is removed.
//
$H("subscribeOnce", function(nm, fn, ob) {
	ob = ob || {};
	ob.once = true;
	$.subscribe(nm, fn, ob);
});

//	##adoptSubscribers
//
//	Returns all subscribers for an event as an array, removing those subscribers from
//	the normal subscription system. Each item is an object:
//
//	{ 	ob		:   The subscriber object.
//		publish	:   Alias to #PUB, which is called to eventually fire subscribers.
//                  #publish([data]) to pass data to subscribers.
//	}
//
//	NOTE: This is a very invasive method, and should be used with extreme
//	caution, ideally only with subscribers that you have created, control and
//	fully understand. You are taking responsibility, ultimately, to publish
//	adopted subscribers. If there is no perceived need for publishing after adoption,
//	it is likely that you are using this incorrectly.
//
//	@param	{String}	name	The name of the event subscribed to.
//
$H("adoptSubscribers", function(name) {
	var r = [];
	$.each((CHANNELS[name] || []).subscribers || [], function(s) {
        r.push({
            ob		: s,
            publish	: function(data) {
                PUB(s.fn, s.scope, data, s);
            }
        });
	});

	delete CHANNELS[name];

	return r;
});

//	##unsubscribe
//
//	Ask to be removed from subscribers list for an event.
//
//	@param		{Mixed}		chan	The name of the channel being unsubscribed.  If you pass a
//									Function, it will be assumed that you are passing a filter
//									for *all* subscribed channels.
//
//	@param		{Function}	[fn]	If this is undefined, all subscribers for this event
//									are removed. If subscriber function === fn, the subscriber
//									is removed. Otherwise, the call data for each
//									subscriber is passed to this filter, being removed if
//									filter returns true.  Note that the filter function (the
//									method you have passed as `fn`) will execute in the scope
//									of the subscriber object (this == subscriber object).
//
//	@see		#subscribe
//	@see		#fire
//
$H('unsubscribe', function(chan, fn) {
	var i;
	var ob;

	if(typeof chan === STR_FUNCTION) {
		for(i in CHANNELS) {
			$.unsubscribe(i, chan);
		}
	} else if(CHANNELS[chan]) {
		ob 	= CHANNELS[chan].subscribers;
		i	= ob.length;
		while(i--) {
			if(fn === void 0 || fn === ob[i].fn || fn.call(ob[i]) === true) {
				ob.splice(i,1);
			}
		}
	}
});

$H("getchannels", function() {
    return CHANNELS;
});

//	##publish
//
//	Publishes to a subscriber channel
//
//	@param		{String}		chan	The name of the channel.
//	@param		{Mixed}			[data]	You may pass event data of any type using this parameter.
//										This data will be passed to all subscribers as the second
//										argument to their callbacks.
//	@param		{Function}		[after]	You may pass a method to fire after subscribers have
//										been handled. This method is passed the channel name,
//										@chan, @data, the # of subscribers called, the # of
//										subscribers of this channel.
//
//	@see		#subscribe
//	@see		#unsubscribe
//
$H('publish', function(chan, data, after) {

	var cob         = CHANNELS[chan];
    PUBLISHED[chan] = data = data || {};

	//	If channel is not found and @chan is a regex then try to match. NOTE: all
	//	matches are published.  It is up to the regex to be discriminating.
	//
	if(!cob) {
		if($.is(RegExp, chan)) {
			for(i in CHANNELS) {
				if(i.match(chan)) {
					$.publish(i, data, after);
				}
			}
		}
		return;
	}

	var subs    = cob.subscribers;
	var sTotal  = subs.length;

	//	Reset #broken attribute of channel object, which is used to flag
	//	chain of responsibility breaks when requested.
	//
	//	@see	#subscribe
	//	@see	#PUB
	//
	cob.broken	= false;

	$.each(subs, function(sub) {
		PUB(sub.fn, sub.scope, data, sub);
	});

	after && after(chan, data, called, sTotal - subs.length);
});

//	##publishOnce
//
//	Will remove all subscribers to an event after the event has published.
//
//	@param		{String}		chan	The name of the channel
//	@param		{Mixed}			[data]	You may pass event data of any type using this parameter.
//										This data will be passed to all subscribers as the
//										second argument to their callbacks.
//	@param		{Function}		[after]	You may pass a method to fire after all subscribers
//                                      have fired.
//
$H('publishOnce', function(chan, data, after) {
	var fr = $.publish(chan, data, after);
	$.unsubscribe(chan);
});

//  ##onChange
//
//  Register to be notified when the model is changed.
//
//	@param	{Function}	fn		The method to call on changes.
//	@param	{Object}	[data]	Any optional passthru data you may want to use.
//
//	@see	#executeChangeBindings
//	@see	#clearChangeBinding
//
$H("onChange", function(fn, data) {
    if(typeof fn === STR_FUNCTION) {

		//	If a change member has this identical function remove it, ultimately
		//	replacing with current.
		//
		this.clearChangeBinding(function(c) {
			return c.func === fn;
		});

		this.$n.onChange.push({
			func	: fn,
			data	: data || {}
		});
    }
});

//	##executeChangeBindings
//
//	Execute all the #onChange events for this Object binding. This is mainly used by #set.
//	Bindings are updated whenever #set is used, so this should be directly called only in
//	cases where you've updated the model "by hand" -- which you shouldn't do.
//
//	@param	{String}	The path which was just set on.
//	@param	{Mixed}		The value set.
//
//	@see	#onChange
//	@see	#clearChangeBinding
//
var __ = 0;
$H("executeChangeBindings", function(path, val) {

	var T = this;
	var N = T.$n;

	//	In any given execution loop very many bindings may be changed on an Object.
	//	We run the #onChange handlers on an altered model on #nextTick, allowing
	//	any intra-loop changes to combine prior to calling change handlers.
	//	We store a collection of changes, to be passed to handlers.
	//
	N.changesQueued.push([path, val]);
	if(N.changesQueued.length > 1) {
		return;
	}

	$.nextTick(function() {
		var change  = N.onChange;
		var len     = change.length;
		while(len--) {
			change[len].func.call(T, N.changesQueued, change[len].data);
		}
		N.changesQueued = [];
	});
});

//	##clearChangeBinding
//
//	Remove a binding set via #onChange, or clear all bindings.
//
//	@param	{Func}		[fn]	If a function, lose bindings where fn(change[i]) returns true.
//								If not set, remove *all* bindings.
//
//	@see	#onChange
//	@see	#executeChangeBindings
//
$H("clearChangeBinding", function(fn) {
	var change	= this.$n.onChange;
	var len 	= change.length;

	while(len--) {
		if(!fn || fn(change[len]) === true) {
			change.splice(len, 1);
		}
	}
});

/*******************************************************************************************
 *
 *	INITIALIZATION
 *
 *	Set up of Terrace and misc.
 *
 *******************************************************************************************/

//	We want to support a number of functional methods for arrays.  These operate on Subject.
//
while(ARR_M.length) {
	(function(m) {
		$H(m, function(targ, fn, scope) {
			return ARRAY_METHOD.call(this, m, targ, fn, scope);
		});
	})(ARR_M.pop());
}

//	Adjustment for trim methods.
//
//	See http://forum.jquery.com/topic/faster-jquery-trim.
//	See: http://code.google.com/p/chromium/issues/detail?id=5206
//	This is a fix for browsers which do not recognize &nbsp; as a whitespace character.
//
//	@see		#trim
//	@see		#trimLeft
//	@see		#trimRight
//
if(!/\s/.test("\xA0")) {
	TRIM_LEFT 	= /^[\s\xA0]+/;
	TRIM_RIGHT 	= /[\s\xA0]+$/;
}

//	Global `Terrace` if browser environment, else set Node module.
//
if(DOCUMENT) {
	window.Terrace = $;
	//	Because we accept Node modules, we need to add #module to the window object.
	//
	window.module = {};
} else {
	module.exports = $;
}

//////////////////////////////////////////////////////////////////////////////////////////////////
//																								//
//							For DOM implementations, special events	kit.						//
//                        The goal is to provide some essential DOM event                       //
//                        handlers without requiring additional libraries.                      //
//																								//
//////////////////////////////////////////////////////////////////////////////////////////////////

//	Initialize DOM listeners, if we are in a DOM context.
//
if(DOCUMENT) {(function() {

	var addEvent = function(e, type, fn) {
		if(e.addEventListener) {
			e.addEventListener(type, fn, false);
		} else if(e.attachEvent) {
			e.attachEvent( "on" + type, fn );
		} else {
			e["on" + type] = fn;
		}
	};

	var DCL = "DOMContentLoaded";

	var resizeTimer;

	//	onDOMReady
	//	Copyright (c) 2009 Ryan Morr (ryanmorr.com)
	//	Licensed under the MIT license.
	//
	var ready;
	var timer;

	var onStateChange = function(e) {
		//Mozilla & Opera
		if(e && e.type == DCL) {
			fireDOMReady();
		//Legacy
		} else if(e && e.type == "load") {
			fireDOMReady();
		//Safari & IE
		} else if(document.readyState) {
			if((/loaded|complete/).test(document.readyState)) {
				fireDOMReady();
			//IE, courtesy of Diego Perini (http://javascript.nwbox.com/IEContentLoaded/)
			} else if (!!document.documentElement.doScroll) {
				try {
					ready || document.documentElement.doScroll('left');
				} catch(e) {
					return;
				}
				fireDOMReady();
			}
		}
	};

	var fireDOMReady = function() {
		if(!ready) {
			//Clean up after the DOM is ready
			if(document.removeEventListener) {
				document.removeEventListener(DCL, onStateChange, false);
			}
			document.onreadystatechange = null;
			clearInterval(timer);
			timer = null;
			ready = true;
			$.publish(".ready");
		}
	};

	//	Mozilla & Opera
	//
	if(document.addEventListener)
		document.addEventListener(DCL, onStateChange, false);
	//	IE
	//
	document.onreadystatechange = onStateChange;
	//	Safari & IE
	//
	timer = setInterval(onStateChange, 5);

	//	Note that we throttle this event a bit.
	//
	addEvent(window, "resize", function() {
		if(!resizeTimer) {
			resizeTimer = setTimeout(function() {
				resizeTimer = null;
				$.publish(".resized");
			}, 100);
		}
	});

	addEvent(window, "scroll", function() {
		$.publish(".scrolled");
	});

	$.addKit("dom", {

		ready		: function(fn, op) {
			$.subscribe(".ready", fn, op);
		},

		resized		: function(fn, op) {
			$.subscribe(".resized", fn, op);
		},

		scrolled	: function(fn, op) {
			$.subscribe(".scrolled", fn, op);
		},

		addEvent	: addEvent
	});

})()};	//	End DOM init

return $;

})(); // end exports

