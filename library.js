'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const nconf = require.main.require('nconf');
const winston = require.main.require('winston');
const db = require.main.require('./src/database');
const meta = require.main.require('./src/meta');
const routeHelpers = require.main.require('./src/routes/helpers');

const plugin = module.exports;

const SETTINGS_KEY = 'altcha';
const CDN_FALLBACK = 'https://cdn.jsdelivr.net/gh/altcha-org/altcha/dist/main/altcha.min.js';
const USED_TTL_MS = 25 * 60 * 60 * 1000; // outlives the max challenge expiry (24h)
const RATE_WINDOW_MS = 10 * 60 * 1000;
const AUTO_VALUES = ['onfocus', 'onload', 'off'];

const FORMS = ['register', 'login', 'reset'];
const FORM_META = [
	{
		id: 'register',
		title: 'Registration',
		note: 'Adds the widget to the /register page and verifies it before an account is created.',
	},
	{
		id: 'login',
		title: 'Login',
		note: 'Adds the widget to the /login page. Legitimate users log in often, so keep the difficulty modest here.',
	},
	{
		id: 'reset',
		title: 'Password reset',
		note: 'Protects the "forgot password" email form. NodeBB sends this request over socket.io, so the plugin wraps the user.reset.send socket method.',
	},
];

const DEFAULTS = {
	enabled: { register: true, login: false, reset: false },
	cost: 2000,
	counterMin: 1000,
	counterMax: 3000,
	expiry: 600,
	auto: 'onfocus',
	rateLimit: 30,
};

/* ---------- altcha-lib (ESM-safe dynamic import) ---------- */

let libPromise;
function loadLib() {
	if (!libPromise) {
		libPromise = Promise.all([
			import('altcha-lib'),
			import('altcha-lib/algorithms/pbkdf2'),
		]).then(([lib, pbkdf2]) => {
			const l = lib.createChallenge ? lib : lib.default;
			const p = pbkdf2.deriveKey ? pbkdf2 : pbkdf2.default;
			return { createChallenge: l.createChallenge, verifySolution: l.verifySolution, deriveKey: p.deriveKey };
		});
	}
	return libPromise;
}

/* ---------- secrets: derived from NodeBB's config.json "secret" ---------- */

function deriveSecret(label) {
	const root = nconf.get('secret');
	if (!root) {
		throw new Error('[altcha] NodeBB "secret" is not set in config.json');
	}
	return crypto.createHmac('sha256', String(root)).update(`nodebb-plugin-altcha:${label}`).digest('hex');
}

function hashIp(ip) {
	return crypto.createHmac('sha256', deriveSecret('ip')).update(String(ip || '')).digest('hex').slice(0, 32);
}

/* ---------- settings ---------- */

const toInt = (v, def, min, max) => {
	const n = parseInt(v, 10);
	return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

// Only a missing value falls back to the default; an unchecked box is an explicit "off".
const isOn = (v, def) => {
	if (v === undefined || v === null) {
		return def;
	}
	return v === true || v === 1 || ['1', 'true', 'on', 'yes'].includes(String(v).toLowerCase());
};

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

function parseForm(raw, form) {
	const key = k => `${form}${cap(k)}`;
	const pick = (k) => {
		const v = raw[key(k)];
		if (v !== undefined && v !== null && v !== '') {
			return v;
		}
		// settings saved by pre-0.2 versions (single form) feed the registration tab
		return form === 'register' ? raw[k] : undefined;
	};

	const counterMin = toInt(pick('counterMin'), DEFAULTS.counterMin, 1, 1000000);
	const auto = pick('auto');
	return {
		enabled: isOn(raw[key('enabled')], DEFAULTS.enabled[form]),
		cost: toInt(pick('cost'), DEFAULTS.cost, 100, 100000),
		counterMin,
		counterMax: Math.max(counterMin, toInt(pick('counterMax'), DEFAULTS.counterMax, 1, 1000000)),
		expiry: toInt(pick('expiry'), DEFAULTS.expiry, 60, 86400),
		auto: AUTO_VALUES.includes(auto) ? auto : DEFAULTS.auto,
		rateLimit: toInt(pick('rateLimit'), DEFAULTS.rateLimit, 1, 10000),
	};
}

let cache = { at: 0, value: null };
async function getSettings(force) {
	if (!force && cache.value && Date.now() - cache.at < 10000) {
		return cache.value;
	}
	const raw = (await meta.settings.get(SETTINGS_KEY)) || {};
	const value = { scriptUrl: String(raw.scriptUrl || '').trim(), forms: {} };
	FORMS.forEach((form) => {
		value.forms[form] = parseForm(raw, form);
	});
	cache = { at: Date.now(), value };
	return value;
}

plugin.onSettingsSet = function (data) {
	if (data && data.plugin === SETTINGS_KEY) {
		cache = { at: 0, value: null };
	}
};

/* ---------- widget script (self-hosted from the `altcha` npm package) ---------- */

let widgetFile;
function findWidgetFile() {
	if (widgetFile !== undefined) {
		return widgetFile;
	}
	widgetFile = null;
	for (const dir of require.resolve.paths('altcha') || []) {
		const candidate = path.join(dir, 'altcha', 'dist', 'main', 'altcha.min.js');
		if (fs.existsSync(candidate)) {
			widgetFile = candidate;
			break;
		}
	}
	return widgetFile;
}

function resolveScriptUrl(s) {
	if (s.scriptUrl) {
		return s.scriptUrl;
	}
	return findWidgetFile() ? `${nconf.get('relative_path')}/altcha/widget.js` : CDN_FALLBACK;
}

function widgetHandler(req, res) {
	const file = findWidgetFile();
	if (!file) {
		return res.sendStatus(404);
	}
	res.set('Cache-Control', 'public, max-age=86400');
	res.sendFile(file);
}

/* ---------- cluster-wide rate limit (fixed window, shared via the NodeBB database) ---------- */

async function rateLimited(form, ip, limit) {
	try {
		const now = Date.now();
		const bucket = Math.floor(now / RATE_WINDOW_MS);
		const key = `altcha:rl:${form}:${bucket}:${hashIp(ip)}`;
		const count = await db.incrObjectField(key, 'count'); // atomic on redis/mongo/postgres
		if (count === 1) {
			await db.pexpireAt(key, (bucket + 2) * RATE_WINDOW_MS);
		}
		return {
			blocked: count > limit,
			retryAfter: Math.ceil(((bucket + 1) * RATE_WINDOW_MS - now) / 1000),
		};
	} catch (err) {
		// Fail open: a database hiccup shouldn't lock everyone out of registering or logging in.
		winston.warn(`[plugins/altcha] rate limit check failed: ${err.message}`);
		return { blocked: false, retryAfter: 0 };
	}
}

/* ---------- challenge endpoint ---------- */

async function challengeHandler(req, res) {
	try {
		const form = req.params.form;
		if (!FORMS.includes(form)) {
			return res.sendStatus(404);
		}
		const settings = await getSettings();
		const f = settings.forms[form];
		if (!f.enabled) {
			return res.sendStatus(404);
		}

		const limit = await rateLimited(form, req.ip, f.rateLimit);
		if (limit.blocked) {
			res.set('Retry-After', String(limit.retryAfter));
			return res.status(429).json({ error: 'rate-limited' });
		}

		const { createChallenge, deriveKey } = await loadLib();
		const challenge = await createChallenge({
			algorithm: 'PBKDF2/SHA-256',
			cost: f.cost,
			counter: crypto.randomInt(f.counterMin, f.counterMax + 1), // deterministic mode
			deriveKey,
			expiresAt: new Date(Date.now() + f.expiry * 1000),
			// Per-form secrets: a challenge issued for one form can't be redeemed on another.
			hmacSignatureSecret: deriveSecret(`signature:${form}`),
			hmacKeySignatureSecret: deriveSecret(`key-signature:${form}`),
		});
		res.set('Cache-Control', 'no-store');
		res.json(challenge);
	} catch (err) {
		winston.error(`[plugins/altcha] challenge error: ${err.stack || err.message}`);
		res.status(500).json({ error: 'internal-error' });
	}
}

/* ---------- verification (shared by all three forms) ---------- */

function decodePayload(raw) {
	if (typeof raw !== 'string' || !raw || raw.length > 16384) {
		return null;
	}
	try {
		const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
		const payload = JSON.parse(text);
		if (payload && typeof payload === 'object' && payload.challenge && payload.solution) {
			return payload;
		}
	} catch (err) {
		// fall through
	}
	return null;
}

// One-time use: atomic increment works across NodeBB cluster processes.
async function consumeChallenge(challenge) {
	const sig = challenge && challenge.signature;
	if (typeof sig !== 'string' || !/^[a-f0-9]{32,256}$/i.test(sig)) {
		return false;
	}
	const key = `altcha:used:${sig.toLowerCase()}`;
	const uses = await db.incrObjectField(key, 'uses');
	if (uses !== 1) {
		return false;
	}
	await db.pexpireAt(key, Date.now() + USED_TTL_MS);
	return true;
}

function formError(code, form) {
	const which = FORMS.includes(form) ? form : 'register';
	return new Error(`[[altcha:${code}, [[altcha:form-${which}]]]]`);
}

async function verifyPayload(rawPayload, form) {
	const payload = decodePayload(rawPayload);
	if (!payload) {
		throw formError('error-required', form);
	}

	const { verifySolution, deriveKey } = await loadLib();
	let result;
	try {
		result = await verifySolution({
			challenge: payload.challenge,
			solution: payload.solution,
			deriveKey,
			hmacSignatureSecret: deriveSecret(`signature:${form}`),
			hmacKeySignatureSecret: deriveSecret(`key-signature:${form}`),
		});
	} catch (err) {
		throw formError('error-invalid', form);
	}

	if (result.expired) {
		throw formError('error-expired', form);
	}
	if (!result.verified) {
		throw formError('error-invalid', form);
	}
	// Only record the challenge as used after it verified successfully.
	if (!(await consumeChallenge(payload.challenge))) {
		throw formError('error-used', form);
	}
}

/* ---------- page config (the client script injects the widget) ---------- */

async function addClientConfig(form, data) {
	const settings = await getSettings();
	const f = settings.forms[form];
	if (f.enabled) {
		const target = data.templateData || data;
		target.altcha = {
			form,
			challenge: `${nconf.get('relative_path')}/api/altcha/challenge/${form}`,
			auto: f.auto,
			scriptUrl: resolveScriptUrl(settings),
		};
	}
	return data;
}

plugin.onRegisterBuild = async function (data) {
	return await addClientConfig('register', data);
};
plugin.onLoginBuild = async function (data) {
	return await addClientConfig('login', data);
};
plugin.onResetBuild = async function (data) {
	return await addClientConfig('reset', data);
};

/* ---------- enforcement hooks ---------- */

async function checkForm(form, data) {
	const settings = await getSettings();
	if (!settings.forms[form].enabled) {
		return data;
	}
	await verifyPayload(data.req && data.req.body && data.req.body.altcha, form);
	return data;
}

plugin.checkRegistration = async function (data) {
	return await checkForm('register', data);
};
plugin.checkLogin = async function (data) {
	return await checkForm('login', data);
};

// Password reset: core handles it over socket.io (user.reset.send), which has no filter hook.
let resetPatched = false;
function patchResetSend() {
	let SocketUser = null;
	try {
		SocketUser = require.main.require('./src/socket.io/user');
	} catch (err) {
		// handled below
	}
	const target = SocketUser && SocketUser.reset;
	if (!target || typeof target.send !== 'function') {
		winston.warn('[plugins/altcha] socket method user.reset.send not found; password reset protection is unavailable');
		return false;
	}
	if (target.send.altchaWrapped) {
		return true;
	}

	const original = target.send;
	const wrapped = async function (socket, data) {
		const settings = await getSettings();
		if (!settings.forms.reset.enabled) {
			return await original.call(this, socket, data);
		}
		if (!data || typeof data !== 'object') {
			throw formError('error-required', 'reset');
		}
		await verifyPayload(data.altcha, 'reset');
		return await original.call(this, socket, data.email);
	};
	wrapped.altchaWrapped = true;
	target.send = wrapped;
	return true;
}

/* ---------- ACP ---------- */

async function renderAdmin(req, res) {
	const settings = await getSettings(true);
	res.render('admin/plugins/altcha', {
		title: 'ALTCHA',
		forms: FORM_META.map(m => ({
			...m,
			enabledNum: settings.forms[m.id].enabled ? 1 : 0,
			unavailable: m.id === 'reset' && !resetPatched,
		})),
	});
}

plugin.init = async function ({ router }) {
	routeHelpers.setupAdminPageRoute(router, '/admin/plugins/altcha', [], renderAdmin);
	router.get('/api/altcha/challenge/:form', challengeHandler);
	router.get('/altcha/widget.js', widgetHandler);

	resetPatched = patchResetSend();
	if (!findWidgetFile()) {
		winston.warn('[plugins/altcha] altcha/dist/main/altcha.min.js not found in node_modules; ' +
			'falling back to the CDN. Set a Script URL in the ACP to override.');
	}
};

plugin.addAdminNavigation = async function (header) {
	header.plugins.push({
		route: '/plugins/altcha',
		icon: 'fa-shield-halved',
		name: 'ALTCHA',
	});
	return header;
};
