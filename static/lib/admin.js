'use strict';

/* global $, define */

define('admin/plugins/altcha', ['settings', 'alerts'], function (Settings, alerts) {
	const ACP = {};

	ACP.init = function () {
		const $form = $('.altcha-settings');

		Settings.load('altcha', $form, function () {
			// The server knows the effective state (including defaults for never-saved keys),
			// so it is authoritative for the switches.
			$form.find('[data-effective]').each(function () {
				$(this).prop('checked', $(this).attr('data-effective') === '1');
			});
		});

		$('#save').on('click', function () {
			Settings.save('altcha', $form, function () {
				alerts.success('ALTCHA settings saved');
			});
		});
	};

	return ACP;
});
