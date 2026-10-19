'use strict';

/* global $, require */

$(document).ready(function () {
	let pending = null;

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

	// Wait until the widget has written its hidden "altcha" field before re-submitting.
	function payloadReady(form, cb, tries) {
		const input = form.querySelector('input[name="altcha"]');
		if ((input && input.value) || tries <= 0) {
			return cb();
		}
		setTimeout(function () { payloadReady(form, cb, tries - 1); }, 50);
	}

	function bind() {
		const widget = document.getElementById('altcha-widget');
		const form = widget && widget.closest('form');
		if (!widget || !form || form.dataset.altchaBound) {
			return;
		}
		form.dataset.altchaBound = '1';
		loadWidgetScript(widget.getAttribute('data-script'));

		// NodeBB submits registration via a click handler + ajaxSubmit, so the widget's own
		// auto="onsubmit" never fires. Gate the Register button instead (capture phase).
		form.addEventListener('click', function (e) {
			const btn = e.target.closest('#register');
			if (!btn) {
				return;
			}
			const loaded = typeof widget.getState === 'function';
			if (loaded && widget.getState() === 'verified') {
				return; // let NodeBB's handler run
			}

			e.preventDefault();
			e.stopImmediatePropagation();

			if (!loaded) {
				require(['alerts'], function (alerts) {
					alerts.error('[[altcha:loading]]');
				});
				return;
			}

			if (pending) {
				widget.removeEventListener('verified', pending);
			}
			pending = function () {
				pending = null;
				payloadReady(form, function () { btn.click(); }, 40);
			};
			widget.addEventListener('verified', pending, { once: true });
			if (widget.getState() !== 'verifying') {
				widget.verify();
			}
		}, true);
	}

	$(window).on('action:ajaxify.end', bind);
	bind();

	// A challenge is single-use: after any /register response, get a fresh one.
	$(document).ajaxComplete(function (ev, xhr, opts) {
		const url = ((opts && opts.url) || '').split('?')[0];
		if (!/\/register$/.test(url)) {
			return;
		}
		const widget = document.getElementById('altcha-widget');
		if (widget && typeof widget.reset === 'function') {
			widget.reset();
		}
	});
});
