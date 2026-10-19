'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const nconf = require.main.require('nconf');
const winston = require.main.require('winston');
const validator = require.main.require('validator');
const db = require.main.require('./src/database');
const meta = require.main.require('./src/meta');
const routeHelpers = require.main.require('./src/routes/helpers');

const plugin = module.exports;

const SETTINGS_KEY = 'altcha';
const CDN_FALLBACK = 'https://cdn.jsdelivr.net/gh/altcha-org/altcha/dist/main/altcha.min.js';
const USED_TTL_MS = 25 * 60 * 60 * 1000; // outlives the max challenge expiry (24h)
const RATE_WINDOW_MS = 10 * 60 * 1000;

const DEFAULTS = {
	cost: 2000,
	counterMin: 1000,
	counterMax: 3000,
	expiry: 600,
	auto: 'off',
	rateLimit: 30,
	scriptUrl: '',
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

/* ---------- settings ---------- */

const toInt = (v, def, min, max) => {
	const n = parseInt(v, 10);
	return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

let cache = { at: 0, value: null };
async function getSettings() {
	if (cache.value && Date.now() - cache.at < 10000) {
		return cache.value;
	}
	const raw = (await meta.settings.get(SETTINGS_KEY)) || {};
	const counterMin = toInt(raw.counterMin, DEFAULTS.counterMin, 1, 1000000);
	const value = {
		cost: toInt(raw.cost, DEFAULTS.cost, 100, 100000),
		counterMin,
		counterMax: Math.max(counterMin, toInt(raw.counterMax, DEFAULTS.counterMax, 1, 1000000)),
		expiry: toInt(raw.expiry, DEFAULTS.expiry, 60, 86400),
		auto: ['onfocus', 'onload', 'off'].includes(raw.auto) ? raw.auto : DEFAULTS.auto,
		rateLimit: toInt(raw.rateLimit, DEFAULTS.rateLimit, 1, 10000),
		scriptUrl: String(raw.scriptUrl || '').trim(),
	};
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

/* ---------- per-process rate limit for the challenge endpoint ---------- */

const hits = new Map();
function rateLimited(ip, limit) {
	const now = Date.now();
	if (hits.size > 10000) {
		for (const [k, v] of hits) {
			if (v.resetAt <= now) hits.delete(k);
		}
	}
	const entry = hits.get(ip);
	if (!entry || entry.resetAt <= now) {
		hits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
		return false;
	}
	entry.count += 1;
	return entry.count > limit;
}

/* ---------- challenge endpoint ---------- */

async function challengeHandler(req, res) {
	try {
		const s = await getSettings();
		if (rateLimited(req.ip, s.rateLimit)) {
			res.set('Retry-After', String(RATE_WINDOW_MS / 1000));
			return res.status(429).json({ error: 'rate-limited' });
		}
		const { createChallenge, deriveKey } = await loadLib();
		const challenge = await createChallenge({
			algorithm: 'PBKDF2/SHA-256',
			cost: s.cost,
			counter: crypto.randomInt(s.counterMin, s.counterMax + 1), // deterministic mode
			deriveKey,
			expiresAt: new Date(Date.now() + s.expiry * 1000),
			hmacSignatureSecret: deriveSecret('signature'),
			hmacKeySignatureSecret: deriveSecret('key-signature'),
		});
		res.set('Cache-Control', 'no-store');
		res.json(challenge);
	} catch (err) {
		winston.error(`[plugins/altcha] challenge error: ${err.stack || err.message}`);
		res.status(500).json({ error: 'internal-error' });
	}
}

/* ---------- registration hooks ---------- */

plugin.addWidget = async function (data) {
	const s = await getSettings();
	const attrs = {
		id: 'altcha-widget',
		name: 'altcha',
		challenge: `${nconf.get('relative_path')}/api/altcha/challenge`,
		type: 'checkbox',
		display: 'standard',
		auto: s.auto,
		'data-script': resolveScriptUrl(s),
	};
	const attrString = Object.entries(attrs)
		.map(([k, v]) => `${k}="${validator.escape(String(v))}"`)
		.join(' ');

	data.templateData.regFormEntry = data.templateData.regFormEntry || [];
	data.templateData.regFormEntry.push({
		label: '[[altcha:label]]',
		html: `<altcha-widget ${attrString}></altcha-widget>`,
		styleName: 'altcha',
	});
	return data;
};

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

// One-time use: atomic increment works across NodeBB cluster processes on redis/mongo/postgres.
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

plugin.checkRegistration = async function (data) {
	const payload = decodePayload(data.req && data.req.body && data.req.body.altcha);
	if (!payload) {
		throw new Error('[[altcha:error-required]]');
	}

	const { verifySolution, deriveKey } = await loadLib();
	let result;
	try {
		result = await verifySolution({
			challenge: payload.challenge,
			solution: payload.solution,
			deriveKey,
			hmacSignatureSecret: deriveSecret('signature'),
			hmacKeySignatureSecret: deriveSecret('key-signature'),
		});
	} catch (err) {
		throw new Error('[[altcha:error-invalid]]');
	}

	if (result.expired) {
		throw new Error('[[altcha:error-expired]]');
	}
	if (!result.verified) {
		throw new Error('[[altcha:error-invalid]]');
	}
	// Only record the challenge as used after it verified successfully.
	if (!(await consumeChallenge(payload.challenge))) {
		throw new Error('[[altcha:error-used]]');
	}
	return data;
};

/* ---------- ACP ---------- */

plugin.init = async function ({ router }) {
	routeHelpers.setupAdminPageRoute(router, '/admin/plugins/altcha', [], async (req, res) => {
		res.render('admin/plugins/altcha', { title: 'ALTCHA' });
	});
	router.get('/api/altcha/challenge', challengeHandler);
	router.get('/altcha/widget.js', widgetHandler);

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
