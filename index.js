'use strict';

const {createHash} = require('crypto');

const {InsertHtmlContent} = require('insert-html-content');
const inspectWithKind = require('inspect-with-kind');
const isPlainObj = require('is-plain-obj');
const reloaderClient = require('reloader-client');

const DEFAULT_EVENT_SOURCE_URL = '/sse';
const BASE_URL_ONLY_USED_FOR_PATHNAME_EXTRACTION = 'https://localhost:8443';
const clients = new Map([
	[
		'injectScriptTag', {
			fn: reloaderClient,
			attribute: 'type="module"'
		}
	],
	[
		'injectLegacyScriptTag', {
			fn: reloaderClient.legacy,
			attribute: 'async'
		}
	]
]);
const insertOptions = {
	tagName: 'head',
	insertToEnd: true
};

module.exports = class ReloaderInjector {
	constructor(...args) {
		const argLen = args.length;

		if (argLen > 1) {
			const error = new RangeError(`Expected 0 or 1 argument (<Object>), but got ${argLen} arguments.`);
			error.code = 'ERR_TOO_MANY_ARGS';

			throw error;
		}

		const [options = {}] = args;

		if (argLen === 1 && !isPlainObj(options)) {
			throw new TypeError(`Expected an <Object> to set ReloaderInjector options, but got ${
				inspectWithKind(options)
			}.`);
		}

		const {url} = {url: '/sse', ...options};

		Object.defineProperty(this, 'clients', {
			enumerable: true,
			value: new Map()
		});

		for (const [methodName, {fn, attribute}] of clients) {
			const clientBody = Buffer.from(fn(url));
			const clientUrl = `${url.toString()}-${
				createHash('md5').update(clientBody).digest().toString('hex')
			}.js`;

			this.clients.set(new URL(clientUrl, BASE_URL_ONLY_USED_FOR_PATHNAME_EXTRACTION).pathname, clientBody);
			Object.defineProperty(this, methodName, {
				enumerable: true,
				value: new InsertHtmlContent(`<script src="${clientUrl}" integrity="sha512-${
					createHash('sha512').update(clientBody).digest().toString('base64')
				}" ${attribute}></script>`, insertOptions)
			});
		}

		Object.defineProperty(this, 'path', {
			enumerable: true,
			value: new URL(url, BASE_URL_ONLY_USED_FOR_PATHNAME_EXTRACTION).pathname
		});
	}
};

for (const prop of ['DOCUMENT_RELOAD_SIGNAL', 'CSS_RELOAD_SIGNAL']) {
	Object.defineProperty(module.exports, prop, {
		enumerable: true,
		value: reloaderClient[prop]
	});
}

Object.defineProperty(module.exports, 'DEFAULT_EVENT_SOURCE_URL', {
	enumerable: true,
	value: DEFAULT_EVENT_SOURCE_URL
});
