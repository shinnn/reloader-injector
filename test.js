'use strict';

const {createServer} = require('http');
const {promisify} = require('util');

const {Builder, By, until} = require('selenium-webdriver');
const ChromeOptions = require('selenium-webdriver/chrome').Options;
const FirefoxOptions = require('selenium-webdriver/firefox').Options;
const once = require('lodash/once');
const pWaitFor = require('p-wait-for');
const ReloaderInjector = require('.');
const startCase = require('lodash/startCase');
const test = require('tape');

(async () => {
	let reloaderInjector;
	let isLegacy;
	let times;
	let sseRes;

	async function sendData(data, id) {
		const body = `retry:10\nid:${id}\ndata:${data}\n\n`;

		await pWaitFor(() => !!sseRes, {timeout: 2000});

		const res = sseRes;

		sseRes = null;
		res.writeHead(200, {
			'cache-control': 'no-store',
			'content-type': 'text/event-stream',
			'content-length': Buffer.byteLength(body)
		});
		await promisify(res.end.bind(res))(body);
	}

	const server = createServer(({url}, res) => {
		for (const [clientUrl, body] of reloaderInjector.clients) {
			if (url === clientUrl) {
				res.writeHead(200, {
					'content-type': 'application/javascript',
					'content-length': body.length
				});

				res.end(body);
				return;
			}
		}

		if (url.startsWith(reloaderInjector.path)) {
			sseRes = res;
			return;
		}

		if (url.startsWith('/style.css')) {
			const css = Buffer.from(`body{font-size:${times}00px}`);

			res.writeHead(200, {
				'content-type': 'text/css',
				'content-length': css.length
			});

			res.end(css);
			return;
		}

		if (url !== '/favicon.ico') {
			const html = Buffer.from(`<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<title>${times++}</title>
	<link href="/style.css" rel="stylesheet">
</head>
<body></body>
</html>`);

			res.setHeader('content-type', 'text/html');
			res.setHeader('content-length', html.length);
			reloaderInjector[`inject${isLegacy ? 'Legacy' : ''}ScriptTag`](res);
			res.end(html);
			return;
		}

		res.end(Buffer.alloc(0));
	});

	const drivers = new Map((await Promise.all([
		...[].concat(...[process.env.SELENIUM_BROWSER || ['chrome', 'firefox']]).map(async browser => {
			const driver = await new Builder()
			.forBrowser(browser)
			.setChromeOptions(new ChromeOptions().headless())
			.setFirefoxOptions(new FirefoxOptions().headless())
			.build();

			return [startCase((await driver.getCapabilities()).getBrowserName()), driver];
		}),
		promisify(server.listen.bind(server))(3001)
	])).slice(0, -1));
	const cleanup = once(() => {
		for (const driver of drivers.values()) {
			driver.quit();
		}

		server.close();
	});

	test.onFinish(cleanup);

	async function run(t, driver, args, isLegacyTest) {
		reloaderInjector = new ReloaderInjector(...args);
		times = 0;
		isLegacy = isLegacyTest;
		await driver.get('http://127.0.0.1:3001');

		await driver.wait(until.titleIs('0'), 1000);
		await sendData(ReloaderInjector.DOCUMENT_RELOAD_SIGNAL, 'a');
		await driver.wait(until.titleIs('1'), 1000);
		t.pass('should reload the document when it receives a document reload signal.');

		await sendData(ReloaderInjector.CSS_RELOAD_SIGNAL, 'b');
		await driver.wait(until.titleIs('1'), 1000);
		t.pass('should not reload the document when it takes a CSS reload signal.');

		t.equal(
			(await (await driver.findElement(By.css('body'))).getCssValue('font-size')).substring(0, 53),
			'200px',
			'should reload multiple CSS when it takes a CSS reload signal.'
		);

		t.end();
	}

	for (const [browserName, driver] of drivers) {
		if (browserName !== 'Edge' && browserName !== 'Internet Explorer') {
			test(`reloader-client on ${browserName}`, t => run(t, driver, [], false));
		}

		test(`Legacy reloader-client on ${browserName}`, t => run(t, driver, [{url: '/legacy'}], true));
	}

	test('Argument validation', async t => {
		cleanup();

		t.throws(
			() => new ReloaderInjector(new Uint8Array()),
			/^TypeError.*Expected an <Object> to set ReloaderInjector options, but got Uint8Array \[\]\./u,
			'should fail when the argument is not a plain object.'
		);

		t.throws(
			() => new ReloaderInjector({url: -0}),
			/Expected a URL of the resource serving Server-sent events \(<string|URL>\), but got -0 \(number\)\./u,
			'should fail when it takes an invalid `url` option.'
		);

		t.throws(
			() => new ReloaderInjector({}, {}),
			/^RangeError.*Expected 0 or 1 argument \(<Object>\), but got 2 arguments\./u,
			'should fail when it takes too many arguments.'
		);

		t.end();
	});
})();
