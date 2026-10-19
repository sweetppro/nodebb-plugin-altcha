'use strict';

/* global $, define */

define('admin/plugins/altcha', ['settings', 'alerts'], function (Settings, alerts) {
	const ACP = {};

	ACP.init = function () {
		Settings.load('altcha', $('.altcha-settings'));

		$('#save').on('click', function () {
			Settings.save('altcha', $('.altcha-settings'), function () {
				alerts.success('ALTCHA settings saved');
			});
		});
	};

	return ACP;
});
