'use strict';

/* global $, ajaxify, require */

$(document).ready(function () {
	const FORMS = {
		register: { button: '#register', ajaxUrl: /\/register$/ },
		login: { button: '#login', ajaxUrl: /\/login$/ },
		reset: { button: '#reset', ajaxUrl: null }, // sent over socket.io, handled separately
	};

	let resetCtx = null;

	function loadWidgetScript(url) {
		if (!url || (window.customElements && window.customElements.get('altcha-widget'))) {
			return;
		}
		if (document.querySelector('script[data-altcha-script]')) {
			return;
		}
		const script = document.createElement('script');
		script.type = 'module';
		script.async = true;
		script.src = url;
		script.setAttribute('data-altcha-script', '1');
		document.head.appendChild(script);
	}

	function readPayload(wrapper) {
		const input = wrapper.querySelector('input[name="altcha"]') || document.querySelector('input[name="altcha"]');
		return (input && input.value) || wrapper.getAttribute('data-payload') || '';
	}

	function payloadReady(wrapper, cb, tries) {
		if (readPayload(wrapper) || tries <= 0) {
			return cb();
		}
		setTimeout(function () { payloadReady(wrapper, cb, tries - 1); }, 50);
	}

	function resetWidget() {
		const widget = document.getElementById('altcha-widget');
		if (widget && typeof widget.reset === 'function') {
			widget.reset();
		}
		const wrapper = document.querySelector('.altcha-wrapper');
		if (wrapper) {
			wrapper.removeAttribute('data-payload');
		}
	}

	// Put the widget right before the submit button (or the top-level block that contains it).
	function placeBefore(btn, wrapper) {
		let node = btn;
		const form = btn.closest('form');
		if (form) {
			while (node.parentElement && node.parentElement !== form) {
				node = node.parentElement;
			}
		}
		node.parentNode.insertBefore(wrapper, node);
	}

	// Reset only: attach the payload when the checkbox is already complete.
	// An unchecked widget is left alone so submit does not start verification.
	function installSocketWrap() {
		const sock = window.socket || (typeof socket !== 'undefined' ? socket : null); // eslint-disable-line no-undef
		if (!sock || sock.altchaWrapped) {
			return;
		}
		const orig = sock.emit;
		sock.emit = function () {
			const args = Array.prototype.slice.call(arguments);
			if (args[0] !== 'user.reset.send' || !resetCtx) {
				return orig.apply(this, args);
			}
			// reset.js emits only after the email check passes.
			const widget = resetCtx.widget;
			const wrapper = resetCtx.wrapper;
			if (!widget || typeof widget.getState !== 'function' || widget.getState() !== 'verified') {
				return orig.apply(this, args);
			}
			const email = typeof args[1] === 'string' ? args[1] : (args[1] && args[1].email);
			function send() {
				const next = args.slice();
				next[1] = { email: email, altcha: readPayload(wrapper) };
				for (let i = 2; i < next.length; i++) {
					if (typeof next[i] === 'function') {
						const cb = next[i];
						next[i] = function () {
							resetWidget(); // challenges are single-use
							return cb.apply(this, arguments);
						};
						break;
					}
				}
				return orig.apply(sock, next);
			}
			payloadReady(wrapper, send, 40);
		};
		sock.altchaWrapped = true;
	}

	function setup() {
		const cfg = ajaxify.data && ajaxify.data.altcha;
		if (!cfg || !FORMS[cfg.form]) {
			resetCtx = null;
			return;
		}
		const spec = FORMS[cfg.form];
		const btn = document.querySelector(spec.button);
		const existing = document.getElementById('altcha-widget');
		if (!btn || existing) {
			// setup() runs on ready and again on ajaxify.end. Keep the reset
			// payload hook pointed at the widget that is already on the page.
			if (cfg.form === 'reset' && existing) {
				const wrapper = existing.closest('.altcha-wrapper');
				if (wrapper) {
					resetCtx = { widget: existing, wrapper: wrapper };
					installSocketWrap();
				}
			} else {
				resetCtx = null;
			}
			return;
		}
		resetCtx = null;

		const wrapper = document.createElement('div');
		wrapper.className = 'mb-3 altcha-wrapper';

		const widget = document.createElement('altcha-widget');
		widget.id = 'altcha-widget';
		widget.setAttribute('name', 'altcha');
		widget.setAttribute('challenge', cfg.challenge);
		// Always off. `onload` runs on mount, and `onfocus` also runs when NodeBB
		// focuses the username or the browser restores focus on refresh.
		widget.setAttribute('auto', 'off');
		if (window.customElements && customElements.get('altcha-widget')) {
			widget.auto = 'off';
		}
		widget.setAttribute('type', 'checkbox');
		widget.setAttribute('display', 'standard');

		// Remember the payload even if the widget isn't inside a <form> (the reset page may not be).
		widget.addEventListener('verified', function (ev) {
			if (ev.detail && ev.detail.payload) {
				wrapper.setAttribute('data-payload', ev.detail.payload);
			}
		});
		widget.addEventListener('statechange', function (ev) {
			if (ev.detail && ev.detail.state && ev.detail.state !== 'verified') {
				wrapper.removeAttribute('data-payload');
			}
		});

		wrapper.appendChild(widget);
		placeBefore(btn, wrapper);
		loadWidgetScript(cfg.scriptUrl);

		if (cfg.form === 'reset') {
			resetCtx = { widget: widget, wrapper: wrapper };
			installSocketWrap();
		}
	}

	$(window).on('action:ajaxify.end', setup);
	setup();

	// A challenge is single-use: after any POST to /register or /login, get a fresh one.
	$(document).ajaxComplete(function (ev, xhr, opts) {
		const cfg = ajaxify.data && ajaxify.data.altcha;
		const spec = cfg && FORMS[cfg.form];
		if (!spec || !spec.ajaxUrl) {
			return;
		}
		const method = String((opts && (opts.type || opts.method)) || '').toUpperCase();
		const url = ((opts && opts.url) || '').split('?')[0];
		if (method === 'POST' && spec.ajaxUrl.test(url)) {
			resetWidget();
		}
	});
});
