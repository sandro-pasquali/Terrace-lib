"use strict";

(function() {

var	AP_SLICE		= Array.prototype.slice;
var	OP_TO_STRING	= Object.prototype.toString;

//	False in a Node environment
//
var DOCUMENT = typeof document === 'undefined' ? false : document;

var OPTIONS	= {
	defaultTransactionTimeout	: 5000,
	useNativeArrayMethods		: Array.prototype.reduce,
	charset						: "utf-8",

	//	Reject transactions if any transaction methods error.  Rejected methods will not fire
	//	their #end callback, #then, OR #or. They *will* fire their #always method.
	//
	rejectTransOnError			: false
};

//	These are protected method names, which cannot be used by kits.
//
//	@see		#addKit
//
var	PROTECTED_NAMES	= {
	sub		: 1
};

//	@see	#nextId
//
var ID_COUNTER = 1;

//	Array methods to be "normalized" -- See below for how methods using these names are
//	added to Object should they not exist for Arrays in the current interpreter.
//
var ARR_M = ["each", "forEach", "map", "filter", "every", "some", "reduce", "reduceRight", "indexOf", "lastIndexOf"];

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

var EVENTS	= {};

//	This will be assigned the instantiated Terrace Object, below, and returned to exports.
//
var $;

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

//  ##ADD_SCRIPT_FILE
//
//  Adds a <script> to the HEAD of a document.
//
//  @see    #require
//  @see    #addScriptFile
//
var ADD_SCRIPT_FILE = function(src, cb, doc) {
    doc = doc || DOCUMENT;
	var scriptT	= doc.createElement('script');
	var docHead	= doc.getElementsByTagName('script')[0];

	//	Note the setting of async to `true`
	//
	scriptT.type 	= 'text/javascript';
	scriptT.charset	= $.options("charset");
	scriptT.async	= true;
	scriptT.src 	= src;
	scriptT.loaded	= false;

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
	docHead.parentNode.insertBefore(scriptT, docHead);

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

	//	folderWhereThisFileIs/kits/sentName/sentName.js
	//
	var src = $.$n.path + "/kits/" + kitName + "/" + kitName + ".js";

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
			$.each(function(sOb) {

                //  Initialize the module, sending it any arguments, then call any
                //  module initialization callback.
                //
				KITS[sOb.kitName].call($this, sOb.origArgs);
				sOb.cont.call($this, sOb);

				KITS[sOb.kitName] = 1;

				sOb.snode.parentNode.removeChild(sOb.snode);

			}, KITS.__o);

			KITS.__o = [];

			$.runQueue('__require');
		}
	};

    var script = ADD_SCRIPT_FILE(src, function() {
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
//	Note that no checking of target is done, expecting that you send either an
//	array or an object. Error, otherwise.
//
//	@param		{Function}		fn		The selective function.
//	@param		{Object}		[targ]	The object to work against. If not sent
//										the default becomes Subject.
//	@param		{Mixed}			[acc]	An accumulator, which is set to result of selective
//										function on each interation through target.
//	@see	#arrayMethod
//
var	ITERATOR	= function(fn, targ, acc) {

	targ	= targ || this.$;

	var c	= targ.length;
	var n	= 0;

	if($.is(Array, targ)) {
		while(n < c) {
			if(n in targ) {
				acc = fn.call(this, targ[n], n, targ, acc);
			}
			n++;
		}
	} else {
		for(n in targ) {
			if(targ.hasOwnProperty(n)) {
				acc = fn.call(this, targ[n], n, targ, acc);
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
//								"this.is.a.path"
//	@param	{Object}	[val]	If a value is sent, then #ACCESS will set that
//								value to the node at the end of path.
//
var ACCESS	= function(ob, path, val) {

	if(typeof path !== "string") {
		return null;
	}

	var props 	= path ? path.split('.') : [];
	var	pL		= props.length;
	var	i 		= 0;
	var	p;

	// 	Set
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
			p = props[i++];
			ob = ob[p] = (ob[p] instanceof Object) ? ob[p] : {};
		}

		ob[props[i]] = val;

		return val;

	// Get
	//
	} else {
		while(((ob = ob[props[i]]) !== void 0) && ++i < pL) {}
	}

	return ob || null;
};

var FIND 	= function(attr, val, path, t, acc, currAttr) {

	acc	= acc || {
		first	: null,
		last	: null,
		values	: [],
		paths	: []
	};

	var node = !!path ? ACCESS(t, path) : t;
	var p;

	//	This would mean either a true object, or an array.
	//
	if(node instanceof Object) {
		if(val instanceof Function ? val(currAttr, node, attr, path) : node[attr] === val) {

			if(!acc.first) {
				acc.first = node;
			}
			acc.last = node;
			acc.values.push(node);
			acc.paths.push(path);
		}

		for(p in node) {
			FIND(attr, val, path + (path ? "." : "") + p, t, acc, p);
		}
	}

	return acc;
};

//	##PUB
//	Whenever an subscriber method needs to be called.
//
//	@see	#subscribe
//	@see	#fire
//
var PUB = function(fn, scope, data, ob) {
	return fn.call(scope, data, ob);
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
   	var path	= false;
	if(DOCUMENT) {

		var s 	= DOCUMENT.getElementsByTagName("script");
		var k 	= "/terrace.js";
		var i	= s.length;
		var n;

		while(i--) {
			n = s[i].getAttribute("src");
			if(n && n.indexOf(k) > -1) {
				path = n.split(k)[0];
			}
		}

		if(path === "..") {
		    path = "../";
		}

		//	If we didn't find the Terrace, work off a relative path for modules, and assume
		//	that Terrace was introduced by some other means.
		//
		if(path === false) {
			path = "/terrace";
		}
	}

	//	Each Object has a namespace, which is used by various methods. You should not directly
	//	write to this space. You should use the accessor methods, #get and #set.
	//
	this.$n = {

		id			: '',
		path		: path,
		parent		: this,
		children	: [],
		isKit		: false,

		//	@see	#advise
		//
		advice		: [],

		//  @see    #ACCESS
		//
		store       : {},

		//	Stores references to the names of extensions
		//
		//	@see		#extend
		//
		extensions		: {},

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

	//	##arrayMethod
	//
	//	Terrace has several array manipulation methods, such as #each and #map. As they all share
	//	some common functionality, and may be superseded by native array methods, this method is
	//	provided to "normalize" the various Terrace array method calls. It is called by the
	//	appropriate method, defined in the init section at the bottom of this file.
	//
	//	@param		{String}		meth	The array method.
	//	@param		{Function}		fn		The selective function.
	//	@param		{Object}		[targ]	The object to work against. If not sent
	//										the default becomes Subject.
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
	this.arrayMethod = function(meth, fn, targ, arg2) {
		targ 		= targ || this.$;
		var scope	= arg2 || this;

		//	Note that the #useNativeArrayMethods flag is ignored where it is not applicable.
		//
		var nat		= $.options("useNativeArrayMethods") && targ[meth];

		switch(meth) {
			case "each":
			case "forEach":
				return 	nat ? targ.forEach(fn, scope)
						: ITERATOR.call(this, function(elem, idx, targ) {
							fn.call(scope, elem, idx, targ);
						}, targ);
			break;

			case "map":
				return	nat ? targ.map(fn, scope)
						: ITERATOR.call(this, function(elem, idx, targ, acc) {
							acc[idx] = fn.call(scope, elem, idx, targ);
							return acc;
						}, targ, []);
			break;

			case "filter":
				return	nat ? targ.filter(fn, scope)
						: ITERATOR.call(this, function(elem, idx, targ, acc) {
							fn.call(scope, elem, idx, targ) && acc.push(elem);
							return acc;
						}, targ, []);
			break;

			case "every":
				return 	nat ? targ.every(fn, scope)
						: ITERATOR.call(this, function(elem, idx, targ, acc) {
							fn.call(scope, elem, idx, targ) && acc.push(1);
							return acc;
						}, targ, []).length === targ.length;
			break;

			case "some":
				return	nat ? targ.some(fn, scope)
						: ITERATOR.call(this, function(elem, idx, targ, acc) {
							fn.call(scope, elem, idx, targ) && acc.push(1);
							return acc;
						}, targ, []).length > 0;
			break;

			case "indexOf":
				return 1
			break;

			case "lastIndexOf":
				return 1;
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
			case "reduce":
				var offset 	= !arg2 ? 1 : 0;
				return	nat ? targ.reduce(fn, arg2 === void 0 ? false : arg2)
						: ITERATOR.call(this, function(elem, idx, targ, acc) {
							return targ[idx + offset]
									? fn.call(scope, acc, targ[idx + offset], idx + offset, targ)
									: acc;
						}, targ, arg2 || targ[0]);
			break;

			case "reduceRight":
				targ 	= $.copy(targ).reverse();
				return 	$.arrayMethod("reduce", fn, targ, arg2);
			break;
		}
	};

	//	##document
	//
	this.document = function() {
		return DOCUMENT;
	};

	//	##noop
	//
	this.noop	= function() {};

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
	this.argsToArray = function(args, offset, end) {
		 return AP_SLICE.call(args, offset || 0, end);
	};

	//	##functionInstance
	//
	this.functionInstance = function(fbody) {
		return Function(
			"with(this) { return (function(){" + fbody + "})(); };"
		)
	};

	//	##options
	//
	//	Accessor for #OPTIONS object.
	//	If *no* arguments passed, entire #OPTIONS object returned.
	//
	//	@param	{String}	[k]	The key in #OPTIONS to return.
	//	@param	{Mixed}		[v]	If passed, set #k to #v.
	//
	this.options	= function(k, v) {

		var op	=	OPTIONS;

		if(v !== void 0) {
			op[k] = v;
		}

		return arguments.length ? op[k] : op;
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
	//	Returns a copy of the sent object.  Note that we don't copy instances of Terrace
	//  Object, or dom Elements (or non-objects or non-arrays, as those are not passed by
	//  refrerence, making additional copying unnecessary).
	//
	// 	@param		{Object}		[o]		The object to copy.
	//	@param		{String}		[sha]	Whether do do a shallow copy.
	//										Default is not shallow.
	//
    this.copy = function(o, sha) {
        var cp = function(ob) {
            var fin;
            var p;

            if(typeof ob !== "object" || ob === null || ob.$n) {
                return ob;
            }

			if($.is(Array, ob) && sha) {
				return ob.slice(0);
			}

            try {
                fin = new ob.constructor;
            } catch(e) {
                return ob;
            }

            for(p in ob) {
                fin[p] = sha ? ob[p] : cp(ob[p]);
            }

            return fin;
        }

        return cp(o);
    };

	//	##nextId
	//
	//  Simply a counter. You're safe until about +/- 9007199254740992
	//
	this.nextId = function() {
		return ++ID_COUNTER;
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

		//	Give the parent references to its children.
		//
		this.$n.children && this.$n.children.push(n);

		if($.is(Object, init)) {
			sub = init.sub || sub;
			delete init.sub;

			for(e in init) {
				n.set(e, init[e]);
			}
		}

		n.sub(sub);

		return n;
	};

	//	##advise
	//
	//	Request a method to run -pre a chainable method.
	//
	//	@see	#extend
	//
	//	@param	{Function}		f		The method.
	//
	this.advise = function(f) {
		var x;
		var ad 	= $.$n.advice;
		for(x=0; x < ad.length; x++) {
			if(ad[x] === f) {
				return this;
			}
		}
		ad.push(f);
		return this;
	};

	//	##unadvise
	//
	//	Cancel previous advice.
	//
	//	@see	#advise
	//	@see 	#extend
	//
	//	@param	{Function}		f		The advice method originally sent.
	//
	this.unadvise = function(f) {
		var ad 	= $.$n.advice;
		var i	= ad.length;
		while(i--) {
			if(ad[i] === f) {
				break;
			}
		}
	};

	//	##extend
	//
	//	Adds a chainable method to Object.
	//
	//	@param	{String}		methodName	The name of the function extending Object.
	//	@param	{Function}		fn			The function to extend Object with.
	//	@param	{Object}		[opts]		A map of options.
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
			for(x in methodName) {
				mx = methodName[x];
				if($.is(Function, mx)) {
					this.extend(x, mx);
				} else {
					this.extend(x, mx[0], mx[1]);
				}
			}
			return this;
		}

		//	Cannot use `$` at first character of method name.
		//
		if(methodName.charAt(0) === "$" || methodName.length < 2) {
			throw $.error("Method names cannot begin with `$`, and must be at least 2 characters long");
		}

		//	Note how in the following two operations any existing extensions
        //	with the sent name within Object will be be overwritten. This allows
        //	overriding parent Object methods (similar to js prototype chain),
        //	which allows a kind of polymorphism.  OTOH, this may not be
        //	so neat if you don't want methods to be overwritten...
        //
		var wrappedF = function() {

			var args		= $.argsToArray(arguments);

            //	If we are waiting for requirements, store subsequent method
            //	requests, until we have all requirements.  We also need to not
            //	queue `require` itself, and of course, `queue`...
            //
            if(KITS.__r.length && (methodName !== 'require' && methodName !== 'queue')) {

            	//	#queue allows flexible arguments length, since we expect to
            	//	be receiving method arguments.
            	//
				$.queue.apply(this, ['__require', methodName].concat(args));
            	return this;
            }

			var methodId		= $.nextId();
			var ns				= this.$n;
			var advice			= ns.advice;

			ns.lastMethodName 	= methodName;
			ns.lastMethodId		= methodId;

			if(advice.length) {

				var rv;
				var r;

				for(x=0; x < advice.length; x++) {
					r = advice[x]({
						$this		: this,
						args		: args,
						methodName	: methodName,
						methodId	: methodId
					});
					rv = rv || r;
				};

				if(rv) {
					return rv;
				}
			};

			//	Execute the requested method within scope of this module collection.
			//
			var result 	= fn.apply(this, args);

			//	Undefined results always return Object.
			//
			if(result === void 0) {
				return this;
			}

            //  Generally, a method prefixed by `$` was called.
            //  See below.
            //
			if(returnAsValue) {
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

        this[methodName]  			= wrappedF;
        this[methodName].toString 	= function() {
		    return fn.toString();
		};

        this["$" + methodName] 		= function() {
        	returnAsValue = true;
        	var r = wrappedF.apply(this, $.argsToArray(arguments));
        	returnAsValue = false;
        	return r;
        };

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

$ = new Terrace();

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
$.hoist("set", function(path, v, ob) {
    if(arguments.length === 1) {
        v = this.$;
    }

    return ACCESS(ob || this.$n.store, path, v);
});

//  ##setIfNone
//
//	Set #v object at #path location if #path does not already exist. 
//  Returns false if #path exists.
//
//  @param  {String}    path    Path to the value object.
//  @param  {Mixed}     [v]     The value to set. If none sent, defaults to Subject.
//  @param  {Object}    [ob]    The object to access. If none set, defaults to $n.store.
//
$.hoist("setIfNone", function(path, v, ob) {

    ob = ob || this.$n.store;
    var a = ACCESS(ob, path);
    
    //  Exists. 
    //
    if(a) {
        return false;
    }

    if(arguments.length === 1) {
        v = this.$;
    }

    ACCESS(ob, path, v);
    
    return true;
});

//	##unset
//
//	Unsets a value from #ns#store, or sent object.
//
//	If one argument sent assumed to be the path to the item in #ns to unset. If
//	two arguments sent the first argument is assumed to be the object you are searching
//	against, using second argument as path.
//
$.hoist("unset", function(path, obj) {
    var ob		= obj || this.$n.store;
    var props 	= path.split(".");
    var pL 		= props.length;
    var i;

    //	Simply traverses the data model finding the penultimate node.
    //
    for(i=0; i < pL-1; i++) {
        ob = ob[props[i]];
    }

    delete ob[props[pL-1]];
});

//	##get
//
//	Fetches an object from #ns#store, or from sent object.
//
$.hoist("get", function(path, ob) {
    return ACCESS(ob || this.$n.store, path);
});

//  ##find
//
//  Returns a string representation of the path to a value
//
$.hoist("find", function(attr, val, path, t) {
    return FIND(attr, val, path, t || this.$n.store);
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
$.hoist("notify", function(msg, type, ob) {
	ob = ob || {};
	ob = {
		msg		: msg || "??",
		type	: type,
		title	: ob.title	|| "",
		delay	: ob.delay
	}

	$.publish(".notification", ob);
});

//	##error
//
//	Essentially an alias for #notify, where the type of "error" is automatically added.
//
//	@param	{String}	[msg]	The error message.
//	@param	{String}	[tit]	The error title.
//
$.hoist("error", function(msg, tit) {
    $.notify(msg, "error", {title: tit || "Error"});
});

/*******************************************************************************************
 *	Asynchronous list methods
 *******************************************************************************************/

//	##asyncEach
//
//	Non-blocking *serial* iteration through an array of methods.
//
//	@param	{Function}	fn			The iterator method.
//	@param	{Function{	[finalCb]	A method to call when stack is cleared. Passed the
//									result object.
//	@param	{Array}		[targ]		The array to iterate through. Defaults to Subject.
//
$.hoist("asyncEach", function(fn, finalCb, targ) {
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

	//	Call the sent iterator method for each member of #targ. If #iterator returns
	//	false (not falsy...===false) push #idx to #len, terminating further iteration.
	//	Otherwise, update the #results object. Ultimately, fire #finalCb.
	//
	var iter = function() {
		if(false === fn.call($this, targ[idx], idx, results, function(err, res) {

			++idx;

			results.errored = results.errored || err;
			results.last 	= res;
			results.stack.push(res);

			if(idx < len) {
				$.nextTick(iter);
			} else {
				finalCb.call($this, results);
			}
		})) {
			idx = len;
			finalCb.call($this, results);
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
$.hoist("asyncParEach", function(fn, finalCb, targ) {

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
		fn.call($this, targ[idx], idx, results, function(err, res, ridx) {

			results.errored = results.errored || err;
			results.last	= res;

			if(ridx !== void 0) {
			    results.stack[ridx] = res;
			} else {
			    results.stack.push(res);
			}

            ++cnt

			if(cnt === len) {
				finalCb.call($this, results);
			}
		});

		++idx;
	}
});

/*******************************************************************************************
 *	Type manipulation
 *******************************************************************************************/

//	##arrayToObject
//
//	Converts an array	: ["a", "b", "c"]
//	To					: {"a": 0, "b": 1, "c", 2}
//
//	@param	{Array}		a	An array
//
$.hoist("arrayToObject", function(a) {
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
$.hoist("objectToArray", function(o, vals) {
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

//	##wait
//
//	Extended timeout. At simplest, will fire callback after given amount of time.
//	Additionally, the caller is sent a control object which can be used to hurry,
//	reset, cancel (etc) the timeout.
//
$.hoist("wait", function(time, cb) {

	if(!$.is(Function, cb)) {
		return;
	}

	time = time || $.options("defaultTransactionTimeout");

	var $this	= this;
	var start	= new Date().getTime();
	var args 	= $.argsToArray(arguments, 2);
	var tout	= function() {
		cb.apply($this, args);
	};

	var tHandle = setTimeout(tout, time);

	//	Return a simple api importantly offering a #cancel method for the timeout.
	//
	return {
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
	};
});

//	##nextTick
//
//	Node has a more efficient version of setTimeout(func, 0).
//	NOTE the 2nd argument (`0`) is ignored by Node #nextTick.
//
$.hoist("nextTick", function(fn) {
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
$.hoist("sub", function(v, safe) {
	this.$$ = this.$;
    return safe ? $.copy(v) : v;
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
$.hoist('restore', function() {
	return this.$$;
});

//  ##addScriptFile
//
//  Adds any number of scripts to the HEAD of the document.
//
//  @param  {Mixed}     src     May send a single src path, or an array of them.
//  @param  {Function}  cb      Called on load.
//  @param  {Object}    [doc]   A DOM document. Default is #DOCUMENT
//
//  @see    #ADD_SCRIPT_FILE
//
$.hoist("addScriptFile", function(src, cb, doc) {
    src = $.is(Array, src) ? src : src;
    var cnt = src.length;

    $.each(function(s) {
        ADD_SCRIPT_FILE(s, function() {
            --cnt;
            if(cnt === 0) {
                cb();
            }
        }, doc);
    }, src);
});

//	##require
//
//	Will accept any number of dependency requests, dependencies can be passed arguments and
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
$.hoist("require", function() {

	var args 	= $.argsToArray(arguments);
	var list 	= [];
	var $this	= this;
	var callback;
	var argument;
	var asDep;

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

	var w = args.length;
	var a;
	var b;

	//	Running from tail, accumulating and triggering on String (ie. kit name).
	//
	while(w--) {
		a = args[w];
		if($.is(String, a)) {
			list.unshift([a, argument, callback]);
			callback = argument = null;
		} else if($.is(Object, a)) {
			argument = a;
		} else if($.is(Function, a)) {
			callback = a;
		}
	};

 	//	Because dependencies are added LIFO (vs FIFO for non-deps) we need to reverse
 	//	the load order.
 	//
	if(asDep) {
		list = list.reverse();
	}

	for(w=0; w < list.length; w++) {
		b = list[w]
		if(!DOCUMENT) {
			require(__dirname + "/kits/" + b[0]).call($this, b[1]);
			b[2] && b[2].call($this);
		} else {
			DOMREQUIRE(b[0], b[2], b[1], $this, asDep);
		}
	};
});

//	##configure
//
$.hoist("configure", function(ops) {
	ops = ops || {};
	var p;

	for(p in ops) {
		$.options(p, ops[p]);
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
//	@param		{Mixed}		nm			Either a String name for a new kit, or a kit Object.
//	@param		{Object}	[funcs]		An object containing named functions.
//
$.hoist("addKit", function(nm, funcs) {

	var pro	= Terrace.prototype;
	var f	= function() {};
	var p;
	var ex;
	var x;

	//	Mixing Object kit, and exiting.  NOTE that no checking is done, and will
	//	error if was sent a general object.
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
		//	prototype namespace (ns), giving each kit its own. Note as well that
		//	this kit namespace does not include either #children or #parent attribute.
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
			currTransaction		: false,
			serialTransaction	: false,
			lastMethodId		: null,
			lastMethodName		: "",
			Q					: []
		}
	}

	//	Add requested kit methods. Note that multiple kits can have identically named
	//	methods and that kits can use (most) Object method names.  You are encouraged
	//	to not scatter the same names around, and not to use Object method names, as
	//	much as possible.  This is simply for reasons of readability.
	//
	//	@see		#PROTECTED_NAMES
	//
	for(p in funcs) {
		if(!PROTECTED_NAMES[p]) {
			pro[nm].extend(p, funcs[p]);
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
$.hoist('queue', function(qn, n) {

	if($.is(Object, qn)) {
		$.each(function(q) {
			q = $.is(String, q) ? [q] : q;
			$.queue.apply(this, [qn.name].concat(q));
		}, qn.items);

		return;
	}

	//	console.log("Q%%% " + n);

    //	Again, note how we are collecting the tail of the arguments object.
    //
   	var args	= $.argsToArray(arguments, 2);
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
$.hoist('dequeue', function(qn, fn) {

    var ns	= this.$n.Q;
   	var q	= ns[qn] || [];
   	var	n	= q.length;

   	//	Not sent a filter, simply clear queue.
   	//
   	if(qn && !$.is(Function, fn)) {

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
//	@param		{String}		qn			The name of the queue.
//	@param		{Boolean}		[kee]		Whether to keep the queue -- default is to
//											delete the queue once run.
//
//	@see		#require
//	@see 		#queue
//	@see		#runQueue
//	@see		#extend
//
$.hoist('runQueue', function(qn, keep) {

    var	ns	= this.$n.Q;
   	var rq	= ns[qn] = ns[qn] || [];
	var	c;
	var ff;
	var ms;
	var i;

	//	Simply go through the queue and execute the methods, in the proper scope,
	//	applying the stored argument array.
	//
	//	rq[c][0]	=== queue[index][methodName]
	//	rq[c][1]	=== queue[index][argumentsArray]
	//	rq[c][2]	=== queue[index][scope]
	//
	//
	//	console.log("Qrun### " + rq[c][0]);
	for(c=0; c < rq.length; c++) {

		//	Because the method name may include a kit prefix (eg. "string.ucwords"), we
		//	need to walk towards the ultimate method we're calling.
		//
		ff = rq[c][2];
		ms = rq[c][0].split(".");

		for(i=0; i < ms.length; i++) {
			ff = ff[ms[i]];
		}

		ff.apply(rq[c][2], rq[c][1]);
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
$.hoist('branch', function(fn, cho) {

	var r	= fn.apply(this, $.argsToArray(arguments, 2));

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
$.hoist('within', function(fn, t) {
	return fn.call(t || this);
});

//	##root
//
//	Reset to main Terrace object (escape a kit scope, for instance).
//
$.hoist('root', function() {
	return $;
});

//	##memoize
//
//	@param		{Function}		f		The function to memoize.
//	@param		{Object}		[scp]	The scope to execute the function within.
//
$.hoist('memoize', function(f, scp) {

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
$.hoist('merge', function() {

	var res = {};
	var a	= $.argsToArray(arguments);

	//	If only one argument, we are merging the sent object with Subject.
	//	NOTE that we copy Subject.
	//
	if(a.length === 1) {
		a.unshift($.copy(this.$));
	}

	$.each(function(ob) {
		res = ITERATOR.call(this, function(e, idx, acc) {
			acc[idx] = e;
		}, res, ob);
	}, a);

	return res;
});

//	##leftTrim
//
//	Removes whitespace from beginning of a string.
//
//	@param		{String}		t		The string to trim.
//
$.hoist('leftTrim',	function(t) {
	return (t || this.$).replace(TRIM_LEFT, "");
});

//	##rightTrim
//
//	Removes whitespace from end of a string.
//
//	@param		{String}		t		The string to trim.
//
$.hoist('rightTrim', function(t) {
	return (t || this.$).replace(TRIM_RIGHT, "");
});

//	##trim
//
//	Removes whitespace from beginning and end of a string.
//
//	@param		{String}		s		The string to trim.
//
$.hoist('trim',	function(s) {
	s = s || this.$;
	return 	NATIVE_TRIM
			? s.trim()
			: s.replace(TRIM_LEFT, "").replace(TRIM_RIGHT, "");
});

//	##subscribe
//
//	Watch for the publishing of a named event.
//
//	@param		{Mixed}		nm		The name of event to listen for. You may send multiple
//									event names in a space-separated string, eg. "load onEnd".
//	@param		{Function}	fn		Called when event is fired.
//	@param		{Object}	[op]	Options:
//										#scope 	: 	Scope to fire in;
//										#greedy	: 	Default true. Whether to fire immediately
//													if event has already fired.
//										#once	: 	Whether to die once fired.
//
$.hoist('subscribe', function(nm, fn, op) {

	nm = nm.split(" ");
	if(nm.length > 1) {
		$.each(function(n) {
			$.subscribe(n, fn, op)
		}, nm);
		return;
	} else {
		nm = nm[0];
	}

	op	= op || {};

   	var scp		= op.scope 	|| this;
   	var grd		= op.greedy === undefined ? true : op.greedy;
    var p;

	//	This is ultimately the data signature representing an subscriber.
	//
   	var	dt	= {
		name	: nm,
		fn		: fn,
		scope	: scp
	};

   	//	Augment data.
   	//
   	for(p in op) {
   		dt[p] = dt[p] || op[p];
   	}

   	//	Automatically create non-existent event handles.  Any `nm` sent will be given
   	//	a namespace within which to keep track of its subscribers, without discrimination.
   	//
	if(!EVENTS[nm]) {
		EVENTS[nm] = {
			subscribers: 	[],
			fired:		false
		};
	}

	//	We have now added an subscriber to be notified when `nm` is is #fire(d).
	//
   	EVENTS[nm].subscribers.push(dt);

	//	Some channels will only be published to once. So, some subscribers will want to be
	// 	notified immediately if the event has already fired. An example would be %dom#ready. If
	//	the subscriber request is made after a %dom#ready has already fired, its callback
	// 	will never fire, which is probably not the desired behavior.  So upon subscription
	// 	request caller can ask for immediate publish.
	//
	if(grd && EVENTS[nm].published) {
		PUB(fn, scp, EVENTS[nm].published, dt);
	}

	$.publish(".subscribed", $.argsToArray(arguments));
});

//	#subscribeOnce
//
//	Once notified, the subscriber is removed.
//
$.hoist("subscribeOnce", function(nm, fn) {
	this.subscribe(nm, fn, {once: true});
});

//	##adoptSubscribers
//
//	Returns all subscribers for an event as an array. Each item is an object:
//	{ 	ob		:   The subscriber object.
//		fired	:   Whether the event has already fired.
//		publish	:   Alias to #PUB, which is called to eventually fire subscribers.
//                  #publish([data]) to pass data to subscribers.
//	}
//
//	NOTE: This is a very invasive method, and should be used with extreme
//	caution, ideally only with subscribers that you have created, control and
//	fully understand. You are taking responsibility, ultimately, to publish to
//	adopted subscribers. If there is no perceived need for publishing after adoption,
//	you are likely using this incorrectly.
//
//	@param	{String}	name	The name of the event subscribed to.
//
$.hoist("adoptSubscribers", function(name) {
	var e = EVENTS[name] || [];
	var r = [];

	$.each(function(s) {
        r.push({
            ob		: s,
            fired	: e.fired,
            publish	: function(data) {
                PUB(s.fn, s.scope, data, s);
            }
        });
	}, e.subscribers || []);

	delete EVENTS[name];

	return r;
});

//	##unsubscribe
//
//	Ask to be removed from subscribers list for an event.
//
//	@param		{Mixed}		nm		The name of the event to unsubscribe.  If you pass a Function,
//									it will be assumed that you are passing a filter for
//									*all* subscribed events.
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
$.hoist('unsubscribe', function(nm, fn) {
	var i;
	var ob;

	if($.is(Function, nm)) {
		for(i in EVENTS) {
			$.unsubscribe(i, nm);
		}
	} else if(EVENTS[nm]) {
		ob 	= EVENTS[nm].subscribers;
		i	= ob.length;
		while(i--) {
			if(fn === void 0 || fn === ob[i].fn || fn.call(ob[i]) === true) {
				ob.splice(i,1);
			}
		}
	}
});

//	##publish
//
//	Publishes to a subscriber channel
//
//	@param		{String}		nm		The name of the channel.
//	@param		{Mixed}			[data]	You may pass event data of any type using this parameter.
//										This data will be passed to all subscribers as the second
//										argument to their callbacks.
//	@param		{Function}		[after]	You may pass a method to fire after subscribers have fired.
//
//	@see		#subscribe
//	@see		#unsubscribe
//
$.hoist('publish', function(nm, data, after) {
	var i;
	var	ob;
	var	obi;
	var	fResult;

	data	= data || {};

	if(!EVENTS[nm]) {
		//	TODO: regexp check NOTE: need to reflect regexp behavior in #unsubscribe as well.
		//
		return;
	}

	$.each(function(e) {

		//	If this subscriber was attached via #subscribeOnce, the #once property will
		//	be set.  Note that, below, we set #fired once an event has occurred.  As
		//	such, we watch for both #once and #fired being set, in which case we
		//	remove the subscriber.
		//
		if(e.once && e.published) {
			$.unsubscribe(nm, function() {
				return this.fn === e.fn;
			});
		} else {

			fResult = PUB(e.fn, e.scope, data, e);

			//	Indicate that this event has fired at least once.  We also store any passed
			//	data here, which is useful should a handler wish to examine previous data
			// 	sent to subscriber.
			//
			//	@see	#subscribe
			//
			e.published	= data;
		}
	}, EVENTS[nm].subscribers);

	if(after) {
		after(data, ob, fResult);
	}
});

//	#publishOnce
//
//	Will remove all subscribers to an event after the event has published.
//
//	@param		{String}		nm		The name of the event.
//	@param		{Mixed}			[data]	You may pass event data of any type using this parameter.
//										This data will be passed to all subscribers as the
//										second argument to their callbacks.
//	@param		{Function}		[after]	You may pass a method to fire after all subscribers
//                                      have fired.
//
$.hoist('publishOnce', function(nm, data, after) {
	var fr = this.publish(nm, data, after);
	this.unsubscribe(nm);
});

/*******************************************************************************************
 *
 *	INITIALIZATION
 *
 *	Set up of Terrace and misc.
 *
 *******************************************************************************************/

//	We want to support a number of functional methods.  These operate on Subject -- to access
//	the result you should read Object.$.  NOTE that it is normal to use these methods against
//	arrays, but if using the NON-native methods, you can use objects.
//
while(ARR_M.length) {
	(function(m) {
		$.hoist(m, function(fn, targ, scope) {
			return $.arrayMethod(m, fn, targ, scope);
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
if($.document()) {(function() {

	var addEvent = function(e, type, fn) {
		if(e.addEventListener) {
			e.addEventListener(type, fn, false);
		} else if(e.attachEvent) {
			e.attachEvent( "on" + type, fn );
		} else {
			e["on"+type] = fn;
		}
	};

	var resizeTimer;

	//	onDOMReady
	//	Copyright (c) 2009 Ryan Morr (ryanmorr.com)
	//	Licensed under the MIT license.
	//
	var ready;
	var timer;

	var onStateChange = function(e) {
		//Mozilla & Opera
		if(e && e.type == "DOMContentLoaded") {
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
			ready = true;

			$.publish(".ready");

			//Clean up after the DOM is ready
			if(document.removeEventListener) {
				document.removeEventListener("DOMContentLoaded", onStateChange, false);
			}
			document.onreadystatechange = null;
			window.onload = null;
			clearInterval(timer);
			timer = null;
		}
	};

	//	Mozilla & Opera
	//
	if(document.addEventListener)
		document.addEventListener("DOMContentLoaded", onStateChange, false);
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


